# 2 — Values, variables and strings

## 2.1 The six kinds of value

| Kind | Examples | `type(x)` |
| --- | --- | --- |
| nothing | `nil` | `"nil"` |
| number | `0`, `42`, `-3`, `2.5`, `1e9` | `"num"` |
| boolean | `true`, `false` | `"bool"` |
| string | `"hello"`, `""`, `"a\nb"` | `"str"` |
| list | `[1, 2, 3]`, `[]` | `"list"` |
| map | `{name: "Ada"}`, `{}` | `"map"` |

There is one number type: every number is an IEEE double. `1` and `1.0` are the
same value, and `type(1)` is `"num"`. Integer-looking values print without a
decimal point, so `println(4 / 2)` gives `2` and `println(10 / 4)` gives `2.5`.

```vela
println(type(1))        # num
println(type("hi"))     # str
println(type(true))     # bool
println(type(nil))      # nil
println(type([1]))      # list
println(type({a: 1}))   # map
```

## 2.2 `let` and `mut`

```vela
let pi = 3.14159      # cannot be reassigned
mut counter = 0       # can
counter = counter + 1
counter += 1          # same thing
```

Assigning to a `let` is a compile error:

```vela
let x = 1
x = 2
```

```
main.vela:2: error: cannot assign to 'x': declare it with 'mut' instead of 'let'
```

The rule is about the **name**, not the value: a `mut` list and a `let` list can
both have elements added to them with `push`, because that changes the list, not
the binding. (Index assignment `xs[0] = 1` does require `mut`, because the
compiler treats it as an assignment to the name.)

`+=`, `-=`, `*=`, `/=` exist. There is no `++`.

## 2.3 Blocks and scope

```vela
let outer = "seen"

if true {
  let inner = "only here"
  println(outer)     # fine
  println(inner)     # fine
}

println(inner)       # error: undefined variable 'inner'
```

A block is `{ ... }`. `if`, `while`, `for` and function bodies are blocks. Names
declared inside are gone when the block ends. Inner blocks may reuse an outer
name (shadowing); the inner one wins until the block ends.

## 2.4 Truthiness

`if` and `while` accept any value. These are falsy:

| Falsy | Truthy |
| --- | --- |
| `false`, `nil` | `true`, any non-zero number |
| `0`, `""` | any non-empty string |
| `[]`, `{}` | any non-empty list or map |

```vela
if "" { println("never") } else { println("empty string is falsy") }
if [1] { println("a non-empty list is truthy") }
```

Because `0` and `""` are falsy, check for "missing" with `== nil` rather than
truthiness when a value could legitimately be zero or empty.

## 2.4.1 Numbers

```vela
println(1 + 2 * 3)      # 7 — precedence as you expect
println((1 + 2) * 3)    # 9
println(10 % 3)         # 1
println(-3 + 1)         # -2
println(abs(-7))        # 7
println(sqrt(9))        # 3
println(floor(2.9))     # 2
println(ceil(2.1))      # 3
println(num("12") + 1)  # 13
println(str(12) + "!")  # 12!
```

Division by zero stops the program with a runtime error. Comparisons work on
numbers and strings:

```vela
println(2 < 3)          # true
println("a" < "b")      # true
println(2 == 2.0)       # true
```

## 2.5 Strings

A string is immutable. Concatenation with `+` builds a new one:

```vela
let a = "Vela"
println(a + " is fun")   # Vela is fun
println(len(a))          # 4 (bytes)
println(a == "Vela")     # true
```

### Escapes

| Written | Is |
| --- | --- |
| `\n` | newline |
| `\t` | tab |
| `\r` | carriage return |
| `\\` | backslash |
| `\"` | a double quote |

Unknown escapes are kept as written: `"a\qb"` is the four characters `a\qb`.

### Interpolation

`${ ... }` inside a double-quoted string evaluates an expression and splices its
text:

```vela
let name = "Ada"
let n = 3
println("hello ${name}")
println("n = ${n}, twice = ${n * 2}")
println("nested: ${upper("abc")}")
println("sum ${1 + 2}${3 + 4}")
```

```
hello Ada
n = 3, twice = 6
nested: ABC
sum 37
```

Anything can go inside the braces: a variable, arithmetic, a function call, a
list or map literal, even a nested string. Braces inside the expression are
matched, so `"${has({a: 1}, "a")}"` is `true`.

If you want a literal `${`, there is no escape for it in 0.2 — build the string
in two pieces: `"$" + "{name}"`.

### String functions

| Function | Result |
| --- | --- |
| `len(s)` | length in bytes |
| `upper(s)`, `lower(s)` | case (ASCII) |
| `trim(s)` | remove leading/trailing whitespace |
| `split(s, sep)` | list of pieces |
| `join(list, sep)` | pieces joined |
| `contains(s, sub)` | `true`/`false` |
| `replace(s, from, to)` | every occurrence replaced |
| `startsWith(s, p)`, `endsWith(s, p)` | prefix/suffix test |
| `indexOf(s, sub)` | byte offset, or `-1` |

```vela
println(split("a,b,c", ","))        # [a, b, c]
println(join(["a", "b"], "-"))      # a-b
println(replace("a-b", "-", "+"))   # a+b
println(indexOf("hello", "ll"))     # 2
println(indexOf("hello", "z"))      # -1
```

Strings can be indexed by byte, which returns a one-character string:

```vela
let s = "hey"
println(s[0])      # h
println(s[-1])     # y
```

For text with multi-byte characters, indexing is by byte — keep that in mind
before treating `s[0]` as "the first character" of an emoji. Iterating a string
with `for` gives one byte per step for the same reason.

### Building strings in a loop

`+` allocates a new string every time, so a big loop is quadratic. For small
programs it does not matter; when it does, collect the pieces in a list and
`join` them:

```vela
mut parts = []
for i in range(5) {
  push(parts, str(i))
}
println(join(parts, ", "))     # 0, 1, 2, 3, 4
```

## 2.6 `nil`

`nil` means "no value". It is not an error; it is a value with its own type.

```vela
mut user = nil
println(type(user))       # nil
if user == nil {
  println("nobody is logged in")
}
```

Reading a field or an index of `nil` is a runtime error, so test before you
reach in.

## 2.7 Exercises

1. Print your name, age and the year you will turn 100, using interpolation.
2. Print `"HELLO"` in lower case and `"hello"` in upper case.
3. Given `let csv = "a,b,c"`, print the pieces one per line.
4. Given `let n = 7`, print whether it is even, using `%`.
5. Print the string `2 + 2 = 4` using one interpolation.
