# 28 — Compiler architecture and self-hosting

**Status:** `spec` for the architecture; `planned` for self-hosting.

This document exists so that the compiler is a specified thing and not just
whatever `src/velac.c` happens to do. It also states, honestly, what the current
implementation is not.

---

## 1. The pipeline

```
source ─▶ lexer ─▶ parser ─▶ AST ─▶ resolver ─▶ type checker ─▶ typed IR
                                          │
                                          ▼
                                    effects & safety checks
                                          │
                                          ▼
                                    lowering (profile)
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                    core: C          app: native    web: DOM + WASM
                    (via clang)      (UIKit/ArkUI)  (HTML/JS/HTTP)
                          │               │               │
                          └───────────────┴───────────────┘
                                          ▼
                                   link / package
```

| Stage | Input → output | Notes |
| --- | --- | --- |
| **lexer** | bytes → tokens | doc 01; UTF-8, comments, attributes |
| **parser** | tokens → AST | doc 18; resumable on error so one typo does not hide five |
| **resolver** | AST → AST + tables | modules, imports, scopes, `use`, visibility, `cfg` pruning |
| **type checker** | AST → typed AST | doc 02–07; `loose` checks what it can, `strict` checks everything |
| **safety** | typed AST → constraints | doc 09 (moves, `unsafe`), doc 10 (`Send`/`Share`), doc 11 (`?`), doc 24 (capabilities) |
| **effects** | typed AST → effect summary | doc 05 §8; purity for `comptime` and caching |
| **lowering** | typed AST → IR | monomorphisation, closure conversion, drop insertion, RC insertion, coroutine splitting |
| **backend** | IR → C / native / WASM | profile-specific |
| **packaging** | objects → artifact | link, entitlements, ipa/d mg/deb, assets |

### 1.1 Why C as one of the backends

`core` lowers to C and then to the host C compiler. This is a deliberate trade:

* it works today with `clang` and `gcc` on every platform Vela runs on;
* it gives the optimiser a mature target;
* it makes the generated code readable when a program misbehaves;
* it costs predictable stack layout and precise debug info, which is why `app`
  and `sys` do not use it.

`app` and `web` and `sys` lower to native IR directly. That is where the
performance guarantees of doc 27 are met without depending on a C compiler's
whimsies.

---

## 2. What `velac` 0.1 is

Stated plainly, because the difference from §1 is the roadmap:

| Spec stage | 0.1 implementation |
| --- | --- |
| lexer | exists, handles a subset (no interpolation, no `#[…]`, no raw strings) |
| parser | recursive descent, single pass, emits C **while** parsing |
| AST | none |
| resolver | a flat scope stack, no modules |
| type checker | none (documents say `loose`; 0.1 is looser than that) |
| safety | bounds checks in the runtime only |
| lowering | direct textual emission |
| backend | C only |
| packaging | works (ipa/d mg/deb) |

That is why the specification is worth more than the compiler right now: the
design is settled; the implementation is a 1,700-line sketch of the smallest
corner of it.

---

## 2.1 Self-hosting plan

The target is a `velac` written in Vela, with the C compiler as the bootstrap.

| Stage | Implementation | Produces | Status |
| --- | --- | --- | --- |
| **0** | `velac` in C (today) | working binaries, conformance results | `impl` (subset) |
| **1** | a Vela *front end* that parses and type-checks and prints diagnostics, compiled by stage 0 | the same diagnostics as 0 | `planned` |
| **2** | a Vela backend that emits C | byte-identical C to stage 0 on the conformance suite | `planned` |
| **3** | the full compiler in Vela | a binary produced by the C compiler from Vela source |
| **4** | the compiler compiled by itself | stage 3's binary builds `velac`; the result must equal stage 3 |
| **5** | self-hosted release | the shipped `velac`, bootstrapped, reproducible |

The gate between each stage is **byte-identical output** on the conformance suite,
not "it seems to work". That is the only way a bootstrap is trustworthy, and it is
the reason stage 2 names C as its output instead of "whatever the IR is".

A self-hosted compiler is what proves the language is usable for a program of
100,000 lines — the compiler is the one program every language must be able to
write in itself.

---

## 3. Error recovery

* The parser synchronises at the next item or statement boundary, so one missing
  brace yields one error, not thirty.
* The type checker reports every independent error in a module before stopping.
* A diagnostic carries: a code (`E-TYPE-030`), a primary span (file, line, column,
  byte range), zero or more secondary spans, a message, a help line, and — where
  one exists — a machine-applicable fix. `--json` emits all of it.
* The same diagnostic renders three ways: human (colour, source excerpt), plain
  (no colour, for CI logs), and structured JSON.

```
error[E-TYPE-030]: heterogeneous list literal
  ┌─ src/main.vela:12:18
  │
12 │   let xs = [1, "two"]
  │                  ^^^^^ expected Int, found Str
  │
help: write `[1, "two"] as List<Any>` or use a union `List<Int | Str>`
```

---

## 4. Incrementality and caching

* The build is incremental per module; a change recompiles that module and its
  dependents, nothing else.
* The cache key is the module's source hash + `cfg` set + dependency interface
  hashes + compiler version. A hash mismatch invalidates; nothing else does.
* A dependency's *interface* is a compact, serialised form (signatures, types,
  docs, inline bodies where `#[inline]`), which is what makes a 200-package build
  not recompile the world.
* `vela build --timings` shows where the time went per stage and per module.

---

## 5. Conformance

`spec/conformance/` is the contract between implementations:

```
conformance/
  types/
    heterogeneous-list/
      fail.vela
      error.txt          # E-TYPE-030
  memory/
    move-after-move/
      fail.vela
      error.txt          # E-MEM-010
  ui/
    container-query/
      pass.vela
      expected.png
```

A compiler claiming conformance runs the suite and reports pass/fail per
directory. A run is **three-valued**: pass, fail, or "not implemented", which is
recorded per feature so the status table (doc 00) can be generated rather than
maintained by hand.

The suite does not exist yet. It is the first artifact a second implementation
(the Vela-written one in §2.1) should produce, because without it "conforms" is
an opinion.

---

## 6. Testing the compiler itself

| Layer | Method |
| --- | --- |
| lexer, parser | golden files: source in, token/AT stream out |
| type checker | conformance `fail` cases with expected codes |
| lowering | IR snapshot per test, reviewed when it changes on purpose |
| backends | `pass` cases compiled and run; output compared |
| codegen | property tests: a random AST is emitted, compiled, and run against an interpreter of the same subset |
| fuzzing | the parser and the type checker run under a fuzzer with a time budget; a crash is a bug |
| differential | `strict` and `loose` on the same program must accept the same valid programs |

The interpreter for property tests is `planned`; until then, codegen is checked by
the `pass` suite and by running every example in `spec/examples/` once the
features it needs exist.

---

## 7. Release process

1. An edition is `2026`, `2028`, …; a release is `1.4.2`.
2. A release is cut from a commit that passes the conformance suite on every
   target the project claims.
3. The changelog is generated from `vela doc --diff` plus commit messages; a
   breaking API change is a section of its own.
4. Artifacts: `velac` per platform (ipa/d mg/deb as today), the conformance
   report, and SBOM (`planned`).
5. The bootstrap stage is recorded in the release notes, so a reproducible build
   can be attempted by a third party from the previous release's binary.

---

## 8. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-CMP-010` | internal compiler error, with a request to report it |
| `E-CMP-020` | a stage exceeded its time budget (a pathology, not a user error) |
| `E-CMP-030` | the `cfg` set has no entry for a target (a manifest bug) |
| `W-CMP-010` | the bootstrap output differs from the recorded stage (self-host gate) |

---

Next: [29-i18n.md](29-i18n.md).
