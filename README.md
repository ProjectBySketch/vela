# Vela

**Vela is a small programming language with its own compiler (`velac`), its own
runtime, and its own packaged toolchain for macOS, iOS and Debian.**

Write one language; the compiler lowers it to portable C11, and the platform's
own C compiler (clang on macOS and iOS, cc on Debian) turns that into a native
binary. That is what lets one ~1,700-line compiler reach all three targets
without a VM, without a bytecode interpreter, and without a dependency.

```
hello.vela ──velac──▶ hello.c ──clang / cc──▶ native binary
```

## What CI produces

Every push to `main` runs [`.github/workflows/build.yml`](.github/workflows/build.yml)
and uploads three unsigned artifacts:

| Artifact | Contents | How to use |
| --- | --- | --- |
| `vela-ios` | `Vela-0.1.0-ios-unsigned.ipa` — the Vela playground app, built for arm64 iOS 15+ | Sign it with Sideloadly / AltStore / TrollStore and install |
| `vela-macos` | `Vela-0.1.0-macos-universal-unsigned.dmg` — universal (arm64 + x86_64) `velac` | Open, run `install.sh`, or copy by hand |
| `vela-debian` | `vela_0.1.0_<arch>.deb` — `velac` + runtime under `/usr/bin` and `/usr/lib/vela` | `sudo dpkg -i vela_0.1.0_amd64.deb` |

None of them are signed, by design: the IPA needs the user's own developer
certificate, and the DMG is meant to be installed without notarisation. On
macOS, right-click the binary and choose **Open**, or clear the quarantine
flag: `xattr -dr com.apple.quarantine /usr/local/bin/velac /usr/local/lib/vela`.

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

Vela is dynamically typed and expression based. There are six value types:
`nil`, numbers (IEEE doubles), booleans, strings, lists and functions.

```vela
# comments run to the end of the line, /* and */ also work

let  greeting = "hello"   # immutable
mut  count = 0            # mutable

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
```

### Values and truthiness

`0`, `""`, `[]`, `false` and `nil` are falsy; everything else is truthy.

### Operators

```
+  -  *  /  %        arithmetic; + also concatenates strings and lists
== != <  <= >  >=    comparison (numbers, strings; == also lists, deeply)
&& || !              logic, short-circuiting
=  += -= *= /=      assignment (only on mut variables)
```

`+` converts the other side to text, so `"num: " + 42` is `num: 42`.
Strings are immutable. Division is floating point: `10 / 4` is `2.5`.

### Variables and scope

`let` declares a name that cannot be reassigned, `mut` one that can. Blocks
(`{ }`, `if`, `while`, `for`) open a scope, and inner scopes may shadow outer
names.

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

break
continue
```

`for` iterates any list; `range(n)` builds `[0, 1, ..., n-1]`.

### Functions

Functions are declared at the top level with `fn name(params) { ... }` and may
be called before their definition. Arguments are passed by value, and a
function that ends without `return` yields `nil`.

### Builtins

| Builtin | Meaning |
| --- | --- |
| `print(x)`, `println(x)` | write without / with a newline |
| `len(x)` | length of a string or list |
| `push(list, x)` | append, returns the list |
| `at(list, i)` | element at index, negative counts from the end |
| `set(list, i, x)` | replace an element, returns the list |
| `str(x)`, `num(x)` | conversions |
| `type(x)` | `"nil"`, `"num"`, `"bool"`, `"str"` or `"list"` |
| `abs`, `sqrt`, `floor`, `ceil` | maths |
| `range(n)` | list of the numbers below `n` |
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
meant to become is written down in [`spec/`](spec/README.md): thirty-nine documents
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
the compiler implements six value types and fifteen builtins; the specification
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
* `packaging/` - the three packaging scripts the workflow calls.

Because every expression becomes a call into the runtime, the emitter stays
simple and backends come cheaply: `vela_main()` is just a function, so the same
generated C runs on a desktop (`main`) and inside an iOS app.

## Installing from the artifacts

**Debian / Ubuntu / WSL**

```sh
sudo dpkg -i vela_0.1.0_amd64.deb
velac --version
```

**macOS**

```sh
hdiutil attach Vela-0.1.0-macos-universal-unsigned.dmg
/Volumes/Vela*/Vela-*/install.sh
velac --version
```

**iOS (unsigned IPA)** - open the IPA in Sideloadly or AltStore and sign it with
your Apple ID / certificate; the app is a normal UIKit app named **Vela** that
runs `examples/ios_demo.vela` when you tap *Run the Vela program*.

## Limitations, honestly

Vela 0.1.0 is a real language and a real compiler, but it is a first version:

* memory is never freed (no garbage collector yet), so long-running programs
  grow;
* no closures, classes/structs, maps or modules yet;
* functions are top level only, and calling a value stored in a variable is not
  supported;
* there is no HTML/CSS/JS backend and no UI toolkit of its own — the web target
  (Vela to JS/WASM, plus a declarative UI layer) is **specified** in
  [`spec/14-web.md`](spec/14-web.md) and [`spec/13-ui.md`](spec/13-ui.md) but not
  implemented;
* error messages point at a line, not a column, and there is no debugger.

Read those two bullets together with the specification: the design is pinned
down and reviewable, and the compiler is nowhere near it. The order the roadmap
actually has to go in is: a real type checker, then structs and traits, then RC
and the cycle collector, then modules, then the UI and web backends. Each step is
a document that already says exactly what to build.

## License

MIT - see [LICENSE](LICENSE).
