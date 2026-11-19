# 11 — Errors

**Status:** `spec`, except `assert`, `error(msg)` and the runtime error exit
(`impl`).

Vela has three ways for a program to go wrong, and they are not interchangeable.

| Kind | Mechanism | Recoverable | In a signature |
| --- | --- | --- | --- |
| **Expected failure** | `Result<T, E>` | yes, by the caller | `-> Result<T, E>` |
| **Absence** | `Option<T>` (`T?`) | yes | `-> T?` |
| **Bug** | `panic` | no; the program stops | not expressible |

---

## 1. `Option<T>`

```vela
enum Option<T> {
  Some(value: T)
  nil
}
```

`T?` is sugar. Constructing: `Some(x)` or just `x` where `T?` is expected.
Testing: `match`, `if let`, `guard let`, `??`, `?` (in a function returning
`Option`), `.unwrap()`, `.unwrapOr(default)`, `.map()`, `.andThen()`.

```vela
fn findUser(id: Int) -> User? {
  for u in users {
    if u.id == id { return u }
  }
  nil
}

let name = findUser(7)?.name ?? "anonymous"
```

`.unwrap()` panics with the value's debug form; it is for the case where absence
is impossible and you want to say so. `.expect("msg")` is the same with a
message.

---

## 2. `Result<T, E>`

```vela
enum Result<T, E> {
  Ok(value: T)
  Err(error: E)
}
```

`E` must conform to `Error`:

```vela
trait Error {
  fn message(self) -> Str
  fn cause(self) -> Error?  { nil }      # default: no cause
}
```

An error type is usually an enum, and `#[derive(Error)]` writes the `message`
method from variant names and payloads:

```vela
#[derive(Error)]
enum ConfigError {
  missing(key: Str)                        # "missing configuration key `key`"
  malformed(key: Str, detail: Str)
  io(underlying: IoError)
}
```

---

## 3. The `?` operator

```vela
fn loadConfig(path: Str) -> Result<Config, ConfigError> {
  let text = try fs.readStr(path)?          # IoError  → ConfigError via From
  let json = try json.parse(text)?
  Config.fromJson(json)
}
```

Rules:

* `expr?` unwraps `Ok(v)` to `v`; on `Err(e)` it returns `Err(e)` from the
  enclosing function.
* The error converts through `From`, so `ConfigError` needs
  `impl From<IoError> for ConfigError` (or `#[derive(Error)]` with an
  `io(underlying: IoError)` variant, which generates it).
* `expr?` on an `Option<T>` in a function returning `Option<U>` yields
  `None` on `nil`.
* Mixing the two — `?` on a `Result` in an `Option` function — is
  `E-ERR-010`, and the fix is `expr.ok()?` or a `match`. Being explicit here
  keeps "did it fail, or was it absent?" from becoming "it returned nothing".
* `?` in a closure applies to the closure's own return type, which must be
  written.

---

## 4. `try` / `catch`

`try` converts the `Result` machinery into a block-scoped catch for the cases
where propagating is not what you want.

```vela
let text = try fs.readStr(path) catch e {
  log.warn("cannot read ${path}: ${e.message()}")
  ""
}
```

* `try A catch e { B }` evaluates `A`; on `Ok`, yields the value; on `Err`, binds
  `e` and evaluates `B`, whose value is the result.
* `catch e` may be omitted (`catch { }`) when the error is discarded.
* `catch IoError as e { }` narrows to one error type; further `catch` clauses may
  follow, and the last must be untyped or an `else` (`E-ERR-020`).
* `try` may wrap any expression that yields a `Result`, and it is an expression.
* There is no `throw`. Errors travel only in return values; this is what makes
  every failure visible in a signature.

```vela
let cfg = try loadConfig(p) catch {
  Config.default()
}
```

---

## 5. `panic`, `assert`, `unreachable`

```vela
panic("invariant violated: ${state}")

assert index < len
assert price > 0.0, "price must be positive"
assertEq(f(x), y)
unreachable()
```

* `panic` is for bugs, not for expected failures. It prints
  `vela: panic: <message>` with a stack trace, stops every task, runs `defer`s
  and `Drop`s on the current stack, and exits 101 (or traps in `sys`).
* `assert` is a compile-time-removable `panic` (doc 04 §12).
* `unreachable()` is `panic` plus an optimiser hint.
* `debug.assert(cond)` is removed in release builds; `assert` is kept unless
  `#![releaseAsserts(false)]`.

### 5.1 Panic handler

```vela
#[panic_handler]
fn onPanic(info: PanicInfo) -> Never {
  log.fatal("panic at ${info.location}: ${info.message}")
  sys.crash()
}
```

Exactly one `#[panic_handler]` per program; in `sys` it is required (`E-ERR-030`)
because there is no default.

---

## 6. `fail`

`fail e` is `return Err(e)` (doc 04 §10). It exists because the common shape of a
deep validation function reads better with it:

```vela
fn validate(u: User) -> Result<Void, ValidateError> {
  if u.name.isEmpty { fail ValidateError.empty("name") }
  if u.age < 0 { fail ValidateError.range("age") }
  Ok(unit)
}
```

---

## 7. `defer`, unwinding and drop

Restated as a guarantee, because it is what makes errors survivable:

* On `?` and on `fail`: `defer`s run, `Drop`s run, in the order of doc 09 §5.
* On `panic`: the same, for the current task's stack; other tasks are cancelled
  and their `defer`s run too.
* In `sys`: `Drop` and `defer` run; the panic handler decides what "stopping"
  means.

No `defer` is skipped, no `Drop` is skipped, and a `Drop` that panics is a
compile error (doc 06 §11), so unwinding always terminates.

---

## 8. `#[must_use]` and ignoring failure

Every `Result` is `#[must_use]`. Discarding one is:

* a warning in `loose`: `W-FN-010`;
* an error in `strict`: `E-ERR-040`.

```vela
save()             # E-ERR-040 in strict: the failure would vanish
let _ = save()     # explicit "I know"
try save()?        # propagate
```

This one rule removes the largest category of silent data loss in real programs.

---

## 9. Error context

```vela
let cfg = try json.parse(text)
  .context("while parsing ${path}")?
```

`.context(msg)` wraps the error in a `ContextError` that prepends a message while
keeping the cause chain. `err.chain()` yields each level, outermost first, and
the default report prints them indented — so a failure tells you *where* it
happened, not only *what* happened.

```vela
fn report(e: Error) -> Str {
  e.chain().map(|e| e.message()).join(": ")
}
```

---

## 10. Exit codes

| Situation | Exit code |
| --- | --- |
| `main` returns normally | 0 |
| `main` returns `Err(e)` | 1, with `vela: <e.message()>` on stderr |
| `fs.exit(n)` | `n` masked to 0–255 |
| `panic` | 101 |
| compile error | 1 from `velac`, 2 from `vela test` |

`main` returning `Result<Void, E>` is legal in `core` (doc 05 §11) because CLI
tools should be able to fail without a `match` in every one of them.

---

## 11. Testing errors

```vela
#[test]
fn rejectsEmptyName() {
  let u = User { id: 1, name: "" }
  let err = validate(u).unwrapErr()             # panics if it succeeded
  assertEq(err, ValidateError.empty("name"))    # needs Eq, which derive gives
}

#[test]
fn doesNotPanic() {
  assertDoesNotPanic(fn() { parse("{}") })
}

#[test]
#[shouldPanic("integer overflow")]
fn overflow() { let _ = int.max + 1 }
```

`unwrapErr`, `assertErr`, `assertOk`, `assertNone`, `assertSome` are in
`std.test`. `#[shouldPanic]` takes an optional message substring.

---

## 12. What Vela does not have

| Absent | Because |
| --- | --- |
| `throw` / checked exceptions | invisible control flow; `Result` covers it and appears in the signature |
| Implicit `nil` from a failed call | that is what `Result` and `T?` are |
| `catch (e)` over everything | a program that handles `Error` generically is a program that logs and continues badly; the type is `Any`-free on purpose |
| `finally` | `defer` |
| Error objects that are silently dropped | `#[must_use]` |
| Stack traces in production default | `panic` includes them; `Result` errors get a `chain`, not a trace (a trace is `err.trace()` when the build has `#[traceErrors]`) |

---

## 13. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-ERR-010` | `?` mixing `Result` and `Option` |
| `E-ERR-011` | `?` outside a fallible function |
| `E-ERR-012` | no `From` conversion for the propagated error |
| `E-ERR-020` | unreachable or unordered `catch` clause |
| `E-ERR-030` | missing or duplicate `#[panic_handler]` |
| `E-ERR-040` | discarded `Result` in strict mode |
| `E-ERR-050` | error type without an `Error` conformance |
| `E-ERR-060` | `fail` with a non-conforming error type |
| `W-ERR-010` | `unwrap()` in a `web` request handler (a panic would take down the request) |

---

Next: [12-metaprogramming.md](12-metaprogramming.md).
