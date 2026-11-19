# 07 — Generics

**Status:** `spec`.

Generics are **monomorphised**: each distinct set of type arguments produces a
distinct compiled function. That is why a generic in Vela is as fast as hand
written code and why the compiler must be told when not to do it.

---

## 1. Syntax

```vela
fn first<T>(xs: List<T>) -> T?
struct Pair<A, B> { first: A, second: B }
enum Tree<T> { leaf, node(left: Tree<T>, value: T, right: Tree<T>) }
trait Container { type Item }                      # doc 07 §4
impl<T> List<T> { fn isEmpty(self) -> Bool { self.len == 0 } }
impl<T: Ord> List<T> { fn sorted(self) -> List<T> { ... } }
```

Type parameters go in angle brackets after the name, before the parameter list.
Type **arguments** go in angle brackets after the type: `List<Int>`,
`Map<Str, Tree<User>>`, `Pair<Int, Str>`.

### 1.1 Parsing note

`<` is a generic opener only in type position, or immediately after a path that
is followed by a type and a `>`. `a < b` is comparison. The grammar in doc 18
says exactly where each applies, so the two never conflict in a well-formed
program; the parser uses a bounded lookahead and, in the one ambiguous case
(`Foo<Bar>(x)` where `Foo` is a type *and* `Bar` is a value), types win and a
disambiguating `Foo::<Bar>(x)` is available.

---

## 2. Bounds

```vela
fn sorted<T: Ord>(xs: List<T>) -> List<T>
fn display<T: Display + Clone>(x: T) -> Str
fn area<T: Shape2D>(s: T) -> Float
fn compare<T: Ord>(a: T, b: T) -> Int
```

A bound says "this type parameter conforms to these traits", which is what
allows calling their methods inside the generic body. Without a bound, the only
operations available on a `T` are moving, dropping, comparing identity
(`is`), and `typeName`.

Multiple bounds use `+`. A bound on one parameter may refer to another:

```vela
fn zip<A, B>(xs: List<A>, ys: List<B>) -> List<(A, B)>
fn convert<T, U: From<T>>(x: T) -> U { U::from(x) }
```

---

## 3. `where` clauses

When bounds get long, they move after the signature. The two forms are
equivalent; the `where` form is what `vela fmt` prefers past three bounds.

```vela
fn merge<T>(a: List<T>, b: List<T>) -> List<T>
where T: Ord + Clone
{
  ...
}

impl<T> Tree<T>
where T: Ord
{
  fn insert(mut self, v: T) { ... }
}
```

`where` clauses may also constrain associated types:

```vela
fn total<I>(iter: I) -> I::Item
where I: Iterator, I::Item: Add<Output = I::Item> + Default
{ ... }
```

---

## 4. Associated types

A trait may declare a type it does not yet know:

```vela
trait Iterator {
  type Item
  fn next(mut self) -> Self::Item?
}

impl Iterator for Range<Int> {
  type Item = Int
  fn next(mut self) -> Int? { ... }
}

fn collect<I: Iterator>(it: I) -> List<I::Item> {
  mut out: List<I::Item> = []
  while let v = it.next() { out.push(v) }
  out
}
```

An associated type is how a trait says "my element type" without a second
parameter polluting every signature. `Self::Item` names it; `I::Item` names it
from outside. Associated types are not generic arguments: they are determined by
the impl, so they participate in inference.

Associated **constants** are also allowed:

```vela
trait Sized2D {
  const NAME: Str
  fn area(self) -> Float
}

impl Sized2D for Circle {
  const NAME = "circle"
  fn area(self) -> Float { math.pi * self.r * self.r }
}
```

---

## 5. Generic impls and specialisation

```vela
impl<T> List<T> { fn len2(self) -> Int { self.len * 2 } }          # all lists
impl<T: Display> Display for List<T> { ... }                        # bound ones
impl Display for List<Int> { ... }                                  # E-DATA-050
```

The third form — specialisation — is **not allowed**, because it makes the
semantics of every generic function depend on every impl that exists anywhere in
the program. Instead, use a trait with an associated type, or an explicit
function:

```vela
impl Display for IntList { ... }        # a newtype wrapping List<Int>
fn displayInts(xs: List<Int>) -> Str { ... }
```

---

## 6. Monomorphisation and code size

Each distinct instantiation is compiled:

```vela
fn id<T>(x: T) -> T { x }
id(1)        # compiles id::<Int>
id("a")      # compiles id::<Str>
```

That is correct and fast by default. The cost is binary size for a generic used
with many types. Three controls:

| Control | Effect |
| --- | --- |
| `#[genericSize(n)]` on a function | limits distinct instantiations to `n`; the `(n+1)`th is an error naming the types (default 64; a warning fires at 16) |
| `#[boxed]` on a parameter | forces a dynamic call through a vtable-free closure pair, one instantiation |
| `box T` type | `box Shape2D` = a heap-allocated dynamic value with a vtable; one instantiation, one indirection |

```vela
fn render(items: List<box Shape2D>) -> Str {      # one instantiation
  items.map(|s| "${s.area()}").join(",")
}
```

`box` is the only dynamic dispatch in the language. It is explicit, it is
allocated, and it is never introduced by the compiler on your behalf. A program
that never writes `box` has no virtual calls.

---

## 7. Variance

Variance is a property of a **type parameter's position**, and Vela derives it
mechanically. A programmer never writes `in`, `out` or `+`/`-`; the compiler
checks the rules below and rejects a use that would be unsound.

| Generic type | Variance | Consequence |
| --- | --- | --- |
| `List<T>` | covariant | `List<Cat>` is accepted where `List<Animal>` is expected |
| `Option<T>`, `Result<T, E>`, `Task<T>` | covariant | same |
| `Func() -> T` (return position) | covariant | same |
| `Func(T) -> Void` (parameter position) | contravariant | `Func(Animal)` is accepted where `Func(Cat)` is expected |
| `Channel<T>` (send **and** receive) | invariant | `Channel<Cat>` is not a `Channel<Animal>` |
| `Map<K, V>` | invariant in `K` (hashed), covariant in `V` for reads only | a `Map<Str, Cat>` read as `Map<Str, Animal>` may not be inserted into |
| `Set<T>` | invariant | inserting needs exactly `T` |
| `Ptr<T>`, `Volatile<T>` | invariant | raw memory is not variant |
| a user `struct`/`enum`/`trait` parameter | inferred from where it is used | see below |

### 7.1 Rule for user types

For a declaration `struct Box<T> { value: T }`, `T` is **covariant** if it appears
only in field types read by the API, **contravariant** if it appears only as a
parameter of a stored `Func`, and **invariant** if it appears in both or behind a
`mut` field. The compiler computes this from the declaration and reports it in
`vela doc`, so a library author can see it.

A generic type whose parameter is invariant is the default and always safe. A
covariant type is the exception, and it costs one thing: the first mutation
through a widened view copies (the same mechanism as doc 09 §3's copy-on-write).
That is why `List<Cat>` widening is sound without a borrow checker: the widening
is a *read* view, and a write through it becomes a copy of the right type.

### 7.2 What is rejected

```vela
fn pushAnimal(xs: List<Animal>, a: Animal) {
  xs.push(a)                       // ok: the list is Animal's
}

fn bad(xs: List<Cat>) {
  let wider: List<Animal> = xs     // ok, covariant
  wider.push(Dog(..))              // E-GEN-070: cannot write through a widened view
}

fn alsoBad(f: Func(Cat) -> Void) {
  let g: Func(Animal) -> Void = f  // ok, contravariant
  g(Dog(..))                       // fine, g accepts any Animal, f is never called with it
}
```

`E-GEN-070` is "mutation through a covariant view": it is a compile error when the
compiler can see it, and a runtime copy when the value arrives through an
interface that erased the distinction (`box`).

---

## 8. Coherence


Two rules keep generics sound in the presence of separate compilation:

1. **Orphan rule.** A conformance `impl Trait for Type` may be written only in a
   module that owns `Trait` or owns `Type` (doc 08 §7).
2. **Overlap rule.** Two conformances for the same `(Trait, Type)` pair may not
   both apply; the compiler checks this across the whole program, including
   blanket impls.

Violations are `E-GEN-010` (orphan) and `E-GEN-011` (overlap), reported with both
implications.

---

## 9. Inference

Type arguments are inferred from the arguments and the expected return type:

```vela
let xs = [1, 2, 3]              # List<Int>
let ys = xs.map(|x| str(x))     # List<Str>, U inferred from the closure body
let z: Pair<Int, Str> = Pair { first: 1, second: "a" }
```

Rules:

* Inference is local to a function body; a signature is never inferred from its
  callers.
* A generic parameter that appears only in the return position must be given at
  the call site: `let xs = list.new::<Int>()` or `let xs: List<Int> = list.new()`
  (`E-GEN-020`).
* A lambda passed to a generic parameter with an unannotated parameter type is
  `E-GEN-021`; annotate it (`|x: Int| ...`).

---

## 10. `const` generics

A generic parameter may be a **value** instead of a type. It is evaluated at
compile time and participates in the type.

```vela
struct Matrix<const R: Int, const C: Int> {
  data: [Float; R * C]
}

struct Buffer<const N: IntSize> {
  bytes: [UInt8; N]
}

const MAT3 = Matrix<3, 3> { data: [0.0; 9] }

impl<const R: Int, const C: Int> Matrix<R, C> {
  fn rows(self) -> Int { R }
  fn at(self, r: Int, c: Int) -> Float { self.data[r * C + c] }
}

impl<const N: IntSize> Buffer<N> {
  fn len(self) -> IntSize { N }
}
```

Rules:

* A const parameter's type is `Int`, `UInt`, `IntSize`, `Bool`, `Char` or an enum
  without payloads. A `Float` or `Str` parameter is `E-GEN-080`, because equality
  on those is not a compile-time identity.
* The value must be a `comptime`-evaluable expression. `Matrix<N, N>` with an
  unknown `N` is `E-GEN-081`.
* Two instantiations with different values are **different types**:
  `Matrix<2, 2>` and `Matrix<3, 3>` do not unify, and each is monomorphised.
* Arithmetic in a const argument (`R * C`, `N + 1`, `N / 2`) is supported for
  integer parameters, and it is evaluated with the same rules as ordinary integer
  arithmetic (doc 03 §5.2), which means overflow is a compile error in `comptime`.
* A const parameter may appear in an array length, in a `Field` bound, in another
  const argument, and in a `where` clause:
  `where N > 0`, `where R == C` (a square matrix).
* `#[genericSize]` counts const instantiations the same way it counts type ones.
* Pattern matching on a const parameter is a `match` in `comptime` code; at run
  time the value is a literal.

This is what removes the last macro from the systems profile: a fixed-size buffer,
a page table of `512` entries, a ring of `256` slots and a register block of a
known size are all `struct X<const N: Int>`, with the size checked at compile time
and no runtime length field.

A `const` generic is also what makes a shader's workgroup size and an ML kernel's
tile size compile-time constants rather than uniforms (`E-AI-080` if a tile size
is not `comptime`).

---

## 11. What generics are not

* Not erased (unlike Java): a `List<Int>` really stores `Int`.
* Not templates with textual substitution (unlike C++): a generic body is
  type-checked **once**, against its bounds, not once per instantiation. This is
  the difference that produces readable error messages.
* Not higher-kinded: you cannot write `F<A>` where `F` is a parameter.
  Associated types cover the real cases.
* Not variadic over type lists (no `Tuple<T...>`).

---

## 12. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-GEN-010` | orphan impl |
| `E-GEN-011` | overlapping impls |
| `E-GEN-020` | uninferrable type parameter |
| `E-GEN-021` | lambda parameter type needed for inference |
| `E-GEN-030` | bound not satisfied (with the failing requirement chain) |
| `E-GEN-031` | associated type has no binding |
| `E-GEN-040` | too many instantiations |
| `E-GEN-050` | generic parameter shadowing another |
| `E-GEN-060` | `box` used in a `sys` profile without an allocator |
| `E-GEN-070` | mutation through a covariant view |
| `E-GEN-080` | const parameter of an unsupported type |
| `E-GEN-081` | const argument not evaluable at compile time |
| `E-GEN-090` | `where` clause impossible to satisfy for the given const arguments |

---

Next: [08-modules.md](08-modules.md).
