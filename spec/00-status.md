# Status: what exists, what is specified, what is planned

Three markers are used throughout the specification.

| Marker | Meaning |
| --- | --- |
| `impl` | Implemented by `velac` 0.1.0 and covered by `tests/cases`. |
| `spec` | Fully specified here. No compiler support. Implementable from the document alone. |
| `planned` | Sketched in the document; details may still change before implementation. |

This file is the single source of truth for the gap. If a document and this
table disagree, this table is right and the document has a bug.

---

## 1. What `velac` 0.1 actually accepts

The complete implemented language, exhaustively:

```
program     := decl*
decl        := fnDecl
fnDecl      := "fn" IDENT "(" params? ")" block
params      := IDENT ("," IDENT)*
block       := "{" stmt* "}"
stmt        := letStmt | mutStmt | assign | ifStmt | whileStmt | forStmt
             | returnStmt | breakStmt | continueStmt | exprStmt
letStmt     := "let" IDENT "=" expr
mutStmt     := "mut" IDENT "=" expr
assign      := IDENT ("=" | "+=" | "-=" | "*=" | "/=") expr
ifStmt      := "if" expr block ("else" (ifStmt | block))?
whileStmt   := "while" expr block
forStmt     := "for" IDENT "in" expr block
returnStmt  := "return" expr?
breakStmt   := "break"
continueStmt:= "continue"
exprStmt    := expr
```

Expressions: `nil`, numbers (f64 only), booleans, strings, lists, identifiers,
calls, `+ - * / %`, `== != < <= > >=`, `&& || !`, grouping. Function values exist
internally but cannot be stored or called from a variable.

Builtins: `print println len push at set str num type abs sqrt floor ceil range
assert error`.

Everything below is not implemented.

---

## 2. Status by area

### 2.1 Lexical structure — doc 01

| Feature | Status |
| --- | --- |
| `#` and `//` line comments | `impl` |
| `/* */` block comments | `spec` |
| Nested block comments | `spec` |
| `///` and `/** */` doc comments with doctests | `spec` |
| Integer literals, decimal | `impl` (as f64) |
| Integer literals `0x`, `0o`, `0b`, `_` separators | `spec` |
| Sized integer literals and suffixes (`1u8`, `1i64`, `1usize`) | `spec` |
| Float literals with exponent, `f32` suffix | `spec` |
| String interpolation `"${expr}"` | `spec` |
| Multi-line `"""` and raw `r"..."` strings | `spec` |
| `Char` literal `'a'` | `spec` |
| Unicode identifiers (XID) | `spec` |
| `#[attribute]` syntax | `spec` |
| Shebang `#!/usr/bin/env vela` | `planned` |

### 2.2 Types — doc 02

| Feature | Status |
| --- | --- |
| `Nil`, `Bool`, `Num`, `Str`, `List<T>` | `impl` (as dynamic `nil`/`bool`/`num`/`str`/`list`) |
| `Int`, `Float` as distinct types | `spec` |
| `Char`, `Bytes`, `Tuple`, `Range` | `spec` |
| `Map<K, V>`, `Set<T>` | `spec` |
| `Option<T>` / `T?` | `spec` |
| `Result<T, E>` | `spec` |
| `Func(...) -> T` as a first-class value | `spec` |
| `Ptr<T>`, `Volatile<T>`, `Opaque` | `spec` |
| `Task<T>`, `Channel<T>` | `spec` |
| Union types `A | B`, `Any` | `spec` |
| Generic type parameters | `spec` |
| Static checking (`strict` mode) | `spec` |
| Gradual checking (`loose` mode) | `impl` (no checker at all) |
| Structural equality/hashing declare rule | `spec` |
| Numeric tower `Int ⊂ Num`, no implicit narrowing | `spec` |

### 2.3 Expressions — doc 03

| Feature | Status |
| --- | --- |
| Arithmetic, comparison, logic, grouping | `impl` |
| Short-circuit `&&`, `||` | `impl` |
| Compound assignment | `impl` |
| `++`/`--` | never |
| Ranges `..<`, `..=` | `spec` |
| Indexing `xs[i]`, negative indices | `impl` (negative, via `at`) |
| Slices `xs[a..<b]` | `spec` |
| Member access `a.b` | `spec` |
| Method calls `a.b()` | `spec` |
| Optional chaining `a?.b`, `a?[0]` | `spec` |
| Nil coalescing `??`, `??=` | `spec` |
| Bitwise `& | ^ ~ << >>` | `spec` |
| Pipeline `|>` | `spec` |
| Spread `...xs` in list literals and calls | `spec` |
| Named arguments `f(n: 1)` | `spec` |
| Default parameter values | `spec` |
| Variadic parameters `...xs` | `spec` |
| Trailing closure `f { |x| ... }` | `spec` |
| Closures `|x| expr` with capture | `spec` |
| `match` expression with patterns, guards, binding | `spec` |
| `if` / `block` as expressions | `spec` |
| List comprehensions `[f(x) for x in xs if p(x)]` | `spec` |
| Struct literal `Point { x: 1 }` | `spec` |
| Enum variant construction and matching | `spec` |
| `await`, `spawn` expressions | `spec` |
| `try`/`catch` as expression | `spec` |
| `comptime` expression | `spec` |
| `unsafe { }` block expression | `spec` |
| `typeOf(x)` and reflection over types | `spec` |
| Operator overloading via `impl` | `spec` |

### 2.4 Statements — doc 04

| Feature | Status |
| --- | --- |
| `let`, `mut`, assignment | `impl` |
| `if`/`else if`/`else` | `impl` |
| `while` | `impl` |
| `for x in xs` | `impl` |
| `break`, `continue` | `impl` |
| `return` with and without value | `impl` |
| `loop { }` with `break value` | `spec` |
| Labelled loops `outer: for` and `break outer` | `spec` |
| `for` over ranges, strings, maps, iterators, channels | `spec` |
| `defer` (LIFO, per scope) | `spec` |
| `guard cond else { }` | `spec` |
| `with` resource binding (auto-close) | `spec` |
| `fail expr` (early `Err` return) | `spec` |
| Multiple binding `let (a, b) = pair` | `spec` |
| Destructuring in `for` and `match` | `spec` |
| `const` (compile-time constant) | `spec` |
| `static` (module-level storage) | `spec` |
| Unreachable-code and unreachable-pattern checks | `spec` |

### 2.5 Functions — doc 05

| Feature | Status |
| --- | --- |
| Top-level `fn`, recursion, forward calls | `impl` |
| Nested functions | `spec` |
| Closures and first-class functions | `spec` |
| Default, named, variadic parameters | `spec` |
| Generic functions | `spec` |
| `async fn` | `spec` |
| `fn` values called through variables | `spec` |
| Methods in `impl` | `spec` |
| Function overloading (trait methods only) | `spec` |
| Tail-call optimisation guarantee in `sys` | `spec` |
| Multiple return via tuple | `spec` |
| `must_use` results | `spec` |

### 2.6 Data — doc 06

| Feature | Status |
| --- | --- |
| `struct` (value type) | `spec` |
| `shared struct` (reference type) | `spec` |
| `enum` with payloads | `spec` |
| `trait` and `impl Trait for Type` | `spec` |
| `interface` (foreign-bridged type) | `spec` |
| Default trait methods | `spec` |
| Generator methods (`yield`) | `spec` |
| `extension` for foreign types | `spec` |
| Operator methods | `spec` |
| `Drop` / destructors | `spec` |
| `#[derive]` conformance | `spec` |
| Inheritance | never (traits + delegation only) |
| Reflection over fields at runtime | `spec` (loose), `planned` (strict) |

### 2.7 Generics — doc 07

| Feature | Status |
| --- | --- |
| Type parameters on functions, structs, enums, traits | `spec` |
| Bounds `T: Trait + Trait` | `spec` |
| `where` clauses | `spec` |
| Associated types | `spec` |
| Generic impls | `spec` |
| Monomorphisation semantics and code-size control | `spec` |
| Variance for shared collections | `spec` |
| Higher-kinded types | never |
| Lifetime parameters | never (GC and CoW instead) |

### 2.8 Modules and packages — doc 08

| Feature | Status |
| --- | --- |
| `mod` with bodies and file modules | `spec` |
| `pub`, `pub(crate)`, `pub(in path)` | `spec` |
| `use` with groups and `as` | `spec` |
| `vela.pkg` manifest | `spec` |
| Dependency resolution and `vela.lock` | `planned` |
| Feature flags | `spec` |
| `#[cfg(target, profile, feature, os, arch)]` | `spec` |
| Conditional dependency by target | `spec` |
| Workspaces | `planned` |
| Registry (`registry.vela.dev`) | `planned` |
| Vendoring and offline mode | `spec` |
| Precompiled binary modules | `planned` |

### 2.9 Memory — doc 09

| Feature | Status |
| --- | --- |
| Reference counting | `spec` |
| Cycle collector | `spec` |
| Copy-on-write for `List`, `Str`, `Map`, `Set`, `Bytes` | `spec` |
| `unique` move semantics | `spec` |
| `Drop` ordering, `defer` interaction | `spec` |
| `Ptr<T>` and `unsafe` dereference | `spec` |
| Custom `Allocator` trait | `spec` |
| Scoped arenas | `spec` |
| `global_allocator` | `spec` |
| Deterministic allocation in `sys` | `spec` |
| Escape analysis (stack allocation) | `planned` |
| Garbage collection (never freed) | `impl` — 0.1 leaks by design |

### 2.10 Concurrency — doc 10

| Feature | Status |
| --- | --- |
| `async fn`, `await` | `spec` |
| `spawn` and `Task<T>` | `spec` |
| Structured concurrency (`TaskGroup`, cancellation) | `spec` |
| `Channel<T>` bounded and unbounded | `spec` |
| `select { }` | `spec` |
| `actor` and `send` | `spec` |
| `Atomic<T>`, `Mutex<T>`, `RwLock<T>`, `Once` | `spec` |
| `parallel for` | `spec` |
| `Send`/`Share` checking | `spec` |
| OS threads (`core` profile) | `spec` |
| Green-thread scheduler in runtime | `planned` |
| Multi-threaded GC | `planned` |

### 2.11 Errors — doc 11

| Feature | Status |
| --- | --- |
| `Result<T, E>`, `Option<T>` | `spec` |
| `?` propagation with conversion | `spec` |
| `try`/`catch` sugar, `catch e { }` | `spec` |
| `panic`, `assert`, `assertEq` | `impl` (`assert` only, as `assert` builtin) |
| `error(msg)` runtime abort | `impl` |
| `defer` unwinding | `spec` |
| Panic handler customisation (`sys`) | `spec` |
| Error context chaining (`.context(..)`) | `spec` |
| Exceptions | never |

### 2.12 Metaprogramming — doc 12

| Feature | Status |
| --- | --- |
| `comptime` blocks and constant folding | `spec` |
| `comptime fn` | `spec` |
| Hygienic template macros | `spec` |
| `#[derive(Eq, Ord, Hash, Display, Debug, Clone, Default, Json, Builder)]` | `spec` |
| Attribute list (59 attributes) | `spec` |
| `#[test]` and doc tests | `spec` |
| Compile-time reflection (`Type.of`) | `spec` |
| Runtime reflection (`vela.meta`) | `spec` (loose), `planned` (strict) |
| Procedural macros as Vela programs | `planned` |
| `eval` of strings at runtime | never |

### 2.13 UI and styling — doc 13

This is the replacement for SwiftUI, UIKit, HTML and CSS.

| Feature | Status |
| --- | --- |
| `view` declarations with typed props | `spec` |
| `state`, `bind`, `env`, `computed` | `spec` |
| Elements: `column`, `row`, `grid`, `zstack`, `scroll`, `canvas`, `text`, `button`, `image`, `field` | `spec` |
| `style` declarations with 214 typed properties | `spec` |
| Style composition, `extend`, per-instance override | `spec` |
| States `when .hover / .pressed / .focused / .disabled / .selected` | `spec` |
| Container/window queries `@when width < 600dp` | `spec` |
| Theming with `theme`, tokens, system light/dark | `spec` |
| Animation `animate`, `transition`, `keyframes`, springs | `spec` |
| Reduced-motion automatic fallback | `spec` |
| Accessibility annotations, required for interactive nodes in strict | `spec` |
| Assets `asset`, image variants, fonts | `spec` |
| Gestures, drag and drop, haptics | `spec` |
| Navigation stack and declarative routes | `spec` |
| 2D canvas painting | `spec` |
| GPU shaders | `planned` |
| Android backend | `planned` |
| Native CSS output (no CSS strings written by hand) | `spec` |

### 2.14 Web — doc 14

| Feature | Status |
| --- | --- |
| `page` and `component` | `spec` |
| DOM event handlers | `spec` |
| Compile to WASM + DOM | `spec` |
| Static site generation | `spec` |
| Responsive `@route`, dynamic segments, layouts | `spec` |
| SSR server (`http`) | `spec` |
| Hydration, islands | `spec` |
| `Markup` escaping by construction | `spec` |
| `fetch`, `WebSocket`, `storage`, `worker`, `history`, `clipboard` | `spec` |
| Sessions, CSRF, CSP helper | `spec` |
| Streaming responses | `planned` |
| Service workers | `planned` |
| Direct JS interop (`extern "js"`) | `spec` |

### 2.15 Systems — doc 15

| Feature | Status |
| --- | --- |
| Freestanding target and `#[entry]` | `spec` |
| `#[panic_handler]` | `spec` |
| `core`-only subset (no heap, no OS) | `spec` |
| `Ptr<T>` arithmetic, `unsafe` | `spec` |
| `volatile` reads/writes | `spec` |
| `mmio` register blocks | `spec` |
| `asm!` inline assembly | `spec` |
| `interrupt fn` | `spec` |
| `extern "c"` and linking | `spec` |
| Linker script support (`.ld`) | `spec` |
| Custom allocators, no global heap | `spec` |
| `#[repr(C/Packed/Align)]` | `spec` |
| `#[naked]`, `#[no_mangle]`, `#[link_section]` | `spec` |
| Syscall declarations | `spec` |
| `#[boot]` entry for kernels | `spec` |
| Multi-arch (x86_64, aarch64, riscv64) | `planned` |
| Self-hosting (`velac` written in Vela) | `planned` |

### 2.16 Standard library — doc 16

40 modules, all `spec`. Only the 15 builtins listed in §1 are `impl`.

### 2.17 FFI — doc 17

| Feature | Status |
| --- | --- |
| `extern "c"` declarations and definitions | `spec` |
| `#[repr(C)]` structs across the boundary | `spec` |
| Vela callback into C | `spec` |
| `extern "swift"` / `#[objc]` | `planned` |
| `extern "js"` | `spec` |
| `extern "python"` | `planned` |
| `extern "wasm"` | `spec` |
| Header generation from Vela | `planned` |
| Binding generation from C headers | `planned` |

### 2.18 Databases — doc 20

| Feature | Status |
| --- | --- |
| `db.open`, connection pool, `Send + Share` pool | `spec` |
| `#[query]` with compile-time schema checking | `spec` |
| Schema declaration DSL and dialect type mapping | `spec` |
| Migrations with checksums, dry run, dangerous-change guard | `spec` |
| Transactions, savepoints, isolation levels | `spec` |
| Typed repositories and checked predicates | `spec` |
| Keyset pagination cursors | `spec` |
| Full-text, JSON, vector search | `spec` (vector index `planned`) |
| Multi-tenancy and sharding | `spec` |
| Query observability and redaction | `spec` |
| Test dialects, rollback-per-test | `spec` |

### 2.19 Graphics — doc 21

| Feature | Status |
| --- | --- |
| Retained 2D scene, transforms, z-order, batching | `spec` |
| Hit testing and picking | `spec` |
| 3D scene, cameras, meshes, materials, lights, instancing | `spec` |
| `shader` declarations compiled to MSL/WGSL/SPIR-V/GLSL | `spec` |
| Compute shaders and dispatch | `spec` (software fallback `planned`) |
| Render graph with pass dependencies | `spec` |
| Headless rendering with deterministic seed | `spec` |
| Golden-image testing | `spec` |
| Charts as a first-class module | `spec` |
| Colour management, HDR, tonemapping | `spec` |
| glTF/USD import | glTF `spec`, USD `planned` |
| GPU shaders authored in Vela running on a device | `planned` |

### 2.20 Media — doc 22

| Feature | Status |
| --- | --- |
| Image decode/encode, resize, filters, colour spaces | `spec` |
| Animated images | `spec` |
| Audio graph: sources, effects, mixer, spatial | `spec` |
| Offline audio rendering for tests | `spec` |
| MIDI input and instrument nodes | `spec` |
| Video decode, seek, encode, thumbnail | `spec` |
| Streaming pipelines with backpressure | `spec` |
| Capture: camera, microphone, screen | `spec` |
| Subtitles | `spec` |

### 2.21 Networking — doc 23

| Feature | Status |
| --- | --- |
| TCP/UDP with timeouts on every call | `spec` |
| Happy-eyeballs connect, address policy, SSRF rules | `spec` |
| HTTP/1.1 and HTTP/2 client with pooling | `spec` |
| HTTP/3 over QUIC, datagrams | `spec` |
| WebSocket, SSE, gRPC, MQTT | `spec` (gRPC messages `planned`) |
| DNS with DoT/DoH and cache caps | `spec` |
| Retry, breaker, rate limit, deadline budget | `spec` |
| Server timeouts, graceful shutdown, health endpoints | `spec` |
| Proxies and forwarded-header trust | `spec` |
| `net.fake` test server | `spec` |

### 2.22 Security — doc 24

| Feature | Status |
| --- | --- |
| Permission declarations in `vela.pkg` | `spec` |
| Enforcement on Apple/Linux/web | `spec` (platform mappings partly `planned`) |
| `Secret<T>` with redaction | `spec` |
| Safe constructors for untrusted input | `spec` |
| Cryptographic policy checked at build time | `spec` |
| Supply chain: lock hashes, `--frozen`, reproducibility | `spec` |
| `vela audit`, SBOM, package signing | `planned` |
| Sandbox profiles and seccomp/landlock generation | `planned` |
| `unsafe` audit table | `spec` |

### 2.23 Tooling — doc 25

| Feature | Status |
| --- | --- |
| `vela` CLI with build/run/test/fmt/lint/doc/add | `spec` |
| Canonical formatter with ten rules | `spec` |
| Lint groups with per-package configuration | `spec` |
| Language server (LSP) and debug adapter (DAP) | `spec` |
| Debug info and Vela-level stack traces | `spec` |
| REPL compiling each entry | `spec` |
| Documentation generator with doc tests | `spec` |
| Machine-readable `--json` for every command | `spec` |
| Official editor extensions | `planned` (except VS Code) |

### 2.24 ABI and binary interface — doc 26

| Feature | Status |
| --- | --- |
| `#[repr(Vela)]`, `#[repr(C)]`, packed, align, transparent | `spec` |
| Enum layout, `Option` niche optimisation | `spec` |
| Shared-value header layout | `spec` (stable within an edition) |
| Symbol mangling scheme | `spec` |
| Stable plugin ABI with version negotiation | `spec` |
| `#[derive(Binary)]`, `#[stable]` | `planned` |
| Reproducible builds and `--verify-repro` | `spec` |

### 2.25 Performance — doc 27

| Feature | Status |
| --- | --- |
| Cost model and ten guaranteed optimisations | `spec` |
| Visible allocation rule | `spec` |
| Benchmarks with statistics and regression gates | `spec` |
| CPU/memory profilers and retain/release counters | `spec` |
| Memory and latency budgets | `spec` |

### 2.26 Compiler architecture — doc 28

| Feature | Status |
| --- | --- |
| The pipeline described in §1 of that document | `spec` |
| `velac` 0.1 as a subset of it | `impl` |
| Self-hosting stages 1–5 with byte-identical gates | `planned` |
| Conformance suite | `planned` |

### 2.27 Internationalisation — doc 29

| Feature | Status |
| --- | --- |
| `messages` catalogues with typed interpolation | `spec` |
| Locale plural rules checked at build time | `spec` |
| Locale-aware number/currency/date/list/unit formatting | `spec` |
| RTL logical layout and bidi isolation | `spec` |
| Translation extraction/import and CI checks | `spec` |
| Pseudolocale rendering | `spec` |

### 2.28 Games — doc 30

| Feature | Status |
| --- | --- |
| Fixed-step loop with bounded catch-up | `spec` |
| ECS with typed queries and deferred structural changes | `spec` |
| Action-based input model | `spec` |
| Kinematic collision and raycasts | `spec` |
| Rigid-body physics and constraints | `spec` |
| Deterministic simulation, replays, state hashing | `spec` |
| Netcode: lockstep, rollback, server authority | `spec` (rollback `planned` in detail) |
| Save games with versioning | `spec` |

### 2.29 Plugins — doc 31

| Feature | Status |
| --- | --- |
| Native and WASM plugins with one declaration | `spec` |
| Host API (log, clock, random, fs, http, kv) | `spec` |
| Sandbox limits: memory, fuel, wall time | `spec` |
| Capability ceiling and hash verification | `spec` |
| Hot reload and per-plugin isolation | `spec` |
| Plugin marketplace | `planned` |

### 2.30 Embedded — doc 32

| Feature | Status |
| --- | --- |
| Cortex-M and RISC-V targets | `spec` (Xtensa/AVR `planned`) |
| HAL traits for GPIO/SPI/I2C/UART/ADC/Storage | `spec` |
| Static-priority task scheduler with deadline analysis | `spec` |
| No-allocator subset with `fmt.writeTo` | `spec` |
| Static memory budget reporting | `spec` |
| `vela flash`, `probe-rs` | `planned` |

### 2.31 Diagnostics and style — docs 33, 34

| Feature | Status |
| --- | --- |
| Diagnostic anatomy, code families, severity policy | `spec` |
| `vela explain`, `--json` catalogue, baselines | `spec` |
| Naming, formatting, lints, idioms | `impl` (formatter), `spec` (lints) |
| API and review checklists | `spec` |


### 2.32 AI and machine learning — doc 36

| Feature | Status |
| --- | --- |
| Tensors with compile-time shapes and dtypes | `spec` |
| CPU and GPU devices, Metal/WebGPU/Vulkan backends | `spec` |
| Reverse-mode autodiff over a Vela function | `spec` |
| `#[derive(Module)]`, `Parameter`, train/eval mode | `spec` |
| Training loop, optimisers, schedules, mixed precision, checkpoints | `spec` |
| Datasets, loaders, prefetch, validation strategy | `spec` |
| Tokenisers (BPE, WordPiece, Unigram) with model hash checking | `spec` |
| Inference from safetensors/GGUF/ONNX, KV cache, streaming | `spec` |
| Quantisation (int8, int4 groupwise) | `spec` |
| Embeddings and vector retrieval | `spec` |
| Serving with batching, limits, cancellation | `spec` |
| Evaluation suites as CI gates | `spec` |
| GPU kernels authored in Vela | `spec` (hardware validation `planned`) |

### 2.33 Kernel and OS construction — doc 37

| Feature | Status |
| --- | --- |
| Processes, threads, scheduler policies, context switch | `spec` |
| Address spaces, demand paging, CoW fork, shared memory | `spec` |
| Syscall table with generated userland ABI and `UserPtr` validation | `spec` |
| VFS and the `FileSystem` trait | `spec` |
| In-tree filesystems (`ramfs`, `tmpfs`, `fat32`, `ext2`) | `planned` |
| Driver framework: PCI, USB, virtio, platform, IRQ split | `spec` |
| IPC: typed ports, shared memory, pipes, signals | `spec` |
| Capability-based process security | `spec` |
| `init`, services, update slots | `spec` |
| POSIX compatibility layer and Vela libc | `spec` |
| In-kernel network stack | `spec` |
| Crash dumps and symbolisation | `spec` |

### 2.34 Serialization and data — doc 38

| Feature | Status |
| --- | --- |
| `#[derive(Serialize, Deserialize)]` across nine formats | `spec` |
| JSON, JSON Lines, CBOR, MessagePack, Protobuf, TOML, YAML, CSV, Parquet | `spec` |
| Schema evolution rules per format and stored-data migrations | `spec` |
| `Validate` derive and the decode-then-validate rule | `spec` |
| Limits on depth, size and polymorphic fields | `spec` |
| Typed dataframes with joins and aggregations | `spec` (window functions `planned`) |
| Golden fixtures for wire formats | `spec` |

### 2.35 Deployment and operations — doc 39

| Feature | Status |
| --- | --- |
| Deployable shapes: binary, static, OCI, static site, Wasm | `spec` |
| Typed configuration with `#[derive(Config)]` and precedence | `spec` |
| Deploy adapters, canary, automatic rollback | `spec` |
| OpenTelemetry traces, metrics and logs over OTLP | `spec` |
| Health/readiness and graceful shutdown | `spec` |
| Local development parity (`vela dev`) | `spec` |
| Multi-region guidance | `spec` |

### 2.36 Build system — doc 40

| Feature | Status |
| --- | --- |
| Target matrix generated for CI | `spec` |
| Workspaces with unified features and `workspace.deps` | `spec` |
| `build.vela` build scripts, hermetic and cached | `spec` |
| Declared generators with input/output tracking | `spec` |
| Interface-hash incrementality and `--explain` | `spec` |
| Local and remote cache with verified entries | `spec` |
| Reproducible builds with `--verify-repro` | `spec` |
| Cross-compilation toolchains in the manifest | `spec` |
| Artifact kinds: bin, lib, c, app, ipa, dmg, deb, oci, sbom | `spec` |

### 2.37 Testing — doc 41

| Feature | Status |
| --- | --- |
| Unit, integration and doc tests | `spec` |
| Property-based tests with shrinking and seeds | `spec` |
| Coverage-guided fuzzing with a saved corpus | `spec` |
| Inline and file snapshots, golden images | `spec` |
| Load tests with p50/p95/p99 budgets | `spec` |
| Mutation testing with a score floor | `spec` |
| Coverage mapped to Vela source | `spec` |
| Isolation rules and fixtures | `spec` |

### 2.38 Contracts and refinements — doc 42

| Feature | Status |
| --- | --- |
| `requires` / `ensures` / `old()` on functions | `spec` |
| Refinement types (`Int in 0..=100`, `where` predicates) | `spec` |
| Struct and enum invariants | `spec` |
| Trait contracts checked against implementations | `spec` |
| Loop invariants | `spec` |
| Contracts on FFI and `unsafe` boundaries | `spec` |
| Static proving via an SMT backend | `planned` |

### 2.39 Streams, signals and sync — doc 43

| Feature | Status |
| --- | --- |
| `gen fn`, `yield`, `yield*` | `spec` |
| `Stream<T>` with `await for` | `spec` |
| Shared operators for iterators and streams | `spec` |
| Backpressure via bounded buffers | `spec` |
| `signal`, `computed`, `effect`, `batch` | `spec` |
| CRDTs (counter, set, map, text, list) | `spec` |
| Local-first sync with offline queue | `spec` |

### 2.40 Units and money — doc 44

| Feature | Status |
| --- | --- |
| `#[unit]` declarations and suffix literals | `spec` |
| Dimensional arithmetic and checked comparisons | `spec` |
| Affine units (temperature points vs deltas) | `spec` |
| `Money` with currency checking and explicit rounding | `spec` |
| `Instant`/`Duration` algebra | `spec` |
| Data sizes, rates and SI derived units | `spec` |
| Physical constants with uncertainty | `spec` |

### 2.41 Development loop — doc 45

| Feature | Status |
| --- | --- |
| `vela dev` with incremental rebuild and reload | `spec` |
| Hot reload with per-change classification | `spec` |
| State preservation rules and opt-outs | `spec` |
| Recording, deterministic replay and time travel | `spec` |
| Live inspector and dev overlay | `spec` |
| Remote and device debugging over DAP | `spec` |

---

## 3. The gap, in one paragraph

The compiler today is a 1,700-line single-pass lowering to C, and it implements
the subset in §1: 14 keywords, 6 value types, 15 builtins, no types, no
closures, no structs, no modules, no borrow or ownership checking, no memory
management, no UI and no web. This specification describes a language roughly
one hundred times that size in surface area: 60 reserved keywords, 24 types, 48
operators, 70+ standard library modules, 18 declaration forms, 214 style
properties and four profiles. Doc 35 records the 23 areas that were gaps in the
first draft and where each was closed, plus the twelve that remain; the distance
between the compiler and this specification is the roadmap, and
it is large on purpose — a language that can build an operating system and a
styled website cannot be a weekend project, and pretending otherwise would be
the only dishonest thing in this repository.

---

## 4. Conformance test suite

`spec/conformance/` will hold one directory per feature, each with:

```
conformance/<area>/<feature>/
  pass/*.vela        # MUST compile, and print the contents of expected.txt
  fail/*.vela        # MUST be rejected with the listed diagnostic code
  expected.txt
  error.txt
```

The diagnostic codes referenced by `error.txt` are defined in each document
(`E-TYPE-004`, `E-MEM-011`, …). A compiler reporting a different code has not
conformed. The suite does not exist yet; it is the first artifact a second
compiler implementation should produce, because it is the only thing that makes
"conformance" mean something.
