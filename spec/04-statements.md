# 04 — Statements, blocks and scope

**Status:** `spec`, except `let`, `mut`, `if`, `while`, `for`, `return`, `break`,
`continue`, assignment — all `impl`.

---

## 1. Blocks

A block is `{ }` containing statements and optionally a trailing expression.

```vela
{
  let a = 1
  let b = 2
  a + b          # the block's value
}
```

* A block introduces a scope. Names declared inside are not visible outside.
* Inner scopes may **shadow** outer names, including in the same block:
  `let x = 1; let x = x + 1` is legal and the second `x` is a new binding.
* The value of a block is its last expression **if** that expression is not
  followed by `;` and the block is in expression position. Otherwise `Void`.
* A block that ends with `break`, `return`, `continue` or `panic` has type
  `Never`.

### 1.1 Where blocks are required

`if`, `else`, `while`, `for`, `loop`, `fn`, `view`, `impl`, `trait`, `mod`,
`macro` bodies always take braces. Parentheses are never required around a
condition and are accepted and removed by `vela fmt`.

---

## 2. Bindings

### 2.1 `let` — immutable binding

```vela
let x = 1
let name: Str = "ada"
let pair = (1, "two")
let Point { x, y } = p               # destructuring, doc 04 §6
let (a, b) = pair
```

A `let` binding may not be reassigned or mutated (`E-STMT-010`). Its *interior*
may be mutated if the value is `shared` and the field is `mut`-declared — see
§2.4.

### 2.2 `mut` — mutable binding

```vela
mut count = 0
count += 1
count = 5

mut user = User { name: "ada" }
user.name = "grace"          # allowed: mut binding, mut field
```

### 2.3 `const` — compile-time constant

```vela
const MAX_RETRIES = 3
const GREETING = "hello" + " world"      # folded at compile time
const TABLE: List<Int> = comptime { buildTable() }
```

The initialiser MUST be a compile-time constant expression (doc 12 §2). A `const`
is inlined where used; it has no address outside `sys`.

### 2.4 `static` — module storage

```vela
static counter: Int = 0                  # one instance, lazily initialised
static mut scratch: Bytes = bytes.withCapacity(4096)
```

* `static` is private to its module unless `pub`.
* `static mut` is allowed in `core` and `sys`, forbidden in `app` and `web`
  (`E-STMT-020`) unless behind `Mutex`/`Atomic`.
* Initialisation is lazy and thread-safe (a `Once` under the hood).
* `pub static` must be immutable.

### 2.5 Typed vs inferred

An annotation is optional in both modes, required by `strict` on public
signatures. `let x: Int = 1.0` is `E-TYPE-050`. The compiler never inserts an
annotation silently into source.

---

## 3. Assignment

```vela
x = 1
x += 1        -= 1       *= 2       /= 2       %= 2
x **= 2       <<= 1      >>= 1      &= mask    |= bit     ^= bit
x ??= default
xs[0] = 1
user.name = "grace"
```

Assignment is an expression of type `Void` and therefore may not be used as a
value (`if (x = 1) { }` is `E-STMT-030`; this is the oldest bug in programming
and it is a compile error here).

Compound assignment evaluates the target's base expression **once**:
`a[f()] += 1` calls `f` once.

---

## 4. Conditionals

```vela
if x > 0 {
  print("positive")
} else if x < 0 {
  print("negative")
} else {
  print("zero")
}
```

`if` is an expression (§1). `else` is optional in statement position. An `if` in
expression position without `else` is `E-STMT-040` unless the then-branch is
`Never`.

**`if let`** binds and tests in one step:

```vela
if let user = lookup(id) {
  print(user.name)
}

if let Some(v) = maybe, v > 10 { ... }        # comma = additional condition
```

---

## 5. Loops

### 5.1 `while`

```vela
while !done {
  step()
}

while let item = queue.pop() {
  handle(item)
}
```

### 5.2 `for`

```vela
for x in xs { }
for i in 0..<xs.len { }
for (i, x) in xs.enumerate() { }
for ch in "hello" { }                  # graphemes
for (k, v) in map { }                  # insertion order
for item in channel { }                # ends when the channel closes
for x in xs.reversed() { }
for x in xs if x.active { }            # filter clause
```

`for` evaluates the iterable once, before the first iteration. Mutating the
iterable inside the body is allowed for `List` (it copies on write, so the loop
sees its own snapshot) and forbidden for `Map`/`Set` (`E-STMT-050`), which
removes the single most common concurrent-modification panic in scripting
languages.

### 5.3 `loop`

An unconditional loop; the only loop whose `break` may carry a value.

```vela
let n = loop {
  let v = read()
  if v != nil { break v }
}
```

### 5.4 Labels

```vela
outer: for row in grid {
  for cell in row {
    if cell.blocked { continue outer }
    if cell.exit { break outer }
  }
}
```

A label is `IDENT ":"` immediately before the loop. `break label` and
`continue label` must name an enclosing loop (`E-STMT-060`).

### 5.5 `break` with a value

`break expr` is legal only inside `loop`, and only when every `break` in that
`loop` agrees on a type.

---

## 6. Destructuring

```vela
let (a, b) = pair
let (a, _, c) = triple                  # _ discards
let [head, ...tail] = xs
let Point { x, y } = p
let Point { x: px, y: py } = p          # rename
for (i, item) in items.enumerate() { }
```

Destructuring is a pattern (doc 03 §7.1) used in binding position. In `loose`
mode a shape mismatch is a runtime error `E-RUN-040`; in `strict` it is a compile
error `E-STMT-070`.

---

## 7. `defer`

```vela
fn copy(from: Str, to: Str) -> Result<Void, IoError>? {
  let input = try fs.open(from)
  defer input.close()

  let output = try fs.create(to)
  defer output.close()

  try io.copy(input, output)
}
```

* `defer` schedules a statement to run when the current scope exits, by any
  path: fall-through, `return`, `?` propagating an error, or an unwinding
  `panic`.
* Deferred statements run in **reverse order** of declaration (LIFO), after the
  scope's value is computed, and *before* the scope's values are dropped.
* A `defer` may not `break`, `continue` or `return` (`E-STMT-080`).
* A `defer` may read the variables in scope at the point of the `defer`
  declaration; it may not capture a variable declared after it.

`defer` is the only cleanup mechanism in the grammar. Destructors (`Drop`) are
the declarative counterpart (doc 09 §5); you cannot have a resource leak from a
missing `defer` because the type's `Drop` runs anyway.

---

## 8. `guard`

```vela
fn area(w: Float, h: Float) -> Result<Float, MathError> {
  guard w > 0 else { return Err(MathError.invalid("width")) }
  guard h > 0 else { return Err(MathError.invalid("height")) }
  Ok(w * h)
}
```

`guard cond else { ... }` continues only when `cond` is true. The `else` block
MUST leave the scope (`return`, `break`, `continue`, `fail`, `panic`) — `E-STMT-
090` otherwise. Bindings made in a `guard let` remain in scope after the guard:

```vela
guard let user = lookup(id) else { return nil }
print(user.name)     # user is non-optional here
```

`guard` exists so that the happy path stays at one indentation level; `if let`
with a nested block is the alternative when the binding is not needed later.

---

## 9. `with` — scoped resources

```vela
with file = fs.open("log.txt") {
  file.writeLine("started")
}   # closed here, even on error

with arena = mem.arena(1 << 16) {
  ...
}

with lock = mutex.lock() {
  counters.update()
}
```

`with` binds a value implementing `Closable` (an `open` function plus `close`)
and guarantees `close()` on exit by routing it through `defer`. It is sugar, not
a new concept: `with x = e { }` is exactly

```vela
let x = e
defer x.close()
{ ... }
```

---

## 10. `fail` — early error return

```vela
fn parse(s: Str) -> Result<Int, ParseError> {
  if s.isEmpty { fail ParseError.empty }
  Ok(int.fromStr(s)?)
}
```

`fail e` is `return Err(e)`. It is a statement, has type `Never`, and may only
appear in a function returning `Result<T, E>` where `e` converts into `E`
(`E-STMT-100`).

---

## 11. `match` as a statement

`match` in statement position discards its value; arms are separated by `,` or a
newline.

```vela
match event {
  Mouse::down { x, y } => handleClick(x, y)
  Key::press(code) if code == 27 => quit()
  _ => {}
}
```

---

## 12. `assert`, `panic`, `unreachable`

```vela
assert x > 0
assert x > 0, "x must be positive"
assertEq(a, b)                 # also assertNe, assertNear, assertContains
panic("impossible state")
unreachable()                   # same as panic, but tells the optimiser
```

`assert` is a statement with a message. In `release` it is removed unless the
module says `#![keepAsserts]`. `panic` always remains.

---

## 13. Scoping and drop order

Within a scope, in this order:

1. Statements run in order.
2. `defer`red statements run in reverse order.
3. Values drop in reverse order of declaration.

```vela
fn demo() {
  let a = File.open("a")   # drops last
  defer print("defer 1")   # runs second-to-last
  let b = File.open("b")   # drops first of the files
  defer print("defer 2")   # runs first
}                          # output: defer 2, defer 1, then b drops, then a
```

Loop bodies create a fresh scope per iteration, so a `defer` inside a loop that
runs 1000 times schedules 1000 running statements — each held until that
iteration ends. There is no "defer at function exit" form, because that is a leak
waiting to happen; use a `with` block around the loop.

---

## 14. Unreachable code

Statements after a `Never` expression in the same block are `E-STMT-110`. A
`return`, `break`, `continue`, `fail` or `panic` is not required at the end of a
function that has no return type; it is inferred.

---

## 15. Statement forms, complete

| Form | Kind | Status |
| --- | --- | --- |
| `let p = e` | declaration | `impl` |
| `mut p = e` | declaration | `impl` |
| `const N = e` | declaration | `spec` |
| `static N = e` | declaration | `spec` |
| `lhs = e`, `lhs op= e` | assignment | `impl` |
| `if` / `else if` / `else` | conditional | `impl` |
| `if let` | conditional binding | `spec` |
| `while` / `while let` | loop | `impl` / `spec` |
| `loop` | loop | `spec` |
| `for x in e` | loop | `impl` |
| `label: for` / `break label` | labelled loop | `spec` |
| `match` | dispatch | `spec` |
| `defer` | cleanup | `spec` |
| `guard` | early exit | `spec` |
| `with` | scoped resource | `spec` |
| `return` | exit | `impl` |
| `break` / `continue` | loop control | `impl` |
| `fail` | error exit | `spec` |
| `assert` / `assertEq` / `panic` / `unreachable` | check | `impl` (`assert`) |
| expression statement | evaluation | `impl` |

---

## 16. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-STMT-010` | assigning to an immutable binding or field |
| `E-STMT-020` | `static mut` outside `core`/`sys` |
| `E-STMT-030` | assignment used as a value |
| `E-STMT-040` | `if` in value position without `else` |
| `E-STMT-050` | mutating a `Map`/`Set` while iterating it |
| `E-STMT-060` | unknown or non-enclosing label |
| `E-STMT-070` | destructuring shape mismatch (strict) |
| `E-STMT-080` | `defer` containing `break`/`continue`/`return` |
| `E-STMT-090` | `guard` body that does not exit |
| `E-STMT-100` | `fail` outside a `Result` function or wrong error type |
| `E-STMT-110` | unreachable statement |
| `E-STMT-120` | variable declared but never used (warning; `_` silences) |

---

Next: [05-functions.md](05-functions.md).
