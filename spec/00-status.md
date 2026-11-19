# Status: what exists, what is specified, what is planned

Three markers are used throughout the specification.

| Marker | Meaning |
| --- | --- |
| `impl` | Implemented by `velac` 0.1.0 and covered by `tests/cases`. |
| `spec` | Fully specified here. No compiler support. Implementable from the document alone. |
| `planned` | Sketched in the document; details may still change before implementation. |

This file is the single source of truth for the gap. If a document and this
table disagree, this table is right and the document has a bug.

---

## 1. What `velac` 0.1 actually accepts

The complete implemented language, exhaustively:

```
program     := decl*
decl        := fnDecl
fnDecl      := "fn" IDENT "(" params? ")" block
params      := IDENT ("," IDENT)*
block       := "{" stmt* "}"
stmt        := letStmt | mutStmt | assign | ifStmt | whileStmt | forStmt
             | returnStmt | breakStmt | continueStmt | exprStmt
letStmt     := "let" IDENT "=" expr
mutStmt     := "mut" IDENT "=" expr
assign      := IDENT ("=" | "+=" | "-=" | "*=" | "/=") expr
ifStmt      := "if" expr block ("else" (ifStmt | block))?
whileStmt   := "while" expr block
forStmt     := "for" IDENT "in" expr block
returnStmt  := "return" expr?
breakStmt   := "break"
continueStmt:= "continue"
exprStmt    := expr
```

Expressions: `nil`, numbers (f64 only), booleans, strings, lists, identifiers,
calls, `+ - * / %`, `== != < <= > >=`, `&& || !`, grouping. Function values exist
internally but cannot be stored or called from a variable.

Builtins: `print println len push at set str num type abs sqrt floor ceil range
assert error`.

Everything below is not implemented.

---

## 2. Status by area

### 2.1 Lexical structure — doc 01

| Feature | Status |
| --- | --- |
| `#` and `//` line comments | `impl` |
| `/* */` block comments | `spec` |
| Nested block comments | `spec` |
| `///` and `/** */` doc comments with doctests | `spec` |
| Integer literals, decimal | `impl` (as f64) |
| Integer literals `0x`, `0o`, `0b`, `_` separators | `spec` |
| Sized integer literals and suffixes (`1u8`, `1i64`, `1usize`) | `spec` |
| Float literals with exponent, `f32` suffix | `spec` |
| String interpolation `"${expr}"` | `spec` |
| Multi-line `"""` and raw `r"..."` strings | `spec` |
| `Char` literal `'a'` | `spec` |
| Unicode identifiers (XID) | `spec` |
| `#[attribute]` syntax | `spec` |
| Shebang `#!/usr/bin/env vela` | `planned` |

### 2.2 Types — doc 02

| Feature | Status |
| --- | --- |
| `Nil`, `Bool`, `Num`, `Str`, `List<T>` | `impl` (as dynamic `nil`/`bool`/`num`/`str`/`list`) |
| `Int`, `Float` as distinct types | `spec` |
| `Char`, `Bytes`, `Tuple`, `Range` | `spec` |
| `Map<K, V>`, `Set<T>` | `spec` |
| `Option<T>` / `T?` | `spec` |
| `Result<T, E>` | `spec` |
| `Func(...) -> T` as a first-class value | `spec` |
| `Ptr<T>`, `Volatile<T>`, `Opaque` | `spec` |
| `Task<T>`, `Channel<T>` | `spec` |
| Union types `A | B`, `Any` | `spec` |
| Generic type parameters | `spec` |
| Static checking (`strict` mode) | `spec` |
| Gradual checking (`loose` mode) | `impl` (no checker at all) |
| Structural equality/hashing declare rule | `spec` |
| Numeric tower `Int ⊂ Num`, no implicit narrowing | `spec` |

### 2.3 Expressions — doc 03

| Feature | Status |
| --- | --- |
| Arithmetic, comparison, logic, grouping | `impl` |
| Short-circuit `&&`, `||` | `impl` |
| Compound assignment | `impl` |
| `++`/`--` | never |
| Ranges `..<`, `..=` | `spec` |
| Indexing `xs[i]`, negative indices | `impl` (negative, via `at`) |
| Slices `xs[a..<b]` | `spec` |
| Member access `a.b` | `spec` |
| Method calls `a.b()` | `spec` |
| Optional chaining `a?.b`, `a?[0]` | `spec` |
| Nil coalescing `??`, `??=` | `spec` |
| Bitwise `& | ^ ~ << >>` | `spec` |
| Pipeline `|>` | `spec` |
| Spread `...xs` in list literals and calls | `spec` |
| Named arguments `f(n: 1)` | `spec` |
| Default parameter values | `spec` |
| Variadic parameters `...xs` | `spec` |
| Trailing closure `f { |x| ... }` | `spec` |
| Closures `|x| expr` with capture | `spec` |
| `match` expression with patterns, guards, binding | `spec` |
| `if` / `block` as expressions | `spec` |
| List comprehensions `[f(x) for x in xs if p(x)]` | `spec` |
| Struct literal `Point { x: 1 }` | `spec` |
| Enum variant construction and matching | `spec` |
| `await`, `spawn` expressions | `spec` |
| `try`/`catch` as expression | `spec` |
| `comptime` expression | `spec` |
| `unsafe { }` block expression | `spec` |
| `typeOf(x)` and reflection over types | `spec` |
| Operator overloading via `impl` | `spec` |

### 2.4 Statements — doc 04

| Feature | Status |
| --- | --- |
| `let`, `mut`, assignment | `impl` |
| `if`/`else if`/`else` | `impl` |
| `while` | `impl` |
| `for x in xs` | `impl` |
| `break`, `continue` | `impl` |
| `return` with and without value | `impl` |
| `loop { }` with `break value` | `spec` |
| Labelled loops `outer: for` and `break outer` | `spec` |
| `for` over ranges, strings, maps, iterators, channels | `spec` |
| `defer` (LIFO, per scope) | `spec` |
| `guard cond else { }` | `spec` |
| `with` resource binding (auto-close) | `spec` |
| `fail expr` (early `Err` return) | `spec` |
| Multiple binding `let (a, b) = pair` | `spec` |
| Destructuring in `for` and `match` | `spec` |
| `const` (compile-time constant) | `spec` |
| `static` (module-level storage) | `spec` |
| Unreachable-code and unreachable-pattern checks | `spec` |

### 2.5 Functions — doc 05

| Feature | Status |
| --- | --- |
| Top-level `fn`, recursion, forward calls | `impl` |
| Nested functions | `spec` |
| Closures and first-class functions | `spec` |
| Default, named, variadic parameters | `spec` |
| Generic functions | `spec` |
| `async fn` | `spec` |
| `fn` values called through variables | `spec` |
| Methods in `impl` | `spec` |
| Function overloading (trait methods only) | `spec` |
| Tail-call optimisation guarantee in `sys` | `spec` |
| Multiple return via tuple | `spec` |
| `must_use` results | `spec` |

### 2.6 Data — doc 06

| Feature | Status |
| --- | --- |
| `struct` (value type) | `spec` |
| `shared struct` (reference type) | `spec` |
| `enum` with payloads | `spec` |
| `trait` and `impl Trait for Type` | `spec` |
| `interface` (foreign-bridged type) | `spec` |
| Default trait methods | `spec` |
| Generator methods (`yield`) | `spec` |
| `extension` for foreign types | `spec` |
| Operator methods | `spec` |
| `Drop` / destructors | `spec` |
| `#[derive]` conformance | `spec` |
| Inheritance | never (traits + delegation only) |
| Reflection over fields at runtime | `spec` (loose), `planned` (strict) |

### 2.7 Generics — doc 07

| Feature | Status |
| --- | --- |
| Type parameters on functions, structs, enums, traits | `spec` |
| Bounds `T: Trait + Trait` | `spec` |
| `where` clauses | `spec` |
| Associated types | `spec` |
| Generic impls | `spec` |
| Monomorphisation semantics and code-size control | `spec` |
| Variance for shared collections | `spec` |
| Higher-kinded types | never |
| Lifetime parameters | never (GC and CoW instead) |

### 2.8 Modules and packages — doc 08

| Feature | Status |
| --- | --- |
| `mod` with bodies and file modules | `spec` |
| `pub`, `pub(crate)`, `pub(in path)` | `spec` |
| `use` with groups and `as` | `spec` |
| `vela.pkg` manifest | `spec` |
| Dependency resolution and `vela.lock` | `planned` |
| Feature flags | `spec` |
| `#[cfg(target, profile, feature, os, arch)]` | `spec` |
| Conditional dependency by target | `spec` |
| Workspaces | `planned` |
| Registry (`registry.vela.dev`) | `planned` |
| Vendoring and offline mode | `spec` |
| Precompiled binary modules | `planned` |

### 2.9 Memory — doc 09

| Feature | Status |
| --- | --- |
| Reference counting | `spec` |
| Cycle collector | `spec` |
| Copy-on-write for `List`, `Str`, `Map`, `Set`, `Bytes` | `spec` |
| `unique` move semantics | `spec` |
| `Drop` ordering, `defer` interaction | `spec` |
| `Ptr<T>` and `unsafe` dereference | `spec` |
| Custom `Allocator` trait | `spec` |
| Scoped arenas | `spec` |
| `global_allocator` | `spec` |
| Deterministic allocation in `sys` | `spec` |
| Escape analysis (stack allocation) | `planned` |
| Garbage collection (never freed) | `impl` — 0.1 leaks by design |

### 2.10 Concurrency — doc 10

| Feature | Status |
| --- | --- |
| `async fn`, `await` | `spec` |
| `spawn` and `Task<T>` | `spec` |
| Structured concurrency (`TaskGroup`, cancellation) | `spec` |
| `Channel<T>` bounded and unbounded | `spec` |
| `select { }` | `spec` |
| `actor` and `send` | `spec` |
| `Atomic<T>`, `Mutex<T>`, `RwLock<T>`, `Once` | `spec` |
| `parallel for` | `spec` |
| `Send`/`Share` checking | `spec` |
| OS threads (`core` profile) | `spec` |
| Green-thread scheduler in runtime | `planned` |
| Multi-threaded GC | `planned` |

### 2.11 Errors — doc 11

| Feature | Status |
| --- | --- |
| `Result<T, E>`, `Option<T>` | `spec` |
| `?` propagation with conversion | `spec` |
| `try`/`catch` sugar, `catch e { }` | `spec` |
| `panic`, `assert`, `assertEq` | `impl` (`assert` only, as `assert` builtin) |
| `error(msg)` runtime abort | `impl` |
| `defer` unwinding | `spec` |
| Panic handler customisation (`sys`) | `spec` |
| Error context chaining (`.context(..)`) | `spec` |
| Exceptions | never |

### 2.12 Metaprogramming — doc 12

| Feature | Status |
| --- | --- |
| `comptime` blocks and constant folding | `spec` |
| `comptime fn` | `spec` |
| Hygienic template macros | `spec` |
| `#[derive(Eq, Ord, Hash, Display, Debug, Clone, Default, Json, Builder)]` | `spec` |
| Attribute list (59 attributes) | `spec` |
| `#[test]` and doc tests | `spec` |
| Compile-time reflection (`Type.of`) | `spec` |
| Runtime reflection (`vela.meta`) | `spec` (loose), `planned` (strict) |
| Procedural macros as Vela programs | `planned` |
| `eval` of strings at runtime | never |

### 2.13 UI and styling — doc 13

This is the replacement for SwiftUI, UIKit, HTML and CSS.

| Feature | Status |
| --- | --- |
| `view` declarations with typed props | `spec` |
| `state`, `bind`, `env`, `computed` | `spec` |
| Elements: `column`, `row`, `grid`, `zstack`, `scroll`, `canvas`, `text`, `button`, `image`, `field` | `spec` |
| `style` declarations with 214 typed properties | `spec` |
| Style composition, `extend`, per-instance override | `spec` |
| States `when .hover / .pressed / .focused / .disabled / .selected` | `spec` |
| Container/window queries `@when width < 600dp` | `spec` |
| Theming with `theme`, tokens, system light/dark | `spec` |
| Animation `animate`, `transition`, `keyframes`, springs | `spec` |
| Reduced-motion automatic fallback | `spec` |
| Accessibility annotations, required for interactive nodes in strict | `spec` |
| Assets `asset`, image variants, fonts | `spec` |
| Gestures, drag and drop, haptics | `spec` |
| Navigation stack and declarative routes | `spec` |
| 2D canvas painting | `spec` |
| GPU shaders | `planned` |
| Android backend | `planned` |
| Native CSS output (no CSS strings written by hand) | `spec` |

### 2.14 Web — doc 14

| Feature | Status |
| --- | --- |
| `page` and `component` | `spec` |
| DOM event handlers | `spec` |
| Compile to WASM + DOM | `spec` |
| Static site generation | `spec` |
| Responsive `@route`, dynamic segments, layouts | `spec` |
| SSR server (`http`) | `spec` |
| Hydration, islands | `spec` |
| `Markup` escaping by construction | `spec` |
| `fetch`, `WebSocket`, `storage`, `worker`, `history`, `clipboard` | `spec` |
| Sessions, CSRF, CSP helper | `spec` |
| Streaming responses | `planned` |
| Service workers | `planned` |
| Direct JS interop (`extern "js"`) | `spec` |

### 2.15 Systems — doc 15

| Feature | Status |
| --- | --- |
| Freestanding target and `#[entry]` | `spec` |
| `#[panic_handler]` | `spec` |
| `core`-only subset (no heap, no OS) | `spec` |
| `Ptr<T>` arithmetic, `unsafe` | `spec` |
| `volatile` reads/writes | `spec` |
| `mmio` register blocks | `spec` |
| `asm!` inline assembly | `spec` |
| `interrupt fn` | `spec` |
| `extern "c"` and linking | `spec` |
| Linker script support (`.ld`) | `spec` |
| Custom allocators, no global heap | `spec` |
| `#[repr(C/Packed/Align)]` | `spec` |
| `#[naked]`, `#[no_mangle]`, `#[link_section]` | `spec` |
| Syscall declarations | `spec` |
| `#[boot]` entry for kernels | `spec` |
| Multi-arch (x86_64, aarch64, riscv64) | `planned` |
| Self-hosting (`velac` written in Vela) | `planned` |

### 2.16 Standard library — doc 16

40 modules, all `spec`. Only the 15 builtins listed in §1 are `impl`.

### 2.17 FFI — doc 17

| Feature | Status |
| --- | --- |
| `extern "c"` declarations and definitions | `spec` |
| `#[repr(C)]` structs across the boundary | `spec` |
| Vela callback into C | `spec` |
| `extern "swift"` / `#[objc]` | `planned` |
| `extern "js"` | `spec` |
| `extern "python"` | `planned` |
| `extern "wasm"` | `spec` |
| Header generation from Vela | `planned` |
| Binding generation from C headers | `planned` |

---

## 3. The gap, in one paragraph

The compiler today is a 1,700-line single-pass lowering to C, and it implements
the subset in §1: 14 keywords, 6 value types, 15 builtins, no types, no
closures, no structs, no modules, no borrow or ownership checking, no memory
management, no UI and no web. This specification describes a language roughly
one hundred times that size in surface area: 60 reserved keywords, 24 types, 48
operators, 40 standard library modules, 18 declaration forms, 214 style
properties and four profiles. The distance between the two is the roadmap, and
it is large on purpose — a language that can build an operating system and a
styled website cannot be a weekend project, and pretending otherwise would be
the only dishonest thing in this repository.

---

## 4. Conformance test suite

`spec/conformance/` will hold one directory per feature, each with:

```
conformance/<area>/<feature>/
  pass/*.vela        # MUST compile, and print the contents of expected.txt
  fail/*.vela        # MUST be rejected with the listed diagnostic code
  expected.txt
  error.txt
```

The diagnostic codes referenced by `error.txt` are defined in each document
(`E-TYPE-004`, `E-MEM-011`, …). A compiler reporting a different code has not
conformed. The suite does not exist yet; it is the first artifact a second
compiler implementation should produce, because it is the only thing that makes
"conformance" mean something.
