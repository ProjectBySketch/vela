# Vela

**Vela is a small programming language with its own compiler (`velac`), its own
runtime, and its own packaged toolchain for macOS, iOS and Debian.**

Write one language; the compiler lowers it to portable C11, and the platform's
own C compiler (clang on macOS and iOS, cc on Debian) turns that into a native
binary. That is what lets one ~2,000-line compiler reach all three targets
without a VM, without a bytecode interpreter, and without a dependency.

```
hello.vela ──velac──▶ hello.c ──clang / cc──▶ native binary
```

## What CI produces

Every push to `main` runs three workflows:

| Workflow | Artifact | Contents | How to use |
| --- | --- | --- | --- |
| [`ios.yml`](.github/workflows/ios.yml) | `vela-ios` | `Vela-0.2.0-ios-unsigned.ipa` — the Vela playground app, built for arm64 iOS 15+ | Sign it with Sideloadly / AltStore / TrollStore and install |
| [`build.yml`](.github/workflows/build.yml) | `vela-macos` | `Vela-0.2.0-macos-universal-unsigned.dmg` — universal (arm64 + x86_64) `velac` | Open, run `install.sh`, or copy by hand |
| [`build.yml`](.github/workflows/build.yml) | `vela-debian` | `vela_0.2.0_<arch>.deb` — `velac` + runtime under `/usr/bin` and `/usr/lib/vela` | `sudo dpkg -i vela_0.2.0_amd64.deb` |
| [`studio.yml`](.github/workflows/studio.yml) | `vela-studio` | The React studio and TypeScript toolchain, built to `studio/dist` | `cd studio && npm install && npm run dev` |

**The IPA has its own workflow on purpose.** It is the priority artifact, so it
does not share a run with tests or packages, it cancels an older run of itself,
and it can be started alone: Actions → **ios** → *Run workflow*. macOS runners
queued by GitHub are the usual reason an artifact is late — if the job sits in
"Queued", that is capacity, not a build failure; check the job once it starts.

None of the artifacts are signed, by design: the IPA needs the user's own
developer certificate, and the DMG is meant to be installed without
notarisation. On macOS, right-click the binary and choose **Open**, or clear the
quarantine flag:
`xattr -dr com.apple.quarantine /usr/local/bin/velac /usr/local/lib/vela`.

## Quick start

```sh
make                       # builds build/velac and copies the runtime there
./build/velac examples/hello.vela -o hello
./hello                    # hello, world

make test                  # compiles and runs every test case
```

`velac` looks for the runtime next to itself (`build/runtime`), through
`$VELA_RUNTIME`, or at `<prefix>/lib/vela/runtime` - which is where the Debian
package and the macOS installer put it.

### Command line

```
velac program.vela                 # builds ./program (plus program.c)
velac program.vela -o build/app    # choose the output path
velac program.vela --emit-c -o out.c   # stop after generating C
velac --cc clang program.vela      # choose the host C compiler
velac --runtime ./runtime app.vela # point at vela_runtime.c / vela_main.c
velac --version
```

The generated C is always written next to the binary (`out.c` for `-o out`), so
you can read, keep or hand-tune it.

## The language

Vela is dynamically typed and expression based. Values are `nil`, numbers
(IEEE doubles), booleans, strings, lists and **maps**. Assignment and output are
statements; everything else is an expression.

```vela
# comments run to the end of the line, /* and */ also work

let  greeting = "hello"   # immutable
mut  count = 0            # mutable
let  user = {name: "Ada", age: 36}

fn fib(n) {
  if n < 2 {
    return n
  }
  return fib(n - 1) + fib(n - 2)
}

mut i = 0
while i < 10 {
  print(fib(i))
  print(" ")
  i += 1
}
println("")

let xs = [1, 2, 3]
for x in xs {
  println(x)
}

println("${user.name} is ${user.age}")
```

`docs/learn/` teaches the whole language in eight chapters — start at
[`docs/learn/README.md`](docs/learn/README.md).

### Values and truthiness

`0`, `""`, `[]`, `{}`, `false` and `nil` are falsy; everything else is truthy.

### Operators

```
+  -  *  /  %        arithmetic; + also concatenates strings and lists
== != <  <= >  >=    comparison (numbers, strings; == also lists and maps)
&& || !              logic, short-circuiting
=  += -= *= /=      assignment (only on mut variables, or into a mut collection)
```

`+` converts the other side to text, so `"num: " + 42` is `num: 42`; prefer
`"num: ${42}"`. Strings are immutable. Division is floating point: `10 / 4` is
`2.5`.

### Strings

```vela
println("hello ${name}")            # interpolation
println("${1 + 2} and ${upper("x")}")
println(split("a,b,c", ","))        # [a, b, c]
println(join(["a", "b"], "-"))      # a-b
println(trim("  hi  "))             # hi
println(replace("a-b", "-", "+"))   # a+b
println(contains("hello", "ell"))   # true
println(indexOf("hello", "ll"))     # 2
```

### Lists and maps

```vela
mut xs = [10, 20, 30]
println(xs[0])        # 10
println(xs[-1])       # 30
xs[1] = 99

mut user = {name: "Ada", age: 36}
println(user.name)    # Ada
println(user["age"])  # 36
user.city = "Paris"   # inserts a key
println(keys(user))   # [name, age, city]
println(has(user, "city"))   # true
remove(user, "city")
```

A map is the language's record type: `{name: "Ada"}` and `user.name` are the
idiomatic pair. `{` in expression position starts a map literal; `{` in
statement position starts a block.

### Variables and scope

`let` declares a name that cannot be reassigned, `mut` one that can. Blocks
(`{ }`, `if`, `while`, `for`) open a scope, and inner scopes may shadow outer
names. Assigning into a list or map requires the binding to be `mut`.

### Control flow

```vela
if x > 0 {
  ...
} else if x == 0 {
  ...
} else {
  ...
}

while running {
  ...
}

for item in list {
  ...
}

for key in map {
  ...
}

for ch in "text" {
  ...
}

break
continue
```

`for` iterates lists, the keys of a map, and the bytes of a string;
`range(n)` builds `[0, 1, ..., n-1]`.

### Functions

Functions are declared at the top level with `fn name(params) { ... }` and may
be called before their definition. Arguments are passed by value, and a
function that ends without `return` yields `nil`.

### Builtins

| Builtin | Meaning |
| --- | --- |
| `print(x)`, `println(x)` | write without / with a newline |
| `len(x)` | length of a string (bytes), list or map |
| `str(x)`, `num(x)`, `type(x)` | conversions and the value's type name |
| `push(list, x)`, `at(list, i)`, `set(list, i, x)` | list helpers (indexing also works) |
| `range(n)` | list of the numbers below `n` |
| `split(s, sep)`, `join(list, sep)` | string splitting and joining |
| `upper(s)`, `lower(s)`, `trim(s)` | case and whitespace |
| `contains(haystack, needle)` | substring or element test |
| `replace(s, from, to)`, `indexOf(haystack, needle)` | replace and search |
| `startsWith(s, p)`, `endsWith(s, p)` | prefix and suffix tests |
| `keys(map)`, `values(map)`, `has(map, k)`, `remove(map, k)` | map helpers |
| `abs`, `sqrt`, `floor`, `ceil` | maths |
| `assert(x)` | stop with an error unless `x` is truthy |
| `error(msg)` | stop with a runtime error |

A runtime error (a type mismatch, an out-of-range index, a failed assertion)
prints `vela: runtime error: ...` and exits with status 1.

### Layout rules

No semicolons are needed (`;` is accepted and ignored) and newlines carry no
meaning; `{` and `}` do the grouping. That keeps the grammar small enough to
read in one sitting.

## The specification

Everything above describes what the compiler does **today**. What the language is
meant to become is written down in [`spec/`](spec/README.md): forty-five documents
covering a full programming language in four profiles.

| Profile | Replaces | Status |
| --- | --- | --- |
| `core` | Python, Go, Ruby | `spec` |
| `app` | SwiftUI, UIKit, Compose | `spec` |
| `web` | HTML, CSS, JavaScript, TypeScript | `spec` |
| `sys` | C, C++, Rust `no_std` | `spec` |

Highlights of the specification, so the scale is auditable rather than claimed:

* **60 reserved keywords** and 18 contextual ones (0.1 has 14 keywords).
* **24 primitive and composite types**, a gradual type system with `strict` and
  `loose` modes, generics with bounds and associated types, traits, enums with
  payloads, `Result<T, E>`, `T?`, and checked exhaustive `match`.
* **No borrow checker and no tracing GC**: reference counting, copy-on-write,
  `unique` move values, a cycle collector, and `unsafe` for raw pointers.
* **Structured concurrency**: `async`/`await`, `TaskGroup`, channels, actors,
  `Mutex`/`Atomic`, and compile-time rejection of lock-held-across-`await`.
* **Styling as part of the language** (doc 13): typed styles with **214 checked
  properties**, no cascade, no specificity, container queries, themes and tokens,
  animation with automatic reduced-motion handling, accessibility fields on the
  element. This is the CSS replacement, and the reason it cannot have CSS's
  failure modes.
* **A web profile** (doc 14) that compiles the same views to DOM + WASM, to static
  HTML, or to a native server, with `Markup` escaping by construction and
  parameterised SQL.
* **A systems profile** (doc 15) with `mmio` register blocks, `#[interrupt]`,
  `asm!`, `#[entry]`, page allocators, and no runtime at all — enough to write an
  operating system kernel.
* **40 core standard library modules** plus ~30 specialised ones (graphics, media,
  games, databases, AI, serialization, i18n, plugins, embedded, deployment), with
  over 1,100 items.
* **Machine learning in the language** (doc 36): tensors whose shapes are checked at
  compile time, reverse-mode autodiff over ordinary Vela functions, models as
  structs, tokenisers, inference from safetensors/GGUF/ONNX with KV caching and
  streaming, quantisation, embeddings that plug into doc 20's vector search, and
  evaluation suites that fail CI.
* **A complete OS construction doc** (doc 37): processes, address spaces, a VFS and
  a `FileSystem` trait, a driver framework with IRQ split, typed IPC, syscalls with
  generated userland stubs and `UserPtr` validation, capabilities, `init`,
  services, a POSIX compatibility layer, and QEMU/fault-injection testing.
* **Every data format a program needs** (doc 38): one `Serialize` derive across
  JSON, CBOR, MessagePack, Protobuf, TOML, YAML, CSV and Parquet, schema evolution
  with stored-data migrations, validation as a declared step, and typed dataframes.
* **Deployment and operations** (doc 39): typed configuration, container/OCI and
  static deploy adapters, canaries with automatic rollback, OpenTelemetry traces,
  metrics and logs, health checks and graceful shutdown.
* **A build system, not a build script** (doc 40): CI matrices generated from the
  manifest, workspaces, hermetic `build.vela` scripts, verified local/remote caching,
  reproducible releases, and artifacts from a binary to an `.ipa`, `.deb` or
  container image.
* **Testing as a first-class citizen** (doc 41): unit, doc and integration tests,
  property tests with shrinking, coverage-guided fuzzing, snapshots and golden
  images, load tests with p99 budgets, and mutation testing that measures whether
  the tests would catch a bug.
* **Design by contract** (doc 42): `requires` / `ensures` / `old()` on functions,
  struct invariants, trait contracts, loop invariants, and refinement types
  (`Int in 0..=100`, `NonEmpty<T>`) that remove bounds checks by proving them.
* **Streams, signals and local-first sync** (doc 43): generators, `Stream<T>` with
  `await for`, one operator set for both, reactive signals for UI, and CRDTs with
  an offline queue for two devices editing the same document.
* **Units of measure** (doc 44): `5.m / 9.58.s` is a velocity, `Meter + Second` is
  a compile error, temperatures distinguish points from deltas, `Money` is integer
  cents with a currency, and `Instant + Instant` does not type-check.
* **A development loop with time travel** (doc 45): `vela dev` with per-change hot
  reload and state preservation, deterministic record/replay, reverse execution,
  a live inspector, and remote debugging over DAP.
* **Specialised subsystems, specified in full**: typed SQL with compile-time
  checked queries and migrations (doc 20), 2D/3D rendering with shaders written in
  Vela (doc 21), image/audio/video pipelines (doc 22), HTTP/2 and QUIC with a
  reliability policy (doc 23), a capability-based security model (doc 24), the
  complete toolchain — formatter, linter, LSP, debugger, REPL (doc 25), a stable
  binary ABI and plugin ABI (doc 26), a cost model with guaranteed optimisations
  (doc 27), a self-hosting plan (doc 28), i18n with plural rules and RTL (doc 29),
  a game runtime with deterministic simulation and netcode (doc 30), sandboxed
  plugins (doc 31), and microcontrollers (doc 32).
* **A style guide and a diagnostics catalogue** (docs 33–34), and a document that
  lists every known gap, non-goal and open question (doc 35) — including what this
  specification still does not answer.
* **A migration map** (doc 19) from Swift, SwiftUI, JS/TS, Python, HTML, CSS, Rust,
  C, C++, Java/Kotlin and Go.

`spec/00-status.md` marks **every** feature `impl`, `spec` or `planned`, so the
distance between this repository and that language is never a guess. It is large:
the compiler implements seven value types and thirty builtins; the specification
describes a language roughly a hundred times that surface area. That is stated in
the spec itself, first page, in bold.

The examples in [`spec/examples/`](spec/examples/README.md) — a language tour, a
notes app, a store website, a kernel — are **not** built by CI, because they use
features `velac` does not implement yet. They exist to be read, and to give the
next implementation something to aim at.

## How it works

* `src/velac.c` - the compiler: lexer, recursive-descent parser and C emitter,
  in one portable file, no dependencies beyond libc.
* `runtime/vela_runtime.h` / `.c` - the dynamic semantics: values, operators,
  string conversion, lists and builtins.
* `runtime/vela_main.c` - the desktop entry point (`main` calls `vela_main`).
* `ios/main.m` - the UIKit shell for the iOS app; it installs its own output
  hook (`vela_write_hook`) so `print` lands in a `UITextView` instead of
  stdout.
* `examples/`, `tests/cases/` - programs, each with the exact output it must
  produce.
* `docs/learn/` - the eight-chapter tutorial for the language as shipped.
* `packaging/` - the three packaging scripts the workflow calls.
* `studio/` - the TypeScript toolchain and browser workbench: a second front end
  (lexer, parser, type checker, linter, formatter, REPL) with four backends,
  including the systems/kernel one. See [`studio/README.md`](studio/README.md).
* `stdlib/`, `tools/` - Vela library modules and Vela-native programs, written for
  the `core` profile in `spec/` rather than for `velac`.

Because every expression becomes a call into the runtime, the emitter stays
simple and backends come cheaply: `vela_main()` is just a function, so the same
generated C runs on a desktop (`main`) and inside an iOS app.

## The studio and the `vela` toolchain

[`studio/`](studio/README.md) is a second, independent implementation of the
language in TypeScript, and the web workbench built on it. It is not needed to
build `velac`, and the two do not cover the same surface: `velac` implements the
subset taught in [`docs/learn/`](docs/learn/README.md), while the studio's
toolchain tracks the much larger language in [`spec/`](spec/README.md) — structs,
generics, traits, `match`, closures, `async`, contracts, `theme`/`style`/`view`
and `mmio`.

```sh
cd studio
npm install
npm run dev            # the studio at http://localhost:3000
npm run vela -- help    # the `vela` CLI
```

It reads `examples/`, `tests/cases/`, `spec/` and `stdlib/` from the repository
root, so the studio always shows the same programs the C toolchain tests.
`VELA_ROOT` points it somewhere else; `PORT` moves the server.

```
vela run <file.vela | dir>             run a program or a project
vela check | lint <file.vela>          type check, then lint
vela fmt [--write] <file.vela>         format to the canonical style
vela emit-c <file.vela> [out.c]        portable C11 for the `core` profile
vela emit-kernel <file.vela> [out.c]   freestanding x86_64 kernel C (`sys` profile)
vela build-web <file.vela> [out.html]  standalone site: HTML + CSS + islands
vela export-obj <file.vela> [out.obj]  a `scene3d` block as Wavefront OBJ
vela new <template> <dir>              scaffold tour|website|kernel|model3d_sat|ai_db
vela test                              run tests/cases against the interpreter
vela repl                              interactive REPL
vela zip [out.zip]                     archive the workspace
```

### The systems backend

`vela emit-kernel` lowers a program to freestanding C for a bare-metal x86_64
target with no libc, no allocator and no runtime:

* an `mmio` block becomes a packed register struct and a macro that dereferences
  it at its base address, with `uint8_t` padding so every register sits at its
  declared offset and a `_Static_assert` on `offsetof` to prove it;
* `#[interrupt]` functions get `__attribute__((interrupt))` and a PIC EOI;
* `#[entry]`, `kmain` or `main` becomes the entry point, ending in `hlt`;
* `const` becomes a `#define`, emitted before the functions that use it;
* `print`/`println` become COM1 serial writes, with numbers through a generated
  `ks_put_u64`, because there is no formatter to call;
* `asm!` is preserved verbatim, and function bodies lower to C over `uint64_t`.

Collection `for`-in loops and method calls have no lowering yet and say so in a
comment rather than emitting wrong code. This is not a bootable image by itself:
the boot stub, GDT/IDT and page tables are yours to write, as
[`spec/37-kernel.md`](spec/37-kernel.md) sets out.

## Installing from the artifacts

**Debian / Ubuntu / WSL**

```sh
sudo dpkg -i vela_0.2.0_amd64.deb
velac --version
```

**macOS**

```sh
hdiutil attach Vela-0.2.0-macos-universal-unsigned.dmg
/Volumes/Vela*/Vela-*/install.sh
velac --version
```

**iOS (unsigned IPA)** - open the IPA in Sideloadly or AltStore and sign it with
your Apple ID / certificate; the app is a normal UIKit app named **Vela** that
runs `examples/ios_demo.vela` when you tap *Run the Vela program*.

## Limitations, honestly

Vela 0.2.0 is a real language and a real compiler, and it is still a young one.
What it does **not** have yet, all of it specified in [`spec/`](spec/README.md):

* memory is never freed, so a long-running program grows;
* no closures, so functions cannot be stored in variables or passed around;
* no structs, traits, generics or modules — maps are the record type, and every
  program is one file with one global namespace;
* no `Result` or `?` — errors are `assert`, `error()` and runtime panics;
* no static type checking: the compiler checks names, arity and `mut`, not types;
* no UI, web or async backends in `velac`. The studio's TypeScript toolchain has
  a web backend and a freestanding kernel backend, but it is a separate
  implementation and it emits C, not a bootable image;
* error messages point at a line, not a column, and there is no debugger.

Those are the next steps, in the order the specification already lays out: a type
checker over the values that exist, then closures, then structs and traits, then
reference counting, then modules, then the UI and web backends. Each has a
document that says exactly what to build — this README's job is to be truthful
about which parts are real today.

## License

MIT - see [LICENSE](LICENSE).
