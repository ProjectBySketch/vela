import React, { useMemo, useState } from 'react';
import { MlSnapshot, SqlTableSnapshot } from '../vela/types';
import { VelaMlEngine } from '../vela/ml';
import { VelaSqlEngine } from '../vela/db';
import { Brain, Database, Play } from 'lucide-react';

interface AiDataPanelProps {
  mlSnapshot: MlSnapshot;
  sqlTables: SqlTableSnapshot[];
  onLoadAiPreset?: () => void;
}

export const AiDataPanel: React.FC<AiDataPanelProps> = ({
  mlSnapshot,
  sqlTables,
  onLoadAiPreset,
}) => {
  const [interactiveEpochs, setInteractiveEpochs] = useState<MlSnapshot['epochs'] | null>(null);
  const [sqlInput, setSqlInput] = useState('SELECT id, model, loss, accuracy FROM experiments ORDER BY accuracy DESC');
  const [sqlResult, setSqlResult] = useState<Record<string, unknown>[] | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);

  const epochs = interactiveEpochs ?? mlSnapshot.epochs;

  const runLiveTraining = () => {
    const ml = new VelaMlEngine();
    ml.setSeed(Math.floor(Math.random() * 1000) + 1);
    const w1 = ml.randn([2, 8], 0.7).data;
    const b1 = ml.zeros([8]).data;
    const w2 = ml.randn([8, 2], 0.7).data;
    const b2 = ml.zeros([2]).data;
    const xs = [[0, 0], [0, 1], [1, 0], [1, 1]];
    const ys = [0, 1, 1, 0];
    const out: MlSnapshot['epochs'] = [];
    for (let e = 1; e <= 40; e++) {
      const res = ml.runAutodiffStep(w1, b1, w2, b2, 2, 8, 2, xs, ys, 0.45);
      out.push({ epoch: e, loss: Number(res.loss.toFixed(4)), accuracy: Number(res.accuracy.toFixed(4)) });
    }
    setInteractiveEpochs(out);
  };

  const runInteractiveSql = () => {
    setSqlError(null);
    try {
      const engine = new VelaSqlEngine();
      // Seed from snapshot tables
      for (const tbl of sqlTables) {
        if (tbl.columns.length > 0) {
          engine.exec(`CREATE TABLE ${tbl.name} (${tbl.columns.map((c) => `${c} TEXT`).join(', ')})`);
          for (const row of tbl.rows) {
            const cols = Object.keys(row);
            const vals = cols.map((c) => {
              const v = row[c];
              return typeof v === 'string' ? `'${v}'` : String(v);
            });
            engine.exec(`INSERT INTO ${tbl.name} (${cols.join(', ')}) VALUES (${vals.join(', ')})`);
          }
        }
      }
      const res = engine.exec(sqlInput);
      setSqlResult(res);
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : 'SQL Error');
    }
  };

  const chartPaths = useMemo(() => {
    if (epochs.length < 2) return null;
    const w = 520;
    const h = 160;
    const maxLoss = Math.max(0.8, ...epochs.map((e) => e.loss));
    const lossPts = epochs
      .map((e, idx) => {
        const x = (idx / (epochs.length - 1)) * (w - 32) + 16;
        const y = h - 16 - (e.loss / maxLoss) * (h - 32);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const accPts = epochs
      .map((e, idx) => {
        const x = (idx / (epochs.length - 1)) * (w - 32) + 16;
        const y = h - 16 - e.accuracy * (h - 32);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { lossPts, accPts, w, h };
  }, [epochs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white font-display">
            AI Tensor Autodiff &amp; Relational SQL Engine
          </h2>
          <p className="text-xs text-slate-400">
            Static-shape Tensors · Reverse-mode computation tape · Parameterized SQL &amp; transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {epochs.length === 0 && sqlTables.length === 0 && onLoadAiPreset && (
            <button
              onClick={onLoadAiPreset}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 whitespace-nowrap"
            >
              Load AI + SQL Preset
            </button>
          )}
          <button
            onClick={runLiveTraining}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 text-teal-400" />
            Run 40-Epoch Autodiff
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ML Training Curve & Layers */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-teal-400" />
                Reverse-Mode Autodiff Loss &amp; Accuracy
              </span>
              {epochs.length > 0 && (
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  epoch {epochs[epochs.length - 1].epoch} · loss {epochs[epochs.length - 1].loss} · acc{' '}
                  {(epochs[epochs.length - 1].accuracy * 100).toFixed(0)}%
                </span>
              )}
            </div>

            {chartPaths ? (
              <div className="bg-[#0B0F17] rounded-lg p-2 border border-white/5">
                <svg viewBox={`0 0 ${chartPaths.w} ${chartPaths.h}`} className="w-full h-44">
                  <line x1="16" y1="16" x2="16" y2={chartPaths.h - 16} stroke="rgba(255,255,255,0.1)" />
                  <line
                    x1="16"
                    y1={chartPaths.h - 16}
                    x2={chartPaths.w - 16}
                    y2={chartPaths.h - 16}
                    stroke="rgba(255,255,255,0.1)"
                  />
                  <polyline fill="none" stroke="#F59E0B" strokeWidth="2.2" points={chartPaths.lossPts} />
                  <polyline fill="none" stroke="#14B8A6" strokeWidth="2.2" points={chartPaths.accPts} />
                </svg>
                <div className="flex items-center gap-4 px-2 pb-1 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> Cross-Entropy Loss
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 bg-teal-400 inline-block" /> Validation Accuracy
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-44 rounded-lg bg-[#0B0F17] border border-white/5 flex items-center justify-center text-xs text-slate-500">
                Run an AI preset or click &ldquo;Run 40-Epoch Autodiff&rdquo; to inspect gradient descent.
              </div>
            )}
          </div>

          {mlSnapshot.layers.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-medium text-slate-300">
                Checked Tensor Module Graph
              </div>
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03] text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Layer</th>
                    <th className="text-left px-3 py-2 font-medium">In Shape</th>
                    <th className="text-left px-3 py-2 font-medium">Out Shape</th>
                    <th className="text-right px-3 py-2 font-medium">Params</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono tabular-nums text-slate-300">
                  {mlSnapshot.layers.map((l) => (
                    <tr key={l.name}>
                      <td className="px-3 py-2 text-teal-400">{l.name}</td>
                      <td className="px-3 py-2">{l.shapeIn}</td>
                      <td className="px-3 py-2">{l.shapeOut}</td>
                      <td className="px-3 py-2 text-right">{l.params}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Relational SQL Database & Query Console */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-3">
            <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-sky-400" />
              Interactive SQL Query Runner
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={sqlInput}
                onChange={(e) => setSqlInput(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg bg-[#0B0F17] border border-white/10 text-slate-200 focus:outline-none focus:border-teal-500"
              />
              <button
                onClick={runInteractiveSql}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 whitespace-nowrap"
              >
                Execute SQL
              </button>
            </div>
            {sqlError && <div className="text-xs text-rose-400 font-mono">{sqlError}</div>}
            {sqlResult && (
              <pre className="p-2.5 rounded-lg bg-[#0B0F17] border border-white/5 text-xs font-mono text-slate-300 max-h-36 overflow-auto">
                {JSON.stringify(sqlResult, null, 2)}
              </pre>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 text-xs font-medium text-slate-300">
              In-Memory SQL Tables ({sqlTables.length})
            </div>
            {sqlTables.length > 0 ? (
              <div className="divide-y divide-white/10">
                {sqlTables.map((tbl) => (
                  <div key={tbl.name} className="p-3 space-y-2">
                    <div className="text-xs font-mono font-semibold text-sky-400">
                      {tbl.name} ({tbl.rows.length} rows)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-white/[0.03] text-slate-400">
                          <tr>
                            {tbl.columns.map((c) => (
                              <th key={c} className="text-left px-2.5 py-1.5 font-medium">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono tabular-nums text-slate-300">
                          {tbl.rows.map((r, ri) => (
                            <tr key={ri}>
                              {tbl.columns.map((c) => (
                                <td key={c} className="px-2.5 py-1.5">
                                  {String(r[c] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                No SQL tables created by the current program yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
