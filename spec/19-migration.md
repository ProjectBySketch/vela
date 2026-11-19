# 19 — Migration: from the languages Vela replaces

**Status:** `spec`. This is a translation map, not a compatibility promise.

For each language: what maps to what, what has no equivalent (and what to write
instead), and what Vela refuses to copy.

---

## 1. Swift

| Swift | Vela |
| --- | --- |
| `let x = 1` / `var y = 2` | `let x = 1` / `mut y = 2` |
| `struct S { }` | `struct S { }` (also a value type) |
| `class C { }` | `shared struct C { }` |
| `protocol P { }` | `trait P { }` |
| `extension T: P { }` | `impl P for T { }` |
| `enum E { case a, b(Int) }` | `enum E { a, b(Int) }` |
| `if let x = opt { }` | `if let x = opt { }` |
| `guard let x = opt else { return }` | identical |
| `try f()` + `throws` | `f()?` + `Result` |
| `do { } catch { }` | `try { } catch e { }` |
| `defer { }` | `defer statement` (same semantics) |
| `closure { $0 + 1 }` | `|x| x + 1` |
| `async`/`await` | identical |
| `Task { }` | `spawn { }` |
| `actor` | `actor` (same model) |
| `@State`, `@Binding`, `@Environment` | `state`, `bind`, `env` |
| `some View` | a view is a view; no `some` needed |
| `optional chaining a?.b` | identical |
| `??` | identical |
| `#available` | `@when target == .ios(version: 16)` in a style, `if platform.atLeast(.ios(16))` in code |
| `CGFloat`, `Double`, `Int` | `Float`, `Float`, `Int` (one numeric tower, no bridging) |
| `DispatchQueue.main.async { }` | `ui.onMain { }`, or nothing: a view body already runs on the UI task |
| `UserDefaults` | `storage.keyed("defaults")` |
| `Codable` | `#[derive(Json)]` |
| `@objc`, `NSObject` | `interface` + `#[objc]` (doc 17 §3) |
| force unwrap `!` | `.unwrap()` (panics) — the compiler still makes you handle the optional first |
| `as!` | `as T` (checked, `E-RUN-030`) |
| `fatalError` | `panic` |

**No equivalent:** protocol extensions with stored properties, class inheritance,
`associatedtype` witnesses that are not written explicitly, KVO, `@propertyWrapper`
in general (the four kinds Vela has are built in), Objective-C runtime
manipulation.

### 1.1 SwiftUI

```swift
struct Counter: View {
  @State private var count = 0
  var body: some View {
    HStack(spacing: 8) {
      Text("\(count)")
      Button("+1") { count += 1 }
    }
    .padding(16)
    .background(Color(.systemBackground))
    .cornerRadius(12)
  }
}
```

```vela
view Counter() {
  state count: Int = 0
  row(gap: 8dp, pad: 16dp) {
    text("${count}")
    button("+1", onTap: { count += 1 })
  }.background(token.surface).radius(12dp)
}
```

The mapping is nearly one to one, which is the point: the modifier chain becomes a
style, the `@State` becomes `state`, and the `.background(...)` that SwiftUI makes
you nest becomes a style property.

---

## 2. JavaScript / TypeScript

| JS / TS | Vela |
| --- | --- |
| `let`/`const` | `mut` / `let` |
| `function f(a) {}` | `fn f(a: Int) -> Int {}` |
| arrow `x => x * 2` | `|x| x * 2` |
| template literal `` `${a}` `` | `"${a}"` |
| object literal `{ a: 1 }` | `Map` literal `{"a": 1}` or a `struct` |
| array `[1, 2]` | `List<Int>` |
| `null` / `undefined` | `nil` (one absence, not two) |
| `===` | `==` (there is no `==` that coerces) |
| `typeof` | `typeName(x)` / `x is Str` |
| `try/catch/throw` | `Result` + `?` + `try/catch` |
| `Promise` + `await` | `async`/`await` |
| `async function` | `async fn` |
| classes | `struct` + `impl` |
| `interface` (TS) | `trait` |
| `enum` | `enum` |
| generics `<T>` | `<T>` |
| destructuring | identical |
| spread `...x` | `...x` |
| `for (const x of xs)` | `for x in xs` |
| `xs.map(f).filter(g)` | identical (lazy through `iter`, eager on `List`) |
| `JSON.parse` | `json.parseAs::<T>(s)?` |
| `localStorage` | `storage.local` |
| `fetch` | `web.fetch` |
| `document.querySelector` | elements and views; `web.dom` as an escape hatch |
| `npm install` | `vela add` from `vela.pkg` |
| `node` on the server | the same Vela program, compiled native |

**No equivalent:** implicit type coercion, `this`, prototype chains, getters and
setters on plain objects, `eval`, `new`, event bubbling that you must remember,
`NaN` propagation through silently-wrong arithmetic.

---

## 3. Python

| Python | Vela |
| --- | --- |
| `x = 1` | `mut x = 1` (or `let` when not reassigned) |
| indentation | braces |
| `def f(a, b=1):` | `fn f(a: Int, b: Int = 1) -> Int {` |
| `lambda x: x*2` | `|x| x * 2` |
| list comprehension | `[x for x in xs if p(x)]` |
| dict | `Map` |
| set | `Set` |
| tuple | `Tuple` |
| `None` | `nil` |
| `try/except/else/finally` | `try/catch` + `defer` |
| `with open(...) as f:` | `with f = fs.open(...) { }` |
| `class` + `self` | `struct`/`shared struct` + `impl` (no implicit `self` parameter) |
| `@dataclass` | `#[derive(Eq, Hash, Display)] struct` |
| `typing` annotations | the real thing; checked |
| `async`/`await` | identical |
| `yield` | `Iterator` trait; `yield` in a generator method |
| `pip` / `requirements.txt` | `vela.pkg` |
| `print(...)` | `print(...)` (same name, variadic) |
| `len(x)` | `len(x)` (same) |
| `str`, `int`, `float` casts | `str(x)`, `num.toInt(x)`, `num.toFloat(x)` |

**No equivalent:** monkey patching (an `extension` is checked and declared),
metaclasses, decorators that rewrite a function, `**kwargs` magic, multiple
inheritance, the GIL as a concurrency model.

Vela is the language a Python script grows into: `loose` mode keeps it short,
`strict` mode turns it into a program someone else can maintain, and no rewrite is
needed in between.

---

## 4. HTML

| HTML | Vela |
| --- | --- |
| `<div>` | `column`/`row`/`group` — a container with an intended axis |
| `<span>` | `text` (a span's purpose is inline text) |
| `<p>`, `<h1>`–`<h6>` | `text(...)`, `heading(...)` |
| `<a href>` | `link(label, href)` |
| `<img src alt>` | `image(asset, alt:)` (alt is required) |
| `<button>` | `button(...)` with `onTap` |
| `<input>`, `<textarea>` | `field(...)` |
| `<select>` | `select(...)` |
| `<form>` | `form(onSubmit:)` with typed parsing |
| `<table>` | `grid(columns:)` — a layout with cells, not a table tag |
| `<ul>/<li>` | `column` + `each` with `listStyle: bullet` |
| `<header>/<nav>/<main>/<footer>` | `role: .banner/.navigation/.main/.contentInfo` on a container |
| `<style>` | `style` declarations |
| `<script>` | the program body; there is no scripting layer *inside* the page |
| `class="..."` | `.style(Name)` |
| `id="..."` | a `state`/`bind` handle or `platformId` for a native control |
| `data-*` | a typed prop on a `view` |
| `onclick="..."` | `onTap: |e| { ... }` |
| `aria-*` | `label`, `hint`, `role`, `liveRegion` (doc 13 §13) |
| `<iframe>` | `webview(url)` on `app`, `portal` on `web` |
| `&amp;` entities | not needed: text is text, and escaping happens at emission |

**No equivalent:** nested forms, invalid nesting that a browser silently fixes,
inline styles, `<script>` in HTML.

---

## 5. CSS

Doc 13 §21 has the property-by-property table (80 rows). The structural ones:

| CSS concept | Vela |
| --- | --- |
| selector | does not exist |
| specificity | does not exist |
| cascade | one level of theme tokens |
| `!important` | does not exist |
| stylesheet file | `style` declarations in the program |
| `@media` | `@when` over `self.width` or `window.width` |
| pseudo-class | `when .hover` |
| pseudo-element | a real element |
| `calc()` | arithmetic on `Length` |
| CSS variable | theme token |
| `box-sizing` | always border-box |
| `display`/`position`/`z-index` | the same names, one layout model |

---

## 6. Rust

| Rust | Vela |
| --- | --- |
| `let`/`let mut` | `let`/`mut` |
| `fn f() -> T` | identical |
| `struct`, `enum`, `trait`, `impl` | identical (same keywords, same meaning) |
| `impl Trait for T` | identical |
| `&T`, `&mut T` | nothing: values copy, shared values copy-on-write, `unique` values move, `borrow` for the non-escaping case |
| lifetimes `'a` | none |
| `Box<T>` | `box T` for dynamic dispatch; `shared struct` for heap identity |
| `Rc`, `Arc` | the default for shared values |
| `Mutex`, `RwLock` | identical |
| `Result<T, E>`, `?` | identical |
| `Option<T>` | `T?` |
| `match` with patterns | identical (no exhaustive `_ => unreachable!()` habit needed) |
| `unsafe` | identical in spirit; Vela also requires a reason string |
| `no_std` | `profile = "sys"` |
| `#[repr(C)]`, `#[no_mangle]` | identical |
| `asm!` | `asm!` |
| `cargo` | `vela` |
| `macro_rules!` | `macro` (templates, not matchers) |
| procedural macros | `comptime` + `#[derive]` + build-time generators |
| `async`/`await` + Tokio | `async`/`await` with a runtime chosen by profile |
| `dyn Trait` | `box Trait` |
| `Clone`, `Copy` | `#[derive(Clone)]`; `Copy` is automatic for value types |

**No equivalent:** lifetimes, the borrow checker's full rule set, traits with
associated consts that depend on generic instantiation, zero-cost slices (the
`planned` item that would close the biggest gap).

Vela is a Rust-shaped language with a smaller rule set. Where Rust makes you
prove aliasing, Vela removes aliasing as a concept.

---

## 7. C

| C | Vela |
| --- | --- |
| `int x = 1;` | `mut x: Int32 = 1` |
| `#define N 10` | `const N = 10` |
| `struct`, `union`, `enum` | `#[repr(C)] struct`, `union`, `#[repr(u8)] enum` |
| `typedef` | `type Name = T` |
| `T *p` | `Ptr<T>` |
| `p->field`, `*p` | `p.field`? no — `unsafe { p.deref().field }` |
| `malloc`/`free` | `mem.alloc`/`mem.free`, or an `Allocator` |
| `memcpy` | `mem.copy` |
| `printf` | `print` / `fmt.format` |
| `null` | `Ptr.null()` |
| function pointers | `Func(...) -> T` |
| `volatile` | `Volatile<T>`, `mmio` blocks |
| `goto` | labelled `break`/`continue`, `loop`, `defer` |
| preprocessor | `#[cfg]`, `comptime`, `macro` |
| `#include` | `use` |
| bitfields | accessor functions (`E-FFI-010`) |
| variable-length arrays | `List<T>` with an allocator, or `Ptr` |
| implicitly-nullable pointers | `Ptr<T>` plus a check, or `T?` for real values |
| undefined behaviour | does not exist outside `unsafe` |

A C file and a Vela file differ mostly in the amount of ceremony that has moved
into the declaration: no separate header, no manual counting, no implicit
promotions, no macro hygiene problems.

---

## 8. C++

| C++ | Vela |
| --- | --- |
| `class` | `shared struct` + `impl` |
| constructor | `fn new(...)` returning the value |
| destructor | `impl Drop` |
| `virtual` | `box Trait` |
| `template` | generics |
| `template` + SFINAE | trait bounds, `where` |
| `std::vector` | `List<T>` |
| `std::map` / `unordered_map` | `Map<K,V>` (insertion-ordered, hashed) |
| `std::string` | `Str` |
| `std::unique_ptr` | `unique struct` |
| `std::shared_ptr` | `shared struct` |
| `std::optional` | `T?` |
| `std::variant` | `enum` with payloads; `match` |
| `std::function` | `Func(...) -> T` |
| `constexpr` | `comptime` |
| `noexcept` | every function: panics are not an exception channel |
| `operator+` | `impl Add` |
| `#include` / modules | `use` / `mod` |
| RAII | `defer` + `Drop` (same idea, both present) |
| move constructor | `unique` types move automatically |
| copy constructor | value types copy; shared types copy-on-write |
| multiple inheritance | traits + delegation |
| `auto` | `let` |
| `decltype`, `reinterpret_cast` | `typeOf` (comptime), `mem.transmute` inside `unsafe` |
| preprocessor metaprogramming | `comptime` + `macro` |
| C++20 concepts | trait bounds |
| exceptions | `Result` |
| `nullptr` | `Ptr.null()`; true absence is `T?` |

**No equivalent (deliberately):** multiple inheritance, template metaprogramming
as a separate language, undefined behaviour, header/implementation split.

---

## 9. Java and Kotlin

| Java / Kotlin | Vela |
| --- | --- |
| `class`, `new` | `shared struct`, literal construction |
| `extends`, `implements` | `impl Trait for T` |
| `interface`, default methods | `trait` |
| `abstract class` | `trait` with a required method |
| visibility modifiers | `pub`, `pub(package:)`, `private` |
| `final` | `let` |
| generics with erasure | monomorphised generics |
| checked exceptions | `Result` |
| `Optional<T>` | `T?` |
| `Stream` API | `iter` adapters |
| `synchronized` | `Mutex` |
| `volatile` (field) | `Atomic<T>` |
| `CompletableFuture` | `Task<T>` |
| Gradle / Maven | `vela.pkg` |
| annotations | `#[attribute]` |
| `data class` | `#[derive(Eq, Hash, Display, Clone)] struct` |
| `sealed class` | `enum` with payloads |
| reflections | `comptime` `Type.of` |
| JVM startup, GC pauses | native binary, RC + cycle collector |

Kotlin's `data class`, `sealed class` and smart-cast-on-`when` are the three
features Vela keeps the *behaviour* of, by way of `derive`, payload enums and
exhaustive `match`.

---

## 10. Go

| Go | Vela |
| --- | --- |
| `func f() error` | `fn f() -> Result<T, E>` |
| `if err != nil` × 40 | `?` |
| `struct`, methods on a receiver | `struct` + `impl` |
| `interface` (implicit) | `trait` (nominal, declared) |
| goroutines | `spawn` |
| `chan` | `Channel<T>` |
| `select` | `select` (same keyword) |
| `defer` | `defer` (same semantics) |
| `sync.Mutex` | `Mutex<T>` |
| `go.mod` | `vela.pkg` |
| `panic`/`recover` | `panic` (not recoverable by design) |

---

## 11. What Vela took from each

Named openly, because a language that pretends to have invented its parts is
either lying or unfamiliar with history:

| Feature | Came from |
| --- | --- |
| `defer` | Go |
| braces, `fn`, statement-oriented blocks | C, Rust |
| `match` with payload patterns | Rust, Swift, ML |
| `if let` / `guard let` | Swift |
| optionals (`T?`) | Swift, Kotlin |
| `Result` + `?` | Rust |
| copy-on-write values | Swift (`Array`), PHP, R |
| traits and impls | Rust |
| actors | Erlang, Swift |
| structured concurrency | Trio, Kotlin |
| `comptime` | Zig |
| hygiene-preserving macros | Scheme, Rust |
| the profile idea | Zig's build modes, Rust's `no_std`, Wuffs' dialects |
| style-as-types | taken from what CSS failed to be |

---

## 12. How to migrate a real project

1. **Identify the boundary.** An app is usually `app` + `core` (business logic);
   a site is `web` + `core`; firmware is `sys` + `core`.
2. **Move the data first.** Structs and enums are the part that makes the rest
   type-check; the migration of `struct`/`enum`/`trait` is nearly mechanical.
3. **Move the pure functions next.** They are the easiest to test, and they are
   the part where `strict` mode pays for itself immediately.
4. **Put the boundary behind `extern`.** A half-migrated project calls the old
   code through the FFI (doc 17), with `unwrap`-free wrappers, and the seam is
   visible in the source rather than hidden in a build script.
5. **Rewrite the UI last.** It is the part where the shape of the target matters
   most, and doc 13's style system is where most of the reduction in line count
   happens.

---

Back to the [index](README.md).
