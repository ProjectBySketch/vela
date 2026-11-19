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

Only `List<T>` is variant, and only covariantly for reading (doc 02 §11). Every
other generic type is **invariant**, which means `Tree<Cat>` is not a
`Tree<Animal>`, and therefore cannot be inserted into. This is the boring correct
answer: variance is where type systems grow footguns, and Vela gets the useful
case (`List`) and nothing else.

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

**Planned.** The syntax is reserved:

```vela
struct Matrix<const R: Int, const C: Int> { data: [Float; R * C] }
```

This is the last piece needed for fixed-size buffers in `sys` without macros.
Until it lands, the workaround is a `sys`-profile `Ptr<Float>` plus a runtime
length, which is what the spec's kernel examples do.

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

---

Next: [08-modules.md](08-modules.md).
