# 06 — Data: structs, enums, traits, impls

**Status:** `spec`. `velac` 0.1 has none of this.

This is the document that replaces classes, records, protocols, interfaces,
interfaces-with-default-methods, algebraic data types and operator overloading.

---

## 1. `struct` — a value type

```vela
struct Point {
  x: Float
  y: Float
}

struct User {
  id: Int
  name: Str
  mut email: Str          # a field that may be written after construction
  tags: List<Str> = []    # a default value
}
```

* A `struct` **copies on assignment**: `let b = a` gives `b` its own fields.
* Fields are immutable unless declared `mut`.
* A field may declare a default; a field without one MUST be given in the
  literal (`E-DATA-010`).
* Construction is a literal, or a generated `Type.new(...)` when a field needs
  validation (see §1.2):

```vela
let p = Point { x: 1.0, y: 2.0 }
let q = Point { x: 1.0, y: 2.0, }       # trailing comma allowed
let r = Point { x: 1.0, ..p }           # update syntax: rest copied from p
```

### 1.1 Size and layout

A struct's size is the sum of its fields, aligned to the largest alignment, in
**declaration order** on x86_64/aarch64 (`#[repr(C)]` guarantees this exactly).
For packed, aligned or explicitly ordered layouts see doc 15 §7.

### 1.2 Constructors

A literal bypasses validation, which is fine for a `Point` and wrong for a
`User`. Declare `fn new(...) -> Result<User, ValidationError>` in an `impl` and
mark the fields `private` (the default when `#![strict]` is on; see §8).
`#[derive(Builder)]` generates the chained form.

```vela
impl User {
  fn new(id: Int, name: Str) -> Result<User, ValidationError> {
    if name.isEmpty { fail ValidationError.empty("name") }
    Ok(User { id, name, tags: [] })
  }
}
```

### 1.3 Value semantics in practice

```vela
mut a = Point { x: 1.0, y: 2.0 }
mut b = a
b.x = 99.0
assertEq(a.x, 1.0)      # a is untouched
```

A struct containing a `List` still copies the struct's fields, but the list is
itself a shared value, so it copies on write (doc 09 §3). There is no deep-copy
cost by surprise: `clone()` exists and is explicit.

---

## 2. `shared struct` — a reference type

```vela
shared struct Node {
  value: Int
  mut next: Node?
}

shared struct Connection {
  socket: Socket
  mut retries: Int = 0
}
```

* The name is a reference; assigning copies the reference, not the object.
* Identity is stable and comparable with `is`.
* Fields are `mut`-able when the binding is `mut`, or when the declaration says
  `mut`.
* Cycles are allowed; the cycle collector reclaims them (doc 09 §4).
* `shared struct` is the right choice for a node in a graph, a long-lived
  service object, or a mutable entity with an identity. It is the wrong choice
  for a `Point`.

```vela
mut a = Node { value: 1, next: nil }
mut b = a
b.value = 2
assertEq(a.value, 2)        # same object
assert(a is b)
```

### 2.1 Weak references

A `shared struct` that points back to its owner creates a cycle that the
collector handles, but a cache may want a weak edge so that the value can be
released promptly:

```vela
shared struct Entry {
  payload: Str
}

struct Cache {
  mut entries: Map<Str, weak Entry> = map.new()   # does not keep it alive
}
```

`weak T` is a type modifier, valid only for `shared` types. `weakValue(w)`
yields `T?`.

---

## 3. `enum` — one type, several shapes

```vela
enum Shape {
  circle(radius: Float)
  rect(width: Float, height: Float)
  triangle(base: Float, height: Float)
  polygon(sides: List<Float>)
  unit
}
```

* Variants may carry positional or named payloads, or nothing.
* Construction is `Shape::circle(radius: 1.0)`. In `strict` mode named payloads
  must be named; in `loose`, positional works too.
* Matching is exhaustive (doc 03 §7.2).

### 3.1 Enums with discriminants (for `sys` and FFI)

```vela
#[repr(u8)]
enum Opcode {
  nop = 0x00
  mov = 0x01
  add = 0x02
  jmp = 0xE9
}
```

An enum with explicit discriminants and `#[repr(...)]` is a plain integer at
runtime, so it may be read from a device register or a wire protocol. An enum
with payloads is a tagged union.

### 3.2 `Option` and `Result` are ordinary enums

```vela
enum Option<T> { Some(value: T), nil }
enum Result<T, E> { Ok(value: T), Err(error: E) }
```

They are declared in the prelude, so you can `impl` on them, `#[derive]` them and
match them exactly like your own enums. There is nothing special about `nil`
except that it is the second variant of `Option` and that `T?` is sugar for it.

---

## 4. `trait` — a named set of behaviours

```vela
trait Shape2D {
  fn area(self) -> Float
  fn perimeter(self) -> Float

  // default method: uses the required ones
  fn describe(self) -> Str {
    "${typeName(self)} of area ${self.area()}"
  }
}

trait Storage {
  type Key
  type Value
  fn get(self, k: Key) -> Value?
  fn put(mut self, k: Key, v: Value)
}
```

* A trait declares methods (`self` receivers), associated functions
  (`fn make() -> Self`), and associated types (§7).
* Default methods are ordinary functions; a conforming type may override them.
* `Self` in a trait means "the conforming type".
* Supertraits: `trait Sorted: Ord + Eq { }`.
* A trait is a nominal concept: conformance is declared, never inferred.

---

## 5. `impl` — where behaviour lives

### 5.1 Inherent methods

```vela
impl Point {
  fn len(self) -> Float { math.sqrt(self.x * self.x + self.y * self.y) }
  fn scaled(self, k: Float) -> Point { Point { x: self.x * k, y: self.y * k } }
  fn scale(mut self, k: Float) { self.x *= k; self.y *= k }
  static fn origin() -> Point { Point { x: 0.0, y: 0.0 } }
}
```

`static fn` is an associated function with no receiver: `Point::origin()`.

### 5.2 Trait conformance

```vela
impl Shape2D for Shape {
  fn area(self) -> Float {
    match self {
      Shape::circle(r)     => math.pi * r * r
      Shape::rect(w, h)    => w * h
      Shape::triangle(b, h)=> b * h / 2.0
      Shape::polygon(sides)=> polygonArea(sides)
      Shape::unit          => 0.0
    }
  }

  fn perimeter(self) -> Float { ... }
}
```

### 5.3 Generic impls

```vela
impl<T: Display> Display for List<T> {
  fn format(self, out: Formatter) { out.list(self, fn(x) { x.format(out) }) }
}

impl<T: Ord> List<T> {
  fn sorted(self) -> List<T> { list.sort(self) }
}
```

### 5.4 Delegation

```vela
struct AudioSource {
  file: File
  name: Str
}

impl Read for AudioSource by self.file      # forwards every Read method
```

`by self.field` implements each method of the trait by calling the same method on
the field. It replaces nine tenths of the inheritance Vela does not have.

### 5.5 Blanket impls

```vela
impl<T: Display> ToText for T {
  fn toText(self) -> Str { fmt.of(self) }
}
```

Blanket impls are allowed but must obey coherence (doc 08 §7): a blanket impl may
not overlap another conformance for the same type. Overlap is `E-DATA-050`.

---

## 6. Operators

Operators are trait methods with fixed names. Implementing one makes the
operator work for your type; nothing else does.

| Operator | Trait method | Trait |
| --- | --- | --- |
| `a + b` | `add` | `Add` |
| `a - b` | `sub` | `Sub` |
| `a * b` | `mul` | `Mul` |
| `a / b` | `div` | `Div` |
| `a % b` | `rem` | `Rem` |
| `a ** b` | `pow` | `Pow` |
| `-a` | `neg` | `Neg` |
| `a == b` | `eq` | `Eq` |
| `a < b` | `cmp` | `Ord` |
| `a[i]` | `index` | `Index` |
| `a[i] = v` | `indexSet` | `IndexSet` |
| `a()` | `call` | `Call` |
| `a & b` | `and` | `BitAnd` (`Set` uses this) |
| `fmt.display(a)` | `display` | `Display` |
| `str(x)` | `toText` | `ToText` |

```vela
impl Add for Vector {
  fn add(self, other: Vector) -> Vector {
    Vector { x: self.x + other.x, y: self.y + other.y }
  }
}
```

`+` never converts between types: an impl decides exactly which pairs are legal.

---

## 7. Associated types and generics

See [07-generics.md](07-generics.md) §4. In short:

```vela
trait Container {
  type Item
  fn head(self) -> Self::Item?
  fn count(self) -> Int
}

impl Container for List<T> {
  type Item = T
  fn head(self) -> T? { if self.isEmpty { nil } else { self[0] } }
  fn count(self) -> Int { self.len }
}
```

---

## 8. Visibility

| Written | Visible to |
| --- | --- |
| `field: T` (no modifier) | the module; `pub` makes it visible outside |
| `pub field: T` | everyone |
| `pub(crate) field: T` | the package |
| `pub(in a::b) field: T` | the module path `a::b` |
| `private field: T` | the declaration's own `impl` blocks only |

`#![strict]` flips the default to `private` and requires `pub` for exposed
members (`E-DATA-060`), which is what a library wants and what a script does not
care about.

---

## 9. `extension` — methods on foreign types

```vela
extension Str {
  fn shout(self) -> Str { self |> str.upper + "!" }   # additive, not invasive
}

extension List<Int> {
  fn total(self) -> Int { self.fold(0, |a, b| a + b) }
}
```

An `extension` may add methods but not fields, and it may not add conformance to
a trait neither the extension nor the type owns (orphan rule, doc 08 §7). This is
how Vela's standard library stays small: `list.total(xs)` is a free function,
`xs.total()` is the same thing through universal call syntax (doc 03 §4.2), and
`extension` exists only for readability.

---

## 10. `interface` — foreign bridged types

```vela
interface NSObject {
  fn description(self) -> Str
  fn isEqual(self, other: Any) -> Bool
}

interface HTMLElement {
  fn tagName(self) -> Str
  fn appendChild(mut self, child: HTMLElement)
  mut textContent: Str
}
```

An `interface` describes a type that exists outside Vela (Objective-C, DOM, a C
struct) so that method calls type-check. Calling one goes through the FFI bridge
(doc 17). An `interface` has no fields, no constructor and cannot be
instantiated by Vela code.

---

## 11. Destruction

```vela
impl Drop for FileHandle {
  fn drop(consuming self) {
    sys.close(self.fd)
  }
}

impl Closable for FileHandle {
  fn close(consuming self) -> Result<Void, IoError> { ... }
}
```

* `drop` runs when the last reference goes away, in reverse declaration order,
  after `defer`s in the same scope.
* A `drop` may not panic (`E-DATA-070`): a panicking destructor during unwinding
  is where languages lose their minds.
* A type with a `drop` is *move-only* by default: copying it would double-free.
  The compiler enforces it (`E-DATA-071`) and offers `#[derive(Clone)]` only if
  the type says `fn clone(self) -> Self` explicitly.

---

## 12. What replaces a class

A programming model with no classes needs an answer for each thing a class does.
The answers are:

| Class feature | Vela |
| --- | --- |
| data | `struct` (value) or `shared struct` (identity) |
| method | `impl` block |
| interface / protocol | `trait` |
| abstract method | a trait method without a body |
| default method | a trait method with a body |
| protected field | `pub(in path)` |
| inheritance | a trait, plus `impl Trait for X by field` |
| `super.method()` | call the delegated implementation explicitly |
| constructor | `fn new(...) -> Result<Self, E>` or a literal |
| destructor | `impl Drop` |
| static member | `static fn`, `static` value, or a `const` |
| operator overload | `impl Add` and friends |
| getter/setter | a computed `fn`, or a `mut` field |
| mixin / module include | `impl Trait for X` written in another module |

---

## 13. A complete example

```vela
enum Payment {
  cash(amount: Float)
  card(last4: Str, amount: Float)
  transfer(iban: Str, amount: Float)
}

trait Ledger {
  fn record(mut self, p: Payment) -> Result<Unit, LedgerError>
  fn balance(self) -> Float
}

shared struct Account {
  owner: Str
  mut entries: List<Payment> = []
}

impl Ledger for Account {
  fn record(mut self, p: Payment) -> Result<Unit, LedgerError> {
    match p {
      Payment::card(_, amount) if amount <= 0.0 =>
        Err(LedgerError.invalidAmount(amount))
      _ => {
        self.entries.push(p)
        Ok(unit)
      }
    }
  }

  fn balance(self) -> Float {
    self.entries.map(fn(p) { p.amount() }).fold(0.0, |a, b| a + b)
  }
}

impl Payment {
  fn amount(self) -> Float {
    match self {
      Payment::cash(a) => a
      Payment::card(_, a) => a
      Payment::transfer(_, a) => a
    }
  }
}
```

---

## 14. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-DATA-010` | missing required field in a literal |
| `E-DATA-011` | unknown field in a literal |
| `E-DATA-020` | unknown variant |
| `E-DATA-030` | missing trait method in an `impl` |
| `E-DATA-031` | method in an `impl` that the trait lacks |
| `E-DATA-040` | conflicting conformance in the same module |
| `E-DATA-050` | overlapping blanket impls |
| `E-DATA-060` | private member accessed outside its module |
| `E-DATA-070` | `drop` may panic |
| `E-DATA-071` | copy of a move-only type |
| `E-DATA-080` | `impl` on a foreign type without an `extension` |
| `E-DATA-090` | unknown supertrait |
| `W-DATA-001` | `shared struct` used where a `struct` would do |

---

Next: [07-generics.md](07-generics.md).
