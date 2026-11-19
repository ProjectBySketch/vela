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

This specification describes roughly **58 standard library modules, 60 reserved
keywords, 24 types, 59 attributes, four profiles and 214 style properties**. The
distance is the roadmap, and no document here closes it. A reader should treat
every `spec` marker as "designed, not built" — that is exactly what doc 00 means.

---

## 2. Not yet written

These are known holes **in the specification**, not in the compiler. They are
listed so that nobody assumes they are settled.

| Area | Gap | Consequence today |
| --- | --- | --- |
| slices | no borrowed slice type; slicing a `List` copies | zero-copy parsing needs an arena; `planned` for a `Slice<T>` with a scope-bound lifetime |
| `const` generics | syntax reserved, semantics not written | fixed-size buffers in `sys` use `Ptr` + a declared length |
| variance | only `List` is variant; rules for user generics unstated | safe but occasionally requires a copy |
| coroutine memory | where an `async fn` frame is allocated is unspecified | an `async` call may allocate; the cost is not in the finished contract |
| `comptime` in shaders | shader bodies may not use `comptime` | a shader cannot generate a lookup table at build time |
| C++ interop | doc 17 covers C, not C++ classes/templates | a C++ library needs a C shim |
| Objective-C runtime | `#[objc]` is specified, protocol conformance details are not | doc 17 §3 is `planned` as a whole |
| reflection in `strict` | `Type.of` is `comptime`-only | a serialiser that must discover a type at run time cannot be written in `strict` |
| registry | `vela.pkg`, lock and features are specified; the registry's API, auth and moderation are not | publishing has no server |
| package signing | mentioned as `planned` in doc 24 §7 | `vela audit`/SBOM are placeholders |
| streaming SSR | doc 14 §11 covers the shell only | a streamed response is `planned` |
| service workers, workers | `web.worker` is sketched | offline web apps are `planned` |
| accessibility platform mapping | properties and roles are specified; the exact UIKit/AppKit/DOM mapping tables are not | a renderer must improvise the last mile |
| text shaping | `text` is specified; the shaping engine (HarfBuzz-class) is not | complex scripts depend on the platform |
| `#[derive(Binary)]`, `#[stable]` | used in doc 26 §7, not defined | the persisted-format story is incomplete |
| `#[derive(Proto)]` | named in doc 23 §4, not defined | gRPC message types are `planned` |
| GPU compute fallback | doc 21 promises a software fallback on `sys`, with no algorithm | a `sys` program using compute has no shipped path yet |
| plugin marketplace | doc 31 covers loading, not distribution | there is no catalogue of plugins |
| metrics/tracing standard | doc 23 §9 assumes sinks, not a wire format | observability is conventional, not specified |
| `vela deploy` | mentioned in doc 14 §13, not specified | deploying is "copy the dist tree or run the binary" |
| mock/fake framework | fakes are described per module (`net.fake`, `hal.fakeI2c`, `testHost`) with no shared base | three conventions instead of one |
| benchmark statistics | doc 27 promises confidence intervals, names no method | numbers may not be comparable across machines |
| docs site generator | `vela doc` is specified; the HTML output format is not | nobody can write a theme |

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
