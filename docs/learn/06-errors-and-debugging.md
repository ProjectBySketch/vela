# 6 — Errors and debugging

## 6.1 Two kinds of failure

Vela 0.2 has no exceptions and no `Result`. A program that goes wrong **stops**,
with a message and exit code 1. That is blunt, and it is honest: there is no
hidden control flow, and every failure is visible in the terminal.

There are two ways to fail on purpose:

```vela
assert x > 0                       # a bug if this is false
error("cannot continue: no data")  # an expected stop, with a message
```

| Written | Prints | When to use |
| --- | --- | --- |
| `assert cond` | `vela: runtime error: assertion failed` | an invariant that should never be false |
| `error(msg)` | `vela: runtime error: <msg>` | a condition you can explain |
| a wrong operation | `vela: runtime error: <detail>` | a bug in the program |

There is no `try`/`catch`. To keep going after a failed check, test first:

```vela
if has(user, "email") {
  println(user.email)
} else {
  println("no email on file")
}
```

## 6.2 The runtime errors you will meet

| Message | Cause | Fix |
| --- | --- | --- |
| `undefined variable 'x'` (compile time) | name not in scope | declare it, or check the block |
| `cannot assign to 'x'` (compile time) | assigned a `let` | use `mut` |
| `x() takes 2 argument(s), 1 given` (compile time) | arity | pass the right number |
| `assertion failed` | `assert` was false | fix the condition or the data |
| `[]: index 5 is out of range ...` | bad index | check `len(xs)` first |
| `division by zero` | `/` or `%` by 0 | guard the divisor |
| `cannot add num and map` | an operation on the wrong kind | check with `type(x)` |
| `cannot index a num` | `x[0]` where `x` is a number | index a list, string or map |
| `for loop expects a list, a map or a string` | iterating something else | iterate a collection |
| `map read expects a map` | `m[k]` where `m` is not a map | build the map first |

An out-of-range index is deliberate: a list returning `nil` silently would push
the bug downstream, where it is harder to find.

## 6.3 Reading a compile error

```
main.vela:7: error: undefined variable 'total'
```

That is `file:line: error: what`. The line is where the parser or generator
noticed, which is usually — but not always — where the mistake is. When the
message seems wrong, look one or two lines above.

A missing `}` is reported at the end of the file, because that is where the
parser ran out of input while still inside a block:

```
main.vela:24: error: expected '}'
```

## 6.4 Debugging with output

The fastest debugger is a `println`. Use interpolation to label it:

```vela
fn totalCost(items) {
  mut sum = 0
  for item in items {
    println("item ${item.name}: ${item.price}")
    sum += item.price
  }
  println("total: ${sum}")
  return sum
}
```

Three habits that save time:

1. **Print the type when a value surprises you**: `println(type(x))`.
2. **Print the shape, not just the value**: `println(len(xs))` next to
   `println(xs)` catches "empty list" immediately.
3. **Print inside the loop, not after it**, when the result is wrong — the first
   iteration that differs is the bug.

## 6.5 Reading the generated C

When output is not what you expect, the generated program tells you what the
compiler thought you wrote:

```sh
./build/velac prog.vela --emit-c -o prog.c
```

Compare the C with the source. A typical surprise:

```vela
let a = [1, 2]
let b = a
```

becomes

```c
vela_value v_a = vela_list_from(2, (vela_value[]){vela_num(1), vela_num(2)});
vela_value v_b = v_a;      /* the same pointer */
```

which is why `b` and `a` are the same list (chapter 3 §3.1). Reading the C is not
required to use Vela, but it removes every "why did that happen?".

## 6.6 Common mistakes, and their fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| program prints nothing | the code is inside an `if` that is false | print the condition |
| a loop runs forever | the loop variable is not changed | `i += 1` in the body |
| the last item is missing | `range(n)` stops before `n` | `range(n + 1)` |
| a map is empty after a function call | the function built a *new* map and returned it, but the caller ignored the return | assign the result |
| a change to a list shows up everywhere | lists are shared | build a copy |
| `nil` printed where a value was expected | the key or index does not exist | `has` / `len` check |
| text is garbled after `upper` | ASCII-only case conversion | it is documented; use ASCII |
| a string index splits a character | indexing is by byte | iterate graphemes is not available yet |

## 6.7 Tests as debugging

A test is a program with a known answer:

```vela
# tests/cases/total.vela
let prices = [3, 5, 7]
mut sum = 0
for p in prices { sum += p }
println(sum)
```

with `tests/cases/total.out` containing `15`. `make test` compares them. When a
program misbehaves, reducing it to a test with a fixed expectation is the fastest
way to see what changed.

## 6.8 When the compiler itself fails

If `velac` reports an error on a program that looks valid, or the generated C
does not compile, that is a compiler bug, not a language feature. The repository's
workflow runs the test suite on every push; a failing test names the case.

## 6.9 Exercises

1. Write a program that reads a list and stops with a clear `error` message when
   it is empty.
2. Take the buggy loop below and fix it:
   ```vela
   mut i = 0
   while i < 3 {
     println(i)
   }
   ```
3. Deliberately index out of range and read the error message; then guard it with
   `if`.
4. Break a `}` and read where the compiler reports it. Then fix it.
5. Emit the C for a map program and find the `vela_map_set` calls.
