# 42 — Contracts and refinement types

**Status:** `spec`. Syntax is part of the language (doc 18); checking modes are a
build flag. Related: doc 02 (types), doc 11 (errors), doc 41 (testing).

A type says what a value **is**. A contract says what it **must be true of**. Vela
has both, and they share one syntax so that a boundary can be documented, checked
in debug, proved where it is provable, and compiled away where it is not.

---

## 1. Function contracts

```vela
fn sqrt(x: Float) -> Float
  requires x >= 0.0
  ensures result >= 0.0
  ensures result * result ≈ x
{
  math.sqrt(x)
}

fn withdraw(account: mut Account, amount: Money) -> Result<Void, BankError>
  requires amount > 0.0.money(account.currency)
  ensures account.balance == old(account.balance) - amount || result.isErr
{
  guard account.balance >= amount else { fail BankError.insufficient }
  account.balance -= amount
  Ok(unit)
}
```

| Clause | Meaning |
| --- | --- |
| `requires e` | a precondition: the caller's obligation |
| `ensures e` | a postcondition: the function's obligation, `result` is the return value |
| `old(x)` | the value of `x` at entry, usable in `ensures` |
| `asserts e` | a loop or block invariant |
| `decreases e` | a termination measure for recursion (`planned`: proof, not check) |

Several clauses of the same kind are conjunctive. A clause may use any pure
expression; calling an `io` function inside one is `E-CONTRACT-010`.

---

## 2. Refinement types

A refinement narrows a type with a predicate, and the predicate is part of the
type:

```vela
type Percentage = Int in 0..=100
type NonEmpty<T> = List<T> where len > 0
type Email = Str where contains("@") and contains(".")
type Positive = Float where self > 0.0

fn setVolume(p: Percentage) { ... }
fn first<T>(xs: NonEmpty<T>) -> T { xs[0] }        # no bounds check, guaranteed
```

* `x: Percentage` carries the proof that it is 0..=100. Assigning `101` is a
  compile error when the value is known, a **checked conversion** when it is not:
  `101 as Percentage` panics in debug, `try 101 as Percentage` yields `Result`.
* `first` above indexes without a bounds check because the type says the list is
  non-empty. This is where refinement pays for itself: a check that would be
  written by hand, and forgotten once, becomes free.
* A refinement over a `struct` uses field names (`where balance >= 0.0`).
* Refinements compose: `Int in 0..=100` where the base is itself refined is
  `E-CONTRACT-020`.
* A refinement may not call an `io` function or allocate unboundedly; it is a
  pure predicate.

### 2.1 Where the check happens

| Value known at compile time | Behaviour |
| --- | --- |
| literal or `comptime` value | checked statically; a violation is `E-CONTRACT-030` |
| a value flowing from a refined to an unrefined type | free (widening) |
| an unrefined value into a refined one | a runtime check, or `try` for a `Result` |
| a value proved by a contract (`requires` / `ensures`) | free in `strict --prove` |

`--contracts=off|check|all` controls the whole thing: `off` compiles the checks
away (the types remain, so a debug build with `check` catches what production
does not), `all` checks widening too.

---

## 3. Struct and enum invariants

```vela
#[invariant]
struct Range {
  lo: Int
  hi: Int
}

impl Range {
  invariant self.lo <= self.hi

  fn new(lo: Int, hi: Int) -> Result<Range, RangeError> {
    if lo > hi { fail RangeError.inverted }
    Ok(Range { lo, hi })
  }

  fn union(self, other: Range) -> Range {
    Range { lo: min(self.lo, other.lo), hi: max(self.hi, other.hi) }
  }
}
```

* An invariant is checked after construction and after every `mut` method returns
  (in `check` mode), and is assumed by the compiler in `prove` mode.
* A type with an invariant may only be constructed through a method that
  establishes it — a struct literal that bypasses the invariant is
  `E-CONTRACT-040` unless every field is `pub` **and** the invariant is declared
  `#[unchecked]`.
* This is how "a `Money` is never negative" or "a `Range` is never inverted"
  becomes a property of the type rather than a comment.

---

## 4. Trait contracts

```vela
trait Sorted {
  fn sorted(self) -> Self
    ensures isSorted(result)
    ensures len(result) == len(self)
}
```

A trait may declare `requires`/`ensures` that every implementation must satisfy.
The compiler checks that the implementation's own contracts imply the trait's
(`E-CONTRACT-050` when they are visibly weaker), and `vela test` can check the
trait's contracts against every conforming type automatically
(`#[test] #[forall(impl: Sorted)]`).

---

## 5. Loop invariants

```vela
mut i = 0
mut sum = 0
while i < xs.len
  asserts 0 <= i and i <= xs.len
  asserts sum == xs[0..<i].sum()
{
  sum += xs[i]
  i += 1
}
```

* A loop invariant is checked at entry and after each iteration in `check` mode.
* In `prove` mode (doc 42 §7) it is the induction hypothesis the verifier uses.
* An invariant that is false at entry is `E-CONTRACT-060` at run time with the
  iteration number, which turns "the assertion after the loop failed" into "the
  invariant was already broken at iteration 0".

---

## 6. Contracts at boundaries

| Boundary | Behaviour |
| --- | --- |
| `pub` function | contracts are part of the API and appear in `vela doc` |
| FFI (`export "c"`) | contracts are checked on entry (`E-FFI-010` if a requirement fails, mapped to a panic or an error return) |
| deserialisation | `Validate` (doc 38 §4) is the contract of a decoded value; a refined field is validated by its refinement |
| `unsafe` block | may state `requires`/`ensures` as the safety argument, and the audit table (doc 24 §11) counts it |
| plugin ABI | contracts are checked on the host side, because a plugin is not trusted |

```vela
unsafe("len <= capacity, checked by the caller")
  requires len <= capacity
{
  ptr.add(len).write(v)
}
```

An `unsafe` block with a `requires` clause is a *documented* safety argument, and
`vela build --audit` shows whether each one has it.

---

## 7. Proving, not just checking

**Planned but designed.** `--contracts=prove` asks an SMT backend (Z3 or an
in-house solver) to discharge contracts statically:

* linear integer and real arithmetic,
* array reads and lengths,
* refinement predicates,
* loop invariants as induction,
* no quantifiers beyond finite ranges.

A contract the solver cannot prove falls back to a runtime check and is reported
as `note: unproved`, never as a failure. That is the honest position: proof where
it is cheap, checks where it is not, and no pretence that a compiler is a theorem
prover.

---

## 8. Cost

| Mode | Cost |
| --- | --- |
| `off` | zero; contracts are documentation |
| `check` (debug) | one branch per clause, no allocation, `ensures` evaluated once at return |
| `check` (release, opt in) | same, measured per function in `--stats` |
| `prove` | build time only; proved clauses cost nothing at run time |

A contract that allocates (a `Str` comparison that builds a message) is a
`W-CONTRACT-010`; the message is built only when the clause fails, on every
implementation.

---

## 9. Examples

**Binary search, with its invariant written down:**

```vela
fn search(xs: List<Int>, target: Int) -> Int?
  requires isSorted(xs)
  ensures match result {
    Some(i) => xs[i] == target
    nil     => not xs.contains(target)
  }
{
  mut lo = 0
  mut hi = xs.len
  while lo < hi
    asserts 0 <= lo and lo <= hi and hi <= xs.len
    asserts not xs[0..<lo].contains(target) and not xs[hi..].contains(target)
  {
    let mid = lo + (hi - lo) / 2
    if xs[mid] == target { return Some(mid) }
    if xs[mid] < target { lo = mid + 1 } else { hi = mid }
  }
  nil
}
```

**A validated identifier, used without re-checking:**

```vela
type UserId = Int where self > 0

fn load(id: UserId) -> Result<User, DbError> {
  // no `if id <= 0` here: the type is the check
  try db.queryOne("select * from users where id = $1", id)?
}
```

---

## 10. What contracts are not

* Not exceptions: a violated `requires` is a bug in the caller, and it panics
  (debug) or is undefined-free but unchecked (`off`). Expected failure is still
  `Result`.
* Not a substitute for validation at a trust boundary: a decoded value is
  validated with `Validate`, and a refinement is a second, cheaper net.
* Not a full specification language: there are no quantifiers over infinite
  domains, no user-defined lemmas and no proof scripts. Those are `planned` if a
  real need appears.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-CONTRACT-010` | impure expression in a contract |
| `E-CONTRACT-020` | refinement over an already-refined base |
| `E-CONTRACT-030` | statically known value violates a refinement |
| `E-CONTRACT-040` | struct literal bypasses an invariant |
| `E-CONTRACT-050` | implementation contract weaker than the trait's |
| `E-CONTRACT-060` | loop invariant false at entry |
| `E-CONTRACT-070` | `old()` used outside `ensures` |
| `W-CONTRACT-010` | contract allocates on the success path |
| `W-CONTRACT-020` | `unsafe` block without a `requires` clause |

---

Next: [43-streams.md](43-streams.md).
