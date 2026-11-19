# 4 — Control flow

## 4.1 `if`

```vela
let n = 7
if n % 2 == 0 {
  println("even")
} else {
  println("odd")
}
```

`else if` chains as you would expect:

```vela
let score = 82
if score >= 90 {
  println("A")
} else if score >= 80 {
  println("B")
} else if score >= 70 {
  println("C")
} else {
  println("F")
}
```

Conditions can be any value (chapter 2 §2.4), and there are no parentheses around
them — `if (x) { }` also parses, but the parentheses are redundant.

There is no `if` **expression** in 0.2: you cannot write `let x = if ...`. Use a
`mut` variable and assign in the branches:

```vela
mut label = "unknown"
if n > 0 {
  label = "positive"
} else if n < 0 {
  label = "negative"
} else {
  label = "zero"
}
```

## 4.2 `while`

```vela
mut i = 0
while i < 5 {
  println(i)
  i += 1
}
```

The condition is re-evaluated before each iteration. A `while` that never changes
the condition loops forever — `break` is the escape hatch:

```vela
mut n = 0
while true {
  n += 1
  if n == 3 {
    break
  }
}
println(n)      # 3
```

## 4.3 `for`

`for` iterates a list, the keys of a map, or the bytes of a string.

```vela
for x in [10, 20, 30] {
  println(x)
}

for ch in "abc" {
  println(ch)          # a, b, c (one byte per step)
}

let user = {name: "Ada", age: 36}
for key in user {
  println("${key} = ${user[key]}")
}
```

`range(n)` makes the counting loop:

```vela
for i in range(5) {
  println(i)           # 0 1 2 3 4
}

mut total = 0
for i in range(1, 10) {
  total += i
}
println(total)         # 45
```

`range` with one argument counts from 0; with two, from the first (inclusive) to
the second (exclusive). A descending loop is a `while`:

```vela
mut i = 5
while i > 0 {
  println(i)
  i -= 1
}
```

The iterable is evaluated **once**, before the first iteration, so adding to a
list inside the loop does not extend it:

```vela
mut xs = [1, 2]
for x in xs {
  push(xs, x * 10)      # legal, but the loop still runs twice
}
println(xs)             # [1, 2, 10, 20]
```

## 4.4 `break` and `continue`

* `break` leaves the innermost loop.
* `continue` skips to the next iteration.

```vela
for n in range(10) {
  if n == 3 { continue }     # skip 3
  if n == 6 { break }        # stop before 6
  print(n)
}
println("")                  # 01245
```

There are no labels in 0.2, so a nested loop that must exit both is written with
a `mut` flag:

```vela
mut found = false
for row in range(3) {
  for col in range(3) {
    if row * col == 2 {
      found = true
      break
    }
  }
  if found { break }
}
```

## 4.5 A state machine

The pattern that shows up in every real program: a value that moves between named
states.

```vela
mut state = "idle"
let events = ["start", "pause", "resume", "stop", "stop"]

for event in events {
  if state == "idle" && event == "start" {
    state = "running"
  } else if state == "running" && event == "pause" {
    state = "paused"
  } else if state == "paused" && event == "resume" {
    state = "running"
  } else if event == "stop" {
    state = "stopped"
  } else {
    println("ignored: ${event} while ${state}")
  }
  println("${event} -> ${state}")
}
```

## 4.6 Common traps

| Trap | What happens | Fix |
| --- | --- | --- |
| forgetting `mut` | compile error | declare with `mut` |
| `for` over a non-list | runtime error | iterate a list, map or string |
| off-by-one in `range(n)` | last value is `n - 1` | `range(n + 1)` |
| changing the list you iterate | the loop sees the original length | iterate a copy, or collect first |
| `if` without braces | compile error | braces are required |

## 4.7 Exercises

1. Print the numbers 1–20, marking multiples of 3 as `fizz`.
2. Sum the even numbers below 100.
3. Print a 5×5 grid of `*` using nested loops.
4. Given a list of numbers, find the largest without using a builtin sort.
5. Print the first 10 Fibonacci numbers with a `while` loop.
