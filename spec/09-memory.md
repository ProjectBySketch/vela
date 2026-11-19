# 09 — Memory model

**Status:** `spec`. `velac` 0.1 allocates and never frees.

This document explains the single most consequential design choice in Vela: it
has **no borrow checker and no tracing garbage collector**. Instead it combines
four mechanisms whose costs are individually visible.

| Mechanism | Applies to | Cost |
| --- | --- | --- |
| Value copy | primitives, `struct` | the size of the value |
| Reference counting + copy-on-write | `Str`, `List`, `Map`, `Set`, `Bytes`, closures, `shared struct` | one increment/decrement, a copy on mutation of a shared value |
| Cycle collection | `shared struct` graphs | amortised sweep when allocation pressure says so |
| Explicit `unsafe` | `Ptr<T>` in `sys` | nothing — you manage it |

---

## 1. Value categories

Every type is in exactly one category.

| Category | Types | Assignment | Mutation |
| --- | --- | --- | --- |
| **Copy** | `Int*`, `UInt*`, `Float*`, `Bool`, `Char`, `Nil`, `enum` without payloads, `struct` all of whose fields are Copy | bit copy | only through a `mut` binding |
| **Shared** | `Str`, `List<T>`, `Map<K,V>`, `Set<T>`, `Bytes`, `Func` with captures, closures, `shared struct`, `box` | reference copy, refcount +1 | copies on write |
| **Unique** | `unique struct`, `Ptr<T>`, resources with `Drop` | move | in place |
| **Static** | `const`, string literals, static tables | never | never |

A `struct` containing a Shared field is Shared; containing a Unique field, Unique.

---

## 2. Reference counting

A Shared value carries a one-word count. `let b = a` increments; scope exit
decrements and frees at zero. In the generated code this is a `vela_retain` /
`vela_release` pair, and the optimiser removes the pair whenever it can prove the
value does not escape.

```vela
fn f() {
  let a = [1, 2, 3]      # count 1
  {
    let b = a            # count 2
  }                      # count 1
}                        # count 0, freed
```

Costs, stated plainly: every Shared assignment is one increment, every scope exit
one decrement or free. A tight loop over a list by index increments per access
**only if the index expression can alias the list**; the common case
(`for x in xs`) compiles to a borrow of the backing array with no per-element
counting. This is a compiler obligation, and `vela build --stats` reports the
retain/release count per function so a regression is visible.

---

## 3. Copy-on-write

A Shared value that is mutated while its count is greater than one copies first.

```vela
let original = [1, 2, 3]
mut copy = original
copy.push(4)                  # copies the backing array, then pushes
assertEq(original.len, 3)
assertEq(copy.len, 4)
```

The rules that make this predictable:

* A variable that owns the only reference (`count == 1`) mutates in place.
* `let` bindings never mutate, so they never trigger the copy.
* Passing a Shared value to a function costs a count, not a copy; returning one
  costs nothing (`ÉT-C` — return with `move`).
* `clone()` on a Shared value forces a deep copy; `sharedView()` is not a thing,
  because that would be a borrow.

### 3.1 Strings

`Str` is immutable, so it never copies on write — there is no write. Building a
string in a loop is O(n²) if done with `+`; the language provides
`str.Builder`, and the compiler rewrites a chain of constant `+` inside one
expression into a builder automatically. This is the one place where an
optimisation is specified rather than left to the compiler:

```vela
let s = "a" + b + "c" + d      # one allocation, not four
```

---

## 4. Cycles

Reference counting leaks cycles, so a cycle collector runs.

```vela
shared struct Node { mut next: Node? }

mut a = Node { next: nil }
mut b = Node { next: a }
a.next = b                     # a cycle: RC alone would never free these
```

* A **trial-deletion** collector runs when the number of live Shared allocations
  has grown by 50% since the last collection, or every 4 MiB of allocation,
  whichever comes first. It is incremental: at most 1 ms of work per 1 ms of
  program time, so a UI frame is never missed.
* `mem.collect()` forces a collection; `mem.stats()` reports live objects.
* In `app` and `web`, the collector may be disabled with
  `#![noCycleCollector]` for a program that proves it has no cycles, removing the
  bookkeeping entirely.
* The `sys` profile has no collector at all (doc 15 §5).

`weak T` exists for caches and back-pointers where prompt release matters more
than simplicity; a cycle reachable only through weak edges is collected by RC
immediately.

---

## 5. Destruction

Three cleanup mechanisms, in the order they run when a scope exits:

1. `defer`red statements, reverse order (doc 04 §7).
2. `Drop` implementations of locals, reverse declaration order (doc 06 §11).
3. The frame is popped.

`Drop` is a trait with a `consuming self` receiver. It runs on every exit path:
return, `?`, `break`, `panic`.

A type with `Drop` is move-only: copying it would run `drop` twice, so the
compiler forbids the copy (`E-DATA-071`). This is why `FileHandle` cannot be
accidentally duplicated, and why `#[derive(Clone)]` on such a type is rejected
until an explicit `clone` is written.

---

## 6. `unique` — no reference count

`unique struct` is a value with exactly one owner at a time. It is what a kernel
data structure or a large buffer should be.

```vela
unique struct Buffer {
  ptr: Ptr<UInt8>
  len: IntSize
  cap: IntSize
}

fn fill(mut b: Buffer, byte: UInt8) {
  for i in 0..<b.len { unsafe { b.ptr.add(i).write(byte) } }
}
```

* Assigning a `unique` **moves** it; the old binding becomes invalid
  (`E-EXPR-021`).
* Passing one to a function moves it unless the parameter is `borrow`:

```vela
fn view(borrow b: Buffer) -> IntSize { b.len }     # no move, no copy, no RC
```

`borrow` is the single borrow form in Vela: a non-escaping, read-only view with
lifetime = the call. It is checked trivially (the compiler rejects storing it in
a field, returning it, or capturing it in a closure that outlives the call), it
cannot alias a `mut` binding in the same expression, and it needs no annotation
at the call site. That is 90% of the borrow-checker benefit for 5% of the rules.

---

## 7. `unsafe`

`unsafe { }` gates exactly six things, and nothing else:

1. Dereferencing a `Ptr<T>`.
2. Calling an `extern` function.
3. Writing to `volatile` memory.
4. `asm!`.
5. Reading a union field.
6. `transmute` between same-size types.

Everything else is safe. A buffer overflow is impossible in safe code because
indexing is bounds-checked; a use-after-free is impossible because references are
counted; a data race is impossible because shared mutability requires `Mutex`,
`Atomic` or an `Actor` (doc 10).

`#![deny(unsafe)]` at the top of a module makes any `unsafe` block a compile
error, so a library can prove its own safety. There is no `#![allow(unsafe)]`
because `unsafe` is never denied by default outside `sys` — what is required
there is an explicit reason string:

```vela
unsafe("the header is 8 bytes, checked above") {
  let n = header.cast::<UInt64>().read()
}
```

An `unsafe` block without a reason is `W-MEM-010`. A safety comment is not
decoration; it is the audit trail a reviewer reads.

---

## 8. Allocators

```vela
trait Allocator {
  fn alloc(mut self, size: IntSize, align: IntSize) -> Ptr<UInt8>?
  fn free(mut self, ptr: Ptr<UInt8>, size: IntSize, align: IntSize)
  fn resize(mut self, ptr: Ptr<UInt8>, old: IntSize, new: IntSize, align: IntSize) -> Ptr<UInt8>?
}
```

Built-in allocators (doc 16):

| Allocator | Use |
| --- | --- |
| `mem.system` | `malloc`/`free`; the default in `core`, `app`, `web` |
| `mem.arena(capacity)` | bump allocation, freed at once — a request scope, a parse |
| `mem.pool<T>(n)` | fixed-size slots — nodes, packets, entities |
| `mem.null` | allocation always fails; the `sys` default |
| `mem.tracking` | bookkeeping wrapper for leak tests |

Scoped:

```vela
fn handleRequest(req: Request) -> Response {
  with arena = mem.arena(64 * 1024) {
    let parsed = parse(req, alloc: arena)      # everything lives in the arena
    render(parsed)
  }                                            # one free, at the end
}
```

`alloc: a` passes an allocator to a function that accepts one. Collection
constructors take it too: `list.new(alloc: arena)`. A function may declare
`@alloc(arena)` to thread it implicitly, which is the ergonomic form and still
visible in the signature.

`#[global_allocator]` names the default for a program, as in:

```vela
#[global_allocator]
const ALLOC: Allocator = mem.arena(1 << 20)
```

---

## 9. Determinism in `sys`

The `sys` profile inverts the defaults:

* No allocator exists unless declared. `List`, `Map`, `Str` concatenation and
  closures with captures are **unavailable** without one (`E-MEM-020` names the
  operation that needed memory).
* `Ptr<T>` is the normal way to hold memory, and `unsafe` is expected, not
  suspicious.
* `Drop` still runs (it is required for correctness), but nothing is ever freed
  implicitly, because nothing was implicitly allocated.
* The cycle collector is absent.

That is what makes a kernel written in Vela possible: the language stops being
convenient exactly where convenience would mean a hidden allocation.

---

## 10. Leaks and detection

* Every `Drop` that never runs is a leak. `vela test --leaks` installs a tracking
  allocator and reports live allocations at exit, with the allocation site of
  each.
* A `static` holds its value for the program's life; that is not a leak, and the
  tracker says so.
* `mem.stats()` returns `allocations`, `bytes`, `live`, `peak`.
* The `app` profile ships a debug overlay (doc 13 §12) that shows the live byte
  count for a development build, because a UI that grows 4 KB per frame is a bug
  you should see in a second, not in a crash report.

---

## 11. What is deliberately absent

| Absent | Reason |
| --- | --- |
| Tracing GC | latency, and `sys` cannot have one; having two memory models is worse than having one |
| Borrow checker with lifetimes | annotation cost; `unique` + `borrow` + CoW covers the real cases |
| Manual `free` in safe code | that is what `unsafe` and `unique` are for |
| `memcpy`-style shallow copies of Shared values | aliasing without a count is the bug RC exists to prevent |
| Slice types with lifetimes | `planned`; would enable zero-copy parsing without an arena |
| Escape analysis | `planned`; would let more values live on the stack automatically |
| Generational arena in the stdlib | `planned`; the pool allocator covers it today |

---

## 12. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-MEM-010` | use of a moved `unique` value |
| `E-MEM-011` | `borrow` escaping its call |
| `E-MEM-012` | `borrow` stored in a field |
| `E-MEM-020` | allocation required in a `sys` module with no allocator |
| `E-MEM-030` | `Ptr` dereference outside `unsafe` |
| `E-MEM-031` | `Ptr` arithmetic outside `unsafe` |
| `E-MEM-040` | `transmute` between different sizes |
| `E-MEM-041` | union field read outside `unsafe` |
| `E-MEM-050` | `drop` on a type that also declares `Clone` without a clone |
| `W-MEM-010` | `unsafe` block without a reason string |
| `W-MEM-020` | Shared value in a `sys` structure that has a non-failing alternative |

---

Next: [10-concurrency.md](10-concurrency.md).
