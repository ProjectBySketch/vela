import React, { useMemo, useRef, useState } from 'react';
import {
  ArcEvent,
  ArcObject,
  CompiledWebOutput,
  ConcurrencyEvent,
  Diagnostic,
  Scene3DObject,
  VelaSymbol,
} from '../vela/types';
import { compileAndRunVela, exportSceneToObj, VelaReplSession, ReplEntry } from '../vela';
import { parseVelaManifest, VelaProjectFile } from '../vela/projects';
import {
  BookOpen,
  CheckCircle2,
  Download,
  Package,
  Play,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';

interface RepoTestCase {
  id: string;
  name: string;
  code: string;
  expectedOut?: string;
}

interface SpecDocInfo {
  file: string;
  title: string;
  excerpt: string;
  lines: number;
}

interface LanguageToolsPanelProps {
  diagnostics: Diagnostic[];
  stdout: string[];
  symbols: VelaSymbol[];
  cCode: string;
  arcObjects: ArcObject[];
  arcEvents: ArcEvent[];
  concurrencyEvents: ConcurrencyEvent[];
  webOutput: CompiledWebOutput | null;
  scene3dFull?: { name: string; objects: Scene3DObject[] };
  projectFiles: VelaProjectFile[];
  repoTests: RepoTestCase[];
  specs: SpecDocInfo[];
  onLoadCode: (code: string) => void;
}

const STDLIB_MODULES = [
  {
    mod: 'std::core & Generics',
    summary: 'Generic functions <T: Trait>, first-class move || closures, Option/Result, units (100.m / 9.58.s), defer LIFO',
    snippet: `fn apply<T>(xs: List<T>, f: Func(T) -> T) -> List<T> {
  [f(x) for x in xs]
}
fn main() {
  let squared = apply([2, 4, 6], |n| n * n)
  println("Squared: \${squared}")
}`,
  },
  {
    mod: 'web & ui',
    summary: 'Zero-cascade theme/style tokens, @island components, multi-page routes, and http.route/dispatch',
    snippet: `fn main() {
  http.route("GET", "/health", "healthCheck")
  println("Registered routes: \${http.routes()}")
  println("Test dispatch: \${http.dispatch("GET", "/health")}")
}`,
  },
  {
    mod: 'os & kernel',
    summary: 'MMIO register blocks, 0xB8000 VGA console, UART 16550, PIT/PS2 IRQs, and in-kernel os.ramfsWrite/Read',
    snippet: `fn main() {
  os.ramfsWrite("/etc/motd", "VelaOS 0.3.0 ready")
  println("RamFS files: \${os.ramfsLs()}")
  println("Boot info: \${os.bootInfo()}")
}`,
  },
  {
    mod: 'gfx3d & game',
    summary: 'Procedural scene3d composite models, Wavefront .obj export, and deterministic game.body/step/collides loop',
    snippet: `fn main() {
  let ship = game.body("Ship", 0.0, 0.0, 4.0, 0.0, 1.0)
  let rock = game.body("Asteroid", 1.5, 0.0, -1.0, 0.0, 0.8)
  game.step([ship, rock], 0.25)
  println("Collides after 0.25s: \${game.collides(ship, rock)}")
}`,
  },
  {
    mod: 'ai & db',
    summary: 'Static-shape Tensors, nn.softmax/relu, reverse-mode autodiff train.mlpXor, and typed SQL db.exec/query',
    snippet: `fn main() {
  let probs = nn.softmax(tensor.of([[1.0, 2.5, 0.5]]))
  println("Softmax: \${probs.toList()}")
  db.exec("CREATE TABLE items (id INT, name TEXT)")
  db.exec("INSERT INTO items (id, name) VALUES ($1, $2)", [1, "Vela Toolkit"])
  println("DB rows: \${db.query("SELECT id, name FROM items")?}")
}`,
  },
  {
    mod: 'async & memory',
    summary: 'Structured async fn, TaskGroup, bounded Channel<T>, deterministic ARC retain/release & cycle collection',
    snippet: `async fn ping(ch: Channel<Str>) {
  await time.sleep(5)
  ch.send("pong from task")
}
async fn main() {
  let ch = Channel(2)
  let t = spawn ping(ch)
  await t
  println("Received: \${await ch.recv()}")
}`,
  },
];

function downloadBlob(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const LanguageToolsPanel: React.FC<LanguageToolsPanelProps> = ({
  diagnostics,
  stdout,
  symbols,
  cCode,
  arcObjects,
  concurrencyEvents,
  webOutput,
  scene3dFull,
  projectFiles,
  repoTests,
  specs,
  onLoadCode,
}) => {
  const [subTab, setSubTab] = useState<'console' | 'lint' | 'stdlib' | 'pkg' | 'tests'>('console');
  const [replInput, setReplInput] = useState('');
  const [replHistory, setReplHistory] = useState<ReplEntry[]>([]);
  const replRef = useRef<VelaReplSession | null>(null);

  const [testResults, setTestResults] = useState<{ name: string; passed: boolean; actual: string; expected: string }[] | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [activeSpec, setActiveSpec] = useState<SpecDocInfo | null>(null);
  const [showBuildTargets, setShowBuildTargets] = useState(false);

  if (!replRef.current) {
    replRef.current = new VelaReplSession();
  }

  const manifest = useMemo(() => {
    const pkgFile = projectFiles.find((f) => f.path === 'vela.pkg');
    return parseVelaManifest(pkgFile?.content || '');
  }, [projectFiles]);

  const handleReplSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replInput.trim()) return;
    const entry = await replRef.current!.evalLine(replInput);
    setReplHistory((prev) => [...prev, entry]);
    setReplInput('');
  };

  const runConformanceSuite = async () => {
    setRunningTests(true);
    const out: { name: string; passed: boolean; actual: string; expected: string }[] = [];
    for (const tc of repoTests) {
      const res = await compileAndRunVela(tc.code, false);
      const actual = res.stdout.join('\n').trim();
      const expected = (tc.expectedOut ?? '').trim();
      out.push({
        name: tc.name,
        passed: res.success && actual === expected,
        actual,
        expected,
      });
    }
    setTestResults(out);
    setRunningTests(false);
  };

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity !== 'error').length;

  return (
    <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden flex flex-col">
      {/* Tooling Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-[#0D131F]">
        <div className="flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'console', label: 'Console & REPL' },
            { id: 'lint', label: `Lint & Symbols (${symbols.length})` },
            { id: 'stdlib', label: 'Stdlib & Guide' },
            { id: 'pkg', label: 'Package (vela.pkg)' },
            { id: 'tests', label: `Tests & Specs (${repoTests.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id as typeof subTab)}
              className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                subTab === t.id ? 'bg-white/15 text-white font-medium' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-400">
          {errorCount} errors · {warnCount} lints
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 flex-1 min-h-[340px] max-h-[520px] overflow-auto">
        {subTab === 'console' && (
          <div className="space-y-4">
            {diagnostics.filter((d) => d.severity === 'error').length > 0 && (
              <div className="space-y-1.5">
                {diagnostics
                  .filter((d) => d.severity === 'error')
                  .map((d, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 rounded-lg border text-xs font-mono bg-rose-500/10 border-rose-500/30 text-rose-200"
                    >
                      <span className="font-semibold">
                        [{d.code}] line {d.line}:{d.col}
                      </span>{' '}
                      — {d.message}
                      {d.hint && <div className="text-slate-400 mt-0.5">hint: {d.hint}</div>}
                    </div>
                  ))}
              </div>
            )}

            <div className="rounded-lg bg-[#0B0F17] border border-white/10 p-3">
              <div className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center justify-between">
                <span>Program Output</span>
                <span className="font-mono tabular-nums">{stdout.length} lines</span>
              </div>
              <pre className="text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap max-h-44 overflow-auto">
                {stdout.length > 0 ? stdout.join('\n') : '(run your Vela program to view output)'}
              </pre>
            </div>

            {/* Interactive Stateful Vela REPL */}
            <div className="rounded-lg bg-[#0B0F17] border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#0E1420]">
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-teal-400" />
                  Interactive Vela REPL (vela repl)
                </span>
                <button
                  onClick={() => {
                    replRef.current?.reset();
                    setReplHistory([]);
                  }}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                  title="Clear REPL session"
                >
                  <Trash2 className="w-3 h-3" />
                  Reset
                </button>
              </div>

              <div className="p-3 space-y-2 max-h-40 overflow-auto text-xs font-mono">
                {replHistory.length === 0 ? (
                  <div className="text-slate-500">
                    Try <code className="text-teal-300">let x = [1, 2, 3].map(|n| n * 10)</code> or{' '}
                    <code className="text-teal-300">:help</code>
                  </div>
                ) : (
                  replHistory.map((item) => (
                    <div key={item.id} className="space-y-0.5">
                      <div className="text-teal-300">vela&gt; {item.input}</div>
                      {item.stdout.map((line, li) => (
                        <div key={li} className="text-slate-200 pl-3">
                          {line}
                        </div>
                      ))}
                      {item.result !== undefined && (
                        <div className="text-sky-300 pl-3">=&gt; {item.result}</div>
                      )}
                      {item.error && <div className="text-rose-400 pl-3">error: {item.error}</div>}
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleReplSubmit} className="flex items-center border-t border-white/10 bg-[#090D14]">
                <span className="pl-3 text-xs font-mono text-teal-400 select-none">vela&gt;</span>
                <input
                  type="text"
                  value={replInput}
                  onChange={(e) => setReplInput(e.target.value)}
                  placeholder="Evaluate expression, let binding, or :type / :env / :help"
                  className="flex-1 px-2 py-2 bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3 py-2 text-xs font-medium text-teal-400 hover:text-teal-300"
                >
                  Eval
                </button>
              </form>
            </div>
          </div>
        )}

        {subTab === 'lint' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">
                Type Checker &amp; Language Linter ({diagnostics.length})
              </div>
              {diagnostics.length === 0 ? (
                <div className="px-3 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Clean check — 0 type errors and 0 style/safety lint warnings.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {diagnostics.map((d, i) => (
                    <div
                      key={i}
                      className={`px-3 py-2 rounded-lg border text-xs font-mono ${
                        d.severity === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                          : d.severity === 'warning'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : 'bg-sky-500/10 border-sky-500/30 text-sky-200'
                      }`}
                    >
                      <span className="font-semibold">
                        [{d.code}] line {d.line}:{d.col}
                      </span>{' '}
                      — {d.message}
                      {d.hint && <div className="text-slate-400 mt-0.5 font-sans">hint: {d.hint}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">
                Language Symbols Outline ({symbols.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {symbols.map((sym, idx) => (
                  <div
                    key={`${sym.name}-${idx}`}
                    className="px-3 py-2 rounded-lg bg-[#0B0F17] border border-white/5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-white truncate">{sym.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{sym.detail}</div>
                    </div>
                    <span className="font-mono text-[11px] text-teal-400 shrink-0">L{sym.line}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === 'stdlib' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-teal-400" />
              Built-in Vela Standard Library Modules &amp; Domain Builders
            </div>
            <div className="space-y-2.5">
              {STDLIB_MODULES.map((m) => (
                <div
                  key={m.mod}
                  className="p-3 rounded-lg bg-[#0B0F17] border border-white/10 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white font-mono">{m.mod}</span>
                    <button
                      onClick={() => onLoadCode(m.snippet)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-teal-500/15 text-teal-300 hover:bg-teal-500/25 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Play className="w-3 h-3" />
                      Run Snippet
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">{m.summary}</div>
                  <pre className="p-2 rounded bg-[#070A10] text-[11px] font-mono text-slate-300 overflow-x-auto">
                    {m.snippet}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {subTab === 'pkg' && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white font-display flex items-center gap-2">
                  <Package className="w-4 h-4 text-teal-400" />
                  {manifest.name} · v{manifest.version}
                </span>
                <span className="text-xs font-mono text-teal-400">profile: {manifest.profile}</span>
              </div>
              <div className="text-xs text-slate-400">{manifest.description}</div>
              <div className="text-xs font-mono text-slate-400 pt-1">
                entry: {manifest.entry} · files: {projectFiles.length}
              </div>
              {Object.keys(manifest.dependencies).length > 0 && (
                <div className="pt-2 border-t border-white/5 text-xs">
                  <div className="text-slate-400 mb-1">Dependencies:</div>
                  <div className="flex flex-wrap gap-3 font-mono text-slate-300">
                    {Object.entries(manifest.dependencies).map(([k, v]) => (
                      <span key={k}>
                        {k}@{v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">Export Build Artifacts</div>
              <div className="flex flex-wrap gap-2">
                {webOutput && (
                  <button
                    onClick={() => downloadBlob(`${manifest.name}.html`, webOutput.bundleHtml, 'text/html;charset=utf-8')}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export Website (index.html)
                  </button>
                )}
                {scene3dFull && scene3dFull.objects.length > 0 && (
                  <button
                    onClick={() =>
                      downloadBlob(
                        `${scene3dFull.name || 'model'}.obj`,
                        exportSceneToObj(scene3dFull.name, scene3dFull.objects)
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export 3D Model (.obj)
                  </button>
                )}
                <button
                  onClick={() => downloadBlob(`${manifest.name}.c`, cCode)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Portable C11 Target
                </button>
                <a
                  href="/api/export-zip"
                  download="vela-all-files.zip"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-teal-300 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download All Files (.zip)
                </a>
              </div>
            </div>

            <div className="pt-2 border-t border-white/10">
              <button
                onClick={() => setShowBuildTargets((v) => !v)}
                className="text-xs text-slate-400 hover:text-white underline"
              >
                {showBuildTargets ? 'Hide' : 'Show'} Runtime ARC &amp; Async Diagnostics ({arcObjects.length} allocs · {concurrencyEvents.length} tasks)
              </button>
              {showBuildTargets && (
                <div className="mt-2 space-y-2 text-xs font-mono">
                  <div className="text-slate-400">
                    ARC: {arcObjects.length} allocated, {arcObjects.filter((o) => o.freed).length} freed · Async events: {concurrencyEvents.length}
                  </div>
                  <pre className="p-2.5 rounded-lg bg-[#0B0F17] border border-white/5 text-[11px] text-sky-100/80 max-h-36 overflow-auto">
                    {cCode}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {subTab === 'tests' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-400">
                Repository test suite (<code className="text-slate-300">tests/cases/*.vela</code>)
              </div>
              <button
                onClick={runConformanceSuite}
                disabled={runningTests}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                {runningTests ? 'Running...' : 'Run Test Suite'}
              </button>
            </div>

            {testResults ? (
              <div className="divide-y divide-white/5 border border-white/10 rounded-lg overflow-hidden">
                {testResults.map((tr) => (
                  <div key={tr.name} className="flex items-center justify-between px-3 py-2 text-xs bg-[#0B0F17]">
                    <div className="flex items-center gap-2 font-mono text-slate-200">
                      {tr.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      {tr.name}
                    </div>
                    <div className="text-slate-400 font-mono">
                      {tr.passed ? 'PASS' : `FAIL: ${tr.actual.slice(0, 36)}`}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {repoTests.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onLoadCode(t.code)}
                    className="px-2.5 py-2 text-xs font-mono text-left rounded-lg bg-[#0B0F17] border border-white/10 hover:border-teal-500/60 text-slate-300 truncate"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}

            {specs.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs font-medium text-slate-300">
                  Language Specification Reference ({specs.length} docs)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {specs.map((sp) => (
                    <button
                      key={sp.file}
                      onClick={() => setActiveSpec(sp)}
                      className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                        activeSpec?.file === sp.file
                          ? 'bg-teal-500/20 border-teal-500 text-teal-200'
                          : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      {sp.file.replace('.md', '')}
                    </button>
                  ))}
                </div>
                {activeSpec && (
                  <div className="p-3 rounded-lg bg-[#0B0F17] border border-white/10 space-y-1.5">
                    <div className="text-xs font-semibold text-white">
                      {activeSpec.title} · {activeSpec.lines} lines
                    </div>
                    <pre className="text-[11px] font-mono text-slate-400 whitespace-pre-wrap max-h-36 overflow-auto">
                      {activeSpec.excerpt}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
