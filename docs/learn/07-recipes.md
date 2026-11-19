# 7 — Recipes

Five complete programs, each with the output it produces. Type them in, run
them, then change them.

---

## 7.1 FizzBuzz

The classic: for 1 to 20, print `Fizz` for multiples of 3, `Buzz` for 5,
`FizzBuzz` for both, and the number otherwise.

```vela
mut n = 1
while n <= 20 {
  if n % 15 == 0 {
    println("FizzBuzz")
  } else if n % 3 == 0 {
    println("Fizz")
  } else if n % 5 == 0 {
    println("Buzz")
  } else {
    println(n)
  }
  n += 1
}
```

```
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
16
17
Fizz
19
Buzz
```

Note the order: test the combined case **first**, or 15 prints `Fizz`.

---

## 7.2 Word frequency

Count how often each word appears, then print the counts.

```vela
let text = "the quick brown fox jumps over the lazy dog the fox"
let words = split(text, " ")

mut counts = {}
for w in words {
  if has(counts, w) {
    counts[w] = counts[w] + 1
  } else {
    counts[w] = 1
  }
}

for w in counts {
  println("${w}: ${counts[w]}")
}
```

```
the: 3
quick: 1
brown: 1
fox: 2
jumps: 1
over: 1
lazy: 1
dog: 1
```

Insertion order is preserved, so the output follows the first appearance of each
word. That is a property of Vela's maps, not luck.

---

## 7.3 Inventory total

A list of records, summed by a loop, with a formatted report.

```vela
let inventory = [
  {name: "bolt", price: 0.25, qty: 40},
  {name: "nut", price: 0.15, qty: 60},
  {name: "washer", price: 0.05, qty: 100},
]

mut total = 0
for item in inventory {
  let line = item.price * item.qty
  total += line
  println("${item.name}: ${item.qty} x ${item.price} = ${line}")
}

println("---")
println("total: ${total}")
```

```
bolt: 40 x 0.25 = 10
nut: 60 x 0.15 = 9
washer: 100 x 0.05 = 5
---
total: 24
```

`item.price` and `item.qty` are map reads through dot access; the record shape is
conventional, not declared, which is the trade 0.2 makes.

---

## 7.4 Parsing `key=value` lines

A small parser: split lines, split each line on `=`, build a map, then read it
with a default.

```vela
let config = """
name=acme
port=8080
debug=true
"""

mut settings = {}
for line in split(trim(config), "\n") {
  let parts = split(line, "=")
  if len(parts) == 2 {
    settings[parts[0]] = parts[1]
  } else {
    println("skipping: ${line}")
  }
}

println(settings.name)
println(num(settings.port) + 1)

mut debug = false
if settings["debug"] == "true" {
  debug = true
}
println("debug: ${debug}")
```

```
acme
8081
debug: true
```

Two things worth noticing: `num()` converts the text to a number, and a missing
key is `nil`, which is neither `"true"` nor an error — exactly what a config
reader wants.

---

## 7.5 Bubble sort, written out

There is no `sort` builtin in 0.2, so this is the algorithm a program needs, and
it exercises indexing, a nested loop and swapping.

```vela
mut xs = [5, 2, 9, 1, 5, 6]

mut n = len(xs)
mut swapped = true
while swapped {
  swapped = false
  mut i = 0
  while i < n - 1 {
    if xs[i] > xs[i + 1] {
      let tmp = xs[i]
      xs[i] = xs[i + 1]
      xs[i + 1] = tmp
      swapped = true
    }
    i += 1
  }
}

println(xs)
```

```
[1, 2, 5, 5, 6, 9]
```

`xs` must be `mut` because it is written through indexing; the elements are
numbers, so swapping copies them.

---

## 7.6 A tiny REPL-style calculator

Input is not available in 0.2, so the "input" is a list of commands — the shape a
real program would have once it reads from somewhere.

```vela
let commands = ["push 3", "push 4", "add", "push 5", "mul", "show"]

mut stack = []
for command in commands {
  let parts = split(command, " ")
  let op = parts[0]

  if op == "push" {
    push(stack, num(parts[1]))
  } else if op == "add" && len(stack) >= 2 {
    let b = stack[-1]
    let a = stack[-2]
    remove(stack, len(stack) - 1)
    remove(stack, len(stack) - 1)
    push(stack, a + b)
  } else if op == "mul" && len(stack) >= 2 {
    let b = stack[-1]
    let a = stack[-2]
    remove(stack, len(stack) - 1)
    remove(stack, len(stack) - 1)
    push(stack, a * b)
  } else if op == "show" {
    println(stack)
  } else {
    println("bad command: ${command}")
  }
}
```

```
[35]
```

---

## 7.7 What these recipes show

| Pattern | Where it appears |
| --- | --- |
| accumulate into a `mut` | inventory total, FizzBuzz |
| map as a counter | word frequency |
| map as a record | inventory |
| map with a default | config reader |
| nested loop and swap | bubble sort |
| list as a stack | calculator |
| `split` + `num` | parsing |
| interpolation for a report | every recipe |

Those eight patterns cover most small programs. The next chapter is about the
language beyond them.
