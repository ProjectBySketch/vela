# 12 — Metaprogramming

**Status:** `spec`.

Metaprogramming in Vela is deliberately narrow: compile-time evaluation,
template macros, attributes and `derive`. There is no `eval`, no runtime code
generation, and no reflection that can defeat the type checker in `strict` mode.

---

## 1. `comptime`

A `comptime` block is evaluated by the compiler and replaced by its value.

```vela
const PRIMES = comptime { sieve(1000) }
const TABLE: List<Float> = comptime { (0..<360).map(|d| sin(toRadians(d))) }

let mask = comptime {
  mut m = 0
  for b in 0..<8 { m |= 1 << b }
  m
}
```

Rules:

* Only **pure** functions may be called (doc 05 §8): no `io`, no `async`, no
  `unsafe`, no `ui`.
* The result must be a compile-time-representable value: numbers, strings,
  booleans, `nil`, lists, maps, structs and enums of those. `Ptr`, `Task`,
  closures over mutable state and foreign handles are `E-META-010`.
* `comptime` has a step budget (default 10 million evaluations) and a depth limit
  (256), because a compiler that hangs on `comptime` is indistinguishable from a
  compiler that crashed. Exceeding it is `E-META-011` with the expression that
  was running.
* `comptime` may read `#[cfg]`-visible constants and `Type` information
  (doc 12 §5), which is what makes it useful for code generation.

### 1.1 `comptime fn`

```vela
comptime fn fibonacci(n: Int) -> Int {
  if n < 2 { n } else { fibonacci(n - 1) + fibonacci(n - 2) }
}

const F30 = fibonacci(30)     # folded; no runtime cost
```

A `comptime fn` is callable only from compile-time context; calling it at
runtime is `E-META-012` (and the fix is to delete `comptime`).

---

## 2. Constant folding

`const` expressions are folded whether or not you write `comptime`
(doc 04 §2.3). The compiler folds:

| Expression | Folded |
| --- | --- |
| arithmetic on `const` operands | yes |
| string concatenation of `const` strings | yes |
| `if` on a `const` condition | dead branch removed |
| `match` on a `const` subject | dead arms removed |
| list/map literals of constants | yes, emitted as static data |
| `for` over a `const` range in a `const` initialiser | yes |
| any call marked `#[comptime]` | yes |

This is why a `const` lookup table costs nothing at run time.

---

## 3. Macros

A macro is a **template** over syntax. It is hygienic: names introduced inside a
macro cannot capture names at the call site, and vice versa.

```vela
macro unless(cond, then) {
  if not cond { then }
}

unless(ready) { start() }        # expands to: if not ready { start() }

macro check(err, ctx) {
  try err catch e { fail RuntimeError("${ctx}: ${e.message()}") }
}
```

### 3.1 Form

```vela
macro name(param, param, ...rest) {
  body
}
```

* Parameters are matched as **token trees**: a call `name(a, b)` binds `a` and
  `b` to the token sequences between top-level commas.
* The body is a template. `$(param)` splices a token tree into a position;
  `${expr}` interpolates a *compile-time value* (from `comptime`) into the
  generated tokens.
* A macro expands to an item, a statement, an expression or a list of statements,
  depending on where it is used.
* Recursion is allowed, with the same depth limit as `comptime`. A macro that
  expands to itself is caught at depth 256 (`E-META-020`).

```vela
macro assertAll(pairs...) {
  $(for p in pairs { "assert($(p))\n" })
}
```

### 3.2 Hygiene

A binding introduced by a macro body (`let tmp = ...`) is renamed so that it
cannot collide with, or be observed by, the caller's scope. A caller's binding
used inside a macro refers to the caller's binding — a macro is a template, not a
closure, so it sees the caller's names, which is what makes `unless(ready)` work.

### 3.3 What macros may not do

* They may not run arbitrary code at compile time; that is `comptime`.
* They may not inspect types; that is `#[derive]` and `comptime` with `Type`.
* They may not introduce conformance to a trait for a foreign type
  (coherence still applies, doc 08 §7).
* They cannot be used where a declaration-only position expects an identifier
  (no macro-generated function names, because that breaks incremental builds —
  `#[derive]` is the supported way).

---

## 4. Attributes

59 attributes. This section is the complete list — if an attribute is used
anywhere else in this specification and is not here, that is a bug in the
specification. Unknown attribute = `E-LEX-070`.

### 4.1 Derivation (11)

| Attribute | Generates |
| --- | --- |
| `#[derive(Eq)]` | field-wise `==` |
| `#[derive(Ord)]` | lexicographic `<`, `compare` |
| `#[derive(Hash)]` | a stable hash over fields |
| `#[derive(Display)]` | a readable string form |
| `#[derive(Debug)]` | a structural string form (`Point { x: 1, y: 2 }`) |
| `#[derive(Clone)]` | a deep copy |
| `#[derive(Default)]` | zero/empty values |
| `#[derive(Error)]` | `Error` conformance from variant shapes |
| `#[derive(Json)]` | `toJson` / `fromJson` |
| `#[derive(Builder)]` | a chained builder with validation |
| `#[derive(From)]` | `From` conversions from each field |

Field-level modifiers accepted inside a `#[derive]` family: `#[json(name: "product_id")]`
on a field (doc 14 §9), and `#[json(skip)]` to leave one out.

### 4.2 Layout and ABI (13)

| Attribute | Meaning |
| --- | --- |
| `#[repr(C)]` | C field layout |
| `#[repr(u8)]` / `#[repr(i32)]` … | integer representation for an enum |
| `#[repr(packed)]` | no padding |
| `#[repr(align(16))]` | minimum alignment |
| `#[no_mangle]` | keep the symbol name |
| `#[link_section(".text.boot")]` | place in a section |
| `#[naked]` | no prologue/epilogue (boot stubs, `#[interrupt]` frames) |
| `#[export]` | emit to the WASM export table |
| `#[global_allocator]` | the program's default allocator |
| `#[panic_handler]` | the program's panic function |
| `#[entry]` | the program's entry point |
| `#[boot]` | a kernel's first function (equivalent to `#[entry]`, named for clarity) |
| `#[target("aarch64-unknown-none")]` | the only target a test or function is valid for |

### 4.3 Foreign and platform (7)

| Attribute | Meaning |
| --- | --- |
| `#[link(name:, kind:)]` | link a library, static library or framework |
| `#[link_args("-flat_namespace")]` | an extra linker flag |
| `#[cdecl]` | a `Func` value uses the C calling convention |
| `#[stored]` | the foreign side may keep the callback past the call |
| `#[objc(name: "...")]` | an Objective-C name for a type or method |
| `#[interrupt(n)]` | install a handler at vector `n` (doc 15 §6) |
| `#[syscall(n)]` | expose a function to user mode at vector `n` (doc 15 §9) |

### 4.4 Behaviour (12)

| Attribute | Meaning |
| --- | --- |
| `#[inline]` / `#[noInline]` | force / forbid inlining |
| `#[wrap]` | integer overflow wraps instead of saturating |
| `#[tailCall]` | require tail-call optimisation (error if impossible) |
| `#[genericSize(n)]` | cap instantiations (doc 07 §6) |
| `#[boxed]` | force boxed dispatch |
| `#[chunk(n)]` | `parallel for` chunk size |
| `#[fair]` | rotate `select` arms |
| `#[comptime]` | callable at compile time |
| `#[trackCaller]` | report the caller's location in diagnostics |
| `#[must_use]` | warn when the result is discarded |
| `#[deprecated("use X")]` | warn at every use |
| `#[doc("text")]` | inline documentation, equivalent to a doc comment |
| `#[noAlloc]` | the function performs no allocation (checked, doc 17 §7) |
| `#[reflect]` | keep runtime type information in a `strict` build (doc 12 §5.1) |

### 4.5 Testing and configuration (6)

| Attribute | Meaning |
| --- | --- |
| `#[test]` | a test function |
| `#[bench]` | a benchmark |
| `#[shouldPanic("msg")]` | the test must panic |
| `#[ignore]` | skip unless explicitly run |
| `#[cfg(...)]` | conditional compilation (doc 08 §8) |
| `#[app]` | the UI root view (doc 13 §2) |

### 4.6 Web routes (7)

| Attribute | Meaning |
| --- | --- |
| `#[get("/path")]` | an HTTP GET handler (doc 14 §5) |
| `#[post("/path")]` | POST |
| `#[put("/path")]` | PUT |
| `#[patch("/path")]` | PATCH |
| `#[delete("/path")]` | DELETE |
| `#[any("/path")]` | any method |
| `#[qemu(...)]` | run a test in an emulator (doc 15 §16) |

That is 59. `@island`, `@client` and `@static` are view modifiers (doc 13 §2),
not attributes, and `#![strict]` and friends are file directives (doc 01 §10).


---

## 5. Compile-time reflection

Inside `comptime`, types are values:

```vela
comptime fn fieldCount<T>() -> Int { Type.of(T).fields.len }

comptime fn makeGetters<T>() -> Str {
  mut out = ""
  for f in Type.of(T).fields {
    out += "fn get_${f.name}(self) -> ${f.type} { self.${f.name} }\n"
  }
  out
}
```

| API (in `vela.meta`) | Returns |
| --- | --- |
| `Type.of(T)` | the type descriptor |
| `.name`, `.kind` | `"Point"`, `"struct"` |
| `.fields` | name, type, offset, mutability |
| `.variants` | name, payloads, discriminant |
| `.methods` | name, signature |
| `.traits` | conformances |
| `.size`, `.align` | layout |
| `.params` | generic parameters |

This is what lets a serialiser, an ORM or a UI binder be written in Vela rather
than in a compiler plugin. It is compile-time only; the descriptor is not in the
binary unless the program asks for runtime reflection.

### 5.1 Runtime reflection

```vela
let t = typeName(x)                # "Point"
let fields = reflect.fields(x)     # Map<Str, Any>
```

In `loose` mode this is always available. In `strict` mode it is available on a
type that opts in, because reflection defeats whole-program optimisation and makes
the type's shape part of its public API:

```vela
#[reflect]
shared struct PluginConfig {
  name: Str
  version: Int
}

let desc = reflect.typeOf(PluginConfig::class)
desc.fields()                       # name, type, offset, mutability
```

| Rule | Detail |
| --- | --- |
| Opt-in | `#[reflect]` on the type; reading metadata of a type without it is `E-META-050` |
| What is kept | names, types, offsets, enum variants, conformances — not method bodies |
| Cost | one static table per reflected type, in `.rodata`; a program with no `#[reflect]` has no tables |
| `strict` interaction | a reflected field's name is part of the API: renaming it is a breaking change (`W-API-010`) |
| Generic types | reflected per instantiation, capped by `#[genericSize]` |

The intended use is a plugin boundary (doc 31), a config loader and a debugging
overlay — not a serialiser, which should use `#[derive]` (doc 38) and stay
monomorphised.


---

## 6. Code generation

A `comptime` block may produce source that the compiler then compiles:

```vela
comptime fn codegenOps() -> Str { ... }
```

is *not* how it is spelled. The supported form is a macro that splices the
generated tokens, or a build-time program:

```toml
[build]
generators = { "src/schema.vela" = "schema.json" }
```

A generator is an ordinary Vela program, compiled and run before the package is
compiled. It reads its input file and writes a `.vela` file into the build
directory, which is then compiled as part of the package. This keeps generated
code readable, cacheable and diffable, which `comptime` string-splicing does not.

---

## 7. Testing

```vela
#[test]
fn addsCorrectly() {
  assertEq(add(1, 2), 3)
}

#[bench(iterations: 10_000)]
fn sortBench(b: Bench) {
  b.run(|_| { list.sort(input) })
}
```

* `vela test` finds every `#[test]` in `src/` and `tests/`, compiles and runs
  them, reports failures with the assertion's left and right values.
* `vela test --doc` runs every doc-comment example (doc 01 §3).
* `vela test --filter=name` runs a subset; `--stress` repeats to find
  concurrency bugs; `--leaks` checks allocations; `--coverage` reports lines.
* A test may be `async`: `#[test] async fn` gets a runtime.

---

## 8. Documentation

```vela
/// A point in the plane.
///
/// ```
/// let p = Point { x: 3.0, y: 4.0 }
/// assertEq(p.len(), 5.0)   // =>
/// ```
pub struct Point { x: Float, y: Float }
```

`vela doc` renders the package's doc comments, signatures and derived
conformance into HTML or Markdown, with a search index and a "jump to
definition" page per item. Because doc tests are real code, the documentation
cannot drift from the implementation without CI noticing.

---

## 9. What Vela refuses

| Refused | Because |
| --- | --- |
| `eval(source: Str)` | a language that can evaluate arbitrary strings cannot be analysed or sandboxed |
| Runtime macro expansion | breaks incremental compilation and debuggability |
| Reflection that changes a type's shape | same reason as `eval` |
| Compiler plugins written in another language | the compiler is a library; a plugin is a Vela program over an AST type |
| Template string that produces Vela source at runtime | see `eval` |

The one escape hatch is a build-time generator (§6), and it is a separate,
visible step in the build.

---

## 10. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-META-010` | non-representable `comptime` result |
| `E-META-011` | `comptime` budget exceeded |
| `E-META-012` | `comptime fn` called at runtime |
| `E-META-020` | macro recursion depth |
| `E-META-021` | macro parameter count mismatch |
| `E-META-030` | `derive` on a type that cannot support it (e.g. `Ord` with a float field is allowed but `Hash` is not) |
| `E-META-040` | generator output changes the public interface of the package without a version bump (`planned`) |
| `W-META-001` | `derive(Clone)` on a large struct (a hint that `shared` may be wanted) |

---

Next: [13-ui.md](13-ui.md) — the CSS and SwiftUI replacement.
