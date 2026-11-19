# 10 — Concurrency

**Status:** `spec`. 0.1 is single-threaded with no `async`.

Vela's concurrency model is **structured, checked and boring**. There is exactly
one way to run things in parallel, one way to share mutable state, and the
compiler refuses everything else.

---

## 1. The three primitives

| Primitive | Purpose |
| --- | --- |
| `async fn` + `await` | suspend and resume within a task |
| `spawn` / `TaskGroup` | run work concurrently |
| `Channel`, `Actor`, `Mutex`, `Atomic` | move data between, or share it safely |

A program that uses none of them is single-threaded and single-task. Nothing is
concurrent by accident: there is no background thread the runtime starts for you.

---

## 2. `async` / `await`

```vela
async fn fetch(url: Str) -> Result<Bytes, HttpError> {
  let conn = try await net.connect(url)?
  defer conn.close()
  conn.readAll()
}

async fn fetchAll(urls: List<Str>) -> List<Result<Bytes, HttpError>> {
  mut out = []
  for u in urls {
    out.push(await fetch(u))
  }
  out
}
```

* An `async fn` returns `Task<T>`; awaiting it yields `T`.
* `await` may appear only in `async` code.
* Awaiting the same `Task` twice is `E-CONC-010`: a task is consumed.
* `await` on a `Task` that has already completed returns immediately.
* Inside an `async fn`, `defer` runs when the **task** finishes, not at the
  `await` point.

The run loop is selected by the profile: an event loop with `epoll`/`kqueue`/
`io_uring` in `core`, the platform run loop in `app`, the microtask queue in
`web`, and an explicit scheduler or nothing at all in `sys`.

---

## 3. Structured concurrency

```vela
async fn load() -> Result<Report, Error> {
  let group = TaskGroup()
  let users  = group.spawn { fetchUsers() }
  let orders = group.spawn { fetchOrders() }
  let stocks = group.spawn { fetchStock() }

  let all = try await group.join()?      # waits for all three
  Ok(Report.build(all))
}
```

Guarantees:

1. A `TaskGroup` outlives none of its children: `group.run { }` and
   `group.join()` wait for every task in the group, including ones that failed.
2. If one child fails, `join()` returns the first failure and **cancels** the
   rest.
3. If the enclosing scope exits early (a `return`, a `?`, a `panic`), the group's
   tasks are cancelled before the scope's values are dropped.
4. A cancelled task stops at its next `await`. Cancellation is cooperative and
   *checked*: it is a `CancellationError` delivered at suspension points, so a
   task cannot be terminated with a half-written buffer.

`spawn { }` without a group is **detached**: it runs to completion or until the
program ends. Detached tasks are what a server uses for a connection; a
`TaskGroup` is what a request handler uses for its sub-work.

---

## 4. Cancellation and timeouts

```vela
let task = spawn { slowThing() }
if somethingHappened {
  task.cancel()
}

// a timeout is a cancellation with a clock attached
let value = try await task.timeout(1500ms)?
```

* `Task.cancel()` requests cancellation; the task observes it at the next
  `await`.
* `time.cancelled()` lets a tight loop poll explicitly:

```vela
async fn primeSieve(limit: Int) -> Int {
  for i in 0..<limit {
    if time.cancelled() { fail CancellationError() }
    ...
  }
}
```

* `timeout(d)` on a `Task` returns `Err(TimeoutError())` when the duration
  elapses and cancels the task.
* A timeout in `sys` needs a timer source; the profile documents which one it
  uses (doc 15 §9).

---

## 5. Channels

```vela
let jobs: Channel<Job> = channel.bounded(64)
let results: Channel<Result<Str, Error>> = channel.unbounded()

spawn {
  for job in jobs {                 # `for` over a channel ends when it closes
    results.send(handle(job))
  }
  results.close()
}

for r in results {
  match r {
    Ok(s) => print(s)
    Err(e) => eprintln("failed: ${e}")
  }
}
```

| Operation | Behaviour |
| --- | --- |
| `channel.bounded(n)` | sender blocks (suspends) when full |
| `channel.unbounded()` | sender never blocks; memory grows |
| `ch.send(v)` | suspends while full; returns `Err` if the channel is closed |
| `ch.trySend(v)` | never suspends; `Result<Void, WouldBlock>` |
| `ch.recv()` | suspends; yields `nil` when closed and drained |
| `ch.close()` | idempotent; remaining items can still be received |
| `for x in ch` | until closed and drained |

`Channel<T>` is `Send` when `T` is `Send`.

---

## 6. `select`

```vela
select {
  v from a => handle(v)
  v from b => handle(v)
  timeout(2s) => fail TimeoutError()
  else => print("nothing ready")
}
```

* Arms are evaluated in written order when several are ready (fair by default;
  `#[fair]` on the `select` rotates the order).
* `else` runs when no arm is immediately ready; without it, `select` waits.
* `timeout(d)` is an ordinary arm with an implicit timer.

---

## 7. Actors

An actor is the **only** way to have shared mutable state without a lock.

```vela
actor Counter {
  mut counts: Map<Str, Int> = map.new()

  fn bump(self, key: Str) -> Int {
    let n = self.counts[key] ?? 0
    self.counts[key] = n + 1
    n + 1
  }

  fn total(self) -> Int {
    self.counts.values().sum()
  }
}

let counter = Counter()
let a = spawn { await counter.bump("a") }
let b = spawn { await counter.bump("a") }
```

Rules:

* Every actor method is implicitly `async` to its caller and runs **serialised**
  on the actor; there is no way to enter an actor concurrently.
* `self` inside an actor method is `mut self` implicitly and the compiler
  forbids holding an actor's `self` across an `await` (`E-CONC-020`) — the
  classic deadlock.
* An actor's fields are never visible from outside; access is via methods.
* Actors may hold other actors; a cycle of awaits is detected at runtime and
  reported as a deadlock with the wait-for graph (`E-RUN-050`).

### 7.1 `send` with a reply

```vela
actor Printer {
  fn print(self, line: Str) { ... }
}

printer.send Printer::print("fire and forget")
```

`send` is shorthand for "start an actor method and do not wait". It is the
canonical way to push work out of a UI task.

---

## 8. Locks and atomics

```vela
let total: Atomic<Int> = atomic.of(0)
total.fetchAdd(1)
let seen = total.load()

let config = mutex.of(Config.default())
with guard = config.lock() {
  guard.timeout = 5
}
```

| Type | Semantics |
| --- | --- |
| `Atomic<T>` | `Int*`, `UInt*`, `Bool`, `Ptr<T>`; `load`, `store`, `fetchAdd`, `compareExchange` |
| `Mutex<T>` | guards a value; `lock()` returns a scope guard |
| `RwLock<T>` | `read()` may be concurrent; `write()` exclusive |
| `Once<T>` | computed exactly once, thread-safe |
| `Barrier(n)` | rendezvous |

Memory orderings are `relaxed`, `acquire`, `release`, `acqRel`, `seqCst`, with
`seqCst` the default so that a program that never mentions ordering is the
correct one.

A `Mutex` guard held across an `await` is `E-CONC-021`. Deadlocking by holding a
lock while suspending is a whole class of bug, and it is a compile error here.

---

## 9. `parallel for`

```vela
let sums = parallel for row in grid { row.sum() }
```

* Runs each iteration on the worker pool, returns results in input order.
* The body may not mutate anything outside it, may not `await`, and captures
  must be `Share` (`E-CONC-030`).
* A `reduce` clause folds instead of collecting:
  `parallel for x in xs reduce (a, b) => a + b { f(x) }`.
* Chunking is automatic; `#[chunk(n)]` overrides it.

This is the only construct that creates threads implicitly, and it creates a
bounded number (the pool size, default CPU count).

---

## 10. `Send` and `Share`

Two marker traits decide what may cross a task boundary.

| Trait | Means | Examples |
| --- | --- | --- |
| `Send` | may be **moved** to another task | everything, except a type holding a `Ptr` or an actor handle to itself |
| `Share` | may be **shared** by reference across tasks | immutable data, `Atomic`, `Mutex` (guarded value must be `Send`) |

A `spawn { }` closure must capture only `Send` values; a captured `shared struct`
with mutable fields is validated by the compiler as `!Share` (`E-CONC-040`,
which names the field).

`str`, `Int`, `Bool` and immutable `struct`s are `Send + Share` automatically.
`List<T>` is `Send` when `T` is and `Share` when `T` is — copy-on-write makes it
safe to share a list without a lock, but the copy on the first write is per-
reference, so a shared-then-mutated list across tasks is a performance bug, not
a correctness one. The compiler warns (`W-CONC-010`) when a `Share` list is
mutated inside `parallel for`.

---

## 11. Threads (`core` and `sys` only)

```vela
let h = thread.spawn(fn() {
  work()
})
thread.join(h)

let t = thread.current().name()
thread.sleep(100ms)
```

`thread` is unavailable in `app` and `web` (`E-CONC-050`): on iOS a thread that
touches the UI crashes the process, so the language forbids the construct rather
than documenting the rule.

---

## 12. How each profile runs it

| Profile | Executor | `spawn` means | Blocking `await` on |
| --- | --- | --- | --- |
| `core` | multi-threaded work-stealing pool | a worker task | any pool thread |
| `app` | the platform run loop + a small pool | a pooled task | a continuation on the UI queue when you return to UI code |
| `web` | the microtask queue | a promise | the event loop |
| `sys` | none by default; an explicit scheduler | an error unless the program supplies one | whatever the program supplies |

In `web`, `parallel for` is `planned` and currently reports a compile error
rather than silently serialising.

---

## 13. Guarantees, stated exactly

| Property | Guarantee |
| --- | --- |
| Data races | impossible in safe code (no shared mutable state outside `Atomic`, `Mutex`, `Actor`) |
| Deadlock by lock-across-await | impossible (compile error) |
| Task leak | prevented by structured concurrency (a group owns its children) |
| Cancellation | cooperative, observable at every `await` |
| Ordering of `Channel` items | FIFO per channel |
| Ordering of `parallel for` results | input order |
| Starvation | no actor is starved by another (fair scheduling, FIFO mailbox) |
| Determinism of a single-threaded program | identical output every run |
| Determinism of a concurrent program | no guarantee — `vela test --stress` runs a program 100 times to find it |

---

## 14. Coroutine frames

An `async fn` compiles to a state machine. Where that state lives is specified,
because "an async call may allocate" is exactly the kind of hidden cost Vela
refuses to have.

| Rule | Detail |
| --- | --- |
| Size | the frame is the union of every local that is live across an `await`, plus the state index; `vela build --stats` prints the largest frame per function |
| Allocation | **none** until the first suspension. A task that never suspends runs entirely on the caller's stack |
| After a suspension | the frame is moved to an allocation of exactly its size, from the current allocator; it is freed when the task completes, is cancelled, or is dropped |
| `#[inlineFrame]` | the compiler must prove the frame fits a declared `maxFrame` (default 4 KiB); otherwise `E-CONC-080` |
| What cannot be held across `await` | a `Mutex` guard, an actor's `self`, a `Slice<T>`, a `borrow` (doc 09 §13) — the last two because a frame outlives the call scope that produced them |
| `sys` | a frame may be allocated from a caller-provided arena, or the task runs to completion on the stack under `#[stackFrame]` |
| `web` | frames live in the WASM heap; the size is reported in `--stats` because the browser's memory is the budget |

```vela
async fn load() -> Result<Data, Error> {
  let a = prepare()            // stack, before the first suspension
  let b = try await fetch()?   // frame moves to the heap here
  combine(a, b)
}
```

The two consequences a program can rely on:

* an `async fn` that never awaits (a wrapper, a trait default) costs no
  allocation;
* a task's peak memory is its frame plus what it awaits, and `--stats` gives the
  number per function rather than a hand-wave.

---

## 15. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-CONC-010` | awaiting a task twice |
| `E-CONC-020` | actor `self` held across `await` |
| `E-CONC-021` | lock guard held across `await` |
| `E-CONC-030` | `parallel for` body captures a non-`Share` value |
| `E-CONC-040` | non-`Send` value captured by `spawn` |
| `E-CONC-050` | `thread` used in `app` or `web` |
| `E-CONC-060` | `await` in a `sys` package without a chosen runtime |
| `E-CONC-070` | channel used after `close()` for sending |
| `E-CONC-080` | coroutine frame larger than the declared `maxFrame` |
| `W-CONC-010` | `Share` list mutated inside `parallel for` |
| `E-RUN-050` | actor deadlock detected |

---

Next: [11-errors.md](11-errors.md).
