# 05 — Functions

**Status:** `spec`, except top-level `fn`, recursion and forward calls (`impl`).

---

## 1. Declaration

```vela
fn name(p1: T1, p2: T2 = default, ...rest: T3) -> R {
  body
}
```

* The parameter list is mandatory; an empty one is written `()`.
* A parameter is `name: Type`; the type may be omitted in `loose` mode.
* A default (`= expr`) must be a compile-time constant or a literal.
* A variadic (`...xs: List<T>`) must be last and collects the remaining
  arguments into a list.
* The return type may be omitted: it is inferred from the body, unless the
  function is recursive (`E-TYPE-070`) or public in `strict` mode (where it is
  required, `E-FN-010`).
* A function that returns nothing omits `-> R` and has type `Void`.

```vela
fn greet(name: Str = "world") -> Str { "hello, ${name}" }

fn clamp(x: Float, lo: Float = 0.0, hi: Float = 1.0) -> Float {
  num.min(num.max(x, lo), hi)
}

fn sum(...xs: List<Float>) -> Float {
  mut total = 0.0
  for x in xs { total += x }
  total
}
```

Declaration order does not matter: any function in a module may call any other,
including mutually recursive ones. There is no forward declaration.

---

## 2. Bodies and returns

```vela
fn square(x: Float) -> Float { x * x }        # last expression is the value

fn log2(x: Float) -> Float {
  let r = math.log(x) / math.log(2.0)
  return r                                    # explicit, identical
}

fn early(xs: List<Int>) -> Int? {
  for x in xs {
    if x > 100 { return x }                   # early return with ?
  }
  nil
}
```

`return` without a value in a `Void` function is allowed and redundant;
`vela fmt` keeps it if you wrote it. Returning a value of the wrong type is
`E-FN-020`. Falling off the end of a non-`Void` function is `E-FN-021` unless the
last statement is `Never`-typed.

---

## 3. Nested functions

```vela
fn outer(xs: List<Int>) -> Int {
  fn helper(x: Int) -> Int { x * 2 }     # private to outer
  xs.map(helper).sum()
}
```

A nested function may close over its parent's bindings exactly like a closure,
but it has a name, may be recursive, and is not a first-class value unless it is
assigned to one.

---

## 4. Functions as values

```vela
fn add(a: Int, b: Int) -> Int { a + b }

let f: Func(Int, Int) -> Int = add
assertEq(f(1, 2), 3)

let ops: Map<Str, Func(Float, Float) -> Float> = {
  "sin": math.sin,
  "cos": math.cos,
}

fn apply(g: Func(Int) -> Int, xs: List<Int>) -> List<Int> {
  xs.map(g)
}

apply(|x| x + 1, [1, 2, 3])     # [2, 3, 4]
```

A named function used as a value produces a **thin pointer** when it captures
nothing and a closure object when it captures. Both satisfy `Func(...) -> T`, so
the distinction never leaks into source.

---

## 5. Methods and receivers

A function declared in an `impl` block takes a receiver:

```vela
impl Str {
  fn shout(self) -> Str { str.upper(self) + "!" }        # read-only receiver
}

impl Counter {
  fn bump(mut self) { self.value += 1 }                  # mutates the receiver
  fn consume(self) -> Int { self.value }                 # takes ownership
}
```

| Receiver | Meaning | Call site |
| --- | --- | --- |
| `self` | read-only view | `x.m()` on any binding |
| `mut self` | writable view | requires the binding to be `mut` or the value to be owned |
| `consuming self` | takes the value; the caller's binding is moved | `x.m()` then `x` is unavailable (`E-EXPR-021`) |

`consuming self` is spelled `self` inside `impl` for a `unique` value and is the
only way to implement a builder that cannot be misused:

```vela
let client = HttpClient::new()
  .withTimeout(5.0)
  .withRetries(3)          # each step consumes and returns a new value
```

---

## 6. Generics on functions

```vela
fn first<T>(xs: List<T>) -> T? { if xs.isEmpty { nil } else { xs[0] } }

fn map<T, U>(xs: List<T>, f: Func(T) -> U) -> List<U> {
  mut out: List<U> = []
  for x in xs { out.push(f(x)) }
  out
}

fn maxOf<T: Ord>(xs: List<T>) -> T? {
  mut best: T? = nil
  for x in xs {
    if best == nil || x > best.unwrap() { best = x }
  }
  best
}
```

Full rules in [07-generics.md](07-generics.md).

---

## 7. `async` functions

```vela
async fn fetchUser(id: Str) -> Result<User, HttpError> {
  let res = try await http.get("https://api.example.com/users/${id}")?
  Ok(try res.json::<User>()?)
}

// at a call site
let user = try await fetchUser("42")?
```

Rules:

* `async fn` returns `Task<T>` where `T` is the declared return type.
* `await` may only appear inside `async` code (`E-FN-030`).
* An `async fn` body is a coroutine; the compiler splits it at `await` points
  automatically. There are no manual state machines.
* `spawn { }` starts a detached task; `TaskGroup` scopes a set of them
  (doc 10 §3).
* In the `web` profile, `async` compiles to promise-returning code; in `core` and
  `sys`, to a thread pool or a single-threaded event loop depending on the
  runtime the package selects.

---

## 8. Effects, declared and checked

A function's signature tells you everything it can do. The compiler derives these
**effect markers** from the body and rejects a body that exceeds its declared
ones:

| Marker | Meaning |
| --- | --- |
| `async` | may suspend |
| `io` | touches files, sockets, clock, environment |
| `ui` | touches the view tree; only callable on the UI task |
| `unsafe` | contains an `unsafe` block |

```vela
fn pure(a: Int, b: Int) -> Int { a + b }            # no markers, provably pure
fn read(p: Str) -> Result<Bytes, IoError> io { ... }
```

A *pure* function is one with no markers: it may be `comptime`-evaluated, cached,
memoised and moved across threads. This is checked, not documented — a pure
function that calls `print` is `E-FN-040`. Pure functions are what makes `const`
tables, shaders-in-Vela and compile-time code generation possible.

---

## 9. Overloading

There is **no overloading by parameter type**. Two functions with the same name
in a module are `E-FN-050`. The exceptions are:

* trait methods, resolved by receiver type (doc 06);
* default parameter values, which give the appearance of several arities;
* `impl` blocks for different types, which never collide.

This is a deliberate simplification: overload resolution is the single largest
source of "which one did it call?" in languages that have it, and default
parameters plus named arguments cover the real uses.

---

## 10. `#[must_use]` and discarded results

```vela
#[must_use]
fn save(self) -> Result<Void, IoError> { ... }

save()            # W-FN-010: discarding a must_use result
let _ = save()    # explicit discard, allowed
try save()?       # the correct use
```

Every `Result` is `#[must_use]` implicitly. Discarding one is a warning in `loose`
mode and an error in `strict`.

---

## 11. Entry points

| Profile | Entry point | Signature |
| --- | --- | --- |
| `core` | `fn main()` in `src/main.vela` | `fn main() -> Void` or `fn main(args: List<Str>) -> Void` |
| `core` (fallible) | `fn main() -> Result<Void, Error>` | `Err` prints and exits 1 |
| `app` | `#[app] view Root()` | doc 13 §2 |
| `web` client | `fn main()` runs after the DOM is ready | doc 14 §3 |
| `web` server | `fn main()` starts the server named by `[serve]` | doc 14 §5 |
| `sys` | `#[entry] fn kmain() -> Never` | doc 15 §4 |

`vela run` and `velac` select the entry by profile. A file with two entry points
is `E-FN-060`.

---

## 12. Recursion and tail calls

Recursion is ordinary. The `sys` profile guarantees **tail-call optimisation**
for a `return f(...)` in tail position, because a kernel driver cannot afford a
growing stack; `core` makes no such promise, and neither does `app` or `web`
(jump-targets and promises instead). A programmer who needs an unbounded loop
uses `loop`, which is guaranteed constant-stack everywhere.

```vela
fn gcd(a: Int, b: Int) -> Int {
  if b == 0 { return a }
  return gcd(b, a % b)          # tail call, optimised in sys
}
```

---

## 13. Performance contract

| Situation | Guarantee |
| --- | --- |
| Call to a statically known function | inlined when ≤ 20 AST nodes, unless `#[noInline]` |
| Call through a `Func` value | indirect call, no inlining |
| Generic function | monomorphised per type argument set |
| `for` over a `List` | no allocation |
| Closure with no captures | thin pointer, no allocation |
| Closure with captures | one allocation, freed with the closure |
| String interpolation | one buffer, one allocation |

The numbers are contract, not tuning: a compiler that allocates in a `for` loop
over a list has a bug.

---

## 14. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-FN-010` | missing return type on a public function in strict mode |
| `E-FN-020` | returned value type mismatch |
| `E-FN-021` | falling off the end of a non-`Void` function |
| `E-FN-030` | `await` outside `async` |
| `E-FN-040` | effect violation (e.g. `io` call in a pure function) |
| `E-FN-050` | duplicate function name in a module |
| `E-FN-060` | multiple or missing entry points |
| `E-FN-070` | variadic parameter not last |
| `E-FN-080` | default value is not a constant |
| `E-FN-090` | `consuming self` method called on an immutable binding |
| `W-FN-010` | discarded `#[must_use]` result |

---

Next: [06-data.md](06-data.md).
