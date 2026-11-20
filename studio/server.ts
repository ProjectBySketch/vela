import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { compileAndRunVela, createZipArchive, ZipInputFile } from './src/vela/index.ts';

const STUDIO = path.dirname(fileURLToPath(import.meta.url));
// The studio lives inside the Vela repository and reads its examples, tests,
// spec and stdlib in place, so ROOT is the repository, not the studio folder.
const ROOT = path.resolve(process.env.VELA_ROOT ?? path.join(STUDIO, '..'));
const PORT = Number(process.env.PORT ?? 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, runtime: 'node', version: '0.3.0', root: ROOT });
  });

  app.get('/api/catalog', (_req, res) => {
    const readDirVela = (dirRel: string, kind: string) => {
      const full = path.join(ROOT, dirRel);
      if (!fs.existsSync(full)) return [];
      const items: { id: string; name: string; path: string; kind: string; code: string; expectedOut?: string }[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(p);
          } else if (entry.name.endsWith('.vela')) {
            const rel = path.relative(ROOT, p);
            const code = fs.readFileSync(p, 'utf-8');
            const outPath = p.replace(/\.vela$/, '.out');
            const expectedOut = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : undefined;
            items.push({
              id: rel,
              name: entry.name,
              path: rel,
              kind,
              code,
              expectedOut,
            });
          }
        }
      };
      walk(full);
      return items;
    };

    res.json({
      examples: readDirVela('examples', 'example'),
      tests: readDirVela('tests/cases', 'test'),
      specExamples: readDirVela('spec/examples', 'spec-example'),
      stdlib: readDirVela('stdlib', 'stdlib'),
    });
  });

  app.get('/api/specs', (_req, res) => {
    const specDir = path.join(ROOT, 'spec');
    if (!fs.existsSync(specDir)) {
      return res.json({ specs: [] });
    }
    const files = fs
      .readdirSync(specDir)
      .filter((f) => f.endsWith('.md') && /^\d{2}-/.test(f))
      .sort();

    const specs = files.map((f) => {
      const content = fs.readFileSync(path.join(specDir, f), 'utf-8');
      const firstLine = content.split('\n').find((l) => l.startsWith('# ')) || f;
      const title = firstLine.replace(/^#\s*/, '').trim();
      return {
        file: f,
        title,
        excerpt: content.slice(0, 1800),
        lines: content.split('\n').length,
      };
    });
    res.json({ specs });
  });

  app.post('/api/compile', async (req, res) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const result = await compileAndRunVela(code);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Compile error' });
    }
  });

  app.get('/api/export-zip', (_req, res) => {
    try {
      const ignoreDirs = new Set(['node_modules', 'build', 'dist', '.git', '.aistudio']);
      const collected: ZipInputFile[] = [];

      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (ignoreDirs.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            if (entry.name.endsWith('.zip')) continue;
            const rel = path.relative(ROOT, full).replace(/\\/g, '/');
            const data = fs.readFileSync(full);
            collected.push({ path: rel, content: new Uint8Array(data) });
          }
        }
      };
      walk(ROOT);
      collected.sort((a, b) => a.path.localeCompare(b.path));

      const zipBytes = createZipArchive(collected);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="vela-all-files.zip"');
      res.setHeader('Content-Length', String(zipBytes.length));
      res.send(Buffer.from(zipBytes));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Zip export error' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(STUDIO, 'dist')));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(STUDIO, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vela Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
