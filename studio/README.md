# Vela Studio

The TypeScript toolchain and browser workbench for Vela. It is a second,
independent implementation of the language front end, and it is what drives the
studio's panels: a web compiler, a kernel emulator, a 3D scene viewer, and an
AI/database workbench, each fed by programs written in Vela.

`velac` in the repository root is the shipping compiler. Nothing here is needed
to build it, and the two do not cover the same language surface: `velac`
implements the small subset taught in [`docs/learn/`](../docs/learn/README.md),
while this toolchain tracks the much larger language in [`spec/`](../spec/README.md).

## Layout

| Path | What it is |
| --- | --- |
| `src/vela/lexer.ts` | tokens, including units, colours and string interpolation |
| `src/vela/parser.ts` | the full grammar: structs, enums, traits, impls, `match`, closures, `async`, `gen`, contracts, `theme`/`style`/`view`, `mmio`, `scene3d` |
| `src/vela/typechecker.ts` | name resolution and type checking |
| `src/vela/linter.ts` | style and safety lints |
| `src/vela/formatter.ts` | the canonical formatter |
| `src/vela/codegen.ts` | four backends: portable C11 (`emitC11`), freestanding kernel C (`emitKernelC`), web HTML + CSS + islands (`compileWebTarget`), and the driver behind the interpreter |
| `src/vela/runtime.ts` | the in-process interpreter: values, ARC, concurrency, tensors, typed SQL, HTTP, `scene3d` |
| `src/vela/kernel.ts` | the modelled machine: VGA text, serial, heap, MMIO, IRQs, port I/O, RAM filesystem |
| `src/vela/memory.ts` | ARC bookkeeping, copy-on-write and cycle-collection telemetry |
| `src/vela/ml.ts`, `db.ts` | tensors and training, typed SQL snapshots |
| `src/vela/projects.ts`, `examples.ts` | project templates and bundled programs |
| `src/vela/repl.ts` | the REPL session |
| `src/vela/zip.ts`, `objExporter.ts` | ZIP writer, Wavefront OBJ export |
| `src/App.tsx`, `src/components/` | the React studio |
| `server.ts` | the Express API and Vite dev server |
| `tools/vela.ts` | the `vela` CLI |

## Running it

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # static bundle in dist/
npm run lint     # tsc --noEmit
npm run vela -- help
```

The server reads `examples/`, `tests/cases/`, `spec/`, `spec/examples/` and
`stdlib/` from the repository root — not from a copy — so the studio always
shows the same programs the C toolchain tests. Point it elsewhere with
`VELA_ROOT=/path/to/vela`, and set `PORT` to move it off 3000.

## The systems backend

`vela emit-kernel file.vela out.c` lowers a program into freestanding C for a
bare-metal x86_64 target, with no libc, no allocator and no Vela runtime:

* an `mmio` block becomes a packed register struct plus a macro that
  dereferences it at its base address, so `Uart.data = 0x48` is a real store;
* `#[interrupt]` functions get `__attribute__((interrupt))` and a PIC EOI;
* `#[entry]`, `kmain` or `main` becomes the entry point, with a halt loop;
* `const` becomes a `#define`, emitted before the functions that use it;
* `print`/`println` become COM1 serial writes, and numbers go through a
  generated `ks_put_u64`, because there is no formatter to call;
* `asm!` is preserved verbatim, and bodies lower to C over `uint64_t`.

Collection `for`-in loops and method calls have no lowering yet; they say so in a
comment instead of emitting wrong code. This is not a booting kernel by itself:
the boot stub, GDT/IDT and page tables are yours to write, as
[`spec/37-kernel.md`](../spec/37-kernel.md) describes.

## What is real

Real: the lexer, parser, type checker, linter, formatter, REPL and ZIP/OBJ
export; the interpreter and every panel it feeds; `emitC11` and `emitKernelC`.

Not yet real: neither C backend is a replacement for `velac`'s emitter. `emitC11`
is a readable lowering that targets this repository's `runtime/vela_runtime.h`,
not an optimising backend, and it handles the core statement and expression
forms rather than the whole language. `vela test` runs `tests/cases/` against the
interpreter — a second implementation, so a divergence from the `.out` files is a
bug in one of the two, not a pass.
