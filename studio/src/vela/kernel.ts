import { KernelSnapshot, MmIoRegisterLog, VgaState } from './types';

export class VelaKernelEmulator {
  public vga: VgaState = {
    cols: 80,
    rows: 25,
    chars: new Array(80 * 25).fill(' '),
    attrs: new Array(80 * 25).fill(0x0f),
    cursorX: 0,
    cursorY: 0,
  };
  public serialLog: string[] = [];
  private serialLine = '';
  public ticks = 0;
  public heapBase = 0x200000;
  public heapSize = 16 * 1024 * 1024;
  public heapUsed = 0;
  public allocations: { addr: string; size: number; align: number }[] = [];
  public mmioLog: MmIoRegisterLog[] = [];
  public interrupts = new Map<string, { vector: string; handler: string; count: number }>();
  public asmExecuted: string[] = [];
  public mmioDevices = new Map<string, { base: number; regs: Map<string, number> }>();
  private keyQueue: number[] = [];

  public registerMmio(name: string, base: number, fields: string[]) {
    const regs = new Map<string, number>();
    for (const f of fields) regs.set(f, 0);
    // UART LSR bit 5 (TX empty) = 0x20
    if (name.toLowerCase().includes('uart')) {
      regs.set('lsr', 0x20);
    }
    this.mmioDevices.set(name, { base, regs });
  }

  public registerInterrupt(vector: string, handler: string) {
    this.interrupts.set(vector, { vector, handler, count: 0 });
  }

  public fireInterrupt(vector: string) {
    const entry = this.interrupts.get(vector);
    if (entry) entry.count += 1;
    if (vector === '0x20') this.ticks += 1;
  }

  public writeMmio(device: string, reg: string, val: number) {
    const dev = this.mmioDevices.get(device);
    if (dev) {
      dev.regs.set(reg, val & 0xff);
    }
    if (device.toLowerCase().includes('uart') && reg === 'data') {
      const ch = String.fromCharCode(val & 0xff);
      if (ch === '\n') {
        this.serialLog.push(this.serialLine);
        this.serialLine = '';
      } else {
        this.serialLine += ch;
      }
    }
    if (this.mmioLog.length < 100) {
      this.mmioLog.push({
        device,
        reg,
        addr: dev ? `0x${dev.base.toString(16).toUpperCase()}` : '0x0',
        op: 'write',
        value: `0x${(val & 0xff).toString(16).padStart(2, '0').toUpperCase()}`,
      });
    }
  }

  public readMmio(device: string, reg: string): number {
    const dev = this.mmioDevices.get(device);
    let val = dev?.regs.get(reg) ?? 0;
    if (device.toLowerCase().includes('uart') && reg === 'lsr') val = 0x20;
    if (this.mmioLog.length < 100) {
      this.mmioLog.push({
        device,
        reg,
        addr: dev ? `0x${dev.base.toString(16).toUpperCase()}` : '0x0',
        op: 'read',
        value: `0x${(val & 0xff).toString(16).padStart(2, '0').toUpperCase()}`,
      });
    }
    return val;
  }

  public writeVgaCell(index: number, wordVal: number) {
    if (index < 0 || index >= this.vga.cols * this.vga.rows) return;
    const ch = String.fromCharCode(wordVal & 0xff);
    const attr = (wordVal >> 8) & 0xff;
    this.vga.chars[index] = ch === '\0' ? ' ' : ch;
    this.vga.attrs[index] = attr || 0x0f;
    this.vga.cursorX = index % this.vga.cols;
    this.vga.cursorY = Math.floor(index / this.vga.cols);
  }

  public vgaClear() {
    this.vga.chars.fill(' ');
    this.vga.attrs.fill(0x0f);
    this.vga.cursorX = 0;
    this.vga.cursorY = 0;
  }

  public vgaWriteText(text: string, attr = 0x0f) {
    for (const ch of text) {
      if (ch === '\n') {
        this.vga.cursorX = 0;
        this.vga.cursorY = Math.min(this.vga.rows - 1, this.vga.cursorY + 1);
      } else {
        const idx = this.vga.cursorY * this.vga.cols + this.vga.cursorX;
        this.vga.chars[idx] = ch;
        this.vga.attrs[idx] = attr;
        this.vga.cursorX += 1;
        if (this.vga.cursorX >= this.vga.cols) {
          this.vga.cursorX = 0;
          this.vga.cursorY = Math.min(this.vga.rows - 1, this.vga.cursorY + 1);
        }
      }
      // Mirror to serial
      if (ch === '\n') {
        this.serialLog.push(this.serialLine);
        this.serialLine = '';
      } else {
        this.serialLine += ch;
      }
    }
  }

  public pushKeyScancode(scancode: number) {
    this.keyQueue.push(scancode);
  }

  public portIn8(port: number): number {
    if (port === 0x60) {
      return this.keyQueue.shift() ?? 0x1e; // 'a' scancode
    }
    return 0;
  }

  public portOut8(port: number, val: number) {
    if (this.mmioLog.length < 100) {
      this.mmioLog.push({
        device: `PortIO`,
        reg: `0x${port.toString(16).toUpperCase()}`,
        addr: `0x${port.toString(16).toUpperCase()}`,
        op: 'write',
        value: `0x${(val & 0xff).toString(16).padStart(2, '0').toUpperCase()}`,
      });
    }
  }

  public heapInit(base: number, size: number) {
    this.heapBase = base;
    this.heapSize = size;
    this.heapUsed = 0;
    this.allocations = [];
  }

  public heapAlloc(size: number, align = 16): number | null {
    const aligned = Math.floor((this.heapUsed + align - 1) / align) * align;
    if (aligned + size > this.heapSize) return null;
    this.heapUsed = aligned + size;
    const addr = this.heapBase + aligned;
    this.allocations.push({ addr: `0x${addr.toString(16).toUpperCase()}`, size, align });
    return addr;
  }

  public execAsm(instructions: string[]) {
    for (const ins of instructions) {
      if (this.asmExecuted.length < 60) this.asmExecuted.push(ins);
    }
  }

  public ramfs = new Map<string, string>([
    ['/etc/hostname', 'velaos\n'],
    ['/boot/cmd', 'root=/dev/ram0 console=ttyS0\n'],
  ]);

  public ramfsWrite(filePath: string, content: string) {
    const clean = filePath.startsWith('/') ? filePath : `/${filePath}`;
    this.ramfs.set(clean, content);
  }

  public ramfsRead(filePath: string): string | undefined {
    const clean = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return this.ramfs.get(clean);
  }

  public snapshot(): KernelSnapshot {
    const serial = [...this.serialLog];
    if (this.serialLine) serial.push(this.serialLine);
    return {
      vga: {
        ...this.vga,
        chars: [...this.vga.chars],
        attrs: [...this.vga.attrs],
      },
      serialLog: serial,
      ticks: this.ticks,
      heapBase: this.heapBase,
      heapUsed: this.heapUsed,
      heapSize: this.heapSize,
      allocations: [...this.allocations],
      mmioLog: [...this.mmioLog],
      interrupts: Array.from(this.interrupts.values()),
      asmExecuted: [...this.asmExecuted],
      ramfsFiles: Array.from(this.ramfs.entries()).map(([path, content]) => ({
        path,
        bytes: content.length,
        content,
      })),
    };
  }
}
