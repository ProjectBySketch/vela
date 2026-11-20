import { lexVela } from './lexer';
import { parseVela } from './parser';
import { typecheckVela } from './typechecker';
import { lintVela } from './linter';
import { formatVela } from './formatter';
import { compileWebTarget, emitC11, emitKernelC } from './codegen';
import { VelaRuntime } from './runtime';
import { bundleProjectSource, VelaProjectFile } from './projects';
import { CompileAndRunResult, ProgramAST, Stmt, VelaSymbol } from './types';

export { formatVela, lintVela };
export { VelaReplSession } from './repl';
export type { ReplEntry } from './repl';
export { exportSceneToObj } from './objExporter';
export { createZipArchive } from './zip';
export type { ZipInputFile } from './zip';
export * from './projects';

function extractSymbols(ast: ProgramAST): VelaSymbol[] {
  const out: VelaSymbol[] = [];
  const walk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      if (s.kind === 'FnStmt') {
        out.push({
          name: s.name,
          kind: 'fn',
          line: s.line,
          detail: `${s.isAsync ? 'async ' : ''}fn(${s.params.map((p) => p.name).join(', ')})`,
        });
      } else if (s.kind === 'StructStmt') {
        out.push({
          name: s.name,
          kind: 'struct',
          line: s.line,
          detail: `${s.isShared ? 'shared ' : ''}struct (${s.fields.length} fields)`,
        });
      } else if (s.kind === 'EnumStmt') {
        out.push({
          name: s.name,
          kind: 'enum',
          line: s.line,
          detail: `enum (${s.variants.length} variants)`,
        });
      } else if (s.kind === 'TraitStmt') {
        out.push({ name: s.name, kind: 'trait', line: s.line, detail: `trait (${s.methods.length} methods)` });
      } else if (s.kind === 'ModStmt') {
        out.push({ name: s.name, kind: 'mod', line: s.line, detail: `module (${s.body.length} items)` });
        walk(s.body);
      } else if (s.kind === 'ThemeStmt') {
        out.push({ name: s.name, kind: 'theme', line: s.line, detail: `theme (${s.tokens.length} tokens)` });
      } else if (s.kind === 'StyleStmt') {
        out.push({ name: s.name, kind: 'style', line: s.line, detail: `style (${s.props.length} props)` });
      } else if (s.kind === 'UiDeclStmt') {
        out.push({ name: s.name, kind: s.uiKind, line: s.line, detail: `${s.uiKind}${s.isIsland ? ' @island' : ''}` });
      } else if (s.kind === 'MmioStmt') {
        out.push({
          name: s.name,
          kind: 'mmio',
          line: s.line,
          detail: `mmio @ 0x${s.baseAddr.toString(16).toUpperCase()}`,
        });
      } else if (s.kind === 'Scene3DStmt') {
        out.push({ name: s.name, kind: 'scene3d', line: s.line, detail: '3D scene block' });
      }
    }
  };
  walk(ast.stmts);
  return out;
}

export async function compileAndRunVela(source: string, includeLints = true): Promise<CompileAndRunResult> {
  const t0 = performance.now();

  const { tokens, diagnostics: lexDiags } = lexVela(source);
  const { ast, diagnostics: parseDiags } = parseVela(tokens);
  const typeDiags = typecheckVela(ast);
  const lintDiags = includeLints ? lintVela(source, ast) : [];

  const diagnostics = [...lexDiags, ...parseDiags, ...typeDiags, ...lintDiags];
  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  const cCode = emitC11(ast);
  const kernelCode = emitKernelC(ast);
  const webOutput = compileWebTarget(ast);
  const symbols = extractSymbols(ast);

  const runtime = new VelaRuntime();
  if (!hasErrors) {
    await runtime.execute(ast);
  }

  const arcSnap = runtime.arc.snapshot();
  const durationMs = Number((performance.now() - t0).toFixed(2));

  return {
    success: !hasErrors,
    diagnostics,
    stdout: runtime.stdout,
    cCode,
    kernelCode,
    webOutput,
    arcObjects: arcSnap.objects,
    arcEvents: arcSnap.events,
    concurrencyEvents: runtime.concurrencyEvents,
    kernelState: runtime.kernel.snapshot(),
    scenes3d: runtime.scenes3d,
    scene3dFull: runtime.scene3dFull,
    sqlTables: runtime.db.snapshot(),
    httpRoutes: runtime.db.routes,
    mlSnapshot: runtime.ml.snapshot,
    symbols,
    durationMs,
    tokensCount: tokens.length,
    astStmtCount: ast.stmts.length,
  };
}

export async function compileAndRunProject(
  files: VelaProjectFile[],
  entryPath = 'src/main.vela'
): Promise<CompileAndRunResult> {
  const bundled = bundleProjectSource(files, entryPath);
  return compileAndRunVela(bundled, true);
}
