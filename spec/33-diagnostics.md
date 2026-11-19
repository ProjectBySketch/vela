# 33 — Diagnostics catalogue

**Status:** `spec` for the conventions and the families; individual codes live in
the document that defines the feature, and this file is the index to them.

Every diagnostic has a stable code. A code is a contract: tooling, tests, CI and
`vela check` baselines refer to it, so a code is never reused and never changes
meaning. This document says how codes are assigned, what each field means, and
where each family lives.

---

## 1. Anatomy

```
error[E-TYPE-030]: heterogeneous list literal
  ┌─ src/main.vela:12:18
  │
12 │   let xs = [1, "two"]
  │                  ^^^^^ expected Int, found Str
  │
help: write `[1, "two"] as List<Any>` or use a union `List<Int | Str>`
note: the first element fixes the type in strict mode
```

| Field | Meaning |
| --- | --- |
| severity | `error`, `warning`, `note`, `help` |
| code | `E-<AREA>-<NNN>` or `W-…` |
| message | one sentence, lower case, no trailing period |
| primary span | the smallest range that is wrong |
| secondary spans | the other places involved, labelled with why |
| help | the fix, in the imperative, with code where possible |
| fix | a machine-applicable edit (`vela fix`), when one is unambiguous |
| lint group | for warnings: naming, size, complexity, security, perf, ui, api |

Rules:

* One diagnostic per root cause. A missing brace produces one error, not thirty.
* A message names the thing (`'total'`), not the kind of thing (`the variable`).
* A help never says "try something else"; it says what to write.
* A fix is attached only when it is provably correct in the parser's context;
  "add the missing import" is a fix only when exactly one candidate exists.

---

## 2. Areas

| Prefix | Area | Defined in |
| --- | --- | --- |
| `E-LEX-` | source text and tokens | [01-lexical.md](01-lexical.md) §13 |
| `E-TYPE-` | type checking | [02-types.md](02-types.md) §14 |
| `E-EXPR-` | expressions | [03-expressions.md](03-expressions.md) §11 |
| `E-STMT-` | statements and scope | [04-statements.md](04-statements.md) §16 |
| `E-FN-` | functions and effects | [05-functions.md](05-functions.md) §14 |
| `E-DATA-` | structs, enums, traits | [06-data.md](06-data.md) §14 |
| `E-GEN-` | generics and coherence | [07-generics.md](07-generics.md) §12 |
| `E-MOD-` / `E-PKG-` | modules, packages, registry | [08-modules.md](08-modules.md) §12 |
| `E-MEM-` | memory, moves, `unsafe` | [09-memory.md](09-memory.md) §12 |
| `E-CONC-` | concurrency | [10-concurrency.md](10-concurrency.md) §14 |
| `E-ERR-` | `Result`, `Option`, panics | [11-errors.md](11-errors.md) §13 |
| `E-META-` | `comptime`, macros, attributes | [12-metaprogramming.md](12-metaprogramming.md) §10 |
| `E-UI-` | views, styles, accessibility | [13-ui.md](13-ui.md) §22 |
| `E-WEB-` | pages, routes, markup, HTML | [14-web.md](14-web.md) §15 |
| `E-SYS-` | freestanding, MMIO, interrupts | [15-systems.md](15-systems.md) §17 |
| `E-STD-` | standard library contracts | [16-stdlib.md](16-stdlib.md) §21 |
| `E-FFI-` | foreign functions | [17-ffi.md](17-ffi.md) §9 |
| `E-DB-` | queries, schema, migrations | [20-databases.md](20-databases.md) §12 |
| `E-GFX-` | scenes, shaders, passes | [21-graphics.md](21-graphics.md) §11 |
| `E-MEDIA-` | image, audio, video | [22-media.md](22-media.md) §8 |
| `E-NET-` | connections, policies | [23-networking.md](23-networking.md) §11 |
| `E-SEC-` | permissions, secrets, policy | [24-security.md](24-security.md) §12 |
| `E-TOOL-` | the `vela` tool | [25-tooling.md](25-tooling.md) §11 |
| `E-ABI-` | layout, symbols, plugins | [26-abi.md](26-abi.md) §10 |
| `E-PERF-` | budgets | [27-performance.md](27-performance.md) §11 |
| `E-CMP-` | the compiler itself | [28-compiler.md](28-compiler.md) §8 |
| `E-I18N-` | catalogues, locales | [29-i18n.md](29-i18n.md) §8 |
| `E-GAME-` | entities, determinism, saves | [30-games.md](30-games.md) §11 |
| `E-PLUG-` | plugin loading and ABI | [31-plugins.md](31-plugins.md) §9 |
| `E-EMB-` | microcontrollers | [32-embedded.md](32-embedded.md) §11 |
| `E-RUN-` | run-time failures | spread across docs, listed below |

Warnings use `W-` with the same area suffix, so `W-UI-040` and `E-UI-040` are
clearly a warning and an error from the same area.

### 2.1 Run-time failures

`E-RUN-` is the only family with a **number that is printed at run time** rather
than at build time, because a runtime error has no compiler span:

| Code | Meaning | Where |
| --- | --- | --- |
| `E-RUN-010` | call of a non-function | doc 03 §4.2 |
| `E-RUN-011` | list index out of range | doc 03 §4.3 |
| `E-RUN-012` | integer overflow | doc 03 §5.2 |
| `E-RUN-013` | division by zero | doc 03 §5.2 |
| `E-RUN-014` | shift wider than the type | doc 03 §5.3 |
| `E-RUN-020` | sort with `NaN` | doc 02 §3.4 |
| `E-RUN-030` | failed `Any` cast | doc 02 §3.10 |
| `E-RUN-040` | destructuring shape mismatch | doc 04 §6 |
| `E-RUN-050` | actor deadlock | doc 10 §7 |
| `E-RUN-060` | unsupported regex construct | doc 16 §4.5 |
| `E-RUN-070` | no secure random source | doc 16 §8 |
| `E-RUN-080` | required environment variable missing | doc 16 §10.1 |

A run-time error prints `vela: runtime error [E-RUN-011]: ...` and exits 1, so a
user can paste the code into `vela explain`.

---

## 3. `vela explain`

```sh
vela explain E-TYPE-030
vela explain W-UI-040
vela explain --all --json > codes.json
```

`explain` prints the message, the full description, an example of the error, an
example of the fix, and a link to the document section. `--all --json` is how an
editor, a website or a test fixture gets the catalogue without scraping Markdown.

---

## 4. Severity policy

| Situation | Severity |
| --- | --- |
| a program that would misbehave at run time | error |
| a program that is correct but likely wrong | warning |
| a program that is correct and idiomatic, but new | note |
| a migration from an older edition | warning with a fix |
| a deprecated item | warning, once per call site |
| a lint the user set to `deny` | error |

An error never depends on a flag that a user must remember to pass; a warning
always has a way to be silenced in source (an explicit cast, an `_` binding, an
`#[allow]`-equivalent on the item) so that a team can adopt a lint gradually.

---

## 5. Stability

* A code's meaning never changes. If a check is replaced, the old code is retired
  and listed in §7.
* A code may gain a better message, a better span or a fix.
* A warning may become an error only in a new edition.
* A new check gets a new number, never a reused one.

---

## 6. Baseline files

```sh
vela check --baseline .vela/diagnostics.json   # record
vela check --baseline .vela/diagnostics.json   # compare; new ones fail CI
vela check --baseline --update                 # accept today's set
```

The baseline stores codes with a hash of the span and the message, so moving code
does not resurrect an old warning, and a genuinely new warning cannot hide.

---

## 7. Retired codes

None yet. A retired code is listed here permanently with the release that retired
it and its replacement, so an old CI log remains searchable.

---

Next: [34-style.md](34-style.md).
