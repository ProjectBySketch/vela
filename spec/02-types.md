# 02 — The type system

**Status:** `spec`. `velac` 0.1 has six dynamic value types and no checker.

This document defines the type universe, the rules that relate types, and the two
checking modes. Everything here applies to all four profiles; where a profile
removes something it says so.

---

## 1. Two modes, one language

A module is checked in one of two modes.

| Mode | Declared by | What is checked |
| --- | --- | --- |
| `loose` | default | Only what is statically obvious. Annotations are trusted, not verified against uses inside a function body. |
| `strict` | `#![strict]` or `strict = true` in `vela.pkg` | Everything. Every public signature is complete, every expression's type is known, every conversion is explicit. |

Rules that hold in **both** modes:

* A type annotation that is present is checked where the value is produced
  (assignment, argument at a typed parameter, `return` in a typed function).
* `nil` may only inhabit `T?`.
* `?` may only appear inside a function whose return type is `Result` or
  `Option`.
* Reading a possibly-uninitialised value is an error.
* `unsafe` is forbidden unless the profile allows it (doc 09 §7).

`loose` is what makes Vela usable as a scripting language; `strict` is what makes
it usable for a kernel. A `strict` module may not `import` a `loose` module's
untyped function and call it in a typed position without a cast (`as`) — this is
the incremental-migration seam and it is loud on purpose (`E-TYPE-090`).

---

## 2. The type universe

```
type := primitive
      | nominal
      | typeExpr
      | "(" type ("," type)* ")"          # tuple
      | "[" type "]"                       # list sugar, = List<t>
      | "{" type ":" type "}"              # map sugar, = Map<k, v>
      | IDENT ("<" typeArgs ">")?          # named / generic
      | type "?"                           # Option<type>
      | "Func" "(" params ")" "->" type    # function type
      | type ("|" type)+ | type ("&" type)+ # union / intersection
      | "!" | "Any" | "Void"                # empty, top, no-value
```

`Void` is the type of a function that returns nothing (`fn f() { }` is
`fn f() -> Void`). `!` (`Never`) is a function that cannot return: `panic`,
`fail`, `return`, `break`, `continue`, `exit`. `Any` is the top of the `loose`
mode lattice; using it in a `strict` signature is a warning
(`W-TYPE-001`).

---

## 3. Primitive types

### 3.1 `Nil`

One value, `nil`. Its type is `Nil`. `Nil` is a subtype of `Option<T>` for every
`T` and of `Any`. It has no methods.

### 3.2 `Bool`

`true`, `false`. No implicit conversion from numbers or strings, in either mode:

```vela
if 1 { }          # E-TYPE-010 in strict; legal in loose (truthiness, §5)
if not true { }
```

### 3.3 Integers

Fixed-width, two's complement, wrapping only where declared.

| Type | Width | Range |
| --- | --- | --- |
| `Int8` `Int16` `Int32` `Int64` `Int` | 8 / 16 / 32 / 64 / 64 signed | as expected |
| `UInt8` `UInt16` `UInt32` `UInt64` `UInt` | unsigned | as expected |
| `IntSize` `UIntSize` | pointer width | alias `isize`/`usize` |
| `Int` | 64-bit signed | the default integer |

Short names are canonical in the spec (`i64` is accepted in source and printed
as `Int64` by `vela fmt`): `i8 i16 i32 i64 i128?` — **no `i128`**; it is
`planned`, and `UInt128` likewise.

`Int` is 64-bit on every target, including 32-bit Wasm; the compiler emulates
64-bit arithmetic where the target lacks it, and this is documented cost, not a
surprise.

### 3.4 Floating point

| Type | Format | Notes |
| --- | --- | --- |
| `Float` | binary64 (IEEE 754) | default |
| `Float32` | binary32 | for GPU and packed layouts |

`NaN` follows IEEE 754: `NaN != NaN` is `true`, and `xs.contains(NaN)` may return
`false` because it uses `==`. Sorting with `NaN` present is `E-RUN-020` unless the
comparison is total (`Float.totalOrder`).

### 3.5 `Num`

`Num` is not a representation. It is the union `Int | Float`, and it exists for
two reasons:

1. **Loose mode.** Every numeric literal is `Num`, so `1` and `1.0` interoperate
   and a script reads like one language.
2. **Generic numeric code.** `fn sum<T: Numeric>(xs: List<T>) -> T` works for
   both without duplicating the function.

In `strict` mode `Num` may appear in a signature, and inside the function body
the compiler requires a `match` or a `num.toFloat()` before doing
floating-point-only work (`sqrt`, `sin`, `/` on non-integral operands).

```vela
fn half(n: Num) -> Num {
  match n {
    let i: Int => num.toFloat(i) / 2.0
    let f: Float => f / 2.0
  }
}
```

`10 / 4` is `2` for `Int` operands and `2.5` for `Float` operands. This is one of
the few places where the distinction is visible, and it is exactly where a
language should not guess: in `loose` mode the operands are `Float` unless both
are integer literals that fit, in which case the result is `Int` and Vela prints
`2`.

### 3.6 `Str`

An immutable, UTF-8 encoded string. Length is available in bytes
(`s.byteLen`), scalars (`s.charCount`) and graphemes (`s.len`, O(n) on first
call, cached). Indexing `s[i]` yields a `Str` containing one **grapheme**, not a
byte and not a scalar — the thing a human would call "a character".

```vela
let s = "héllo"
s.len            # 5
s.charCount      # 5
s.byteLen        # 6
s[1]             # "é"
s[0..<2]         # "hé"
```

### 3.7 `Char`

One Unicode scalar value. Used for byte-sized text processing and for
`Str.chars()`. Arithmetic is not defined on `Char`; `char.toInt()` is.

### 3.8 `Bytes`

A mutable buffer of `UInt8` with a length and a capacity. This is what a file, a
socket or a hash function moves around. Converting between `Str` and `Bytes` is
explicit both ways (`str.toBytes()`, `bytes.toString()` returns
`Result<Str, Utf8Error>`), because neither direction is lossless in general.

### 3.9 `Range`

`start..<end` or `start..=end`, with an element type: `Range<Int>`,
`Range<Float>` (for interpolation, not iteration), `Range<Char>`. Ranges are
values, they are `Iterable`, and `for i in 0..<10` is the canonical loop.

### 3.10 `Void`, `Never`, `Any`, `Opaque`

| Type | Meaning |
| --- | --- |
| `Void` | a function that produces no value; `let x = f()` where `f: fn() -> Void` is `E-TYPE-020` |
| `Never` | no value; subtypes every type, so `if c { 1 } else { panic("x") }` is `Int` |
| `Any` | top type; legal in `loose` signatures, warning in `strict`; `x as T` narrows it and fails at runtime with `E-RUN-030` if the value is not a `T` |
| `Opaque` | a foreign handle from FFI; you may pass it and drop it but not inspect it (doc 17) |

---

## 4. Composite types

### 4.1 `List<T>`

An ordered sequence, indexable, iterable, with O(1) `push`/`pop` at the end and
O(n) insert/remove elsewhere. A `List` is a **shared** value: passing it copies a
reference, and mutation triggers copy-on-write (doc 09 §3).

```vela
let xs: List<Int> = [1, 2, 3]      # type inferred from the literal
mut ys = xs                        # shares storage
ys.push(4)                         # copies first; xs is still [1, 2, 3]
```

`[1, "two"]` in `loose` mode is `List<Any>`; in `strict` mode it is
`E-TYPE-030` and must be written `[1, "two"] as List<Any>` or a union
`List<Int | Str>`.

### 4.2 `Set<T>` and `Map<K, V>`

Insertion-ordered (principle 10). `T` and `K` MUST conform to `Hash + Eq`; the
compiler enforces it and falls back to no default hasher, so a `struct` without
`#[derive(Hash, Eq)]` cannot be a key (`E-TYPE-031`). That one rule prevents the
classic "my object doesn't work as a key" afternoon.

```vela
let seen: Set<Str> = set.of(["a", "b"])
let counts: Map<Str, Int> = map.new()
counts["a"] = 1                 # insert or update
let c = counts["a"] ?? 0        # read with a default
```

### 4.3 `Tuple`

Fixed arity, heterogenous, structural. `(Int, Str)` equals `(Int, Str)`
everywhere; there is no nominal tuple. `()` is `Void`. A one-element tuple must
be written `(x,)`.

### 4.4 `Func(...) -> T`

A first-class function value. Optional parameters appear with `=`, variadic with
`...`:

```vela
let f: Func(Int, Int) -> Int = (a, b) => a + b
let g: Func(Str, Int = 1) -> Str = ...      # callable as g("x") or g("x", 2)
```

Functions are values, they may be stored, returned, passed and compared by
identity (`==` on functions is identity, not structure).

### 4.5 `Option<T>` and `Result<T, E>`

Defined in doc 11, listed here for completeness:

* `T?` is sugar for `Option<T>`, an enum `Some(T) | nil`.
* `Result<T, E>` is an enum `Ok(T) | Err(E)`.
* In `strict` mode, a value of type `T?` must be unwrapped (`?`, `??`, `if let`,
  `match`, `.unwrap()`) before it can be used as `T`.
* A `#[must_use]` `Result` that is discarded is `W-TYPE-040`.

### 4.6 `Task<T>`, `Channel<T>`

Concurrency handles (doc 10). `Task<T>` is a value you may `await` exactly once;
`Channel<T>` is a queue you may `send` to and `recv` from.

### 4.7 `Ptr<T>`, `Volatile<T>`

`sys`-profile raw access (doc 15). `Ptr<T>` is nullable-by-convention but has no
`nil`: its zero value is `Ptr.null()`, and dereferencing requires `unsafe`.

---

## 5. Conversion and coercion

Vela has **no implicit lossy conversions**. The table is the whole story.

| From → To | Implicit? | Mechanism |
| --- | --- | --- |
| `Int8` → `Int16/32/64` (widening, signed) | yes | automatic |
| `UInt8` → `UInt16/32/64` | yes | automatic |
| `IntN` → `Float` | no | `num.toFloat(x)` (may lose precision above 2^53) |
| `Float` → `IntN` | no | `x as Int` (truncates toward zero) or `x.round()` |
| `IntN` → `UIntN` same width | no | `x as UInt` (checked in debug, `#[wrap]` to wrap) |
| `Str` ↔ `Bytes` | no | explicit, fallible one way |
| `T` → `T?` | yes | automatic |
| `T?` → `T` | no | `?`, `??`, `match`, `unwrap` |
| `T` → `Any` | yes | automatic |
| `Any` → `T` | no | `x as T`, checked |
| `Char` → `Str` | yes | automatic |
| `Int` → `Char` | no | `char.fromInt(n)?` (fallible, validates scalar) |
| `List<Int>` → `List<Any>` | no | `xs as List<Any>` (copies) |
| `Struct` → `Struct` with same fields | no | never; write an explicit conversion |

Numeric promotion inside an expression follows one rule, and only one: **the
widest operand wins, and it must be an exact widening**. `1 + 2.5` in `loose`
mode is `Float` (because `Num` allows it); in `strict` mode it is `E-TYPE-050`
unless one side is converted.

---

## 6. Truthiness

In `loose` mode, and only there, a value may be used where a `Bool` is expected,
using these rules:

| Value | Truthy |
| --- | --- |
| `false`, `nil` | no |
| `0`, `0.0`, `NaN` | no |
| `""` | no |
| `[]`, `{}` (empty list, map, set, bytes) | no |
| everything else | yes |

`strict` mode abolishes truthiness: `if xs { }` is `E-TYPE-010`, write
`if xs.len > 0 { }`. A program that moves from `loose` to `strict` therefore
gets a *list of places where it was relying on a shortcut*, which is the point.

---

## 7. Equality, hashing, ordering

Three traits define what comparisons mean, and a type opts into each explicitly.

| Trait | Required for | Contract |
| --- | --- | --- |
| `Eq` | `==`, `!=`, `Set`, `Map` keys | reflexive, symmetric, transitive |
| `Hash` | `Set`, `Map` keys | `a == b` implies `hash(a) == hash(b)` |
| `Ord` | `<`, sorting, `min`/`max` | total order consistent with `Eq` |

`#[derive(Eq, Hash, Ord)]` generates the three from the fields in declaration
order. A type without `Eq` may still be compared with `is` (identity), which is
what `shared struct` instances use by default.

The compiler **rejects** a `Hash` implementation without `Eq` (`E-TYPE-060`) and
an `Ord` implementation inconsistent with `Eq` is unprovable, so it is a
documented obligation rather than a check.

---

## 8. Nominal vs structural

* `struct`, `enum`, `trait`, `interface` are **nominal**: `A` is not `B` because
  they look alike.
* `Tuple`, `Func`, union and intersection are **structural**.
* Conformance is nominal too: `impl Trait for Type` must be written somewhere,
  and it may be written in the module that owns `Type` or the module that owns
  `Trait` (the orphan rule, doc 08 §7).

---

## 9. Type aliases and opaque types

```vela
type UserId = Int
type Handler = Func(Request) -> Result<Response, Error>
type Point3 = (Float, Float, Float)

opaque type FileHandle = Opaque      # may be created only by io
```

An alias is transparent and interchangeable; `opaque type` (contextual keyword
`opaque`) creates a distinct nominal type whose representation is visible only in
its own module. This is how a library exposes a handle without exposing its
internals, without paying for a class.

---

## 10. Inference

Local inference only, and always in one direction:

* `let x = expr` infers `x`'s type from `expr`, exactly.
* A function body infers from its declared return type and parameters.
* Arguments do not infer a generic from a lambda's body without an annotation
  when the lambda has no parameter types; write them (`|x: Int| ...`).
* A recursive function MUST declare its return type (`E-TYPE-070`).
* The empty list literal `[]` needs context: `let xs: List<Int> = []`
  (`E-TYPE-071` otherwise). `mut xs = []` then `xs.push(1)` does not retro-fit
  the type; this is deliberate, because retro-fitting makes error messages worse
  and overload resolution ambiguous.

---

## 11. Subtyping

Five rules, all of them:

1. `Never <: T` for all `T`.
2. `T <: T?` for all `T`.
3. `T <: Any`.
4. `A <: A | B` and `B <: A | B`; `A & B <: A`, `A & B <: B`.
5. `List<T>` is covariant in `T` **for reading only**: a `List<Cat>` may be used
   where `List<Animal>` is expected, and the compiler inserts a
   copy-on-write check on the first mutation through the wider view. No other
   generic type is variant.

There is no structural subtyping, no `Duck` typing, and no implicit conformance.

---

## 12. Well-formedness

* A type may not contain itself by value: `struct Node { next: Node }` is
  `E-TYPE-080`. Use `Node?` (a shared reference) or `shared struct`.
* A generic parameter must be used in the type or a where-clause
  (`E-TYPE-081`).
* Trait bounds must be satisfiable: a `where T: A + B` with contradictory
  associated types is `E-TYPE-082`.
* Recursive aliases are `E-TYPE-083`.
* A union may not contain `Any` (`E-TYPE-084`).

---

## 13. What the type system deliberately does not have

| Missing | Because |
| --- | --- |
| Lifetimes | RC + CoW handle the same problems without annotation burden (doc 09) |
| Borrow checker | `unique` + copy-on-write covers the same ground for the 95% case; `unsafe` covers the rest |
| Implicit numeric conversion | the source of a category of silent bugs |
| Null | `T?` is a real type you must handle |
| Operator overloading by convention | only through explicit `impl` |
| Multiple inheritance | traits, plus explicit delegation by `impl Trait for X by field` |
| Exceptions | `Result` is checked, `panic` is fatal, `try` is sugar |
| Global mutable statics that are visible across modules | `static` is module-private unless `pub`, and `pub static mut` is banned outside `sys` |

---

## 14. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-TYPE-010` | non-boolean in a boolean position (strict mode) |
| `E-TYPE-020` | value used from a `Void` expression |
| `E-TYPE-030` | heterogeneous list literal |
| `E-TYPE-031` | `Set`/`Map` key without `Hash + Eq` |
| `E-TYPE-040` | unknown type name |
| `E-TYPE-041` | wrong number of type arguments |
| `E-TYPE-050` | implicit numeric mixing in strict mode |
| `E-TYPE-060` | `Hash` without `Eq` |
| `E-TYPE-070` | recursive function without a return type |
| `E-TYPE-071` | empty collection literal with no context |
| `E-TYPE-080` | infinitely sized type |
| `E-TYPE-081` | unused generic parameter |
| `E-TYPE-082` | unsatisfiable bounds |
| `E-TYPE-083` | recursive type alias |
| `E-TYPE-084` | `Any` inside a union |
| `E-TYPE-090` | untyped call in a strict context |
| `W-TYPE-001` | `Any` in a strict signature |
| `W-TYPE-040` | discarded `#[must_use]` result |

---

Next: [03-expressions.md](03-expressions.md).
