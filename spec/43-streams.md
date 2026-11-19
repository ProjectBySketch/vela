# 43 — Streams, generators and signals

**Status:** `spec`. Related: doc 10 (concurrency), doc 13 §4 (UI state), doc 23
(networking).

Iteration, asynchrony and reactivity are three views of the same thing: a sequence
of values over time. Vela gives each a name and a shared set of operators, so a
program does not switch mental models between a file, a socket and a UI.

---

## 1. Generators

```vela
gen fn fibonacci(limit: Int) -> Int {
  mut a = 0
  mut b = 1
  while a < limit {
    yield a
    let next = a + b
    a = b
    b = next
  }
}

for n in fibonacci(100) { print(n) }
```

* `gen fn` returns an `Iterator<T>`; the body runs lazily, one `yield` at a time.
* `yield v` produces a value; `yield* other` delegates to another iterator.
* A generator is a value: it can be passed, stored and iterated once. Iterating it
  twice yields the same sequence only if it is `Clone` and cloned first
  (`E-STREAM-010` otherwise).
* A generator that returns a value (`return x`) exposes it through `.result()`
  after exhaustion, which is how "read until the header" carries its trailer out.
* `send(v)` into a generator (`gen fn` with a `v = yield x` form) is **not**
  supported: it turns a generator into a coroutine with two directions, and
  `Channel` already covers that case with better semantics.

---

## 2. `Stream<T>` — asynchronous iteration

```vela
async fn readLines(path: Str) -> Stream<Result<Str, IoError>> {
  let file = try fs.open(path)?
  defer file.close()
  while let line = try await file.readLine()? {
    yield Ok(line)
  }
}

await for line in readLines("big.log") {
  match line {
    Ok(text) => process(text),
    Err(e)   => log.warn("${e}"),
  }
}
```

* A `Stream<T>` is an asynchronous iterator: `next()` is `async`, so a stream can
  take as long as it needs per item.
* `await for x in stream { }` is the consumer form; it handles backpressure,
  cancellation and early `break` (which cancels the producer).
* `await for` may appear only in `async` code (`E-STREAM-020`).
* `Stream<T>` converts to `Iterator<T>` with `.sync()` for a producer that never
  suspends, and an `Iterator` converts to a `Stream` with `.async()`.

---

## 3. Operators

All three kinds share these (an `Iterator` version allocates nothing per stage, a
`Stream` version suspends):

| Operator | Meaning |
| --- | --- |
| `map`, `filter`, `filterMap`, `flatMap` | transform |
| `take(n)`, `skip(n)`, `takeWhile`, `skipWhile` | bound |
| `enumerate`, `zip`, `chain`, `interleave` | combine |
| `chunk(n)`, `window(n)`, `groupBy(key)` | group |
| `dedupe`, `distinct` | uniqueness |
| `scan(init, f)` | running fold with output |
| `tee(other)` | duplicate |
| `buffer(n)`, `receive(duration:)`, `debounce(d)`, `throttle(d)` | time and pressure |
| `timeout(d)`, `retry(policy)`, `catch(f)` | failure |
| `merge(other)`, `race(other)`, `broadcast(n)` | concurrency |
| `collect()`, `for await` | consume |

`buffer(n)` is the backpressure knob: a producer that outruns a consumer suspends
once the buffer is full (`E-STREAM-030` if an unbounded buffer is requested
without `unbounded()`), which is what keeps a fast socket from exhausting memory.

---

## 4. Errors and cancellation

* A stream yields `Result<T, E>` when a stage can fail; `?` inside a `gen fn`
  returns from the generator, and `.result()` carries the error out.
* Cancelling a stream (dropping it, `break` from `await for`, or the enclosing task
  cancelling) cancels its producer at the next suspension point (doc 10 §4).
* A stream that was cancelled and is read again is `E-STREAM-040`.
* An unconsumed stream does not run: a generator body executes only when pulled,
  so a stream that is created and dropped costs nothing.

---

## 5. Signals — reactive values for UI

A signal is a value that notifies readers when it changes. It is how doc 13's
`state`/`computed` are implemented, and it is available to any program.

```vela
let count = signal.of(0)
let doubled = signal.computed { count.get() * 2 }

let stop = doubled.subscribe { v | label.text = "${v}" }
count.set(1)          # label updates
stop()                # unsubscribe

signal.effect {
  log.info("count is ${count.get()}")   // re-runs when count changes
}
```

| API | Meaning |
| --- | --- |
| `signal.of(v)` | a writable signal |
| `signal.computed { }` | a derived signal, recomputed when a dependency changes |
| `.get()` / `.set(v)` / `.update(f)` | read / write / transform |
| `.subscribe(f)` | call `f` on change; returns an unsubscribe function |
| `signal.effect { }` | run now and whenever a read dependency changes |
| `signal.batch { }` | coalesce writes into one notification |
| `signal.untracked { }` | read without subscribing |

Rules:

* Dependency tracking is dynamic and per-run: a `computed` depends on exactly the
  signals it read last time, so a branch that stops reading a signal stops
  depending on it (`E-STREAM-050` warns about a conditionally-read dependency that
  looks accidental).
* A write inside an `effect` is allowed only through `batch` to avoid an infinite
  loop (`E-STREAM-051` otherwise).
* Signals are UI-task-affine: a signal written from another task is marshalled
  through `ui.onMain` (doc 10 §12), not silently raced.
* A `computed` is memoised until a dependency changes; a computed with no
  subscribers and no readers is not recomputed.

---

## 6. Local-first and sync

The same model extends to persistence: a signal backed by storage, and a CRDT
that merges two divergent copies.

```vela
let doc = crdt.text("notes")
let offline = sync.local(doc, store: storage.local)
sync.remote(offline, url: "wss://sync.example.com/doc/1", auth: token)

doc.insert(at: 0, "hello ")        # applies locally, syncs when online
```

| Type | Merge rule |
| --- | --- |
| `crdt.counter` | increment/decrement counters (PN-Counter) |
| `crdt.set` | observed-remove set |
| `crdt.map` | last-writer-wins per key, with a total order on writes |
| `crdt.text` | RGA/sequence CRDT, no interleaving surprises |
| `crdt.list` | sequence CRDT |

Guarantees:

* **Convergence**: two copies that have seen the same operations are equal,
  regardless of order.
* **Offline**: every operation applies immediately; the sync layer queues them.
* **Idempotent**: replaying an operation twice is a no-op, so a flaky connection
  cannot duplicate an edit.
* **No lost local work**: an operation on a diverged copy merges rather than
  overwriting (unlike an LWW-per-document approach, which is why `crdt.text` is a
  sequence CRDT).
* Storage is the `store` you pass: `storage.local` (web), a file (desktop), the
  `db` module (server). The sync protocol is a binary encoding of operations
  (doc 38), versioned and signed (doc 24 §7.1) when the transport needs it.

---

## 7. Choosing the right tool

| Need | Use |
| --- | --- |
| iterate a collection | `Iterator` (`for x in xs`) |
| produce lazily without async | `gen fn` |
| read a socket, file or database in chunks | `Stream<T>` |
| a value that changes over time | `signal` |
| a UI that renders a signal | doc 13's `state`/`computed` (which are signals) |
| two devices editing the same document | `crdt` + `sync` |
| many producers, one consumer | `Channel<T>` (doc 10 §5) |
| one value computed once | `Once<T>` or a `static` |

---

## 8. Testing streams

```vela
#[test]
async fn emitsInOrder() {
  let out = await readLines(fixtures.file("three.log")).collect()
  assertEq(out.len, 3)
  assertEq(out[0].unwrap(), "one")
}

#[test]
fn generatorIsLazy() {
  mut produced = 0
  let xs = gen fn() -> Int { produced += 1; yield 1 }
  assertEq(produced, 0)
  _ = xs.next()
  assertEq(produced, 1)
}

#[test]
async fn cancelsOnBreak() {
  let stream = infiniteTicks()
  await for t in stream { if t > 2 { break } }
  assert(stream.isCancelled())
}
```

`test.clock()` (doc 25 §10.1) makes `debounce`, `throttle` and `timeout` testable
without sleeping, which is the difference between a fast suite and a slow one.

---

## 9. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-STREAM-010` | generator iterated twice |
| `E-STREAM-020` | `await for` outside `async` |
| `E-STREAM-030` | unbounded buffer requested |
| `E-STREAM-040` | reading a cancelled stream |
| `E-STREAM-050` | conditionally-read signal dependency |
| `E-STREAM-051` | write inside an effect without `batch` |
| `W-STREAM-010` | stream created and never consumed |
| `W-STREAM-020` | `collect()` on a stream that may be unbounded |

---

Next: [44-units.md](44-units.md).
