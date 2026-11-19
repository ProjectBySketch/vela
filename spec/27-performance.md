# 27 — Performance

**Status:** `spec`. Related: doc 09 (memory), doc 05 §13 (function contract), doc 21
§10 (graphics budgets).

Vela's performance story is a **contract**, not a benchmark table: certain things
are guaranteed (no allocation in a `for` loop over a list), certain things are
opt-in and named (`clone`, `collect`, `box`), and everything else is measured and
reported by the toolchain.

---

## 1. Cost model

A reader should be able to predict the cost of a line without knowing the
compiler. The rules:

| Operation | Cost |
| --- | --- |
| local value read/write | one register or stack slot |
| `struct` copy | its size, memcpy'd inline |
| shared value copy | 24 bytes + one atomic-free refcount increment (single-threaded) or one atomic increment (shared across tasks) |
| shared value mutation | a branch on `count == 1`, then in-place; otherwise a full copy |
| string concatenation | one allocation for the result (chains within one expression become one builder) |
| function call | inlined when small (§13 of doc 05), otherwise a call |
| call through `Func` | indirect call, no inline |
| generic instantiation | compiled per type argument set |
| `for x in xs` | one index variable, no allocation, no bounds check when provable |
| `xs[i]` | a bounds check unless the compiler proves `0 <= i < len` |
| `match` on an enum | a jump table when dense, a chain when sparse |
| closure creation | none if it captures nothing; one allocation if it captures |
| `await` | a state-machine switch; a completed task does not suspend |

No operation is O(n) unless its name says so (`clone`, `sorted`, `collect`,
`join`, `contains` on a list). A function whose name implies linear time may not
be quadratic inside, and `vela bench` will show it.

---

## 2. Guaranteed optimisations

These are contract: a compiler that misses one has a bug.

1. **Inlining** of a statically-known function ≤ 20 AST nodes, unless
   `#[noInline]`.
2. **String builder fusion** for a `+` chain inside one expression.
3. **No allocation** for a `for` loop over a `List`, `Str` (graphemes), `Range`,
   `Map` or `Set`.
4. **Bounds-check elision** when the index is provably in range (a range loop, a
   check immediately before).
5. **Constant folding** of `const` expressions and `comptime` blocks.
6. **Dead code removal** of the non-taken branch of a `const` condition.
7. **Copy elision** for a returned local that is not used after the return.
8. **Tail calls** in `sys` (§12 of doc 05).
9. **`Option<Ptr<T>>`** is the size of a pointer (§7.3 of doc 26).
10. **`List` literal of constants** becomes static data, no per-element call.

---

## 3. Explicit costs

Opt-in operations, each of which a reader can see:

| Operation | What it costs |
| --- | --- |
| `clone()` | a deep copy |
| `collect()` (iterator) | one allocation for the result |
| `box T` | one allocation + an indirect call |
| `toList()` on a lazy iterator | one allocation |
| `.context(msg)` on an error | one allocation per level |
| `fmt.of(x)` | one allocation |
| `str.Builder` | one buffer, amortised |
| `map.new(alloc: a)` | into the given allocator |

The rule is simple enough to state: **if a line allocates, the allocation is
visible in the source**.

---

## 4. Boundaries that cost

| Boundary | Cost | Mitigation |
| --- | --- | --- |
| `Str` ↔ `Bytes` | a copy + UTF-8 validation | keep one form in a hot path |
| `List<T>` → `List<Any>` cast | a copy | avoid in loops; use a union type |
| FFI call | a call, plus whatever the other side does | batch calls |
| `box Trait` dispatch | an indirect call | use a generic when the type is known |
| `Json` round trip | parse + allocate | `#[derive(Json)]` on a struct is one pass |
| DB round trip | network | batch, paginate with cursors (doc 20 §7) |
| `async` task creation | one allocation | use `TaskGroup` for many |

---

## 5. Startup

| Profile | Guarantee |
| --- | --- |
| `core` | no static initialisation beyond `const` data; `main` runs first |
| `app` | the runtime starts the UI before the first frame; a `state` initialiser that is slow is `W-PERF-010` |
| `web` server | listens within 50 ms of process start for a small package |
| `web` client | ≤ 8 KB runtime + the module; first paint does not wait for the module (doc 14 §3.1) |
| `sys` | nothing but what `#[entry]` does |

A `static` with a non-constant initialiser is lazily initialised on first use, not
at startup — so a program's startup cost is its `main`, not its `statics`.

---

## 6. Measuring

```sh
vela bench                      # benchmark functions, compare to the last run
vela bench --save baseline.json --assert-regression 5%
vela run --profile-cpu out.json  # a speedscope/Chrome trace
vela run --profile-mem           # allocation sites, live bytes over time
vela build --stats               # size and monomorphisation counts
vela run --count-refs            # per-function retain/release counts (doc 09 §2)
```

`vela bench` uses a bootstrap statistic (not a single run), reports ns/op with a
confidence interval, and fails CI on a regression over the declared threshold.
Benchmarks are functions:

```vela
#[bench(iterations: 10_000, warmup: 1_000)]
fn sortInts(b: Bench) {
  let input = b.setup { randomInts(1_000) }
  b.run(|xs| { list.sorted(xs) })
}
```

`b.setup` runs outside the measurement; `b.run` measures; `b.bytes(n)` reports
throughput. The same benchmark runs on every target a package claims, which is how
"fast on my machine" becomes a number.

---

## 7. Memory budgets

```toml
[build]
budget = { rss = "64MiB", binary = "4MiB", stack = "1MiB", heapPeak = "16MiB" }
```

`vela test --budget` fails a test suite that exceeds a declared budget on the
`app` and `web` profiles, where a leak is a crash report. The `sys` profile has no
budget beyond what the linker script enforces.

---

## 8. Latency budgets

| Context | Budget | Enforced by |
| --- | --- | --- |
| UI frame | 16.6 ms | doc 13 §19 |
| Audio callback | 128 frames | doc 22 §2.1 |
| Web request | p99 declared per route | `app.route(...).budget(200ms)`, reported, not enforced |
| Hydration | 4 ms per island | doc 14 §12 |
| Startup | 50 ms | §5 above |

A budget that cannot be met is a `W-PERF-020` in the profile build with the
measured value, because a budget nobody checks is a wish.

---

## 9. Optimisation levels

| Flag | Meaning |
| --- | --- |
| `--release` | `speed`: inlining, vectorisation where it does not change semantics, bounds-check elision as proven |
| `--release --size` | `size`: no inlining past 8 nodes, no loop unrolling, shared generic instances where possible |
| `--debug` | no inlining, all bounds checks, overflow panics, debug assertions |
| `--release --asserts` | release performance, `assert` kept |

There is no "unsafe fast mode" that changes semantics: wrapping integers is
`#[wrap]` on a function, and unchecked indexing does not exist outside `unsafe`
with `Ptr`.

---

## 10. What is not guaranteed

Stated plainly so nobody builds on sand:

* no auto-vectorisation promise for a specific loop;
* no escape analysis guarantee (a value *may* live on the stack; `planned` to make
  it more likely);
* no promise about code layout or instruction selection;
* no promise that a generic is instantiated once (it is once per type argument set);
* no promise about the order of dictionary iteration beyond insertion order;
* no promise about `Str` capacity growth beyond amortised O(1) `push`.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-PERF-010` | a benchmark's `setup` contains a `run` |
| `W-PERF-010` | slow work in a `state` initialiser |
| `W-PERF-020` | declared latency budget missed |
| `W-PERF-030` | `list.len` in a loop condition on a shared list |
| `W-PERF-040` | string `+` inside a loop |
| `W-PERF-050` | `clone()` of a large struct in a loop |
| `W-PERF-060` | regression over the declared benchmark threshold |

---

Next: [28-compiler.md](28-compiler.md).
