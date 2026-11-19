# 35 — Limitations, non-goals and open questions

**Status:** living document. This is where the specification is honest about what
it does not have, what it will never have, and what is still a guess.

Everything here is deliberate. A limitation that is written down can be planned
around; one that is not is a lie by omission.

---

## 1. The gap that matters most

`velac` 0.1.0 implements, in full:

* 14 keywords, 6 dynamic value types, 15 builtins;
* `let`, `mut`, assignment, `if`, `while`, `for`, `break`, `continue`, `return`;
* top-level `fn` with recursion;
* a compiler that emits C and calls `clang`/`cc`;
* packaging to a native binary, a DMG, a DEB and an iOS app.

This specification describes roughly **70 standard library modules, 60 reserved
keywords, 24 types, 59 attributes, four profiles and 214 style properties**. The
distance is the roadmap, and no document here closes it. A reader should treat
every `spec` marker as "designed, not built" — that is exactly what doc 00 means.

---

## 2. Closed since the first draft

Every area that was listed here as unwritten has been specified. This table is
the audit trail: the gap, and where the answer now lives.

| Was missing | Now specified in |
| --- | --- |
| borrowed slices | [09-memory.md](09-memory.md) §13 — call-scoped `Slice<T>`, sound without lifetimes |
| `const` generics | [07-generics.md](07-generics.md) §10 — value parameters, arrays, `where` clauses |
| variance for user generics | [07-generics.md](07-generics.md) §7 — derived from position, mutation check |
| coroutine frame memory | [10-concurrency.md](10-concurrency.md) §14 — no allocation before the first suspension |
| `comptime` in shaders | [21-graphics.md](21-graphics.md) §5 — folded tables in shaders |
| C++ interop | [17-ffi.md](17-ffi.md) §3.2 — `extern "cxx"` with a generated shim |
| Objective-C runtime and protocols | [17-ffi.md](17-ffi.md) §3.1 — real classes, selectors, ARC, delegates |
| reflection in `strict` | [12-metaprogramming.md](12-metaprogramming.md) §5.1 — `#[reflect]` per type |
| registry protocol | [08-modules.md](08-modules.md) §10 — publishing, resolving, auth, private registries |
| package signing and SBOM | [24-security.md](24-security.md) §7.1–7.2 |
| streaming SSR | [14-web.md](14-web.md) §11 — shell, suspense, chunking rules |
| service workers | [14-web.md](14-web.md) §10 — behind `#![serviceWorker]` |
| accessibility platform mapping | [13-ui.md](13-ui.md) §13.1 — UIKit/AppKit/DOM tables |
| text shaping | [13-ui.md](13-ui.md) §9.3.1 — the six-stage pipeline |
| `#[derive(Binary)]`, `#[stable]` | [26-abi.md](26-abi.md) §7 — field options, size checks, frozen layouts |
| `#[derive(Proto)]` | [38-serialization.md](38-serialization.md) §1–2, [23-networking.md](23-networking.md) §12 |
| GPU compute fallback | [21-graphics.md](21-graphics.md) §5.2 — generated CPU implementation |
| plugin distribution | [31-plugins.md](31-plugins.md) §6.1 — signed, hash-pinned registry entries |
| metrics and tracing wire format | [39-cloud.md](39-cloud.md) §5 — OpenTelemetry over OTLP |
| `vela deploy` | [39-cloud.md](39-cloud.md) §4 — adapters, canary, rollback |
| mock/fake framework | [25-tooling.md](25-tooling.md) §10.1 — one `test.fake` base |
| benchmark statistics | [27-performance.md](27-performance.md) §6 — median, BCa bootstrap, regression rule |
| docs site generator | [25-tooling.md](25-tooling.md) §6.1 — themes are view packages |

And three whole subsystems were missing and are now specified:

| Was missing | Now specified in |
| --- | --- |
| AI and machine learning | [36-ai.md](36-ai.md) — tensors, autodiff, training, inference, serving |
| building an operating system | [37-kernel.md](37-kernel.md) — processes, VM, VFS, drivers, IPC, POSIX |
| serialization and data | [38-serialization.md](38-serialization.md) — nine formats, validation, dataframes |
| deployment and operations | [39-cloud.md](39-cloud.md) — containers, config, observability, scaling |

---

## 2.1 What is still not specified

The honest remainder, with what a program does in the meantime.

| Area | State | Workaround |
| --- | --- | --- |
| Windows target | not designed; the IO and thread model are POSIX-shaped | WSL, or a Linux binary in a container |
| 32-bit desktop | `Int` is 64-bit on every target | a microcontroller target, or a `sys` build |
| `i128`/`u128` | absent; `Int` is 64-bit and `Bytes` covers wide arithmetic | `crypto`'s wide-integer helpers |
| borrowed mutable slices | deliberately absent (doc 09 §13.2) | a `mut` value, or an `Output` writer |
| stackful coroutines | `async` is stackless (doc 10 §14) | `spawn` a task for deep recursion across an `await` |
| higher-kinded types | not planned (doc 07 §11) | associated types |
| XML | not specified | a package, when a real need appears |
| binary compatibility with Linux | not a goal (doc 37 §10) | recompile against the Vela libc |
| struct packing pragmas per target | only `#[repr(packed)]` | explicit field types and padding fields |
| WASI preview 2 preview | `wasm32-wasi` is specified against the stable surface | a WASI 0.2 adapter is `planned` |
| GPU on `sys` | compute has a CPU fallback, no GPU driver | software rendering, documented as slow |
| distributed training | not specified (doc 36 §13 covers local devices) | data-parallel over a `Channel` is a package |

Each of these is a real gap. None of them blocks the four things the language is
for: an OS, a styled website, an app, or an AI program. That is the bar this
document applies, and it is why the list is short and specific rather than long and
apologetic.

---

## 3. Deliberate non-goals — things Vela will not do

| Non-goal | Why |
| --- | --- |
| **Inheritance** | traits plus delegation cover the cases; inheritance is the one feature every language that has it regrets |
| **Borrow checker with lifetimes** | annotation cost; RC + CoW + `unique` + `borrow` cover the real cases (doc 09 §11) |
| **Tracing garbage collector** | latency, and `sys` cannot have one; two memory models is worse than one |
| **Exceptions** | invisible control flow; `Result` is checked and visible in signatures |
| **Null** | `T?` is a real type you must handle (doc 02 §4.5) |
| **`eval` of strings** | a language that evaluates arbitrary strings cannot be analysed, sandboxed or optimised |
| **Operator overloading by convention** | only through an explicit `impl` (doc 06 §6) |
| **Global mutable statics across modules** | `pub static` is immutable; `static mut` is module-private and refused outside `core`/`sys` |
| **Multiple inheritance, mixins** | `impl Trait for X by field` (doc 06 §5.4) |
| **Implicit numeric conversion** | one category of silent bug, removed |
| **`++`/`--`, ternary `?:`, `goto`** | `+= 1`, `if` as an expression, labelled `break` |
| **Stringly-typed APIs** | config keys are attributes, events are enums, routes are typed |
| **A plugin that adds syntax** | doc 31 §8 — that is the end of analysability |
| **Interpreted mode in the shipped toolchain** | `vela repl` exists for development; the product is compiled |
| **A web framework in the stdlib with an ORM** | doc 20 gives typed SQL; a framework is a package, not a language feature |
| **Windows** | every target in this spec is POSIX-or-bare-metal; a Windows target would need a thread/IO model that is not designed |
| **32-bit desktop** | `Int` is 64-bit on every target; 32-bit is a microcontroller target, not a desktop one |
| **Semantic versioning of the language itself** | editions (doc 00 §6), not semver |

---

## 4. Known risks in the design

Written down because a design without a risk list is a pitch.

| Risk | Why it might hurt | Current mitigation |
| --- | --- | --- |
| RC throughput | every shared assignment is a count; a hot loop can pay more than a tracing GC would | doc 09 §2 makes the count visible (`--count-refs`) and the `for` loop is count-free by contract; `unique` exists for the hot path |
| cycle collector pauses | a trial-deletion pass can be long | incrementality with a 1 ms budget (doc 09 §4); `#![noCycleCollector]` for a program with no cycles |
| `loose` mode as a trap | a codebase stays untyped forever and the checker never helps | `strict` per module, `W-TYPE-001`, and a `vela check --strict-ratio` report for CI |
| monomorphisation bloat | a generic used with 40 types is 40 copies | `#[genericSize]`, `box`, `--stats` reports instantiations |
| UI diffing cost | a large tree diffed per frame is a jank source | keyed `each`, immutable tree, deduplicated styles; doc 13 §19 has a target |
| WASM/DOM boundary | every DOM mutation crosses it | batched mutations, no virtual DOM, 8 KB shim budget (doc 14 §12) |
| `unsafe` in `sys` | a kernel's safety argument rests on review | reason strings, `--audit` table, `#![deny(unsafe)]` per module (doc 24 §11) |
| statements about determinism | "deterministic" is easy to claim and hard to test | doc 30 §6 lists exactly what is deterministic, and a replay test is specified |
| the profile split | four profiles is four sets of semantics to document and implement | one grammar, one type system; the profiles only remove capabilities |
| specification size | 35 documents is more than one person can hold | doc 00 is the status table; doc 18 is the grammar; everything else is reference |

---

## 5. Open questions

Each has a current leaning, and each could still change by RFC.

1. **Should `borrow` be extended?** Today it is call-scoped and read-only. A
   `borrow mut` would remove more copies but reintroduces aliasing rules. Leaning:
   no, until a real workload demands it.
2. **Should `Option<T>` be nullable at the ABI level for all types?** Today only
   pointer-like and `Bool` get the niche optimisation (doc 26 §7.3). Leaning:
   leave it; a general niche optimisation is where compilers grow bugs.
3. **How strict should `loose` be?** Right now it checks what it can and trusts
   annotations. Leaning: keep it, but make the ratio visible so a project can set
   a floor.
4. **Should `match` allow `fallthrough`?** No. Exhaustive matching plus guards
   covers it, and fallthrough is how a switch becomes unreadable.
5. **Should the web profile ship a UI without WASM?** A static-only profile is
   smaller and cannot do interactive state. Leaning: yes, `static` target exists
   (doc 14 §1); the interactive one pays the 8 KB.
6. **Is `db` a language module or a package?** It is specified as a module because
   `#[query]` needs the compiler to check SQL; the drivers are packages. Leaning:
   keep the split.
7. **How much of the stdlib is versioned with the edition?** Today: stable /
   provisional / unstable (doc 16 §20). Leaning: keep three tiers, no more.
8. **Should `#[derive]` be extensible by a package?** No: generated code must be
   inspectable by the compiler. Leaning: a fixed set, plus build-time generators
   (doc 12 §6).
9. **Should Vela have a REPL in the shipped toolchain if there is no interpreter?**
   The REPL compiles each entry (doc 25 §7). Leaning: yes, the cost is a compiler
   invocation per line, not a second implementation.
10. **Editions or feature flags for the language itself?** Leaning: editions
    (doc 00 §6), because a program must not compile differently depending on a
    flag a dependency set.

---

## 6. What would make this spec wrong

The specification is falsifiable, which is the point of writing it down:

* If a real 100,000-line program cannot be written in `strict` mode without
  contorting around a missing feature, the type system is incomplete.
* If the `app` profile cannot render a list of 1,000 rows at 60 fps, doc 13 §19 is
  wrong.
* If a kernel cannot be written without `unsafe` in every function, doc 09 §7 is
  too weak.
* If the web profile's client runtime exceeds its 8 KB budget for a real page,
  doc 14 §12 is a fantasy.
* If a self-hosted compiler (doc 28 §2.1) cannot be written in the language, the
  language is not finished.
* If three independent implementations of doc 18 disagree about a program, the
  grammar is ambiguous and the spec needs an RFC.

Each of these is testable, and each is the reason the conformance suite
(doc 28 §5) is the first artifact to build.

---

## 7. How to change this document

A gap in §2 that gets written becomes a document, not an edit to this one: it moves
out of the gap list and into `spec/`, and its row is removed with the release that
lands it. A non-goal in §3 leaving the list requires an RFC and a new edition.

---

Back to the [index](README.md).
