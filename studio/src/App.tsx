import React, { useCallback, useEffect, useState } from 'react';
import {
  compileAndRunProject,
  formatVela,
  VELA_PROJECT_TEMPLATES,
  VelaProjectFile,
  VelaProjectTemplate,
} from './vela';
import { CompileAndRunResult } from './vela/types';
import { ThreeViewport } from './components/ThreeViewport';
import { KernelPanel } from './components/KernelPanel';
import { WebPanel } from './components/WebPanel';
import { AiDataPanel } from './components/AiDataPanel';
import { LanguageToolsPanel } from './components/LanguageToolsPanel';
import { FileCode2, FilePlus, Play, Sparkles } from 'lucide-react';

type WorkspaceView = 'workspace' | 'web' | 'kernel' | 'models' | 'ai';

interface CatalogFile {
  id: string;
  name: string;
  path: string;
  kind: string;
  code: string;
  expectedOut?: string;
}

interface SpecDocInfo {
  file: string;
  title: string;
  excerpt: string;
  lines: number;
}

export function App() {
  const [view, setView] = useState<WorkspaceView>('workspace');
  const [activeTemplateId, setActiveTemplateId] = useState<string>(VELA_PROJECT_TEMPLATES[0].id);
  const [projectFiles, setProjectFiles] = useState<VelaProjectFile[]>(() =>
    VELA_PROJECT_TEMPLATES[0].files.map((f) => ({ ...f }))
  );
  const [activeFilePath, setActiveFilePath] = useState<string>('src/main.vela');
  const [result, setResult] = useState<CompileAndRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const [repoExamples, setRepoExamples] = useState<CatalogFile[]>([]);
  const [repoTests, setRepoTests] = useState<CatalogFile[]>([]);
  const [specs, setSpecs] = useState<SpecDocInfo[]>([]);

  const executeProject = useCallback(async (files: VelaProjectFile[]) => {
    setRunning(true);
    try {
      const entry = files.find((f) => f.path === 'src/main.vela')?.path || files.find((f) => f.path.endsWith('.vela'))?.path || 'src/main.vela';
      const res = await compileAndRunProject(files, entry);
      setResult(res);
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    executeProject(VELA_PROJECT_TEMPLATES[0].files);

    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setRepoExamples([
            ...(data.stdlib || []),
            ...(data.examples || []),
            ...(data.specExamples || []),
          ]);
          setRepoTests(data.tests || []);
        }
      })
      .catch(() => {});

    fetch('/api/specs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.specs) setSpecs(data.specs);
      })
      .catch(() => {});
  }, [executeProject]);

  const selectTemplate = (tpl: VelaProjectTemplate, targetView?: WorkspaceView) => {
    const cloned = tpl.files.map((f) => ({ ...f }));
    setActiveTemplateId(tpl.id);
    setProjectFiles(cloned);
    const entry = cloned.find((f) => f.path === 'src/main.vela')?.path || cloned[0].path;
    setActiveFilePath(entry);
    if (targetView) setView(targetView);
    executeProject(cloned);
  };

  const selectTemplateById = (id: string, targetView?: WorkspaceView) => {
    const tpl = VELA_PROJECT_TEMPLATES.find((t) => t.id === id);
    if (tpl) selectTemplate(tpl, targetView);
  };

  const handleNavClick = (nextView: WorkspaceView) => {
    setView(nextView);
    if (nextView === 'web' && !result?.webOutput) {
      selectTemplateById('website', 'web');
    } else if (
      nextView === 'kernel' &&
      (result?.kernelState.mmioLog.length ?? 0) === 0 &&
      (result?.kernelState.serialLog.length ?? 0) === 0
    ) {
      selectTemplateById('kernel', 'kernel');
    } else if (nextView === 'models' && !result?.scene3dFull) {
      selectTemplateById('model3d_sat', 'models');
    } else if (
      nextView === 'ai' &&
      (result?.mlSnapshot.epochs.length ?? 0) === 0 &&
      (result?.sqlTables.length ?? 0) === 0
    ) {
      selectTemplateById('ai_db', 'ai');
    }
  };

  const activeFile = projectFiles.find((f) => f.path === activeFilePath) || projectFiles[0];
  const updateActiveFileContent = (nextText: string) => {
    setProjectFiles((prev) =>
      prev.map((f) => (f.path === activeFile.path ? { ...f, content: nextText } : f))
    );
  };

  const loadSingleSnippet = (snippetCode: string) => {
    const nextFiles: VelaProjectFile[] = [
      {
        path: 'vela.pkg',
        content: `[package]\nname = "vela-scratch"\nversion = "0.3.0"\nprofile = "core"\nentry = "src/main.vela"\ndescription = "Vela snippet workspace"\n`,
      },
      { path: 'src/main.vela', content: snippetCode },
    ];
    setActiveTemplateId('');
    setProjectFiles(nextFiles);
    setActiveFilePath('src/main.vela');
    executeProject(nextFiles);
  };

  const handleFormatActiveFile = () => {
    if (!activeFile || !activeFile.path.endsWith('.vela')) return;
    const formatted = formatVela(activeFile.content);
    updateActiveFileContent(formatted);
  };

  const handleAddModule = () => {
    let idx = 1;
    while (projectFiles.some((f) => f.path === `src/mod${idx}.vela`)) idx++;
    const newPath = `src/mod${idx}.vela`;
    const newMod: VelaProjectFile = {
      path: newPath,
      content: `# Imported automatically when referenced via \`use mod${idx}::*\`\n\npub fn greet(name: Str) -> Str {\n  "Hello, \${name}!"\n}\n`,
    };
    const next = [...projectFiles, newMod];
    setProjectFiles(next);
    setActiveFilePath(newPath);
  };

  // Prefer src/main.vela for domain-specific views (web/kernel/models/ai)
  const mainVelaFile = projectFiles.find((f) => f.path === 'src/main.vela') || activeFile;
  const lineCount = activeFile ? activeFile.content.split('\n').length : 0;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#E6EDF3] flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-white/10 bg-[#0B0F17]">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setView('workspace');
            }}
            className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
          >
            Vela
          </a>

          <nav className="flex items-center gap-6 overflow-x-auto">
            {[
              { id: 'workspace', label: 'Workspace' },
              { id: 'web', label: 'Web Builder' },
              { id: 'kernel', label: 'OS Builder' },
              { id: 'models', label: '3D Studio' },
              { id: 'ai', label: 'AI & Data' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id as WorkspaceView)}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  view === item.id
                    ? 'text-white border-teal-400'
                    : 'text-slate-400 border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="shrink-0">
            <button
              onClick={() => executeProject(projectFiles)}
              disabled={running}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {running ? 'Running...' : 'Run'}
            </button>
          </div>
        </div>
      </header>

      {/* Project Template Selector & Stdlib Catalog */}
      <div className="border-b border-white/10 bg-[#0F1522]">
        <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {VELA_PROJECT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => {
                  const target: WorkspaceView =
                    tpl.category === 'web'
                      ? 'web'
                      : tpl.category === 'kernel'
                      ? 'kernel'
                      : tpl.category === '3d'
                      ? 'models'
                      : tpl.category === 'ai'
                      ? 'ai'
                      : 'workspace';
                  selectTemplate(tpl, target);
                }}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                  activeTemplateId === tpl.id
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tpl.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs">
            {repoExamples.length > 0 && (
              <select
                aria-label="Stdlib and Repository Examples"
                defaultValue=""
                onChange={(e) => {
                  const found = repoExamples.find((ex) => ex.id === e.target.value);
                  if (found) {
                    loadSingleSnippet(found.code);
                    setView('workspace');
                  }
                }}
                className="px-2.5 py-1 rounded-md bg-[#0B0F17] border border-white/10 text-slate-300 text-xs focus:outline-none focus:border-teal-500"
              >
                <option value="" disabled>
                  Stdlib &amp; Repo Files ({repoExamples.length})
                </option>
                {repoExamples.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.path}
                  </option>
                ))}
              </select>
            )}

            {result && (
              <span className="font-mono text-slate-400 tabular-nums whitespace-nowrap">
                {projectFiles.length} files · {lineCount} lines · {result.durationMs} ms
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-5 space-y-5">
        {view === 'models' && (
          <div className="space-y-4">
            <ThreeViewport
              sceneName={result?.scene3dFull?.name || 'Orbital Satellite'}
              objects={result?.scene3dFull?.objects || []}
              lights={result?.scene3dFull?.lights}
              cameraConfig={result?.scene3dFull?.camera}
              bgColor={result?.scene3dFull?.bg}
              activePresetId={activeTemplateId}
              onSelectPreset={(id) => selectTemplateById(id, 'models')}
            />
            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0D131F]">
                <span className="text-xs font-medium text-slate-300">
                  {activeFile.path} · Vela 3D &amp; Game Simulation
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleFormatActiveFile}
                    className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Format
                  </button>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">{lineCount} lines</span>
                </div>
              </div>
              <textarea
                value={activeFile.content}
                onChange={(e) => updateActiveFileContent(e.target.value)}
                spellCheck={false}
                className="w-full h-56 p-4 bg-[#0B0F17] text-xs font-mono text-slate-200 leading-relaxed focus:outline-none resize-y"
              />
            </div>
          </div>
        )}

        {view === 'web' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#0D131F] gap-2">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {projectFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setActiveFilePath(f.path)}
                      className={`px-2 py-1 text-xs font-mono rounded whitespace-nowrap ${
                        activeFile.path === f.path
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {f.path}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleFormatActiveFile}
                  className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 shrink-0"
                >
                  <Sparkles className="w-3 h-3" />
                  Fmt
                </button>
              </div>
              <textarea
                value={activeFile.content}
                onChange={(e) => updateActiveFileContent(e.target.value)}
                spellCheck={false}
                className="w-full h-[560px] p-4 bg-[#0B0F17] text-xs font-mono text-slate-200 leading-relaxed focus:outline-none resize-y"
              />
            </div>
            <div className="lg:col-span-7">
              <WebPanel
                webOutput={result?.webOutput ?? null}
                httpRoutes={result?.httpRoutes ?? []}
                onLoadWebPreset={() => selectTemplateById('website', 'web')}
              />
            </div>
          </div>
        )}

        {view === 'kernel' && (
          <div className="space-y-5">
            {result && (
              <KernelPanel
                kernelState={result.kernelState}
                kernelCode={result.kernelCode}
                hasKernelCode={
                  result.kernelState.mmioLog.length > 0 || result.kernelState.serialLog.length > 0
                }
                onLoadKernelPreset={() => selectTemplateById('kernel', 'kernel')}
              />
            )}
            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0D131F]">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {projectFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setActiveFilePath(f.path)}
                      className={`px-2.5 py-1 text-xs font-mono rounded whitespace-nowrap ${
                        activeFile.path === f.path
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {f.path}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleFormatActiveFile}
                    className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Format
                  </button>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">{lineCount} lines</span>
                </div>
              </div>
              <textarea
                value={activeFile.content}
                onChange={(e) => updateActiveFileContent(e.target.value)}
                spellCheck={false}
                className="w-full h-56 p-4 bg-[#0B0F17] text-xs font-mono text-slate-200 leading-relaxed focus:outline-none resize-y"
              />
            </div>
          </div>
        )}

        {view === 'ai' && (
          <div className="space-y-5">
            {result && (
              <AiDataPanel
                mlSnapshot={result.mlSnapshot}
                sqlTables={result.sqlTables}
                onLoadAiPreset={() => selectTemplateById('ai_db', 'ai')}
              />
            )}
            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0D131F]">
                <span className="text-xs font-medium text-slate-300">
                  {mainVelaFile.path} · Vela AI &amp; SQL Source
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleFormatActiveFile}
                    className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Format
                  </button>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">{lineCount} lines</span>
                </div>
              </div>
              <textarea
                value={activeFile.content}
                onChange={(e) => updateActiveFileContent(e.target.value)}
                spellCheck={false}
                className="w-full h-52 p-4 bg-[#0B0F17] text-xs font-mono text-slate-200 leading-relaxed focus:outline-none resize-y"
              />
            </div>
          </div>
        )}

        {view === 'workspace' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#111827] overflow-hidden flex flex-col">
              {/* Multi-File Package Tab Strip & Language Formatter */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#0D131F] gap-2">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {projectFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setActiveFilePath(f.path)}
                      className={`px-2.5 py-1 text-xs font-mono rounded-md flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                        activeFile.path === f.path
                          ? 'bg-white/15 text-white font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <FileCode2 className="w-3 h-3 text-teal-400" />
                      {f.path}
                    </button>
                  ))}
                  <button
                    onClick={handleAddModule}
                    className="px-2 py-1 text-xs rounded-md text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-1 whitespace-nowrap"
                    title="Add a new Vela module file"
                  >
                    <FilePlus className="w-3 h-3" />
                    Module
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeFile.path.endsWith('.vela') && (
                    <button
                      onClick={handleFormatActiveFile}
                      className="px-2.5 py-1 text-xs rounded-md bg-white/10 hover:bg-white/15 text-teal-300 flex items-center gap-1 whitespace-nowrap"
                      title="Format active file with vela fmt"
                    >
                      <Sparkles className="w-3 h-3" />
                      Format
                    </button>
                  )}
                  <span className="text-xs font-mono text-slate-400 tabular-nums">{lineCount}L</span>
                </div>
              </div>

              <textarea
                value={activeFile.content}
                onChange={(e) => updateActiveFileContent(e.target.value)}
                spellCheck={false}
                className="w-full flex-1 min-h-[480px] p-4 bg-[#0B0F17] text-xs font-mono text-slate-200 leading-relaxed focus:outline-none resize-none"
              />
            </div>

            <div className="lg:col-span-6 flex flex-col gap-4">
              {result && (
                <LanguageToolsPanel
                  diagnostics={result.diagnostics}
                  stdout={result.stdout}
                  symbols={result.symbols ?? []}
                  cCode={result.cCode}
                  arcObjects={result.arcObjects}
                  arcEvents={result.arcEvents}
                  concurrencyEvents={result.concurrencyEvents}
                  webOutput={result.webOutput}
                  scene3dFull={result.scene3dFull}
                  projectFiles={projectFiles}
                  repoTests={repoTests}
                  specs={specs}
                  onLoadCode={loadSingleSnippet}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
