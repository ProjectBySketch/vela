# Learn Vela

Eight short chapters that take you from "I have never seen this language" to
"my program does what I want". They teach **the language this repository
actually ships**, 0.2.0 — not the larger language in [`spec/`](../spec/README.md).
Where the two differ, this book says so and tells you where to look.

| # | Chapter | You learn |
| --- | --- | --- |
| 1 | [Getting started](01-getting-started.md) | build, run, and read the generated C |
| 2 | [Values, variables and strings](02-values-and-strings.md) | `let`/`mut`, numbers, text, interpolation |
| 3 | [Lists and maps](03-lists-and-maps.md) | collections, indexing, records, iteration |
| 4 | [Control flow](04-control-flow.md) | `if`, `while`, `for`, `break`, `continue` |
| 5 | [Functions](05-functions.md) | defining, calling, recursion, scope |
| 6 | [Errors and debugging](06-errors-and-debugging.md) | `assert`, `error`, reading a panic |
| 7 | [Recipes](07-recipes.md) | five small programs, line by line |
| 8 | [What's next](08-whats-next.md) | the road to 1.0 and how to read the spec |

If you have five minutes, read chapters 1 and 2 and write FizzBuzz. If you have
an hour, the whole book.

---

## The one-paragraph tour

A Vela program is a sequence of statements and function definitions in a
`.vela` file. It runs top to bottom; there is no `main` to declare. Values are
dynamic: `nil`, numbers, booleans, strings, lists and maps. `let` binds a name
once, `mut` allows reassignment. Braces group; semicolons are optional and
meaningless; newlines mean nothing. `print` and `println` write to standard
output. That is the whole core, and the rest of this book is detail.

```vela
let name = "world"
mut count = 3

for i in range(count) {
  println("hello ${name}, #${i + 1}")
}
```

```
hello world, #1
hello world, #2
hello world, #3
```
