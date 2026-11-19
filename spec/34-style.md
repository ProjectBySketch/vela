# 34 — Style guide

**Status:** `spec`. Normative where it says MUST; advisory otherwise. `vela fmt`
implements §2 mechanically; `vela lint` implements §3 by rule name.

A language with one formatter has no formatting arguments. What is left is naming,
shape and idiom, and this is that.

---

## 1. Naming

| Kind | Convention | Example |
| --- | --- | --- |
| variable, parameter, function | `lowerCamel` (`snake_case` allowed in `core` scripts) | `totalPrice`, `parseHeader` |
| type, trait, view, style, theme | `UpperCamel` | `HttpRequest`, `CardStyle`, `Dark` |
| constant | `SCREAMING_SNAKE` | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| enum variant | `UpperCamel` for types, `lowerCamel` for values | `Shape::circle(r)`, `Filter::active` |
| module | `lower_snake` | `http_client`, `geometry` |
| package | `scope/name`, both lower case | `acme/dashboard` |
| boolean | reads as a question | `isReady`, `hasChildren`, `canRetry` |
| predicate function | `is…`, `has…`, `can…` | `isValid`, `hasNext` |
| conversion | `toX`, `asX`, `intoX` | `toJson`, `asInt`, `intoBytes` |
| fallible | no prefix; the `Result` says it | `parse(s) -> Result<T, E>` |
| mutating method | imperative verb | `push`, `sort`, `clear` |
| non-mutating method | past participle or noun | `sorted`, `length` |
| test | sentence about behaviour | `rejectsEmptyName`, `sortsByDate` |

Rules:

* No abbreviations except the well-known ones (`id`, `url`, `http`, `io`, `ctx`).
* No single-letter names except `i`, `j` in a loop index and `x`, `y`, `z` for
  coordinates.
* A name may not repeat its type (`userUser`, `stringName`).
* A name may not be a keyword with a suffix unless it is deliberate (`type_`).

---

## 2. Formatting (what `vela fmt` does)

1. Two-space indent, spaces not tabs.
2. One statement per line, no semicolons.
3. `{` opens on the same line; `}` closes on its own line.
4. One blank line between top-level items; no blank line as the first or last line
   of a block.
5. 100-column limit; a call that does not fit breaks one argument per line with a
   trailing comma.
6. `and`/`or`/`not` are rewritten to `&&`/`||`/`!`.
7. Imports grouped `std`, packages, local, each alphabetised.
8. No alignment padding, no manual indentation of continuation lines beyond one
   level.
9. Trailing comments keep two spaces before `#`/`//`.
10. A `match` with a single arm may be written on one line.

Formatting is not configurable, and `vela fmt --check` is the CI gate.

---

## 3. Lints that encode taste

| Rule | Default | Why |
| --- | --- | --- |
| `fn-length` (max 60) | warn | a function you cannot read on a screen is two functions |
| `file-length` (max 600) | warn | past that, the module is doing two jobs |
| `type-fields` (max 20) | warn | a struct with 20 fields is usually a `Map` wearing a costume |
| `nesting-depth` (max 4) | warn | `guard` exists so you do not need a fifth level |
| `bool-params` (max 2) | warn | three booleans at a call site is unreadable; use a named struct |
| `explicit-nil` | warn | `return nil` in a `Void` function is noise |
| `unused-import`, `unused-let` | deny | dead code hides the live kind |
| `shadowing` | allow | shadowing is a feature (doc 04 §2) unless it hides a name in the same scope |
| `todo-comment` | warn | `# TODO(name): …` is allowed; a bare `# TODO` is not |
| `magic-number` | allow | a named constant is better but a lint about it is noise |

Every rule is one sentence in `vela explain W-…`, and every one can be set to
`allow` in `vela.pkg` with a reason.

---

## 4. Idioms

### 4.1 Errors over exceptions over panics

```vela
fn read(path: Str) -> Result<Bytes, IoError>     // expected failure
fn find(xs: List<Int>) -> Int?                    // absence
fn assertInvariant(x: Int)                        // a bug, if it fires
```

* A library returns `Result` for anything a caller might reasonably handle.
* A library panics only for a broken contract (an index its own docs forbid).
* `unwrap()` in a library is a smell; in a test it is fine.
* `?` in a chain is preferred over nested `match`; `match` is preferred when the
  two branches differ in what they do, not just in what they return.

### 4.2 `guard` for the happy path

```vela
fn area(w: Float, h: Float) -> Result<Float, MathError> {
  guard w > 0 else { fail MathError.invalid("width") }
  guard h > 0 else { fail MathError.invalid("height") }
  Ok(w * h)
}
```

Nested `if` on error conditions is the single biggest source of unreadable Vela;
`guard` exists to flatten it, and the style guide says to use it.

### 4.3 Structs over boolean parameters

```vela
// no
connect(host, port, true, false, 30)
// yes
connect(host, port, ConnectionOptions { tls: true, retry: false, timeout: 30s })
```

### 4.4 Immutability by default

`let` unless it changes; `mut` on the smallest scope that needs it. A `mut`
parameter whose value is only read is a bug in the signature.

### 4.5 Small interfaces

A public type exposes the fewest methods that make it useful. A method that a
caller can write in one line from existing ones belongs in `extension` (doc 06
§9) or nowhere.

### 4.6 Named arguments for clarity at the call site

```vela
circle(radius: 4.0, at: (x: 10.0, y: 10.0))
```

A function with more than two parameters of the same type MUST be called with
names in `strict` mode (`E-EXPR-010` in the API review lint, not the checker).

### 4.7 Tests describe behaviour

```vela
#[test]
fn rejectsAnEmptyName() { ... }
```

Not `test1`, not `testValidate`. A test name is a sentence; a failing test's name
is the first thing anyone reads.

---

## 5. Module layout

```vela
# 1. file directives
#![strict]

# 2. imports (std, packages, local)
use std::{list, str}

# 3. constants
const DEFAULT_TIMEOUT = 30s

# 4. types: struct, enum, trait
struct Client { ... }

# 5. constructors and inherent impls
impl Client { fn new(...) -> Self { ... } }

# 6. trait conformances
impl Display for Client { ... }

# 7. free functions, in call order or grouped by task

# 8. tests at the bottom, or in tests/
```

A module with more than one obvious "section" of public types is two modules.

---

## 4.6 Documentation

* Every `pub` item has a doc comment whose first sentence says what it does, in
  the third person ("Returns the…", "Parses…").
* Every `pub` function documents its failure modes and its panicking conditions
  (there should be none).
* A doc example is a doc test (doc 01 §3); if it is not runnable, it is not in a
  `vela` fence.
* A deprecated item's doc says what replaced it, and the attribute repeats it.

---

## 6. API design checklist

Before a public item ships:

1. Can a caller break it with a value its type allows? If yes, the type is wrong.
2. Does it return `Result` where failure is expected, and `T?` where absence is?
3. Is every parameter name necessary at the call site, or is one name enough?
4. Is it cheap to call in a loop? If not, does the name say so?
5. Is it testable without a device, a network or a clock?
6. Does it leak an implementation type in its signature?
7. Does it conform to `Display` if a human will see it, and `Debug` if a developer
   will?
8. Does it need `#[must_use]`?
9. Is the doc's first sentence true?
10. Would removing it break anything? If not, remove it.

---

## 7. Review checklist

| Area | Question |
| --- | --- |
| correctness | is the error path tested? |
| errors | is every `Result` used, logged or returned? |
| concurrency | is shared state behind an actor or a lock? |
| memory | is there an allocation in a hot loop? |
| security | is any user string reaching SQL, HTML or a path? |
| ui | are interactive elements labelled, and is the touch target ≥ 44dp? |
| i18n | is user-visible text in a message catalogue? |
| docs | does a public signature explain its failure modes? |
| tests | would this test fail if the code were deleted? |

Nine questions; a review that answers them is worth more than a long one that
does not.

---

Next: [35-limitations.md](35-limitations.md).
