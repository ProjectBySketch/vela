#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  compileAndRunVela,
  compileAndRunProject,
  createZipArchive,
  exportSceneToObj,
  formatVela,
  VELA_PROJECT_TEMPLATES,
  VelaReplSession,
  ZipInputFile,
} from '../src/vela';
import { emitC11, emitKernelC } from '../src/vela/codegen';
import { lexVela } from '../src/vela/lexer';
import { parseVela } from '../src/vela/parser';

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`vela 0.3.0 — Vela Language Toolkit

Usage:
  vela run <file.vela | dir>           Run a Vela file or project (with vela.pkg)
  vela fmt [--write] <file.vela>       Format Vela code per canonical style rules
  vela lint <file.vela>                Check types and language style/safety lints
  vela check <file.vela>               Typecheck without executing
  vela new <template> <dir>            Scaffold a project (tour|website|kernel|model3d_sat|ai_db)
  vela emit-c <file.vela> [out.c]       Emit portable C11 for the core profile
  vela emit-kernel <file.vela> [out.c]  Emit freestanding x86_64 kernel C (sys profile)
  vela build-web <file.vela> [out.html] Compile Vela web/UI file to standalone HTML bundle
  vela export-obj <file.vela> [out.obj] Export Vela 3D scene3d model to Wavefront .obj
  vela zip [out.zip]                   Package all workspace files into a .zip archive
  vela test                            Run repository golden conformance tests
  vela repl                            Start interactive Vela REPL`);
    return;
  }

  if (cmd === 'run') {
    const target = args[1];
    if (!target) {
      console.error('Usage: vela run <file.vela | project-dir>');
      process.exit(1);
    }
    const resolved = path.resolve(target);
    let res;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      const srcDir = path.join(resolved, 'src');
      const files: { path: string; content: string }[] = [];
      if (fs.existsSync(srcDir)) {
        for (const f of fs.readdirSync(srcDir)) {
          if (f.endsWith('.vela')) {
            files.push({ path: `src/${f}`, content: fs.readFileSync(path.join(srcDir, f), 'utf-8') });
          }
        }
      }
      res = await compileAndRunProject(files, 'src/main.vela');
    } else {
      const code = fs.readFileSync(resolved, 'utf-8');
      res = await compileAndRunVela(code);
    }
    for (const d of res.diagnostics) {
      if (d.severity === 'error') {
        console.error(`[${d.code}] line ${d.line}:${d.col}: ${d.message}`);
      }
    }
    if (res.stdout.length > 0) console.log(res.stdout.join('\n'));
    if (!res.success) process.exit(3);
    return;
  }

  if (cmd === 'fmt') {
    const write = args.includes('--write') || args.includes('-w');
    const file = args.find((a, i) => i > 0 && !a.startsWith('-'));
    if (!file) {
      console.error('Usage: vela fmt [--write] <file.vela>');
      process.exit(1);
    }
    const raw = fs.readFileSync(file, 'utf-8');
    const formatted = formatVela(raw);
    if (write) {
      fs.writeFileSync(file, formatted, 'utf-8');
      console.log(`Formatted ${file}`);
    } else {
      process.stdout.write(formatted);
    }
    return;
  }

  if (cmd === 'lint' || cmd === 'check') {
    const file = args[1];
    if (!file) {
      console.error(`Usage: vela ${cmd} <file.vela>`);
      process.exit(1);
    }
    const raw = fs.readFileSync(file, 'utf-8');
    const res = await compileAndRunVela(raw, cmd === 'lint');
    if (res.diagnostics.length === 0) {
      console.log(`OK: ${file} (0 issues)`);
      return;
    }
    for (const d of res.diagnostics) {
      console.log(`${d.severity.toUpperCase()} [${d.code}] ${file}:${d.line}:${d.col} — ${d.message}`);
      if (d.hint) console.log(`  hint: ${d.hint}`);
    }
    if (res.diagnostics.some((d) => d.severity === 'error')) process.exit(3);
    return;
  }

  if (cmd === 'new') {
    const tplId = args[1] || 'tour';
    const outDir = path.resolve(args[2] || `vela-${tplId}`);
    const tpl = VELA_PROJECT_TEMPLATES.find((t) => t.id === tplId) || VELA_PROJECT_TEMPLATES[0];
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of tpl.files) {
      const dest = path.join(outDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content, 'utf-8');
    }
    console.log(`Created Vela project '${tpl.name}' in ${outDir}`);
    return;
  }

  if (cmd === 'emit-c' || cmd === 'emit-kernel') {
    const file = args[1];
    if (!file) {
      console.error(`Usage: vela ${cmd} <file.vela> [out.c]`);
      process.exit(1);
    }
    const isKernel = cmd === 'emit-kernel';
    const outFile = path.resolve(args[2] || (isKernel ? 'kernel.c' : 'program.c'));
    const { tokens } = lexVela(fs.readFileSync(file, 'utf-8'));
    const { ast, diagnostics } = parseVela(tokens);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      for (const d of errors) console.error(`[${d.code}] ${file}:${d.line}:${d.col} — ${d.message}`);
      process.exit(3);
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, isKernel ? emitKernelC(ast) : emitC11(ast), 'utf-8');
    if (isKernel) {
      console.log(`Emitted freestanding kernel C -> ${outFile}`);
      console.log('That is the sys profile: no libc, no allocator, no Vela runtime.');
      console.log(`  clang -target x86_64-none-elf -ffreestanding -nostdlib -O2 -c ${path.basename(outFile)} -o kernel.o`);
    } else {
      console.log(`Emitted portable C11 -> ${outFile}`);
      console.log(`  cc -std=c11 ${path.basename(outFile)} ../runtime/vela_runtime.c -o program`);
    }
    return;
  }

  if (cmd === 'build-web') {
    const file = args[1];
    const outFile = args[2] || 'dist-web/index.html';
    if (!file) {
      console.error('Usage: vela build-web <file.vela> [out.html]');
      process.exit(1);
    }
    const res = await compileAndRunVela(fs.readFileSync(file, 'utf-8'));
    if (!res.webOutput) {
      console.error('No theme/style/page/view declarations found.');
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(path.resolve(outFile), res.webOutput.bundleHtml, 'utf-8');
    console.log(`Built standalone website -> ${outFile} (${res.webOutput.routes.length} routes)`);
    return;
  }

  if (cmd === 'export-obj') {
    const file = args[1];
    const outFile = args[2] || 'model.obj';
    if (!file) {
      console.error('Usage: vela export-obj <file.vela> [out.obj]');
      process.exit(1);
    }
    const res = await compileAndRunVela(fs.readFileSync(file, 'utf-8'));
    if (!res.scene3dFull || res.scene3dFull.objects.length === 0) {
      console.error('No scene3d declarations found.');
      process.exit(1);
    }
    const obj = exportSceneToObj(res.scene3dFull.name, res.scene3dFull.objects);
    fs.writeFileSync(path.resolve(outFile), obj, 'utf-8');
    console.log(`Exported ${res.scene3dFull.objects.length} 3D parts -> ${outFile}`);
    return;
  }

  if (cmd === 'zip') {
    const outFile = path.resolve(args[1] || 'vela-all-files.zip');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const ignoreDirs = new Set(['node_modules', 'build', 'dist', '.git', '.aistudio']);
    const collected: ZipInputFile[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ignoreDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && !entry.name.endsWith('.zip')) {
          collected.push({
            path: path.relative(root, full).replace(/\\/g, '/'),
            content: new Uint8Array(fs.readFileSync(full)),
          });
        }
      }
    };
    walk(root);
    collected.sort((a, b) => a.path.localeCompare(b.path));
    const zipBytes = createZipArchive(collected);
    fs.writeFileSync(outFile, zipBytes);
    console.log(`Packaged ${collected.length} files -> ${outFile} (${zipBytes.length} bytes)`);
    return;
  }

  if (cmd === 'test') {
    const casesDir = path.resolve('tests/cases');
    const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.vela')).sort();
    let passed = 0;
    for (const f of files) {
      const code = fs.readFileSync(path.join(casesDir, f), 'utf-8');
      const expected = fs.readFileSync(path.join(casesDir, f.replace(/\.vela$/, '.out')), 'utf-8').trim();
      const res = await compileAndRunVela(code);
      const actual = res.stdout.join('\n').trim();
      if (res.success && actual === expected) {
        passed++;
        console.log(`PASS ${f}`);
      } else {
        console.error(`FAIL ${f}`);
        process.exitCode = 2;
      }
    }
    console.log(`${passed}/${files.length} tests passed`);
    return;
  }

  if (cmd === 'repl') {
    const repl = new VelaReplSession();
    console.log('Vela 0.3.0 Interactive REPL (type :help or :quit)');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'vela> ' });
    rl.prompt();
    rl.on('line', async (line) => {
      if (line.trim() === ':quit' || line.trim() === ':q') {
        rl.close();
        return;
      }
      const entry = await repl.evalLine(line);
      if (entry.stdout.length > 0) console.log(entry.stdout.join('\n'));
      if (entry.error) console.error(`error: ${entry.error}`);
      else if (entry.result !== undefined) console.log(`=> ${entry.result}`);
      rl.prompt();
    });
    return;
  }

  console.error(`Unknown command: ${cmd}. Run 'vela help'.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
