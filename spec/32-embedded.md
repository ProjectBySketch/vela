# 32 — Embedded and microcontrollers

**Status:** `spec`. Module: `embedded` (unstable). Doc 15 is the big-systems
story (kernels, MMIO, interrupts); this is the small one: a microcontroller with
64 KiB of flash, no allocator and no operating system.

---

## 1. Targets

```
thumbv6m-none-eabi      Cortex-M0/M0+
thumbv7m-none-eabi      Cortex-M3
thumbv7em-none-eabi     Cortex-M4/M7 (no FPU)
thumbv7em-none-eabihf   Cortex-M4F/M7F (hard float)
thumbv8m.main-none-eabi Cortex-M33
riscv32imac-none-elf    ESP32-C3, GD32V
xtensa-esp32-none-elf   ESP32 (planned)
avr-unknown-gnu-atmega  (planned)
```

A target package declares its memory map and its linker script; the compiler
emits a binary the target's flasher understands.

---

## 2. The floor

What a `sys` program can use on a 32 KiB device:

| Available | Not available |
| --- | --- |
| primitives, `Ptr<T>`, `Volatile<T>` | `Str` concatenation, `List`, `Map`, `Set`, `Bytes` growth |
| `struct`, `enum`, tuples, fixed arrays | closures with captures, `box`, `Async` without a scheduler |
| `if`, `match`, `loop`, `for` over ranges and fixed arrays | `for` over heap collections |
| `unsafe`, `mmio`, `asm!`, `#[interrupt]` | `unsafe`-free requirement? no, `unsafe` is expected here |
| `comptime` (tables in flash) | the cycle collector, the UI, `web`, `db`, `fs` |
| `Result`, `Option` | `panic` formatting beyond a panic handler you write |
| `fmt.writeTo(buffer, ...)` for one-shot formatting | the allocating `fmt.of`, `str.Builder` without an allocator |

The rule is the same as doc 15 §3: memory is visible. `str.writeTo` formats into a
fixed buffer you own, which is exactly what an embedded `printf` should be.

---

## 3. A first program

```vela
#![deny(unsafe)]           // except where noted below; this example is honest about it

use embedded::{gpio, delay, systick}

#[entry]
fn main() -> Never {
  let led = gpio.output(pin: 13)
  let pause = delay::millis(systick.init(48_000_000))

  loop {
    led.high()
    pause.run()
    led.low()
    pause.run()
  }
}
```

That is a complete blink program: no register addresses in the source, a
`Pin` value whose direction is a type, and a delay that cannot be called before it
is initialised (`E-EMB-010` is "delay used before `systick.init`", caught at
compile time because `delay::millis` takes a `&Clock`).

---

## 4. HAL traits

A HAL is a set of traits a chip crate implements; the program depends on the
traits, so it compiles for every board that implements them.

```vela
trait OutputPin {
  fn setHigh(mut self)
  fn setLow(mut self)
  fn toggle(mut self)
}

trait Spi {
  type Error
  fn transfer(mut self, byte: UInt8) -> Result<UInt8, Self::Error>
  fn write(mut self, bytes: Ptr<UInt8>, len: IntSize) -> Result<Void, Self::Error>
}
```

| Trait | Implemented by |
| --- | --- |
| `OutputPin`, `InputPin`, `PwmPin` | every GPIO driver |
| `Spi`, `I2c`, `Uart`, `Can`, `Usb` | peripherals |
| `Adc`, `Dac` | analogue |
| `Timer`, `Counter` | time bases |
| `Storage` | flash, EEPROM, SD, an in-memory fake |
| `Radio` | nRF/BLE/LoRa/Wi-Fi modules |

A driver read from a sensor is written once against `I2c` and works on every board,
which is the actual benefit of a HAL: the sensor crate does not know what chip it
is talking through.

---

## 5. Interrupts and scheduling

```vela
#[interrupt(TIMER2)]
fn onTimer(frame: Ptr<InterruptFrame>) {
  SCHEDULER.tick()
  timers.clear()
}
```

For a program with more than two interrupts, a small deterministic scheduler:

```vela
#[tasks]
fn firmware() {
  #[task(priority: 1, capacity: 4)]
  fn sample(mut s: Sensor) {
    let reading = readSensor()
    log.send(line: "reading", value: value)
  }

  #[task(priority: 2)]
  fn control(mut c: Ctrl) {
    for msg in receiver { c.apply(msg) }
  }

  #[init]
  fn start() -> () { spawnSample(Sensor.new()); }
}
```

* Priorities are static; the scheduler is a stackless priority scheduler generated
  at compile time, so it costs a few hundred bytes rather than a kernel.
* Resource sharing is checked: two tasks touching a peripheral without a declared
  `shared` resource is `E-EMB-020`, which is the data race a real-time system
  cannot have.
* Deadline-bound tasks (`#[task(deadline: 5ms)]`) reserve a timer compare and the
  build reports the schedulability analysis for the declared periods — a static
  result, not a runtime hope.

---

## 6. Memory

| Device | Strategy |
| --- | --- |
| no heap | `static` buffers, `arena` over a `static mut` region, or nothing |
| 32–256 KiB | a `bump` allocator in `.bss` for the few dynamic structures |
| with an allocator | `List`, `Map`, `Str` become available; the build prints the heap's size |

`#[global_allocator]` is optional; `mem.arena` over a static array is the common
choice:

```vela
static mut HEAP_MEM: [UInt8; 8192] = [0; 8192]

#[global_allocator]
const HEAP: Allocator = mem.arena(at: HEAP_MEM, size: 8192)
```

The compiler checks the arena's region is in `.bss` and aligned (`E-EMB-030`), and
`vela build --stats` prints static usage: `.text`, `.rodata`, `.data`, `.bss`, and
the largest stack depth computed from the call graph.

---

## 7. Time

No `time.now()` (there is no wall clock); `embedded::clock` gives a monotonic tick
counter from the platform's own timer, and `Instant` is replaced by `Ticks`. A
`Duration` is still available for arithmetic. A program that wants real time adds
an RTC driver; the language does not pretend one exists.

---

## 8. Power

```vela
#[task(priority: 0)]
fn idle() {
  cpu.wfi()              // wait for interrupt; the scheduler wakes on the next event
}
```

`embedded.power` exposes the chip's low-power modes as typed calls with the
preconditions the chip requires (a mode that stops a timer the program uses is
`E-EMB-040`). `vela build --power` prints the wake sources a program relies on, so
a device that dies after 40 minutes has a table to look at.

---

## 9. Testing and flashing

| Need | Tool |
| --- | --- |
| unit test a driver | `hal.fakeI2c(expect: [...])` returns a fake peripheral |
| run firmware logic on a host | the same code compiled for the host target with the fake HAL |
| run on hardware | `vela flash --target thumbv7em-none-eabihf --probe jlink` |
| run in an emulator | `vela run --qemu --target thumbv7em-none-eabihf` (QEMU's machine model) |
| hardware-in-the-loop | `#[hil]` tests run on a connected board and assert on serial output |

`vela flash` uses `probe-rs` (planned) or a declared `[flash]` command in the
manifest, so a board that needs a vendor tool is a configuration line, not a fork
of the language.

---

## 10. Safety on a microcontroller

* `#![deny(unsafe)]` is achievable for an application on a HAL, because the HAL
  holds the register writes; the application is safe code.
* A `static mut` is allowed in `sys` (doc 04 §2.4) but every access is `unsafe`
  with a reason; the audit table (doc 24 §11) counts them.
* `Ptr` and `Volatile` never appear in safe code.
* Panic behaviour: `#[panic_handler]` writes to a UART or resets the chip; a
  device that is expected to recover uses `Result` and never panics in a loop.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-EMB-010` | a peripheral used before it is initialised |
| `E-EMB-020` | two tasks share a resource without declaring it |
| `E-EMB-030` | allocator region not in `.bss` or misaligned |
| `E-EMB-040` | a low-power mode that would stop a timer the program uses |
| `E-EMB-050` | a floating-point operation in an interrupt on a soft-float target |
| `E-EMB-060` | static usage exceeds the declared device memory |
| `W-EMB-010` | task deadlines not schedulable at the declared rates |

---

Next: [33-diagnostics.md](33-diagnostics.md).
