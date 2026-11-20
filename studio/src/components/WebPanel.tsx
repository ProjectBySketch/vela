import React, { useState } from 'react';
import { CompiledWebOutput } from '../vela/types';
import { Code2, Download, Globe, Layout } from 'lucide-react';

interface WebPanelProps {
  webOutput: CompiledWebOutput | null;
  httpRoutes?: { method: string; path: string; handler: string }[];
  onLoadWebPreset?: () => void;
}

export const WebPanel: React.FC<WebPanelProps> = ({ webOutput, httpRoutes = [], onLoadWebPreset }) => {
  const [tab, setTab] = useState<'preview' | 'css' | 'html' | 'js'>('preview');

  const downloadHtml = () => {
    if (!webOutput) return;
    const blob = new Blob([webOutput.bundleHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vela-site.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!webOutput) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#111827] p-8 text-center space-y-3">
        <Globe className="w-8 h-8 text-teal-400 mx-auto" />
        <h3 className="text-base font-semibold text-white font-display">
          No Web / UI Declarations in Current Project
        </h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto">
          Declare <code className="text-teal-300">theme</code>, <code className="text-teal-300">style</code>,{' '}
          <code className="text-teal-300">component</code>, or <code className="text-teal-300">page</code> blocks in Vela to build a standalone website without writing HTML, CSS, or JS by hand.
        </p>
        {onLoadWebPreset && (
          <button
            onClick={onLoadWebPreset}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 transition-colors"
          >
            Load Full-Stack Website Project
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white font-display">
            Vela Web &amp; UI Builder
          </h2>
          <div className="text-xs text-slate-400 tabular-nums">
            {webOutput.themes.length} themes · {webOutput.styleCount} typed styles · {webOutput.componentCount} views &amp; pages · {webOutput.routes.length} routes
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={downloadHtml}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export index.html
          </button>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5">
            <button
              onClick={() => setTab('preview')}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'preview' ? 'bg-teal-500 text-slate-950 font-medium' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Layout className="w-3.5 h-3.5" />
              Live Preview
            </button>
            <button
              onClick={() => setTab('css')}
              className={`px-3 py-1 text-xs rounded-md whitespace-nowrap ${
                tab === 'css' ? 'bg-white/15 text-white font-medium' : 'text-slate-300 hover:text-white'
              }`}
            >
              Scoped CSS
            </button>
            <button
              onClick={() => setTab('html')}
              className={`px-3 py-1 text-xs rounded-md whitespace-nowrap ${
                tab === 'html' ? 'bg-white/15 text-white font-medium' : 'text-slate-300 hover:text-white'
              }`}
            >
              HTML5
            </button>
            <button
              onClick={() => setTab('js')}
              className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 whitespace-nowrap ${
                tab === 'js' ? 'bg-white/15 text-white font-medium' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Islands JS
            </button>
          </div>
        </div>
      </div>

      {(webOutput.routes.length > 0 || httpRoutes.length > 0) && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          {webOutput.routes.length > 0 && (
            <div>
              <span className="font-medium text-slate-300 mr-2">Pages:</span>
              <span className="font-mono">{webOutput.routes.join(' · ')}</span>
            </div>
          )}
          {httpRoutes.length > 0 && (
            <div>
              <span className="font-medium text-slate-300 mr-2">API Endpoints:</span>
              <span className="font-mono text-teal-400">
                {httpRoutes.map((r) => `${r.method} ${r.path}`).join(' · ')}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === 'preview' && (
        <div className="rounded-xl overflow-hidden border border-white/10 bg-white">
          <iframe
            title="Vela Compiled Web Preview"
            srcDoc={webOutput.bundleHtml}
            sandbox="allow-scripts"
            className="w-full h-[520px] border-0"
          />
        </div>
      )}

      {tab === 'css' && (
        <pre className="p-4 rounded-xl border border-white/10 bg-[#0D111A] text-xs font-mono text-sky-200 overflow-auto max-h-[520px]">
          {webOutput.css}
        </pre>
      )}

      {tab === 'html' && (
        <pre className="p-4 rounded-xl border border-white/10 bg-[#0D111A] text-xs font-mono text-emerald-200 overflow-auto max-h-[520px]">
          {webOutput.html}
        </pre>
      )}

      {tab === 'js' && (
        <pre className="p-4 rounded-xl border border-white/10 bg-[#0D111A] text-xs font-mono text-amber-200 overflow-auto max-h-[520px]">
          {webOutput.js}
        </pre>
      )}
    </div>
  );
};
