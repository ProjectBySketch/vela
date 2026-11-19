# 17 — Foreign function interface

**Status:** `spec` for C, JS and WASM; `planned` for Swift/Objective-C and Python.

The FFI is where memory safety ends, so it is designed to make the boundary
visible and narrow: every foreign call is inside `unsafe`, every type crossing is
`#[repr(C)]` by construction, and every string crossing is explicit about who
owns it.

---

## 1. Four kinds of statement

| Statement | Meaning |
| --- | --- |
| `extern "c" fn f(...) -> T` | **import**: `f` exists elsewhere and is linked |
| `export "c" fn f(...)` | **export**: `f` is visible to the foreign side |
| `interface Name { ... }` | a foreign *type* with methods (doc 06 §10) |
| `extern "lang" { ... }` | a block of imports from a non-C runtime |

---

## 2. C

### 2.1 Importing

```vela
extern "c" fn strlen(s: Ptr<UInt8>) -> UIntSize
extern "c" fn malloc(n: UIntSize) -> Ptr<UInt8>
extern "c" fn free(p: Ptr<UInt8>)
extern "c" fn printf(fmt: Ptr<UInt8>, ...) -> Int

#[link(name: "curl")]
extern "c" {
  fn curl_easy_init() -> Ptr<Opaque>
  fn curl_easy_setopt(h: Ptr<Opaque>, option: Int, ...) -> Int
  fn curl_easy_perform(h: Ptr<Opaque>) -> Int
  fn curl_easy_cleanup(h: Ptr<Opaque>)
}
```

* `#[link(name: "curl")]` on an `extern` block adds `-lcurl`.
* `#[link(name: "x", kind: "static" | "framework")]` selects a static library or
  a framework (Apple).
* `#[link_args("-flat_namespace")]` for the rare flag.
* Calling any `extern` function is `unsafe` (doc 09 §7) and the call site writes a
  reason string.

### 2.2 Type mapping

| C | Vela |
| --- | --- |
| `void` | `Void` |
| `_Bool` / `bool` | `Bool` (a `UInt8` in the ABI) |
| `char` | `Char` |
| `int8_t` … `int64_t` | `Int8` … `Int64` |
| `uint8_t` … `uint64_t` | `UInt8` … `UInt64` |
| `size_t` / `ssize_t` | `UIntSize` / `IntSize` |
| `int` / `long` | `Int32` / `Int` (**not** `Int`; the width is the point) |
| `float` / `double` | `Float32` / `Float` |
| `T *` | `Ptr<T>` |
| `const char *` | `Ptr<UInt8>` (a `Str` is not NUL-terminated and does not carry a lifetime) |
| `struct S *` | `Ptr<S>` where `S` is `#[repr(C)]` |
| `void *` | `Ptr<Opaque>` |
| `enum` | `#[repr(u32)] enum` |
| function pointer | `Func(...) -> T` with `#[cdecl]` |
| `union` | `#[repr(C)] union` (field access needs `unsafe`) |
| bitfield | not supported; use accessor functions (`E-FFI-010` explains) |

### 2.3 Strings across the boundary

There is no automatic conversion, because there are three reasonable conventions
and guessing between them is how security bugs happen.

```vela
// C wants a NUL-terminated string
unsafe {
  let cstr = str.toCStr("hello")            // allocates, caller frees with cstr.free()
  defer cstr.free()
  puts(cstr.ptr())
}

// C returns one we must copy and not free
unsafe {
  let p = getenv(Ptr.fromAddr(0))            // returns const char*
  let s = str.fromCStr(p)?                   // copies into a Vela Str
}
```

| Helper | Direction | Ownership |
| --- | --- | --- |
| `str.toCStr(s)` | Vela → C | Vela allocates, Vela frees |
| `str.fromCStr(p)` | C → Vela | copies; the C memory is untouched |
| `bytes.toString(bytes)` | Vela → Vela | fallible UTF-8 validation |
| `cstr.copyOut(p, maxLen)` | C → Vela | bounded copy, no NUL scan past `maxLen` |

### 2.4 Structs

```vela
#[repr(C)]
struct timespec {
  tv_sec: Int64
  tv_nsec: Int64
}

#[repr(C, packed)]
struct Packet {
  kind: UInt16
  len: UInt16
  payload: [UInt8; 60]
}
```

A `#[repr(C)]` struct is layout-compatible with the C declaration: fields in
order, C alignment, C padding. The compiler will not reorder fields, and
`mem.sizeOf::<T>()` equals `sizeof(T)` on the C side of the same target — a
conformance test checks this for every struct in `spec/conformance/ffi`.

### 2.5 Exporting to C

```vela
export "c" fn vela_add(a: Int32, b: Int32) -> Int32 { a + b }

export "c" #[no_mangle] fn vela_init() -> Bool {
  init() catch { false }
}
```

`export "c"` generates a C ABI function with the given name. Every parameter and
return type must be C-representable (`E-FFI-020` otherwise). Exported functions may
be called from any thread, so their body must be `Send`-checked.

### 2.6 Callbacks into Vela

```vela
extern "c" fn qsort(base: Ptr<Opaque>, n: UIntSize, size: UIntSize,
                    cmp: Func(Ptr<Opaque>, Ptr<Opaque>) -> Int)

unsafe {
  let f: Func(Ptr<Opaque>, Ptr<Opaque>) -> Int = |a, b| {
    let x = a.cast::<Int>().read()
    let y = b.cast::<Int>().read()
    cmp.compare(x, y).asInt()
  }
  qsort(base, len, mem.sizeOf::<Int>(), f)
}
```

* A Vela closure passed as a C function pointer is boxed and given a generated
  trampoline. It is valid only for the duration of the call unless the C side
  documents that it stores it, in which case the parameter type is
  `Func(...) -> T` with `#[stored]` and the closure is promoted to a leaked one
  (`E-FFI-030` warns).
* Panicking across a C frame is forbidden; an unwinding panic at an `export` is
  converted into an abort with the message (`E-FFI-040`) unless the function is
  declared `#["c", unwind]`.

---

## 3. Swift and Objective-C

**Status:** `spec`.

```vela
extern "swift" module Foundation {
  class NSString {
    fn length(self) -> IntSize
    fn uppercased(self) -> NSString
  }
}

#[objc(name: "VELAWidget")]
shared struct Widget { ... }
```

Design intent, stated so it can be reviewed:

* `extern "swift" module X { ... }` names a Swift module and extracts its public
  interface (via `swift-symbolgraph-extract` at build time) into an `interface`
  tree that type-checks normally.
* `#[objc(name:)]` gives a Vela type an Objective-C name, so a Vela view can be
  handed to UIKit code and a Vela class can be a delegate.
* ARC interop: a Vela `shared struct` bridged to Objective-C is `__strong` while
  Vela holds a reference; a `weak` Vela reference becomes `__weak`.
* `@protocol` conformance is `impl Trait for Type` where the trait came from an
  `extern "swift"` block.

This is the bridge that makes doc 13's `app` profile a real iOS app rather than a
look-alike: the generated UI uses UIKit/SwiftUI through exactly this mechanism.

### 3.1 The Objective-C runtime, precisely

A Vela type marked `#[objc]` is emitted as a real Objective-C class, not a proxy:

| Vela | Objective-C |
| --- | --- |
| `#[objc(name: "VELAWidget")] shared struct W` | `@interface VELAWidget : NSObject` |
| `impl W { fn title(self) -> Str }` | `- (NSString *)title` |
| `impl W { fn setTitle(mut self, s: Str) }` | `- (void)setTitle:(NSString *)s` |
| `static fn make() -> W` | `+ (VELAWidget *)make` |
| `impl SomeObjCProtocol for W { }` | `<SomeObjCProtocol>` conformance, methods generated from the protocol |
| an enum with `#[repr(i32)]` | `NS_ENUM` |
| a `struct` with `#[repr(C)]` | a C struct usable from Objective-C |

Rules:

* Method names are camel-cased at the boundary (`setTitle` → `setTitle:`), and a
  Vela method whose Vela name contains `:` maps to a multi-part selector
  (`insert(at:)`), so a protocol requirement is satisfiable without a shim.
* Retain/release is ARC on both sides: a `shared struct` passed to Objective-C is
  retained for the duration of the call and released after; a `weak` field is a
  weak reference. A cycle between a Vela object and an Objective-C object is
  collected by neither, which is why `#[objc]` types may declare `weak` fields and
  why `vela check --lint` warns on a strong back-reference (`W-FFI-020`).
* Delegates: `delegate.assign(obj)` chooses a weak reference, because that is what
  `delegate` means in Cocoa and getting it wrong is the classic leak.
* KVC/KVO are **not** supported: observing a Vela object from Objective-C is done
  through a protocol callback, not string keys.
* Swizzling, method resolution at run time and `forwardInvocation:` are not
  exposed. A program that needs them drops into `extern "c"` and `unsafe`.

---

## 3.2 C++

**Status:** `spec` for the `extern "cxx"` surface; template interop is `planned`.

Calling C++ needs a stable ABI, and C++ has none, so the design is explicit:

```vela
extern "cxx" class Widget {
  fn new(name: Str) -> Widget
  fn setSize(mut self, w: Float, h: Float)
  fn render(self) -> Void
}
```

* `extern "cxx" class` declares an opaque C++ class; Vela code creates it with the
  declared factory, calls methods through a generated C shim, and drops it with
  the class's destructor. The shim is generated, `extern "C"`, and compiled by the
  project's C++ compiler.
* A Vela `struct` with `#[repr(C)]` can be passed by value or pointer to C++.
* A C++ callback into Vela is a `Func(...) -> T` parameter with `#[cdecl]`.
* Templates are not instantiated from Vela: a C++ template that matters is wrapped
  in a concrete class in C++ and declared here. That is `planned` to change with a
  generator that reads a header and emits the instantiations the program uses.
* Exceptions never cross the boundary: a C++ function declared here must be
  `noexcept` (or wrapped), because a C++ exception unwinding into a Vela frame is
  undefined. `#[cxx(throws: true)]` wraps it in a `try/catch` in the shim and
  returns a `Result` instead.
* The standard library is not exposed; a C++ library is a dependency, and the
  project's `vela.pkg` records the extra `-lstdc++` link.

A C++ codebase is therefore usable in two ways: through a hand-written C API (doc
17 §2, always available), or through `extern "cxx"` with the generated shim (less
work, one more build step).

---

## 4. JavaScript

```vela
extern "js" {
  fn console.log(msg: Str)
  fn JSON.stringify(value: Any) -> Str
  fn setTimeout(fn: Func() -> Void, ms: Float) -> Int
}

extern "js" module "lodash" {
  fn debounce(fn: Func(...Any) -> Void, ms: Int) -> Func(...Any) -> Void
}
```

* `extern "js"` is available in the `web` profile only.
* Calls compile to WASM imports; the JS shim is generated by the compiler, not
  written by hand.
* Types must be JS-representable: `Str` → string, `Float` → number, `Bool` →
  boolean, `nil` → null, `List<T>` → array, `Map<Str, T>` → object, `Func` →
  function. A struct without `#[derive(Json)]` is `E-FFI-050`.
* A JS function returning a promise declared as `async fn` becomes awaitable:
  the compiler inserts `await` on the JS side.
* An object from JS is an `Opaque`; `web.dom` is a typed wrapper over exactly
  this mechanism.

---

## 5. Python

**Status:** `planned`.

The intended shape is the CPython C API plus a generator that reads a Python
module's stubs:

```vela
extern "python" module numpy {
  fn array(data: List<Float>) -> Opaque
}
```

Vela is not going to embed CPython in its own runtime; the target is calling
Python *from* a Vela `core` program that has decided to link libpython, which is
what a migration from a Python script needs.

---

## 6. WASM

```vela
#[export]
fn compute(n: Int) -> Int { ... }

extern "wasm" module "env" {
  fn log(ptr: Ptr<UInt8>, len: UIntSize)
}
```

* `#[export]` puts a function in the module's export table.
* `extern "wasm"` imports from a named module.
* Memory is the linear memory; `Ptr<T>` is an offset in it, and `sys`'s page
  functions map onto `memory.grow`.
* A `String` crosses as (ptr, len) and the receiving side copies — never as a
  borrowed view, because the collector may move memory.

---

## 7. Safety rules at the boundary

Five rules, and every one of them exists because of a bug that shipped somewhere:

1. **A foreign pointer is never a Vela reference.** It is a `Ptr<T>`, it is
   nullable by convention, and reading it is `unsafe`.
2. **Lengths travel with pointers.** Any API that takes a buffer takes
   `(ptr, len)`; an unbounded `strlen` on untrusted input is not expressible
   through the standard helpers.
3. **Ownership is stated.** A function returning a pointer documents one of:
   `owned` (caller frees), `borrowed` (valid for the call), `static` (never
   freed). The Vela declaration carries it: `-> owned Ptr<T>`,
   `-> borrowed Ptr<T>`, `-> static Ptr<T>`. A missing annotation is `E-FFI-060`.
4. **No Vela allocation while a foreign lock is held.** The compiler cannot know,
   so this is a documented obligation; `#[noAlloc]` on a function enforces it.
5. **Errors become `Result`.** A C function returning `-1` with `errno` is
   wrapped once, in a Vela function, and the rest of the program sees
   `Result<T, IoError>`.

```vela
fn curlGet(url: Str) -> Result<Bytes, CurlError> {
  unsafe {
    let h = curl_easy_init()
    guard not h.isNull() else { fail CurlError.init }
    defer curl_easy_cleanup(h)

    let cstr = str.toCStr(url)
    defer cstr.free()

    if curl_easy_setopt(h, CURL_URL, cstr.ptr()) != 0 { fail CurlError.setopt }
    if curl_easy_perform(h) != 0 { fail CurlError.perform }

    Ok(readBuffer(h))
  }
}
```

That function is the whole FFI pattern: one `unsafe` block, `defer` for every
resource, `Result` at the edge, and nothing foreign escapes into the rest of the
program.

---

## 8. Generating bindings

| Direction | Tool | Status |
| --- | --- | --- |
| C header → Vela declarations | `vela bindgen --header foo.h --out foo.vela` | `planned` |
| Vela `export "c"` → C header | `vela build --emit-header foo.h` | `planned` |
| Swift module → Vela interface | `vela bindgen --swift Foundation` | `planned` |
| Vela → `.d.ts` for JS consumers | `vela build --emit-types` | `planned` |

Generated bindings are ordinary Vela files, committed and reviewable, with a
header saying which tool and which version produced them. The generator is a
Vela program (`vela bindgen` is written in Vela), which is the reason
`profile = "core"` exists.

---

## 9. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-FFI-010` | unsupported C construct (bitfield, VLA) |
| `E-FFI-020` | type not C-representable in an `export "c"` |
| `E-FFI-030` | callback stored by the foreign side without `#[stored]` |
| `E-FFI-040` | panic across a foreign frame |
| `E-FFI-050` | non-JS-representable type in `extern "js"` |
| `E-FFI-060` | pointer return without an ownership annotation |
| `E-FFI-070` | `repr(C)` struct with a non-`repr(C)` field |
| `E-FFI-080` | `extern` call outside `unsafe` |
| `W-FFI-010` | `extern` declaration with no link attribute (may fail at link time) |

---

Next: [18-grammar.md](18-grammar.md).
