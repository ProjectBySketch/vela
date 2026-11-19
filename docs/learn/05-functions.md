# 5 — Functions

## 5.1 Defining and calling

```vela
fn add(a, b) {
  return a + b
}

println(add(2, 3))      # 5
```

A function that reaches the end without `return` yields `nil`:

```vela
fn greet(name) {
  println("hello ${name}")
}

println(greet("Ada"))   # hello Ada, then nil
```

Use `return` for the value you care about, and leave a function bare when it only
performs an effect like printing.

## 5.2 Parameters are values

There is no type annotation and no default value in 0.2. A missing argument is a
compile error (arity is checked), an extra one too:

```vela
fn area(w, h) { return w * h }

println(area(2, 3))       # 6
println(area(2))          # error: area() takes 2 argument(s), 1 given
```

Arguments are passed by value — but lists and maps are *shared*, so a function
that pushes into its parameter changes the caller's list (chapter 3 §3.1).

## 5.3 Order does not matter

```vela
println(double(21))     # 42, even though double comes later

fn double(x) {
  return x * 2
}
```

The compiler collects every top-level `fn` before compiling the program, so
mutual recursion works too:

```vela
fn isEven(n) {
  if n == 0 { return true }
  return isOdd(n - 1)
}

fn isOdd(n) {
  if n == 0 { return false }
  return isEven(n - 1)
}

println(isEven(10))     # true
```

## 5.4 Recursion

```vela
fn fact(n) {
  if n <= 1 { return 1 }
  return n * fact(n - 1)
}

fn fib(n) {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}

println(fact(5))       # 120
println(fib(10))       # 55
```

There is no tail-call optimisation, so deep recursion can exhaust the stack. The
iterative version is always available:

```vela
fn factLoop(n) {
  mut acc = 1
  mut i = 2
  while i <= n {
    acc *= i
    i += 1
  }
  return acc
}
```

## 5.5 Functions are top-level only

A function cannot be declared inside another function, inside an `if`, or inside
a loop in 0.2 — the compiler rejects it with *"functions must be declared at the
top level"*. Helper functions are siblings:

```vela
fn classify(n) {
  if n < 0 { return "negative" }
  return "non-negative"
}

fn report(xs) {
  for x in xs {
    println("${x}: ${classify(x)}")
  }
}
```

## 5.6 Scope

* Parameters and `let`/`mut` declarations are visible in the function body.
* Top-level declarations (before or after the function) are **not** visible
  inside a function — there are no globals in 0.2. Pass values in.
* A function cannot see the variables of its caller.

```vela
fn show(x) {
  println(x)        # fine: x is a parameter
}

show(1)
```

```vela
let secret = 42

fn reveal() {
  println(secret)   # error: undefined variable 'secret'
}
```

The fix is a parameter: `fn reveal(value) { ... }` called as `reveal(secret)`.

## 5.7 Functions without a return value

A function used for its side effects returns `nil`, which is falsy. Do not use it
in a condition by accident:

```vela
fn log(msg) {
  println("[log] ${msg}")
}

log("starting")          # fine
if log("x") { ... }      # always false — the call returned nil
```

## 5.8 Composition

The way to keep a program readable without closures is small functions that
return values, combined at the call site:

```vela
fn words(text) {
  return split(text, " ")
}

fn nonEmpty(xs) {
  mut out = []
  for x in xs {
    if len(x) > 0 {
      push(out, x)
    }
  }
  return out
}

fn longest(xs) {
  mut best = ""
  for x in xs {
    if len(x) > len(best) {
      best = x
    }
  }
  return best
}

println(longest(nonEmpty(words("the quick  brown fox"))))   # quick
```

## 5.9 A word on what is missing

No closures, no default parameters, no named arguments, no overloading, no
generics. The specification has all of them; this compiler does not yet. When you
miss a feature, chapter 8 tells you which document defines it.

## 5.10 Exercises

1. Write `fn max(xs)` returning the largest number in a list.
2. Write `fn count(xs, v)` returning how many times `v` appears.
3. Write `fn joinWords(words, sep)` without using the `join` builtin.
4. Write `fn power(base, exp)` by repeated multiplication.
5. Write `fn isPalindrome(s)` using indexing and `len`.
