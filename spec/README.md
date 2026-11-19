# The Vela Language Specification

**Version 1.0 — edition 2026.**

Vela is one language with four profiles, each of which is a complete language in
its own right:

| Profile | Replaces | Target |
| --- | --- | --- |
| `core` | Python, Go, Ruby, shell scripting | hosted native, JVM-free |
| `app` | SwiftUI, UIKit, Jetpack Compose | iOS, iPadOS, macOS, Android |
| `web` | HTML, CSS, JavaScript, TypeScript | DOM + WASM, SSR server |
| `sys` | C, C++, Rust `no_std`, assembly glue | freestanding bare metal, kernels |

The profiles share one grammar, one type system, one memory model and one
standard library core. They differ in what is *permitted* (a `web` module cannot
call `asm!`), in what is *implied* (an `app` module gets a UI runtime), and in
what is *generated* (DOM operations, UIKit calls, or machine code).

```
                    ┌──────────────┐
   app.vela ───────▶│              │──────▶ UIKit / AppKit / Compose
   web.vela ───────▶│    velac     │──────▶ DOM + CSS + WASM, or HTML/HTTP
   sys.vela ───────▶│              │──────▶ ELF / Mach-O, no runtime
  core.vela ───────▶└──────────────┘──────▶ native binary + vela runtime
```

---

## 1. Status of this document

This specification is **normative for the language** and is written ahead of the
implementation. That asymmetry is deliberate and it is stated plainly here so
that nobody is misled:

* `velac` **0.1.0** implements a small subset: six value types, fourteen
  keywords, fifteen builtins, functions, `if`/`while`/`for`. Everything it
  implements is listed in [00-status.md](00-status.md) as `impl`.
* Everything else in this directory is marked `spec` (design fixed, no compiler
  support yet) or `planned` (sketched, expected to change).

A feature marked `spec` is specified precisely enough to implement from this
document without further design work. A feature marked `planned` may still move.

**Nothing in this specification is a claim that `velac` accepts it today.**

---

## 2. Design principles

The principles are ordered. When two conflict, the earlier one wins.

1. **One language, four profiles.** A program's capabilities are declared, not
   discovered. A kernel author and a website author write the same syntax, and
   the compiler refuses what the profile does not allow. This is why the
   language can replace both C and CSS without becoming both at once.

2. **Safety is the default; `unsafe` is a visible, auditable hole.** Buffer
   overflows, use-after-free and data races are compile errors in `core`, `app`
   and `web`. In `sys` they are also impossible without an explicit
   `unsafe { }` block, and a whole module can be marked `#[deny(unsafe)]` to
   prove it contains none.

3. **No undefined behaviour.** Reading uninitialised memory is a compile error,
   not a coin flip. Integer overflow panics in debug builds and wraps in release
   builds only where `#[wrap]` says so. There is no `reinterpret_cast` outside
   `unsafe`, and `transmute` is checked for size equality at compile time.

4. **Types are optional annotations, checked whenever present.** Vela is
   gradual. In `loose` mode (default for scripts) you may write no types at all,
   exactly like the 0.1 language. In `strict` mode every public boundary must be
   typed and the whole module is checked statically. The same source file can be
   promoted to `strict` without edits if its types are already there.

5. **Removing categories of bug beats catching them.** No null outside `T?`
   (the compiler forces you to handle `nil`). No unhandled errors outside
   `Result<T, E>` (the `?` operator is the only way to widen). No global mutable
   state crossing a task boundary (only `Actor`, `Atomic` and `Mutex` are
   `Send`). No implicit conversions that lose information.

6. **Styling is part of the language, not a string in a file.** A style is a
   typed value with a compiler-checked property set, deterministic composition
   and no cascade. This is what replaces CSS, and it is why Vela cannot produce
   the specific failure CSS is famous for: there is nothing to have a specificity
   war over.

7. **Text is text, markup is markup, and they never mix.** `Str` is UTF-8 and
   immutable. HTML is produced by a `Markup` type that escapes by construction.
   There is no path from a user-supplied string to raw HTML except
   `Markup.trust(..)`, which is banned in `web` modules by default.

8. **The grammar is small; the library is large.** Every feature that can be a
   library is a library. `match`, closures, generics, traits and `comptime` are
   syntax; `json`, `http`, `regex`, `ui` are modules with signatures, not
   keywords. This is how the surface area grows without the language becoming
   unlearnable.

9. **Predictable performance, stated per feature.** Value types copy, shared
   values copy-on-write, `unique` values move, generics monomorphise, no hidden
   allocations in a `for` loop over a list. Anything whose cost is surprising
   must be opt-in and named (`toList()`, `clone()`, `collect()`).

10. **Deterministic output.** Given the same inputs, a Vela program produces the
    same bytes. Hash iteration order is insertion order, float formatting is
    shortest-round-trip, and no feature depends on wall-clock time unless it
    asks for it.

11. **Tooling is not an afterthought.** The spec defines what `vela fmt`, `vela
    check`, `vela test`, `vela doc` and the LSP server consume, and the grammar
    is unambiguous so that all of them can be written once.

12. **No footguns by committee.** No `==` that means "assign", no truthiness
    surprises beyond the documented list, no implicit `this`, no operator that
    silently does something else for a different type unless it was declared in
    an `impl`.

---

## 3. Conformance

A compiler conforms at one of four **tiers**. Each tier is a superset of the
tier before it.

| Tier | Requirement |
| --- | --- |
| **A — Core** | Everything in docs 01–12, in `core` profile, `loose` and `strict` modes. |
| **B — App** | Tier A plus the UI runtime surface in doc 13. |
| **C — Web** | Tier A plus DOM/WASM/SSR surface in doc 14. |
| **D — Sys** | Tier A plus freestanding surface in doc 15. |

Tiers B, C and D are independent of each other. A compiler claiming Tier C must
also claim Tier A.

---

## 4. Documents

Read in order for a full picture; each stands alone for reference.

| # | Document | Contents | Status |
| --- | --- | --- | --- |
| — | [00-status.md](00-status.md) | Every feature with its implementation status | living |
| 01 | [01-lexical.md](01-lexical.md) | Source text, tokens, literals, keywords, attributes | spec |
| 02 | [02-types.md](02-types.md) | Type system, value categories, gradual typing, coercion | spec |
| 03 | [03-expressions.md](03-expressions.md) | Operators, precedence, calls, closures, `match`, comprehensions | spec |
| 04 | [04-statements.md](04-statements.md) | Bindings, control flow, `defer`, `guard`, `with`, lifetimes of scopes | spec |
| 05 | [05-functions.md](05-functions.md) | Functions, generics for functions, async, effects, overloading | spec |
| 06 | [06-data.md](06-data.md) | `struct`, `shared struct`, `enum`, `trait`, `impl`, `interface` | spec |
| 07 | [07-generics.md](07-generics.md) | Type parameters, bounds, associated types, monomorphisation | spec |
| 08 | [08-modules.md](08-modules.md) | Modules, packages, `vela.pkg`, registry, features, `cfg` | spec |
| 09 | [09-memory.md](09-memory.md) | Value categories, RC + cycle collection, `unique`, `Ptr`, allocators | spec |
| 10 | [10-concurrency.md](10-concurrency.md) | `async`/`await`, tasks, channels, actors, `parallel for`, atomics | spec |
| 11 | [11-errors.md](11-errors.md) | `Result`, `Option`, `?`, `try`/`catch`, `panic`, `defer` | spec |
| 12 | [12-metaprogramming.md](12-metaprogramming.md) | `comptime`, macros, `#[derive]`, reflection, doc tests | spec |
| 13 | [13-ui.md](13-ui.md) | Views, layout, styles, themes, animation, a11y — the CSS/SwiftUI replacement | spec |
| 14 | [14-web.md](14-web.md) | Pages, routes, DOM/WASM client, SSR server, assets, security | spec |
| 15 | [15-systems.md](15-systems.md) | Freestanding, MMIO, interrupts, syscalls, allocators, boot | spec |
| 16 | [16-stdlib.md](16-stdlib.md) | The whole standard library, module by module | spec |
| 17 | [17-ffi.md](17-ffi.md) | C, Swift, Objective-C, JS, Python, WASM bridges | spec |
| 18 | [18-grammar.md](18-grammar.md) | Complete EBNF for the entire language | spec |
| 19 | [19-migration.md](19-migration.md) | Construct-by-construct maps from the languages Vela replaces | spec |
| 20 | [20-databases.md](20-databases.md) | Typed SQL, schema declarations, migrations, repositories, cursors | spec |
| 21 | [21-graphics.md](21-graphics.md) | 2D/3D scenes, materials, shaders in Vela, compute, render graphs | spec |
| 22 | [22-media.md](22-media.md) | Image, audio graph, video, streaming pipelines, capture | spec |
| 23 | [23-networking.md](23-networking.md) | HTTP/2, QUIC, DNS, gRPC, MQTT, reliability policy, proxies | spec |
| 24 | [24-security.md](24-security.md) | Permissions, secrets, untrusted input, crypto policy, sandboxing | spec |
| 25 | [25-tooling.md](25-tooling.md) | `vela` CLI, formatter, linter, LSP, debugger, docs, CI, REPL | spec |
| 26 | [26-abi.md](26-abi.md) | Layout, mangling, calling conventions, plugin ABI, reproducibility | spec |
| 27 | [27-performance.md](27-performance.md) | Cost model, guaranteed optimisations, budgets, benchmarks | spec |
| 28 | [28-compiler.md](28-compiler.md) | Pipeline, error recovery, incrementality, self-hosting plan | spec |
| 29 | [29-i18n.md](29-i18n.md) | Message catalogues, plurals, locales, RTL, translation workflow | spec |
| 30 | [30-games.md](30-games.md) | Game loop, ECS, input, physics, determinism, netcode, saves | spec |
| 31 | [31-plugins.md](31-plugins.md) | Native and WASM plugins, host API, sandboxing, versioning | spec |
| 32 | [32-embedded.md](32-embedded.md) | Microcontrollers, HAL traits, static scheduling, no-allocator budgets | spec |
| 33 | [33-diagnostics.md](33-diagnostics.md) | Diagnostic anatomy, code families, severity policy, baselines | spec |
| 34 | [34-style.md](34-style.md) | Naming, formatting, lints, idioms, API and review checklists | spec |
| 35 | [35-limitations.md](35-limitations.md) | The implementation gap, unwritten areas, non-goals, risks, open questions | living |
| 36 | [36-ai.md](36-ai.md) | Tensors, autodiff, training, inference, tokenisers, serving, evals | spec |
| 37 | [37-kernel.md](37-kernel.md) | Processes, virtual memory, VFS, drivers, IPC, syscalls, POSIX layer | spec |
| 38 | [38-serialization.md](38-serialization.md) | Nine formats, derives, schema evolution, validation, dataframes | spec |
| 39 | [39-cloud.md](39-cloud.md) | Deploy adapters, config, observability, scaling, rollback | spec |
| 40 | [40-build.md](40-build.md) | Workspaces, build scripts, hermetic builds, caching, cross-compilation | spec |
| 41 | [41-testing.md](41-testing.md) | Properties, fuzzing, snapshots, load, mutation, coverage | spec |
| 42 | [42-contracts.md](42-contracts.md) | `requires`/`ensures`, invariants, refinement types, proving | spec |
| 43 | [43-streams.md](43-streams.md) | Generators, async streams, signals, CRDTs, local-first sync | spec |
| 44 | [44-units.md](44-units.md) | Units of measure, dimensioned quantities, money, time | spec |
| 45 | [45-dev-loop.md](45-dev-loop.md) | Hot reload, time travel, replay, live inspection, remote debug | spec |

Illustrative programs that exercise the spec live in
[examples/](examples/README.md). They are **not** built by CI, because they use
features `velac` does not implement yet:

| Example | Profile | Shows |
| --- | --- | --- |
| [examples/tour.vela](examples/tour.vela) | `core` | the core language end to end |
| [examples/app/notes.vela](examples/app/notes.vela) | `app` | views, styles, state, persistence |
| [examples/web/site.vela](examples/web/site.vela) | `web` | pages, routes, islands, a server |
| [examples/kernel.vela](examples/kernel.vela) | `sys` | boot, MMIO, interrupts, heap |
| [examples/os/fs.vela](examples/os/fs.vela) | `sys` | a filesystem trait, a block driver, a syscall |
| [examples/ai/train.vela](examples/ai/train.vela) | `core` | tensors, autodiff, training, inference, serving |
| [examples/showcase.vela](examples/showcase.vela) | `core` | contracts, refinements, units, money, streams |

---

## 5. Keywords used in this document

* **MUST**, **MUST NOT**, **SHOULD** — as in RFC 2119.
* **compile error** — the program is rejected before it runs.
* **runtime error** — the program stops and reports `vela: runtime error: ...`.
* **unsafe context** — inside `unsafe { }`, an `extern` body, or a `#[naked]`
  function.
* **profile-gated** — only available when the module's profile permits it.

---

## 6. Changing the language

1. Open a proposal in [rfc/](rfc/) naming the documents it changes.
2. State the principle it serves (§2) and the ones it trades against.
3. Any change that breaks a program conforming to a previous edition requires a
   new edition (this document describes edition `2026`).
4. A change lands in this directory before the compiler implements it, never
   after.

---

## 7. Non-goals

* **Not** a superset of any existing language. There is no "paste your Swift and
  it runs" story; there is a translation map (doc 19) and that is all.
* **Not** a bytecode or VM language. Vela compiles to native code or to
  WASM/DOM. There is no interpreter in the shipped toolchain except `vela
  repl`, which is a developer convenience outside the conformance surface.
* **Not** a dynamic-first language with optional types bolted on. Types are
  first class; the `loose` mode exists so that small scripts stay short.
* **Not** backwards compatible with 0.1 syntax at the feature level — 0.1
  programs keep working unchanged, but nothing in this spec is constrained by
  0.1's implementation shortcuts.

---

## 8. Size at a glance

A measure of how much language there is, so the growth is auditable rather than
claimed:

| Dimension | 0.1 (implemented) | 1.0 (this spec) |
| --- | --- | --- |
| Documents | 0 | 45 |
| Keywords | 14 | 60 reserved + 18 contextual |
| Value types | 6 | 24 primitive and composite |
| Operators | 17 | 48 |
| Statement forms | 8 | 19 |
| Declaration forms | 3 | 18 |
| Stdlib modules | 0 | 75+ |
| Standard library items | 15 builtins | 1,100+ |
| Style properties (replacing CSS) | 0 | 214 |
| Attributes | 0 | 59 |
| Specified diagnostic codes | 0 | 300+ |
| Profiles | 1 (implicit) | 4 |


