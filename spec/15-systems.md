# 15 — Systems: building an operating system

**Status:** `spec`.

This document is the answer to "can I write a kernel in Vela", and it is written
as a construction manual rather than a feature list: the pieces are in the order
you would use them.

---

## 1. What `sys` changes

The `sys` profile is the `core` language with three inversions and one addition:

| | `core` | `sys` |
| --- | --- | --- |
| Memory | allocator available and implicit | **no allocator unless declared**; allocation is visible or absent |
| Standard library | full | `core` subset only (no `fs`, `net`, `process`, `ui`, `web`) |
| Runtime | a runtime with RC, cycle collection, an executor | **no runtime**; the program provides its own |
| Raw access | `unsafe` forbidden | `unsafe`, `asm!`, MMIO and `Ptr` are the normal tools |
| Panic | prints and exits | calls **your** `#[panic_handler]` |
| Entry | `main` | `#[entry]` / `#[boot]` |

Everything else — syntax, types, generics, traits, `Result`, `match`, closures,
`comptime` — is unchanged. A kernel is written in the same language as a website;
that is the entire point of the profile split.

```toml
[package]
name    = "acme/velaos"
version = "0.1.0"
edition = "2026"
profile = "sys"
```

---

## 2. Targets and the build

```
vela build --target x86_64-unknown-none --release
vela build --target aarch64-unknown-none --release
vela build --target riscv64-unknown-none --release
vela build --target x86_64-unknown-linux-gnu     # a hosted kernel module, for tests
```

A target triple is `<arch>-<vendor>-<os>[-<abi>]`. A `*-none` target means
freestanding: no libc, no dynamic loader, no runtime beyond what the program
declares.

```toml
[targets.x86_64-unknown-none]
profile       = "sys"
entry         = "_start"
linkerScript  = "boot/linker.ld"
linker        = "ld.lld"
flags         = ["-nostdlib", "-static", "-T", "boot/linker.ld"]
output        = "bin/velaos.elf"
arch          = "x86_64"

[targets.aarch64-unknown-none]
profile       = "sys"
entry         = "_start"
linkerScript  = "boot/linker-aarch64.ld"
output        = "bin/velaos-aarch64.elf"
```

A minimal linker script, for reference — this is an ordinary file in the package:

```ld
ENTRY(_start)
SECTIONS {
  . = 1M;
  .boot  : { *(.boot) }
  .text  : { *(.text .text.*) }
  .rodata: { *(.rodata .rodata.*) }
  .data  : { *(.data .data.*) }
  .bss   : { *(.bss .bss.*) *(COMMON) }
}
```

`#[link_section(".boot")]` on a function or a constant places it there, which is
how the first-stage boot code and its data stay inside the first megabyte.

The build produces an ELF per target. `vela build --target ... --emit-obj` stops
after the object file, for linking into an existing bootloader project.

---

## 3. The freestanding subset

Available in `sys` without any runtime:

| Area | Available |
| --- | --- |
| primitives | `Int*`, `UInt*`, `Float*`, `Bool`, `Char`, `Ptr<T>`, `Volatile<T>` |
| aggregates | `struct`, `shared struct` **without RC**, `enum`, tuples, fixed arrays |
| control | everything, including `match`, `loop`, `defer`, `guard` |
| functions | everything, plus `#[naked]`, `#[entry]`, `interrupt fn` |
| generics | monomorphised, with `#[genericSize]` limits |
| `Str` | string **literals** only (static data); no concatenation, no interpolation, but `str.eq` and `str.len` on a literal work |
| `List`/`Map`/`Set`/`Bytes` | only with an allocator (see §8) |
| `Result`, `Option` | fully |
| `comptime` | fully — this is how you build tables for a kernel |
| `unsafe`, `asm!`, MMIO | fully |
| `async` | only with a scheduler the program supplies |
| `panic` | only with a `#[panic_handler]` |

`Str` being literal-only is the single most surprising restriction, and it is
deliberate: formatting into a buffer in a kernel means an allocator or a
fixed-size buffer, so `str.writeTo(buf, fmt, args...)` is the API and the buffer
is yours.

---

## 4. Entry, and the first page of the kernel

```vela
// boot/linker entry: the ELF starts here
#[naked]
#[no_mangle]
#[link_section(".boot")]
fn _start() -> Never {
  unsafe {
    asm!(
      "mov rsp, offset stack_top",
      "call kmain",
      "cli",
      "1: hlt",
      "jmp 1b"
    )
  }
}

#[link_section(".bss")]
static mut STACK: [UInt8; 64 * 1024] = [0; 64 * 1024]

#[boot]
fn kmain(bootInfo: *BootInfo) -> Never {
  serial.init(0x3F8)                  // COM1
  serial.writeStr("velaos: booting\n")

  let mem = memory.init(bootInfo)     // parse the memory map the bootloader left
  logging.info("usable memory: ${mem.totalPages} pages")

  interrupts.init()                   // IDT + PIC + timer at 100 Hz
  let sched = scheduler.new()
  sched.spawn(fn() { shell.run() })
  sched.start()                       // never returns
}
```

`_start` is `#[naked]` because no prologue may run before the stack exists. It is
the only place in the language where assembly is unavoidable, and it is eight
lines.

---

## 5. Raw memory

```vela
let p: Ptr<UInt8> = Ptr.fromAddr(0xB8000)      // VGA text buffer
unsafe {
  p.write(0x41)                                // 'A'
  let b = p.read()
  let q = p.add(2)                             // pointer arithmetic
  let w = q.cast::<UInt16>().read()            // typed read
}
```

| Operation | Requires `unsafe` |
| --- | --- |
| `Ptr.read()`, `.write(v)` | yes |
| `.add(n)`, `.sub(n)`, `.offset(i)` | yes |
| `.cast::<T>()` | yes |
| `.isNull()`, `.addr()` | no |
| creating a `Ptr` from an integer | yes (`Ptr.fromAddr`) |
| `Ptr.null()` | no |

A `Ptr<T>` is one word, has no nullability in the type (its zero value is a
`Ptr.null()` you must check), and is never automatically dereferenced.

### 5.1 Volatile

```vela
let status: Volatile<UInt32> = volatile.at(0xFE00_0004)
let ready = status.read()
status.write(1)
```

A `volatile` read is not reordered or elided; a `volatile` write is not cached.
This is for memory-mapped hardware, and for nothing else.

### 5.2 MMIO register blocks

```vela
#[repr(C)]
mmio Uart @ 0x0900_0000 {
  dr:   UInt32 @ 0x00
  fr:   UInt32 @ 0x18
  ibpr: UInt32 @ 0x24
  cr:   UInt32 @ 0x30
}

fn putc(c: Char) {
  while Uart.fr.read() & (1 << 5) != 0 { }     // wait while TX FIFO full
  Uart.dr.write(UInt32(c.toInt()))
}
```

`mmio` declares a block of registers at a fixed address; every field read and
write is volatile automatically, and the field's `@` offset is checked against the
block's declared extent (`E-SYS-010` if a field lies outside). This replaces the
`#define UART_DR (*(volatile uint32_t*)0x9000000)` that every C driver starts
with, and the compiler cannot optimise it into a bare load.

---

## 6. Interrupts

```vela
#[interrupt(0x20)]                     // vector 32: the programmable timer
fn timerTick(frame: *InterruptFrame) {
  scheduler.tick()                     // may switch tasks; frame is preserved
  pic.ack(0x20)
}

#[naked]
#[interrupt(0x0E)]                     // page fault
fn pageFault() {
  unsafe {
    let addr = asm!("mov {}, cr2", out("rax") _)
    faultHandler(addr)
  }
}
```

* `#[interrupt(n)]` installs the function in the IDT (x86_64) or the vector table
  (aarch64) at entry `n`.
* A non-`#[naked]` handler gets a proper frame save/restore, and `frame` gives the
  saved registers, the faulting address and the error code.
* An interrupt handler may not allocate, may not `await`, and may not call an
  `io` function (`E-SYS-020`): those are the three things a kernel cannot do in
  interrupt context, and the compiler knows it.
* `interrupts.disable()` / `enable()` / `areEnabled()` wrap `cli`/`sti`; a scope
  helper `withoutInterrupts { }` restores the previous state, which is the only
  correct way to nest them.

---

## 7. Assembly

```vela
let cycles: UInt64
unsafe {
  asm!("rdtsc", out("rax") cycles.lo, out("rdx") cycles.hi)
}

unsafe {
  asm!(
    "mov {0}, {1}",
    "lock xadd [{2}], {0}",
    inout("rax") result,
    in("rdi") value,
    in("rsi") addr,
    options: noMemory, noFlags
  )
}
asm!("hlt")
asm!("mfence")
```

* `asm!("template", operands..., options: ...)`.
* Templates use `{0}`, `{1}` for operands and `{{`/`}}` for literal braces.
* `in("reg") v`, `out("reg") x`, `inout("reg") x`, `in("reg") _` (clobbered,
  unused), `const n`.
* `options:` — `noMemory`, `noFlags`, `pure`, `align`, `intelSyntax`.
* A register class (`"r"`, `"x"`) lets the compiler choose.
* `#[naked]` functions may contain only `asm!` and constant declarations.

Assembly is `unsafe`, requires a reason string like every `unsafe` block, and the
presence of `asm!` in a module is reported by `vela build --audit` — the number
that tells a reviewer how much of the kernel is not Vela.

---

## 8. Allocation in a kernel

There is none until you ask for it.

```vela
#[global_allocator]
const HEAP: Allocator = mem.pool(64 * 1024 * 1024)

fn setupHeap(mem: *MemoryMap) {
  HEAP.init(at(mem, 0x10_0000), size: 0x400_0000)
}
```

| Allocator | Use in a kernel |
| --- | --- |
| `mem.null` | the default: every allocation is `Err(OutOfMemory)` |
| `mem.bump(start, size)` | boot-time structures, never freed |
| `mem.pool(pageRecords)` | fixed-size objects: page-table frames, process structs, packets |
| `mem.slab<T>(n)` | many `T`s of one type |
| `mem.buddy(order)` | page allocator for physical frames |
| `mem.freelist(start, size)` | general purpose with a free list |

Once a `#[global_allocator]` exists, `List`, `Map`, `Str` concatenation and
closures with captures become available — and with them, the RC and cycle
collector if the program declares them. Most kernels declare a `bump` allocator
for boot and a `slab` for processes, and use `List<T>` for the task table because
the convenience is worth the bytes.

---

## 9. Privilege, syscalls and descriptors

```vela
#[syscall(n: 0)]
fn sysWrite(fd: Int, buf: Ptr<UInt8>, len: IntSize) -> IntSize {
  let file = try process.current().descriptor(fd)?
  file.write(buf, len)
}

#[syscall(n: 1)]
fn sysExit(code: Int) -> Never {
  process.exit(code)
}
```

* `#[syscall(n)]` declares a handler reachable from ring 3 at vector `n`.
* The user side is the same function declared `extern`, so a user program calls
  `sysWrite(1, msg, len)` with the argument marshalling generated:

```vela
extern "syscall" fn sysWrite(fd: Int, buf: Ptr<UInt8>, len: IntSize) -> IntSize
```

* `process.spawn(entry, args)` creates a task with a fresh address space;
  `process.current()` returns the descriptor; `userland.enter(pc, sp)` drops to
  ring 3.
* An unknown syscall, a bad pointer or a wrong `len` from a user program yields
  `E_PROCESS`, and a kernel written in Vela gets that check for free: the
  `Result` from `descriptor(fd)` is the whole "validate user input" story.

---

## 10. A complete driver

```vela
#[repr(C)]
mmio Pl011 @ 0x0900_0000 {
  dr: UInt32 @ 0x00
  fr: UInt32 @ 0x18
  lcr: UInt32 @ 0x2C
  cr: UInt32 @ 0x30
  imsc: UInt32 @ 0x38
  icr: UInt32 @ 0x44
}

mod uart {
  mut initialized = false

  pub fn init() {
    guard not initialized else { return }
    Pl011.cr.write(0)                    // disable
    Pl011.ibpr.write(1)                  // 115200 baud
    Pl011.lcr.write(0x70)                // 8N1, FIFO on
    Pl011.imsc.write(0x10)               // receive interrupt
    Pl011.cr.write(0x301)                // enable TX and RX
    initialized = true
  }

  pub fn writeStr(s: Str) {
    for ch in s { putc(ch) }
  }

  pub fn putc(c: Char) {
    while Pl011.fr.read() & (1 << 5) != 0 { }   // TX FIFO full
    Pl011.dr.write(UInt32(c.toInt()))
  }

  pub fn read() -> Char? {
    if Pl011.fr.read() & (1 << 4) != 0 { return nil }   // RX FIFO empty
    Char.fromInt(Pl011.dr.read()?).ok()
  }
}
```

Fifteen lines of register access, no `volatile` casts, no macros, and the field
offsets are checked against the block.

---

## 11. Scheduling

```vela
shared struct Task {
  mut id: Int
  mut stack: Ptr<UInt8>
  mut state: TaskState
  mut savedSp: UInt64
}

struct Scheduler {
  mut tasks: List<Task> = []
  mut current: Int = 0
  mut quantum: Int = 10
}

impl Scheduler {
  fn spawn(mut self, entry: Func() -> Void) -> Task {
    let stack = memory.allocPages(4)?           // 16 KiB
    let t = Task { id: self.tasks.len, stack, state: .ready, savedSp: 0 }
    // write the initial stack frame so that the first switch "returns" into entry
    unsafe { asm!(
      "mov rax, [{}]",  in("rdi") stack.add(4096 - 8),
      "mov [rax], {}",  in("rdi") entry
    ) }
    self.tasks.push(t)
    t
  }

  fn tick(mut self) {
    if self.quantum > 0 { self.quantum -= 1; return }
    self.quantum = 10
    self.switch()
  }

  fn switch(mut self) {
    let prev = self.tasks[self.current]
    self.current = (self.current + 1) % self.tasks.len
    let next = self.tasks[self.current]
    context.switchTo(next.savedSp)              // assembly: save, restore, iretq
  }
}
```

`context.switchTo` is the classic save-stack-pointer/restore routine: it pushes
the callee-saved registers, stores `rsp` in the current task, loads `next.savedSp`
and pops. The standard library ships one implementation per target in `core`,
which is why the scheduler above is portable Vela rather than architecture-
specific assembly, and why the same scheduler runs on x86_64, aarch64 and riscv64
without a `#[cfg]` in sight.

`thread`, `Mutex`, `Atomic` and `Channel` are available in `sys` **only** after the
program supplies a scheduler (`E-CONC-060`); the same source then provides
`parallel for` on as many cores as the kernel brings up.

---

## 12. Panic, logging, debugging

```vela
#[panic_handler]
fn onPanic(info: PanicInfo) -> Never {
  serial.writeStr("\nvela panic: ")
  serial.writeStr(info.message)
  serial.writeStr(" at ")
  serial.writeStr(info.location.file)
  serial.writeStr(":")
  num.writeTo(serial, info.location.line)
  stack.trace(|frame| {
    serial.writeStr("  ")
    serial.writeHex(frame.pc)
    serial.writeStr(" ")
    serial.writeStr(symbols.nameFor(frame.pc))
  })
  hltForever()
}
```

* `info` gives the message (a `Str` literal or a formatted buffer), the file, the
  line, and the symbol table entry when symbols are linked in.
* `stack.trace` walks frame pointers; the build emits a symbol map
  (`--emit-symbols`) so a crash address becomes a function name.
* `logging` writes to the console with levels; in `sys` it is compiled out below
  the configured level at compile time, so `logging.debug` in a hot path costs
  nothing.
* `vela run --target qemu-x86_64 --gdb` starts QEMU with a GDB stub and loads the
  symbol map, so a breakpoint can be set by function name.

---

## 13. Boot, end to end

1. **The bootloader** (Limine, GRUB, U-Boot, or the platform's own) loads the ELF,
   sets up a stack, and jumps to `_start`.
2. **`_start`** (`#[naked]`) sets a stack, calls `kmain`, and halts if it returns.
3. **`kmain`** (`#[boot]`) reads the boot info for the memory map, the graphics
   framebuffer and the RSDP.
4. **`memory.init`** builds a frame allocator from the map, reserves the kernel's
   sections (from the linker script's symbols) and sets up page tables.
5. **`interrupts.init`** loads the IDT/GDT (or the ARM vector table), remaps the
   PIC (x86), programs the timer, enables interrupts.
6. **`scheduler.new` + `spawn`** gives the kernel something to switch between.
7. **`shell.run`** is an ordinary Vela program with a `while` loop and a `match`
   over command names — the same code that would run in `core`, minus the
   allocator.
8. **A user program** is a second Vela package with `profile = "core"`, compiled
   for the kernel's user ABI, whose `main` calls the `extern "syscall"`
   declarations.

Every step is ordinary Vela. There is no "and then you drop to C for the hard
parts" in this document, because the language was designed with the hard parts in
mind.

---

## 14. What is guaranteed per architecture

| Guarantee | x86_64 | aarch64 | riscv64 |
| --- | --- | --- | --- |
| `#[entry]`, `#[boot]` | yes | yes | yes |
| `#[interrupt(n)]` | IDT vector `n` | vector table entry | trap vector |
| `asm!` | yes | yes | yes |
| `mmio` blocks | yes | yes | yes |
| 64-bit `Int` | native | native | native |
| Atomic `UInt64` | yes | yes | yes (A extension) |
| Tail-call optimisation | yes | yes | yes |
| Float | SSE2 (assumed) | FP/SIMD (assumed) | soft-float by default, hard if `+f` |
| Stack alignment for `Float` | 16 bytes | 16 bytes | 16 bytes |

`Float` in a kernel is opt-in: a target with `softFloat` uses a software
implementation, and an interrupt handler may not use `Float` unless the target
saves the FP state (`E-SYS-030`), because that is the classic silent corruption.

---

## 15. Size and speed

| Property | Guarantee |
| --- | --- |
| Runtime in the binary | none unless declared |
| Hello-world kernel | < 8 KiB of text (measured: boot + UART + halt) |
| `Str` literals | in `.rodata`, no copy |
| `match` on an enum | a jump table when dense, a compare chain when sparse |
| Generic instantiations | capped with `#[genericSize]`, reported by `--stats` |
| `comptime` tables | emitted as static data, never computed at boot |
| Bound check | on for `List<T>` when an allocator is present; the compiler elides it when the index is provably in range |

---

## 16. Testing a kernel

```vela
#[test]
#[target("x86_64-unknown-none")]
#[qemu(memory: "256M", display: "none", serial: "stdio")]
fn bootsAndPrints() {
  assertSerialContains("velaos: booting")
}

#[test]
fn frameAllocatorIsLifo() {
  let fa = page.Allocator.new(16)
  let a = fa.alloc().unwrap()
  let b = fa.alloc().unwrap()
  fa.free(a)
  assertEq(fa.alloc().unwrap(), a)
}
```

* A test without `#[target]` runs natively; with `#[qemu]` it runs in an emulator
  and asserts on serial output. `vela test --target x86_64-unknown-none` runs the
  whole suite that way.
* A panic in a test is a failure, not a process kill: the harness installs its own
  panic handler in test builds.

---

## 17. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-SYS-010` | MMIO field outside its block |
| `E-SYS-020` | allocation or `await` in interrupt context |
| `E-SYS-030` | `Float` in an interrupt handler on a target that does not save FP state |
| `E-SYS-040` | missing `#[panic_handler]` |
| `E-SYS-050` | missing or duplicate `#[entry]` |
| `E-SYS-060` | libc symbol referenced in a `none` target |
| `E-SYS-070` | `#[naked]` function containing non-assembly |
| `E-SYS-080` | allocation without a `#[global_allocator]` |
| `E-SYS-090` | unaligned `Ptr::<T>::read` where `T` requires alignment |
| `W-SYS-010` | `asm!` in a module (audit count) |

---

Next: [16-stdlib.md](16-stdlib.md).
