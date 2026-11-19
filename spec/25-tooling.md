# 25 — Tooling

**Status:** `spec`. The tool is `vela`, a single binary. `velac` is the compiler
inside it; it stays usable on its own for a one-file script.

---

## 1. Commands

| Command | Does |
| --- | --- |
| `vela new <name>` | creates a package with a manifest, `src/main.vela`, `.gitignore` |
| `vela new --template app\|web\|sys\|lib <name>` | a working starter for the profile |
| `vela build` | compiles for the current target |
| `vela run [-- args]` | builds and runs (or serves, or installs on a simulator) |
| `vela test` | builds and runs tests (doc 12 §7) |
| `vela bench` | benchmarks, with comparison against the last run |
| `vela check` | type-checks without emitting |
| `vela fmt [--check]` | formats (doc 25 §3) |
| `vela lint` | the lint pass, separate from `check` |
| `vela doc [--open]` | builds documentation |
| `vela add <pkg>` / `vela remove <pkg>` / `vela update` | dependency edits |
| `vela search <term>` | registry search |
| `vela publish` | validates and publishes |
| `vela audit` | advisories (`planned`) |
| `vela db check\|diff\|migrate\|seed` | doc 20 |
| `vela bindgen --header\|--swift\|--proto` | doc 17 §8 |
| `vela repl` | an interactive session |
| `vela explain <code>` | a diagnostic's full explanation |
| `vela clean` | removes the build directory |
| `vela meta` | compiler, target and environment report |

Global flags: `--target`, `--release`, `--frozen`, `--offline`, `--verbose`,
`--json`, `--jobs N`, `--config key=value`.

`--json` makes every command emit machine-readable output, because CI and editors
should not be parsing prose.

---

## 2. Builds

```sh
vela build                       # debug, current target
vela build --release             # optimised
vela build --target aarch64-unknown-none
vela build --profile app         # override the manifest's profile
vela build --emit c|obj|asm|llvm|ir
vela build --stats               # sizes, timings, monomorphisation counts
vela build --timings out.json    # a Chrome trace of the build itself
```

* Output goes to `build/<target>/<profile>/`.
* The build is incremental per module: a module's hash covers its source, its
  `cfg` set, its dependencies' public interfaces and the compiler version.
* `--stats` prints, per module: front-end time, generated code size, inline count,
  monomorphisations, and the top ten functions by size. It is how a regression is
  noticed before it ships.
* `--emit c` gives the lowered C for a `core` package; for `app`/`web`/`sys` it
  gives the IR, since C is not the intermediate there.

---

## 3. Formatting

`vela fmt` is canonical: two programs that differ only in layout produce
byte-identical output. The rules — the whole list:

1. Two-space indentation, spaces never tabs.
2. One statement per line; no semicolons.
3. Braces: opening on the same line, closing on its own line at the parent's
   indentation.
4. A blank line between top-level items, none inside a short function body.
5. Maximum line width 100; a call that does not fit breaks after `(`, one
   argument per line, trailing comma.
6. `and`/`or`/`not` are rewritten to `&&`/`||`/`!`.
7. Imports are sorted and grouped: std, then packages, then local; each group
   alphabetised.
8. Alignment is not preserved (no padded `=`), because it makes diffs noisy.
9. Comments stay attached to the item below them; a comment that would move
   across a blank line keeps its blank line.
10. `vela fmt --check` exits non-zero if anything would change, which is the CI
    form.

Formatting is not configurable. A language with one format has no arguments
about it, and the formatter is 100 % of the answer to "how should this look".

---

## 4. Linting

Separate from the type checker, and each rule is individually explainable with
`vela explain W-...`.

| Group | Examples |
| --- | --- |
| naming | `snake_case` in `core`, `UpperCamel` for types, `SCREAMING_SNAKE` for constants |
| size | a function over 60 lines, a file over 600, a type with over 20 fields |
| complexity | nesting depth over 4, boolean expression with over 4 operators |
| correctness-adjacent | discarded `#[must_use]`, unreachable arm, empty `match` on a non-empty enum |
| performance | `list.len` in a loop condition on a copy-on-write list, string `+` in a loop, `queryRaw` |
| security | the doc 24 §11 set |
| ui | dead style, touch target under 44dp, animation ignoring reduced motion, missing label |
| api | `pub` item without docs, a breaking change against the last published version (`W-API-010`) |

Lints are enabled by default at their listed level and can be configured per
package:

```toml
[lint]
level = "deny"          # deny | warn | allow
rules = { fn-length = "warn", query-raw = "deny" }
```

---

## 5. Language server

`vela lsp` speaks LSP over stdio. Capabilities:

| Capability | Detail |
| --- | --- |
| diagnostics | pushed on change, with the same codes and spans as the CLI |
| completion | locals, members, modules, keywords, with type-aware filtering |
| hover | type, docs, the declaration's source |
| definition / references | across modules and dependencies |
| rename | package-wide, including doc links |
| code actions | add missing `match` arm, import a name, apply a lint fix, extract a function |
| formatting | `vela fmt` on save |
| inlay hints | inferred types in `loose` mode, parameter names at call sites |
| semantic tokens | syntax highlighting with no grammar file |
| code lenses | "run test", "run benchmark" |
| signature help | parameters with defaults and effects |
| inlay errors | a query's schema mismatch appears in the SQL string literal |

The server is the same compiler library as the CLI: one implementation of every
diagnostic, so an editor and CI can never disagree.

---

## 4.1 Debugging

```sh
vela run --debug --brk main.vela
vela test --gdb --filter floodFill
```

* A `velac`-generated binary carries DWARF when built with `--debug`, so `lldb`
  and `gdb` work on it directly, with Vela names (`v_total`, `f_fib`) mapped back
  to source names.
* `vela lsp` provides a Debug Adapter Protocol endpoint: breakpoints, stepping,
  variables, watch expressions, and the ability to evaluate a Vela expression in
  a frame.
* `debug.breakpoint()` is a `SIGTRAP` on every platform.
* A panic prints a Vela-level stack trace with file, line and column; in `release`
  the trace is included only when `#![traceErrors]` is set, to keep the binary
  small.

---

## 6. Documentation

`vela doc` renders doc comments (doc 01 §3) into static HTML:

* one page per item, with its signature, docs, derived conformances, and the
  items it re-exports;
* a search index built from names and the first sentence of each doc;
* doc tests (doc 12 §7) run by `vela test --doc`;
* a package-level `index.vela.md` may override the landing page;
* `--json` emits the whole API as a JSON schema, which is what an editor's
  completion data and a version-diff tool consume.

`vela doc --diff <version>` lists public API changes between two versions — the
input to a release note, and to the `W-API-010` lint.

---

## 7. REPL

`vela repl` starts a session in `loose` mode with the package's dependencies
loaded:

```
vela> let xs = [1, 2, 3]
vela> xs.map(|x| x * 2)
[2, 4, 6]
vela: list<Int>
vela> :type xs
List<Int>
vela> :doc list.sort
fn sort<T: Ord>(xs: List<T>) -> List<T>
```

Commands: `:help`, `:quit`, `:type <expr>`, `:doc <path>`, `:load <file>`,
`:strict` (switch modes), `:clear`. The REPL compiles each entry with the same
front end as a file, so a snippet that works there works in a program — the one
property a REPL must have to be worth using.

---

## 8. CI integration

```yaml
- run: vela build --frozen
- run: vela fmt --check
- run: vela lint --deny warnings
- run: vela test --coverage --json > results.json
- run: vela build --sbom sbom.json     # planned
```

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | general failure |
| 2 | test failures |
| 3 | type or compile error |
| 4 | lint or format failure |
| 5 | manifest, lock or dependency error |
| 6 | tooling/internal error |

A CI job distinguishes "the code is wrong" from "the toolchain is unhappy"
without parsing output.

---

## 9. Editor support

| Editor | Mechanism |
| --- | --- |
| VS Code | the official extension, a thin client over `vela lsp` |
| Neovim / Vim | built-in LSP client |
| Emacs | `eglot` |
| JetBrains | an LSP plugin (`planned`) |
| Xcode | a source editor extension (`planned`) |

There is no separate grammar file to maintain: semantic tokens come from the
compiler's own lexer, so highlighting cannot drift from the language.

---

## 10. Project structure the tools expect

```
acme/
  vela.pkg
  vela.lock
  README.md
  src/
    main.vela
  tests/
  assets/
  migrations/        # if the package uses db
  build/             # ignored
  .vela/
    cache/           # per-package build cache
```

`vela new` produces exactly this, `vela clean` removes `build/` and `.vela/cache/`,
and nothing else is created by the toolchain.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-TOOL-010` | unknown command or flag |
| `E-TOOL-020` | no `vela.pkg` in this directory or above |
| `E-TOOL-030` | formatter could not parse (it formats valid code only) |
| `E-TOOL-040` | `vela doc` failed on a broken doc link |
| `W-TOOL-010` | `vela fmt --check` found differences |
| `W-API-010` | breaking change in a published package's public API |

---

Next: [26-abi.md](26-abi.md).
