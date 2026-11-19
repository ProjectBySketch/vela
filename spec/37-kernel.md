# 37 — Building an operating system

**Status:** `spec`. Doc 15 covers the language facilities a kernel needs (MMIO,
interrupts, `asm!`, allocators). This document covers the **system** a kernel is
made of: processes, memory management, filesystems, drivers, IPC, syscalls, a
userland, and how to test all of it. It is the difference between "can write a
boot stub" and "can write an OS".

---

## 1. The shape of a Vela OS

```
userland/        programs, shell, init, services        (profile: core, freestanding libc)
  syscalls       the ABI boundary (generated)
kernel/
  boot/          entry, page tables, boot info
  mm/            physical frames, virtual memory, slab
  sched/         tasks, contexts, timers
  ipc/           ports, shared memory, signals
  vfs/           files, directories, mounts, pipes
  drivers/       bus, block, net, input, display
  fs/            one or more filesystems
  net/           a stack (or a port of one)
  security/      capabilities, users, namespaces
  log/           ring buffer, crash dumps
```

Every layer is a module with an interface; a kernel is not one 30,000-line file.
The profile for all of it is `sys`; the userland is `core` compiled for the
kernel's own ABI.

---

## 2. Processes and threads

```vela
pub struct Process {
  id: ProcessId
  addressSpace: AddressSpace
  mut threads: List<Thread>
  mut fds: List<Descriptor>
  mut cwd: Path
  credentials: Credentials
  mut state: ProcessState
}

pub fn spawn(image: ElfImage, args: List<Str>) -> Result<ProcessId, SpawnError> {
  let space = try AddressSpace.new()?
  try space.load(image)?                       # segments, stack, guard page
  let thread = Thread.new(space, entry: image.entry, stack: stackTop)
  let proc = Process { id: nextId(), addressSpace: space, threads: [thread], ... }
  SCHEDULER.add(proc)
  Ok(proc.id)
}
```

* A process owns an address space; a thread is a schedulable context inside it.
* `Thread` state is `ready`, `running`, `blocked(reason)`, `zombie`; a blocked
  thread is on a wait queue for one object (a lock, a port, a timer), which is how
  priority inversion is avoided by construction.
* Context switch is doc 15 §11's `context.switchTo`; the scheduler is a
  multi-level feedback queue with a real-time band, and its policy is a module so
  a different one can be linked.
* `fork` exists as `spawn` + a copied address space (`Process.fork()`), because
  POSIX userland needs it; `exec` replaces the image in place.

---

## 3. Virtual memory

```vela
let space = AddressSpace.new()?
try space.map(region: Region {
  virt: 0x400000, phys: frame, len: 0x1000,
  flags: [.read, .write, .user],
})?
try space.protect(0x400000, len: 0x1000, flags: [.read, .execute])
```

| Concept | API |
| --- | --- |
| physical frames | `page.Allocator` (buddy or bitmap, doc 15 §8) |
| address space | `AddressSpace` with `map`, `unmap`, `protect`, `translate` |
| regions | `Region` with flags, and a `guard` flag that leaves a page unmapped |
| demand paging | a `FaultHandler` per space; a fault with no handler kills the process |
| copy-on-write | `space.copyOnWrite(region)` — used by `fork` |
| shared memory | `ipc.shared(region)` maps the same frames in two spaces |
| huge pages | `map(..., huge: true)` where the architecture supports it |

A user pointer that arrives in a syscall is validated by `space.validate(ptr, len,
write: bool)`, which returns `Result<Slice, Fault>`. The kernel never trusts a
user address, and the API makes that the only way to read one.

---

## 4. Syscalls and the userland ABI

```vela
// kernel side
#[syscall(0)]
fn sysRead(fd: Int, buf: UserPtr<UInt8>, len: IntSize) -> Result<IntSize, Errno> {
  let slice = try CURRENT.validate(buf, len, write: true)?
  let file = try CURRENT.descriptor(fd)?
  file.read(slice)
}

// userland side, generated from the declaration
let n = try sys.read(fd, buffer)?
```

* `UserPtr<T>` is a pointer that may only be used after `validate`; dereferencing
  it directly is `E-SYS-100`.
* The syscall table is declared once; the kernel side, the userland stub and the
  error mapping are generated from it, so they cannot drift.
* `Errno` is an enum with the POSIX numbers, mapped to Vela's `Result` at the
  boundary. A syscall that returns `-1` in C returns `Err(...)` here.
* The ABI is versioned; a userland program records the ABI it was built for and
  the kernel refuses an older major version with a clear message.

---

## 5. Filesystems and the VFS

```vela
pub trait FileSystem {
  fn mount(self, device: BlockDevice) -> Result<Self, FsError>
  fn lookup(self, path: Path) -> Result<Inode, FsError>
  fn read(self, inode: Inode, offset: UInt64, into: Slice<UInt8>) -> Result<IntSize, FsError>
  fn write(mut self, inode: Inode, offset: UInt64, from: Slice<UInt8>) -> Result<IntSize, FsError>
  fn readDir(self, inode: Inode, at: UInt64) -> Result<List<DirEntry>, FsError>
  fn create(mut self, dir: Inode, name: Str, kind: NodeKind) -> Result<Inode, FsError>
  fn unlink(mut self, dir: Inode, name: Str) -> Result<Void, FsError>
  fn sync(mut self) -> Result<Void, FsError>
}
```

* The VFS is a mount table plus this trait; a filesystem is a module implementing
  it. `ramfs`, `fat32`, `ext2`, `tmpfs`, `procfs` are `planned` in-tree; the trait
  is `spec`.
* Path resolution walks mounts, handles `..` and symlinks with a depth limit
  (`E-SYS-110` on a loop), and returns an `Inode` — a file handle is an inode plus
  a position.
* Permissions are checked in the VFS (`credentials`), not in each filesystem.
* A block device is `BlockDevice` with `readBlocks`, `writeBlocks`, `flush`, and
  an optional `trim`; a filesystem never sees a raw port.

---

## 6. Drivers

```vela
pub trait Driver {
  fn probe(self, device: Device) -> Result<Self, DriverError>
  fn remove(mut self)
  fn suspend(mut self) -> Result<Void, DriverError>
  fn resume(mut self) -> Result<Void, DriverError>
}

pub struct UartDriver {
  base: Mmio<UartRegisters>
  irq: Irq
}
```

* Buses: `pci`, `usb`, `virtio`, `platform` (device tree or ACPI), `i2c`, `spi`.
  Each enumerates and produces `Device` values; a driver declares the IDs it
  matches.
* Interrupt handling is split: a top half that acknowledges the device and defers
  (`irq.defer(work)`), and a bottom half that runs in a kernel task. Doing work in
  the top half is `E-SYS-020` (doc 15 §6) and the audit reports it.
* DMA: `dma.alloc(len, align)` returns a buffer with a physical address and a
  `sync` for cache coherency. Using a DMA buffer after `free` is `E-SYS-120`.
* A driver that panics takes down the kernel; a driver loaded as a userland service
  (microkernel style) does not, and the trait works in both.

---

## 7. IPC

| Mechanism | API | Use |
| --- | --- | --- |
| message ports | `ipc.port()`, `send`, `recv`, typed messages | service calls |
| shared memory | `ipc.shared(region)` | large payloads, framebuffers |
| signals | `ipc.signal(pid, sig)` | POSIX compatibility |
| pipes | `vfs.pipe()` | shell pipelines |
| sockets | `net.socket(...)` | local and network |

A port is typed (`Port<Request>`), and the message type is checked at both ends;
a port that crosses a process boundary is a serialised struct (doc 26 §7), not a
pointer.

---

## 8. Security model

* Credentials: `uid`, `gid`, supplementary groups, and **capabilities** (doc 24):
  a process has a set, and a syscall that needs one is refused with `Err(EPERM)`.
* No ambient authority: a new process starts with the capabilities its parent
  grants explicitly.
* Namespaces (`planned`): mount, pid, net, for containers.
* A kernel module (in-tree driver) runs with full privilege; a userland driver
  does not. The build prints which drivers are in which mode.

---

## 9. Boot, init and userspace

1. Firmware loads the bootloader; the bootloader loads the kernel ELF and a
   memory map (doc 15 §13).
2. `#[entry] kmain(bootInfo)` initialises memory, interrupts, timers, the
   scheduler, the VFS, drivers (probe order from the bus), and the network stack.
3. The kernel mounts the root filesystem from the boot info (an initramfs, a
   partition, or a network boot) and starts `init`.
4. `init` is a Vela program in the userland package: it reads a service
   description, starts services in order, restarts a failed one with backoff, and
   is the parent of everything.
5. The shell is a Vela program (`vela` in `core` profile) using the syscall ABI.

A service is a package:

```toml
[service]
name    = "netd"
exec    = "/bin/netd"
restart = "onFailure"
user    = "root"
caps    = ["net.admin"]
```

---

## 10. POSIX compatibility

Running existing software matters more than purity, so a POSIX layer is part of
the design:

| Layer | Provides |
| --- | --- |
| `libc` (in Vela, compiled to the kernel ABI) | the C library functions a ported program calls |
| syscall shim | the POSIX syscall numbers mapped onto Vela's ABI |
| `/proc`, `/dev`, `/sys` | the pseudo-filesystems programs expect |
| fork/exec/wait | the process model programs assume |

A ported program is recompiled against the Vela libc; binary compatibility with
Linux is **not** a goal (doc 35).

---

## 11. Networking stack

Doc 23's modules are the API; a kernel needs an implementation:

| Layer | In-kernel |
| --- | --- |
| link | an Ethernet driver, ARP, a loopback |
| IP | IPv4 and IPv6, fragmentation, ICMP |
| transport | TCP with congestion control, UDP |
| sockets | the POSIX socket API on top of `ipc` |
| DNS | a resolver client (doc 23 §5) |
| TLS | in userland, where a bug is a process and not a kernel panic |

TLS belongs in userland on purpose: a kernel that parses untrusted certificates is
a kernel with a remote code execution surface.

---

## 12. Observability in a kernel

* A ring-buffer logger that never blocks (`log.ring(64 * 1024)`), dumped on panic.
* Per-CPU counters, a task list, memory statistics, and a `procfs` that exposes
  them for a userland tool to read.
* Crash dumps: on panic, the kernel writes a dump (registers, backtrace, task list,
  last N log lines) to a reserved partition or over serial; `vela crash open`
  symbolises it with the build's symbol map.
* A tracepoint mechanism (`trace.point("sched.switch")`) compiled out unless
  enabled at build time.

---

## 13. Testing an OS

| Level | How |
| --- | --- |
| unit | a module compiled for the host with a fake bus (`pci.fake`, `block.fake`) |
| kernel integration | boot in QEMU with a test initramfs, run a test binary, assert on serial output |
| syscall conformance | a userland suite that exercises the ABI and compares with the spec |
| fault injection | `block.failNext(n)`, `alloc.failAfter(n)` — a filesystem that only works when nothing fails is not a filesystem |
| soak | run for an hour with a workload, assert no leak (`mem.stats`) and no panic |
| boot matrix | every supported target and bootloader, in CI |

```vela
#[test]
#[qemu(machine: "q35", memory: "512M", serial: "stdio")]
#[target("x86_64-unknown-none")]
fn mountsAndReadsAFile() {
  assertSerialContains("init: mounted root")
  assertSerialContains("test: read 12 bytes")
}
```

---

## 14. Build and release of an OS

* `vela build --target x86_64-unknown-none --release` produces the kernel ELF;
  `--emit image` produces a bootable disk image with a bootloader and an
  initramfs.
* `--emit symbols` writes the map for crash symbolisation.
* The userland is a separate package built for the kernel's ABI and packed into
  the initramfs; the build records both hashes in the image header, so a kernel and
  its userland cannot be mismatched.
* An update is a signed image (doc 24 §7) written to the inactive slot; the
  bootloader picks the slot and rolls back on a failed boot after N attempts.

---

## 15. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-SYS-100` | user pointer used without `validate` |
| `E-SYS-110` | symlink loop or path depth exceeded |
| `E-SYS-120` | DMA buffer used after free |
| `E-SYS-130` | syscall ABI major version mismatch |
| `E-SYS-140` | service started without a capability it needs |
| `W-SYS-020` | driver doing work in an interrupt top half |

---

Next: [38-serialization.md](38-serialization.md).
