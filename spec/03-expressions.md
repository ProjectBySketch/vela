# 03 — Expressions

**Status:** `spec`, except the operators marked `impl`.

---

## 1. Shape

Everything that produces a value is an expression. Blocks, `if`, `match`, `try`,
`unsafe`, `comptime` and `loop` are all expressions; a statement is an expression
whose value is discarded, plus the forms in doc 04.

The last expression of a block is the block's value; a block ending in `;` or in
a statement produces `Void`.

```vela
let label = if n % 15 == 0 { "fizzbuzz" } else if n % 3 == 0 { "fizz" } else { str(n) }
```

---

## 2. Literals

| Literal | Type | Notes |
| --- | --- | --- |
| `42` | `Int` (strict) / `Num` (loose) | doc 01 §6 |
| `1.5` | `Float` | |
| `"text"` | `Str` | interpolation active |
| `'a'` | `Char` | |
| `true`, `false` | `Bool` | |
| `nil` | `Nil` | only inhabits `T?` |
| `[1, 2, 3]` | `List<Int>` | |
| `[]` | needs context | `E-TYPE-071` otherwise |
| `(1, "a")` | `(Int, Str)` | |
| `()` | `Void` | |
| `{"a": 1}` | `Map<Str, Int>` | key is any expression |
| `set.of([1, 2])` | `Set<Int>` | no brace form; `{ }` is a block |
| `0..<10`, `0..=9`, `0..` | `Range<Int>` | `0..` is unbounded, `Iterable` only with a bound |
| `b"bytes"` | `Bytes` | ASCII/escaped byte literal |
| `[0; 20]` | `[UInt8; 20]` | fixed-size repeated literal; the count is a `comptime` constant |
| `Point { x: 1, y: 2 }` | struct or shared-struct literal | doc 03 §14 |

Collection literals are **homogeneous** in `strict` mode. The type is inferred
from the elements; if it cannot be, the first element wins and the rest must
coerce.

---

## 3. Paths

```
path := IDENT ("::" IDENT)*
```

A path names a module member (`geometry::area`) or a type's variant
(`Shape::circle`). Single-segment paths are ordinary identifiers. `::` binds
tighter than `.`.

---

## 4. Access, calls, indexing

### 4.1 Member access

```vela
user.name          # field
user.address.city  # nested
Timer::now         # associated function
xs.len             # property implemented as a method
```

Fields are read-only unless the base is `mut` or the field was declared `mut`
inside a `mut` binding. Assigning to a field of an immutable value is
`E-STMT-010`.

### 4.2 Calls

```vela
f(a, b)                     # positional
f(a, b: 2)                  # named, after positionals
f()                         # no arguments
obj.method(a)               # method call: sugar for Type.method(obj, a)
xs.map(|x| x * 2)           # function value argument
xs.map { |x| x * 2 }        # trailing closure: same thing
```

Argument rules:

* Positional arguments come first; naming a later one names all after it
  (`E-EXPR-010`).
* A parameter with a default may be omitted; omitting a positional in the middle
  requires naming it.
* A variadic parameter (`...rest: List<T>`) takes the remaining arguments; a
  spread `f(...xs)` expands a list into them.
* A function value is callable through a variable: `let f = add; f(1, 2)`.
* Calling a non-function is `E-RUN-010` in `loose`, `E-TYPE-100` in `strict`.

**Universal call syntax.** For any value `x` of type `T` and any function
`f(t: T, ...)`, `x.f(...)` is legal and means `f(x, ...)`. This is how the
standard library offers `xs.map(f)` without `List` having to declare every
function, and it is why extension methods exist for foreign types (doc 06 §9).

### 4.3 Indexing

```vela
xs[0]           # first; negative counts from the end: xs[-1] is last
xs[i]           # runtime error E-RUN-011 if out of bounds
s[2]            # one grapheme of a Str
counts[key]     # map read; a missing key yields nil (so the type is V?) 
counts[key] ?? 0
```

A map read through `[]` yields `V?`, never a runtime error; a map **write**
through `[]=` inserts. A list read through `[]` is checked and panics on
out-of-range rather than yielding `nil`, because a silent `nil` from a list is
almost always a bug (`xs.get(i)` is the checked, `Option`-returning form).

### 4.4 Slicing

```vela
xs[1..<4]        # elements 1, 2, 3 — copies
xs[1..]          # to the end
s[2..<5]         # graphemes 2..4
bytes[0..<16]    # a copy of 16 bytes
```

A slice of a `shared` value copies; a slice of a `unique` value copies and drops
the source. There is no borrowed slice type (`planned`, doc 09 §11).

### 4.5 Optional chaining

```vela
user?.name            # Str? — nil if user is nil
a?.b?.c               # chains
xs?[0]                # Str? for xs: List<Str>?
```

Chaining short-circuits to `nil` at the first `nil`. It never calls a method on
`nil`.

---

## 5. Operators

### 5.1 Precedence

Highest first. All binary operators are left-associative except where marked.

| Level | Operators | Notes |
| --- | --- | --- |
| 1 | `.` `?.` `[]` `()` `::` | postfix, highest |
| 2 | `!` `-` `~` `+` | unary prefix; `+` is a no-op assertion for numbers |
| 3 | `**` | right-associative, exponentiation (`spec`) |
| 4 | `*` `/` `%` | |
| 5 | `+` `-` | `+` also concatenates `Str`, `List`, `Bytes` |
| 6 | `<<` `>>` `>>>` | shifts |
| 7 | `&` | bitwise and |
| 8 | `^` | bitwise xor |
| 9 | `|` | bitwise or |
| 10 | `..<` `..=` `..` | ranges (non-associative) |
| 11 | `<` `<=` `>` `>=` | comparison (non-associative) |
| 12 | `==` `!=` `is` `is not` | equality (non-associative) |
| 13 | `&&` | short-circuit |
| 14 | `\|\|` | short-circuit |
| 15 | `??` | nil coalescing, right-associative |
| 16 | `\|>` | pipeline, left-associative, lowest binary |
| 17 | `?` `as` `is` (postfix form) | propagates / casts |

`a ?? b ?? c` groups as `a ?? (b ?? c)`. `x |> f |> g` is `g(f(x))`.

### 5.2 Arithmetic

| Operation | `Int` | `Float` |
| --- | --- | --- |
| `+ - *` | wrapping on overflow only under `#[wrap]`; otherwise debug panics (`E-RUN-012`) and release saturates, never wraps silently | IEEE 754 |
| `/` | integer division truncating toward zero; `/ 0` is `E-RUN-013` | IEEE 754 (`1.0/0.0` is `inf`) |
| `%` | remainder with the sign of the dividend; `% 0` is `E-RUN-013` | fmod |
| `**` | `Int ** UInt` | `pow` |

The choice in the second row is deliberate and unusual: an overflowing `Int` in a
release build **saturates** rather than wraps, so a checked-then-shipped program
degrades to a wrong-but-bounded answer instead of a negative index. A program
that wants wrapping says `#[wrap]` on the function or uses `int.wrappingAdd`.

`+` on `Str` concatenates; on `List` concatenates (copying); on `Bytes`
concatenates. `+` between a `Str` and any other type does **not** convert: write
`"total: ${n}"`. (0.1's implicit `+` stringification is removed by this spec and
replaced by interpolation, which is explicit and formatted with `Display`.)

### 5.3 Bitwise and shifts

```vela
flags & 0b0100          # Int
a | b
a ^ b
~a                      # bitwise not, same width
x << 2                  # shift; shifting by >= width is E-RUN-014, not UB
x >>> 1                 # logical shift right on unsigned values
```

Bitwise operators are defined on integers and on `Set<T>` for `&`, `|`, `^`
(set union/intersection/symmetric difference) — a declared overload, not magic.

### 5.4 Comparison and equality

`<`, `<=`, `>`, `>=` require an `Ord` conformance. `==` requires `Eq`, except
for primitives where it is built in. Two values of unrelated types compared with
`==` are `E-TYPE-110` in `strict` and `false` in `loose` (never a panic).

`is` is identity for `shared` values, type test for `Any`:

```vela
if anyValue is Str { print(anyValue as Str) }
if a is b { }          # same object
```

### 5.5 Logic

`&&` and `||` short-circuit and yield a `Bool` (not the operand). `!` negates.
`and`, `or`, `not` are accepted spellings and are rewritten by `vela fmt`.

### 5.6 Nil coalescing

```vela
let name = user.nickname ?? user.login
config.timeout ??= 30          # assigns only when currently nil
```

`a ?? b` evaluates `b` only when `a` is `nil`. In `strict` mode the result type
is the left type without `nil` unified with the right type.

### 5.7 Pipeline

```vela
"  hello  " |> str.trim |> str.upper            # "HELLO"
xs |> list.filter(|x| x > 0) |> list.sum
```

`a |> f(b)` is `f(a, b)`: the left value becomes the first argument. It exists
so that a chain of transformations reads top-to-bottom instead of inside-out
without needing method syntax on every type.

### 5.8 Spread

```vela
let all = [1, ...rest, 5]        # list literal
f(...args)                       # call arguments
map.merge(base, ...overrides)    # variadic parameter
```

---

## 6. Closures

```vela
let double = |x| x * 2
let add = |a, b| { let s = a + b; s }
let typed = |x: Int| -> Int { x + 1 }
xs.map(|x| x * 2)
xs.map { |x| x * 2 }              # trailing form
```

* A closure captures by **value** for copyable types and by **shared
  reference** for `List`, `Map`, `Str`, `shared struct` — which is safe because
  those are copy-on-write (doc 09 §3). A closure that mutates a captured `mut`
  variable must say `move |x| { ... }`, which takes ownership of the captures.
* A closure with no parameters is written `|| { ... }`. A `||` in **operand
  position** opens a closure; a `||` in operator position is logical or. The
  grammar makes this unambiguous because an operand is expected at the start of
  an expression and after `(`, `,`, `=`, `return` and `{`, so `let f = || 1` and
  `if a || b` never collide.
* Capturing a `unique` value without `move` is `E-EXPR-020`.
* Calling a function that has already captured a moved value is `E-EXPR-021`.
* Closures are values of type `Func(...) -> T`; they may escape the function
  that created them.

---

## 7. `match`

The only pattern-matching construct. It is exhaustive in `strict` mode and
warns in `loose`.

```vela
let amount = match shape {
  Shape::circle(r)            => 3.14159 * r * r
  Shape::rect(w, h)           => w * h
  Shape::triangle { base, height } => base * height / 2
  Shape::unit                 => 0.0
}

match code {
  200..<300 => "ok"
  404 | 410 => "gone"
  n if n >= 500 => "server error"
  _ => "other"
}
```

### 7.1 Patterns

| Pattern | Matches |
| --- | --- |
| `_` | anything, binds nothing |
| `let x` | anything, binds `x` |
| `1`, `"a"`, `true`, `nil` | that literal |
| `200..<300`, `'a'..='z'` | a range |
| `Shape::circle(r)` | variant with one payload, binding `r` |
| `Shape::rect(w, h)` | variant with positional payloads |
| `Shape::triangle { base, height }` | variant with named fields |
| `(a, b)` | a 2-tuple |
| `[first, ...rest]` | a non-empty list, binding head and tail |
| `[]` | the empty list |
| `x @ Shape::circle(_)` | binds `x` to the whole matched value |
| `p1 \| p2` | either pattern (bindings must agree in name and type) |
| `s: Str` | a type test (used with `Any` and with `Num`) |
| `not p` | negation, for simple patterns |

A guard is `if <bool expr>` after the pattern. Bindings are in scope for the arm
body only. Overlapping arms are allowed; the first wins; a later arm that can
never match is `W-EXPR-030`.

### 7.2 Exhaustiveness

In `strict` mode, `match` over an `enum` must cover every variant or end in `_`.
Over `Bool` it must cover `true` and `false`. Over `Option`/`Result` it must cover
both. Otherwise: `E-EXPR-030`. This single rule is why Vela needs no null checks
scattered through a program: the compiler makes you handle the `nil` where it
appears, once.

---

## 8. Blocks, `if`, `try`, `unsafe`, `comptime` as expressions

```vela
let x = { let a = 1; let b = 2; a + b }             # 3
let y = if c { 1 } else { 2 }
let z = try readFile(p) catch { "" }                # doc 11
let r = unsafe { ptr.read() }
let n = comptime { factorial(10) }                  # doc 12
```

`loop` is an expression when it produces a value through `break value`:

```vela
let firstEven = loop {
  let n = next()
  if n % 2 == 0 { break n }
}
```

---

## 9. Comprehensions

```vela
let squares = [x * x for x in 0..<10]
let evens   = [x for x in xs if x % 2 == 0]
let pairs   = [(a, b) for a in as for b in bs]
let lookup  = {k: f(k) for k in keys}
let uniques = set.of([x.tag for x in items])
```

A comprehension is sugar for a loop that builds a collection; it may not contain
`break`, `return`, `await` or `try` (use a loop). Its type is inferred from the
target: `[` gives `List`, `{` gives `Map`, `set.of(` gives `Set`.

---

## 10. Evaluation order

Left to right, always, at every level:

* Call: the callee expression, then arguments in written order.
* Binary operators: the left operand, then the right (so `a() + b()` calls `a`
  then `b`).
* `&&`, `||`, `??`: left first, right only when needed.
* Collection literals: elements in written order.
* Struct literals: fields in written order, not declaration order.
* `match`: the subject once; arms in written order, first match wins, no
  backtracking.
* Comprehensions: outermost clause first.

A program may rely on this. Any optimisation that would change it is illegal.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-EXPR-010` | positional argument after a named one |
| `E-EXPR-011` | unknown named argument |
| `E-EXPR-012` | missing required argument |
| `E-EXPR-020` | capturing a `unique` value without `move` |
| `E-EXPR-021` | use of a moved value |
| `E-EXPR-030` | non-exhaustive `match` |
| `W-EXPR-030` | unreachable `match` arm |
| `E-EXPR-040` | `break`/`continue` outside a loop |
| `E-EXPR-041` | comprehension with `break`/`await`/`try` |
| `E-EXPR-050` | optional chaining on a non-optional value (warning in loose) |
| `E-EXPR-051` | `?` outside a `Result`/`Option` function |
| `W-EXPR-060` | expression statement with a `#[must_use]` value |

---

Next: [04-statements.md](04-statements.md).
