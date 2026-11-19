# 26 — ABI, layout and binary interface

**Status:** `spec`. Normative for anything that crosses a binary boundary: FFI,
plugins, dynamic libraries, serialised records and persisted data.

A Vela program that never crosses a process or library boundary does not care
about this document. Everything that does — an FFI struct, a plugin ABI, a file
format, a network protocol — needs it to be written down, and it is.

---

## 1. Layout rules

### 1.1 Default (`#[repr(Vela)]`)

* Fields are laid out **in declaration order**, each aligned to its own
  alignment, with the struct aligned to its widest field. No reordering, ever.
* This is the same rule as `#[repr(C)]` except that enums with payloads are
  permitted and the tag is a `UInt32` by default.
* Padding bytes are unspecified; a program must never rely on their value.

```vela
struct Header {
  version: UInt8
  kind: UInt16
  length: UInt32
}
# offsets: version 0, kind 2, length 4, size 8, align 4
```

### 7.1 `#[repr(C)]`

Exactly the C ABI for the target: field order preserved, C alignment rules, no
reordering, no packing unless asked. This is the layout every FFI struct uses and
the one `mem.sizeOf` reports.

### 7.2 `#[repr(packed)]`, `#[repr(align(n))]`, `#[repr(transparent)]`

* `packed`: no padding; every field access compiles to an unaligned load, which
  is legal but slower, and taking a reference to a field is `E-ABI-010`.
* `align(n)`: raises the struct's alignment to `n` (power of two, ≥ natural).
* `transparent`: a one-field wrapper with the field's layout, for newtypes that
  must pass as the underlying type across the boundary.

### 7.3 Enums

| Form | Layout |
| --- | --- |
| no payloads, no `repr` | `UInt32` discriminant, values as declared |
| `#[repr(u8/i8/…)]` | the given integer, no payloads |
| with payloads | tag (`UInt32` by default, or the `repr` integer) then the payload area, aligned to the widest variant |
| `Option<T>` for a pointer-like `T` | the null-pointer optimisation: same size as `T` |
| `Option<Bool>` | one byte: `0` = nil, `1` = false, `2` = true |

The last two are guaranteed because they are what makes `T?` free in a struct that
crosses an FFI boundary.

### 7.4 Unions

`unsafe` field access, size = widest field rounded up to alignment, alignment =
widest. A union is the only type where reading an inactive field is defined (it
reads the bits), and it is why it needs `unsafe`.

---

## 2. Size and alignment, guaranteed

| Type | Size (x86_64 / aarch64 / wasm32) |
| --- | --- |
| `Bool` | 1 |
| `UInt8`/`Int8` | 1 |
| `UInt16`/`Int16` | 2 |
| `UInt32`/`Int32`, `Float32`, `Char` | 4 |
| `UInt64`/`Int64`, `Float`, `Instant` | 8 |
| `UIntSize`/`IntSize`, `Ptr<T>`, `Func`, `Str`, `List<T>`, `Map`, box | 8 / 8 / 4 |
| `Str`, `List<T>`, `Map`, `Set`, `Bytes` | three words (ptr, len, capacity) — see §3 |
| `()` | 1 (as a field), 0 (as a type argument count) |

`comptime` can assert these:

```vela
comptime {
  assert(mem.sizeOf::<Header>() == 8)
  assert(mem.alignOf::<Header>() == 4)
}
```

The assertion runs at compile time on the **target**, so a 32-bit build fails the
check instead of producing a wrong binary at run time.

---

## 3. Shared value representation

A `Str`, `List<T>`, `Map<K,V>`, `Set<T>` and `Bytes` is a header of three words:

```
ptr   pointer to the first element
len   number of elements (not bytes, except for Bytes and Str)
cap   number of elements allocated, or 0 for a borrowed/static value
```

The allocator's block sits **before** `ptr` and holds the reference count. This
means:

* passing a shared value costs 24 bytes and one increment, never a copy;
* a slice (`xs[a..<b]`) is either a copy (default) or, `planned`, a borrowed
  header with `cap = 0`;
* a string literal is a header pointing into `.rodata` with `cap = 0`, which is
  why a literal costs no allocation.

The layout is not stable across editions and must not be relied on outside the
standard library (`E-ABI-020` if a `#[repr(C)]` struct contains a shared field).

---

## 4. Calling convention

| Situation | Convention |
| --- | --- |
| Vela → Vela | private to the compiler; may change per release |
| `extern "c"` / `export "c"` | the target's C ABI (System V on x86_64 Linux, AAPCS64, Win64 if a target ever appears) |
| `extern "swift"` | Swift's own convention |
| `extern "js"` | WASM imports with `(ptr, len)` for strings |
| Plugins | the stable Vela plugin ABI (§6) |

What the plugin ABI fixes, and the Vela-to-Vela convention does not:

* how a `Str` is passed (a header by value, never a NUL-terminated pointer),
* how an error crosses (`Result` returned as a two-word struct: tag + payload),
* how a panic crosses (never — a panic at a plugin boundary aborts with a message),
* how a callback is passed (a `Func` value, which the host may call while the call
  is on the stack unless it was declared `#[stored]`).

---

## 5. Symbol names

`velac` mangles Vela names for its own use:

```
<module path>::<name>          ->  $<len>_<path>_<name>
List<Int>::push                ->  $12_std_list_List$Int$push
```

The scheme is: `$`, the length of the last segment in decimal, `_`, the path with
`::` replaced by `_`, type arguments between `$`, and the member name. It is
injective, it sorts predictably for reproducible builds, and it never produces an
identifier that a C symbol clashes with.

* `#[no_mangle]` uses the declared name verbatim and is `unsafe`-adjacent: two
  modules declaring the same one is `E-ABI-030`.
* A symbol's visibility defaults to the module; `pub` makes it external for a
  dynamic library, and `--emit symbol-map` writes a JSON map for a profiler or a
  crash reporter.
* Generic instantiations carry their type arguments, so a demangler can print
  `List<Int>::push` back from a stack trace.

---

## 6. Plugin ABI

A plugin is a dynamic library with one exported symbol:

```vela
// plugin
#[plugin]
fn init(host: PluginHost) -> Plugin {
  Plugin {
    name: "acme.metrics",
    version: (1, 2, 0),
    capabilities: [.network],
    hooks: { "onRequest": |req| metricsOnRequest(req) },
  }
}

// host
with plugin = try plugins.load("libacme_metrics.so")?
    if plugin.capabilities.contains(.network) {
  log.info("plugin ${plugin.name} loaded")
}
```

Stability rules:

* The plugin ABI is versioned (`PLUGIN_ABI = 3`); a host refuses a plugin with a
  different major version (`E-ABI-040`) instead of crashing.
* A plugin gets only the capabilities it declared, enforced by doc 24 §8.
* A panic in a plugin is caught at the boundary and reported with the plugin's
  name; the host keeps running.
* A plugin may not be loaded in `web` or `sys`.
* The ABI's types are a fixed subset: primitives, `Str`, `Bytes`, `List<T>` of
  those, `Result`, and `Func` values. A `struct` crosses only if it is
  `#[repr(plugin)]` and every field is in the subset (`E-ABI-050`).

---

## 7. Persisted and wire formats

The same layout rules make a binary format cheap:

```vela
#[derive(Binary)]
#[repr(C)]
struct Record {
  id: UInt64
  flags: UInt16
  score: Float32
}
```

`#[derive(Binary)]` (planned) gives `encode`/`decode` that write exactly the
struct's layout in little-endian (or `endian: .network`), with no field names, no
padding and no ambiguity. Combined with `comptime` size checks, a file format or a
packet is a struct plus a version field.

For a format that must survive a compiler change, an edition pin is required:

```vela
#[stable(since: "2026", layout: 1)]
#[repr(C)]
struct Record { ... }
```

A change to a `#[stable]` struct's layout is `E-ABI-060` — the compiler refuses to
silently break a format someone stored on disk.

---

## 8. Reproducible binaries

`vela build --release` is reproducible: the same source, manifest and compiler
produce a byte-identical artifact, except for a build-id the toolchain records
separately.

| Source of nondeterminism | Handling |
| --- | --- |
| hash map iteration | insertion order, always |
| symbol order | sorted by mangled name |
| timestamps | none in the output; `SOURCE_DATE_EPOCH` honoured for archives |
| absolute paths | relative or remapped via `--remap-path-prefix` |
| generic instantiation order | discovery order, which is source order |
| parallelism | results merged deterministically |

`vela build --verify-repro` builds twice and compares.

---

## 9. What is deliberately not stable

| Thing | Policy |
| --- | --- |
| internal calling convention | may change every release |
| shared-value header | stable within an edition only |
| symbol mangling | stable within an edition only |
| debug info format | DWARF 5, no promise on the exact producer strings |
| build directory layout | not a contract; use `--emit` for artifacts |
| `.vela/cache` contents | never a contract |

Everything else in this document is part of the edition, and a change to it needs
an RFC (doc [rfc/](rfc/README.md)).

---

## 10. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-ABI-010` | reference to a field of a packed struct |
| `E-ABI-020` | shared value inside a `#[repr(C)]` struct |
| `E-ABI-030` | duplicate `#[no_mangle]` symbol |
| `E-ABI-040` | plugin ABI version mismatch |
| `E-ABI-050` | type outside the plugin ABI subset |
| `E-ABI-060` | layout change in a `#[stable]` struct |
| `W-ABI-010` | `#[repr(packed)]` without a comment explaining why |

---

Next: [27-performance.md](27-performance.md).
