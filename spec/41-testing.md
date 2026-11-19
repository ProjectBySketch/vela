# 41 — Testing

**Status:** `spec`. Tool: `vela test`, `vela bench`, `vela fuzz` (doc 25). Related:
doc 11 (errors), doc 25 §10.1 (test doubles), doc 28 §5 (conformance).

A language is only as good as the tests it makes easy. Vela ships every kind that
matters, with one syntax, one runner and one report.

---

## 1. The hierarchy

| Kind | Attr | What it proves |
| --- | --- | --- |
| unit | `#[test]` | a function does what it says |
| integration | `tests/*.vela` | the package works through its public API |
| doc | `/// ````vela ```` | the example in the docs is true |
| property | `#[property]` | a law holds for a thousand generated inputs |
| fuzz | `#[fuzz]` | no input crashes it |
| snapshot | `#[snapshot]` | output did not change |
| golden image | `assertImageMatches` | pixels did not change |
| conformance | `spec/conformance` | the compiler matches the spec |
| load | `#[load]` | it stays within budget under concurrency |
| mutation | `vela test --mutate` | the tests would catch a bug |

All of them are `#[test]`-shaped functions with an attribute, so one runner, one
filter, one report.

---

## 2. Unit and integration tests

```vela
#[test]
fn parsesTheHeader() {
  let h = try parseHeader(fixtures.bytes("header.bin"))?
  assertEq(h.version, 2)
  assertEq(h.length, 512)
}

#[test]
#[shouldPanic("index out of range")]
fn panicsOnBadIndex() { _ = [1, 2][9] }
```

* A test is a function with no parameters and no requirement on the return type;
  `Result` is allowed and an `Err` fails the test with its message.
* `tests/` compiles the package as an external user would, so a private item that
  a test needs is a signal that it should be `pub`.
* `#[ignore("reason")]`, `#[only("platform: linux")]`, `#[timeout(5s)]`.

---

## 3. Property-based testing

```vela
#[property]
fn sortingIsIdempotent(mut xs: List<Int>) {
  let once = list.sorted(xs)
  let twice = list.sorted(once)
  assertEq(twice, once)
}

#[property]
fn encodeDecodeRoundTrips(order: Order) {
  let back = try json.decode::<Order>(try json.encode(order)?)?
  assertEq(back, order)
}
```

* Parameters are generated from their type by the `Arbitrary` trait; a type
  without an implementation is `E-TEST-010`, and `#[derive(Arbitrary)]` writes one
  from its fields.
* 100 cases per property by default, then a shrinking pass that reports the
  **minimal** failing input.
* `assume(cond)` discards a case; a property that discards more than 90 % of cases
  is `W-TEST-010`, because it is not testing what it claims.
* The seed is printed on failure and `--seed` replays it, which is the difference
  between a flake and a bug report.
* Custom generators: `#[property(gen: myOrderGen)]`.

---

## 4. Fuzzing

```vela
#[fuzz(maxInput: 1 << 20)]
fn headerNeverPanics(data: Bytes) {
  _ = parseHeader(data) catch { }
}
```

* `vela fuzz` runs libFuzzer-style coverage-guided fuzzing against the annotated
  functions; a corpus is kept under `fuzz/corpus/`.
* A crash writes the input to `fuzz/crashes/` and exits non-zero, so CI catches it.
* `--time 60s` bounds a run; `--jobs n` parallelises.
* A `#[fuzz]` function must be total: it may return `Result`, and the harness
  treats a panic as a failure and an `Err` as a normal outcome.

---

## 5. Snapshots

```vela
#[snapshot]
fn rendersTheCard() {
  render(ProductCard(fixtures.product()))
}
```

* The value's `Debug` (or `Display`, if `#[snapshot(display)]`) is written to
  `snapshots/<test>.snap` on first run, and compared afterwards.
* A mismatch prints a unified diff and fails. `vela test --update` rewrites the
  snapshots; a snapshot that changed without its test changing is caught in review
  by the diff.
* Inline snapshots are `assertSnapshot(value)`, stored in the test file, so a
  small expectation stays next to the code.
* Golden images work the same way with `assertImageMatches(image, "golden/x.png",
  tolerance: 0.002)` (doc 21 §7).

---

## 6. Load and stress

```vela
#[load(requests: 10_000, concurrency: 64, p99: 200ms)]
async fn handlesTheRoute(client: TestClient) {
  let res = try await client.get("/products")?
  assertEq(res.status, 200)
}
```

* The harness runs the function at the declared concurrency, measures p50/p95/p99,
  and fails when the p99 budget is exceeded.
* `--stress` repeats a concurrent test 100 times to expose ordering bugs;
  `#[stress(iterations: 500)]` overrides it.
* A database test uses doc 20 §9's rollback-per-test, so load tests do not leave
  state behind.

---

## 7. Mutation testing

```sh
vela test --mutate src/checkout.vela
```

The runner mutates the code — flips a comparison, replaces `+` with `-`, removes a
statement — and reports the **mutation score**: the percentage of mutants the test
suite killed. A surviving mutant names the line and the behaviour that no test
covers. This is the only measurement of test *quality* rather than quantity, and it
is a flag rather than a separate product.

---

## 8. Coverage

```sh
vela test --coverage --json > coverage.json
```

* Line, branch and function coverage, mapped back to Vela source (not C, not IR).
* `--min-coverage 85` fails the run below a threshold; per-package thresholds are
  allowed, because a generated binding should not crawl toward 100 %.
* `#[coverage(off)]` on an item excludes it, and the report lists the exclusions so
  an exemption is visible.

---

## 9. Isolation and fixtures

| Rule | Detail |
| --- | --- |
| no shared state | each test gets a fresh process **or** a fresh runtime, by declaration (`#[inProcess]` opts into speed) |
| time | injected (`test.clock()`), never read from the wall |
| randomness | seeded per test; `--seed` reproduces |
| filesystem | a temp directory per test, removed afterwards |
| network | blocked unless the test uses `net.fake` or `#[network]` |
| database | a transaction per test, rolled back (doc 20 §9) |

A test that reads the wall clock or the network without declaring it is
`W-TEST-020`, which is the same lint as doc 25 §10.1.

---

## 10. Running

```sh
vela test                       # everything
vela test --filter checkout     # name substring
vela test --doc                 # documentation examples
vela test --target x86_64-unknown-none --qemu
vela test --repeat 50           # flake hunt
vela test --shard 2/4           # CI parallelism
vela test --json                # machine-readable report
```

* Tests run in parallel by default, `--test-threads 1` serialises.
* A failure prints: the test name, the assertion, both values, the seed (if any),
  the snapshot diff (if any), and the source span.
* `--fail-fast`, `--only`, `--skip`, `--exact`.

---

## 11. Reporting

`--json` emits JUnit-compatible and native formats:

```json
{ "suite": "checkout", "total": 42, "passed": 41, "failed": 1,
  "durationMs": 1234,
  "failures": [{ "test": "rejectsAnEmptyCart", "message": "expected Err, got Ok",
                 "file": "tests/checkout.vela", "line": 18, "seed": 7 }] }
```

A CI job fails on `failed > 0` without parsing prose, and a dashboard can trend the
duration of each test — which is how a slow test is noticed before it is a slow
suite.

---

## 12. What a good test looks like

The style guide (doc 34 §4.7) says `rejectsAnEmptyName`, not `test1`. Beyond
naming:

* A test asserts behaviour, not implementation: changing a private function should
  not require changing its tests.
* One reason to fail per test. A test with three assertions about three things
  reports the first and hides the others.
* Every bug fix comes with a test that fails without the fix. `vela test --mutate`
  is the machine check on that promise.
* A test that needs a fake is a design signal (doc 25 §10.1): the dependency
  should be a parameter.

---

## 13. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-TEST-010` | property parameter type has no `Arbitrary` |
| `E-TEST-020` | snapshot mismatch |
| `E-TEST-030` | load test exceeded its p99 budget |
| `E-TEST-040` | fuzz target panicked (with the saved input path) |
| `E-TEST-050` | test exceeded its timeout |
| `W-TEST-010` | property discards too many cases |
| `W-TEST-020` | ambient clock/network/filesystem in a test |
| `W-TEST-030` | mutation score below the declared floor |

---

Next: [42-contracts.md](42-contracts.md).
