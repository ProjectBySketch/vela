import React, { useState } from 'react';
import { KernelSnapshot } from '../vela/types';
import { Cpu, Download, FolderOpen, HardDrive, Keyboard, Terminal, Timer } from 'lucide-react';

interface KernelPanelProps {
  kernelState: KernelSnapshot;
  kernelCode: string;
  onLoadKernelPreset?: () => void;
  hasKernelCode: boolean;
}

export const KernelPanel: React.FC<KernelPanelProps> = ({
  kernelState,
  kernelCode,
  onLoadKernelPreset,
  hasKernelCode,
}) => {
  const [liveTicks, setLiveTicks] = useState(0);
  const [typedKeys, setTypedKeys] = useState('');
  const [extraHeapPages, setExtraHeapPages] = useState(0);
  const [viewMode, setViewMode] = useState<'machine' | 'asm' | 'c'>('machine');

  const totalTicks = kernelState.ticks + liveTicks;
  const heapUsed = kernelState.heapUsed + extraHeapPages * 4096;

  // Render 80x25 VGA buffer lines (append interactive keyboard echoes on last active line)
  const vgaLines: string[] = [];
  for (let r = 0; r < kernelState.vga.rows; r++) {
    const start = r * kernelState.vga.cols;
    const rowStr = kernelState.vga.chars.slice(start, start + kernelState.vga.cols).join('').trimEnd();
    vgaLines.push(rowStr);
  }
  const activeLines = vgaLines.filter((l, idx) => l.length > 0 || idx < 8);
  if (typedKeys) {
    activeLines.push(`ps2_irq(0x21)> ${typedKeys}`);
  }
  if (liveTicks > 0) {
    activeLines.push(`pit_irq(0x20)> uptime ${(totalTicks * 10).toFixed(0)} ms (${totalTicks} ticks)`);
  }

  const downloadKernelC = () => {
    const blob = new Blob([kernelCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'velaos_kernel.c';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div>
          <h2 className="text-base font-semibold text-white font-display">
            VelaOS Builder &amp; Machine Sandbox
          </h2>
          <p className="text-xs text-slate-400">
            VGA display 0xB8000 · UART 16550 @ 0x3F8 · PIC 8259 · PIT/PS2 IRQs · In-kernel ramfs
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!hasKernelCode && onLoadKernelPreset && (
            <button
              onClick={onLoadKernelPreset}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 transition-colors whitespace-nowrap"
            >
              Load VelaOS Project
            </button>
          )}
          <button
            onClick={downloadKernelC}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export Kernel Image C
          </button>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5">
            {(['machine', 'c', 'asm'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 text-xs rounded-md capitalize whitespace-nowrap transition-colors ${
                  viewMode === m ? 'bg-white/15 text-white font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                {m === 'machine' ? 'OS Machine' : m === 'c' ? 'Freestanding C' : 'Boot ASM'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {viewMode === 'machine' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* VGA + Serial Consoles */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-xl border border-white/10 bg-[#05080F] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0E1420]">
                <span className="text-xs font-medium text-slate-300 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-teal-400" />
                  VGA Text Display (0xB8000 · 80x25)
                </span>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  cursor ({kernelState.vga.cursorX}, {kernelState.vga.cursorY})
                </span>
              </div>
              <pre className="p-4 text-xs font-mono leading-relaxed text-emerald-300 min-h-[220px] max-h-[280px] overflow-auto">
                {activeLines.length > 0
                  ? activeLines.join('\n')
                  : 'VGA memory uninitialized. Load and run the Kernel Program to boot.'}
              </pre>
            </div>

            {/* Interactive Hardware IRQ Controls */}
            <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-3">
              <div className="text-xs font-medium text-slate-300">Hardware Interrupt Injection</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setLiveTicks((t) => t + 1)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Timer className="w-3.5 h-3.5 text-teal-400" />
                  Tick PIT Timer (IRQ 0x20)
                </button>
                <button
                  onClick={() => setExtraHeapPages((p) => p + 1)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 whitespace-nowrap"
                >
                  <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                  Alloc 4KiB Frame
                </button>
                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <Keyboard className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={typedKeys}
                    onChange={(e) => setTypedKeys(e.target.value)}
                    placeholder="Type to fire PS/2 IRQ 0x21 (port 0x60)..."
                    className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[#0B0F17] border border-white/10 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Serial UART Output */}
            <div className="rounded-xl border border-white/10 bg-[#0D111A] p-4">
              <div className="text-xs font-medium text-slate-300 mb-2">
                UART 16550 Serial Link (COM1 · 0x3F8 · 115200 8N1)
              </div>
              <pre className="text-xs font-mono text-slate-300 max-h-[120px] overflow-auto">
                {kernelState.serialLog.length > 0 ? kernelState.serialLog.join('\n') : '(no serial bytes written)'}
              </pre>
            </div>
          </div>

          {/* Right Column: Memory Map, Interrupts & MMIO Trace */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-xl border border-white/10 bg-[#111827] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-teal-400" />
                  Physical Kernel Heap
                </span>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  {heapUsed.toLocaleString()} / {kernelState.heapSize.toLocaleString()} B
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-teal-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(2, (heapUsed / Math.max(1, kernelState.heapSize)) * 100))}%` }}
                />
              </div>
              <div className="text-xs font-mono text-slate-400 tabular-nums">
                base: 0x{kernelState.heapBase.toString(16).toUpperCase()} · pages: {extraHeapPages + (kernelState.heapUsed > 0 ? 1 : 0)}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-medium text-slate-300">
                IDT Interrupt Vectors
              </div>
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03] text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Vector</th>
                    <th className="text-left px-3 py-2 font-medium">Handler</th>
                    <th className="text-right px-3 py-2 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono tabular-nums">
                  {kernelState.interrupts.length > 0 ? (
                    kernelState.interrupts.map((ir) => (
                      <tr key={ir.vector} className="text-slate-300">
                        <td className="px-3 py-2 text-teal-400">{ir.vector}</td>
                        <td className="px-3 py-2">{ir.handler}</td>
                        <td className="px-3 py-2 text-right">
                          {ir.vector === '0x20' ? ir.count + liveTicks : ir.vector === '0x21' ? ir.count + typedKeys.length : ir.count}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-slate-500 font-sans">
                        No interrupt vectors registered
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-medium text-slate-300">
                MMIO &amp; Port I/O Log
              </div>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-white/[0.03] text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Device</th>
                      <th className="text-left px-3 py-1.5 font-medium">Reg</th>
                      <th className="text-left px-3 py-1.5 font-medium">Op</th>
                      <th className="text-right px-3 py-1.5 font-medium">Val</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono tabular-nums">
                    {kernelState.mmioLog.slice(0, 24).map((m, i) => (
                      <tr key={i} className="text-slate-300">
                        <td className="px-3 py-1.5">{m.device}</td>
                        <td className="px-3 py-1.5 text-slate-400">{m.reg}</td>
                        <td className="px-3 py-1.5 text-sky-400">{m.op}</td>
                        <td className="px-3 py-1.5 text-right">{m.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* In-Kernel RamFS Filesystem */}
            <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-teal-400" />
                Kernel Virtual Filesystem (ramfs)
              </div>
              <div className="divide-y divide-white/5 max-h-[150px] overflow-auto">
                {(kernelState.ramfsFiles || []).map((rf) => (
                  <div key={rf.path} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-teal-300 truncate">{rf.path}</div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {rf.content.trim()}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{rf.bytes} B</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'c' && (
        <pre className="p-4 rounded-xl border border-white/10 bg-[#0D111A] text-xs font-mono text-slate-200 overflow-auto max-h-[520px]">
          {kernelCode}
        </pre>
      )}

      {viewMode === 'asm' && (
        <div className="rounded-xl border border-white/10 bg-[#0D111A] p-4 space-y-3">
          <div className="text-xs font-medium text-slate-300">Inline x86_64 Assembly &amp; Boot Stub</div>
          <pre className="text-xs font-mono text-amber-200/90 overflow-auto max-h-[420px]">
            {[
              '; Multiboot2 / x86_64 _start bootstrap emitted by velac',
              'section .boot',
              'global _start',
              '_start:',
              '  lea rsp, [rel STACK + 65536]',
              '  xor rbp, rbp',
              '  call kmain',
              '  cli',
              '  hlt',
              '',
              '; User asm! blocks executed in kernel:',
              ...(kernelState.asmExecuted.length > 0 ? kernelState.asmExecuted.map((a) => `  ${a}`) : ['  (none executed yet)']),
            ].join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
};
