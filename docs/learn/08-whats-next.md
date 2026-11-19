# 8 — What's next

## 8.1 Where you are

You can now write, build and debug a Vela program using everything the 0.2.0
compiler implements:

* six kinds of value, `let`/`mut`, truthiness;
* strings with interpolation and fourteen string and map builtins;
* lists and maps, indexing, dot access, iteration;
* `if`, `while`, `for`, `break`, `continue`;
* top-level functions, recursion, mutual recursion;
* `assert`, `error` and readable runtime errors;
* `make test` and the compiler's own test suite.

That is a small language. It is also a complete one: every program in chapter 7
is real, runs today, and needs nothing that is missing.

## 8.2 What is missing, and why

| Missing | Consequence | Specified in |
| --- | --- | --- |
| closures | functions cannot be passed or stored | [05-functions.md](../spec/05-functions.md) |
| structs, traits, generics | records are maps; no nominal types, no interfaces | [06-data.md](../spec/06-data.md), [07-generics.md](../spec/07-generics.md) |
| modules and packages | one file, one namespace | [08-modules.md](../spec/08-modules.md) |
| static types | the compiler checks names and arity, not types | [02-types.md](../spec/02-types.md) |
| `Result` and `?` | all failure is fatal | [11-errors.md](../spec/11-errors.md) |
| reference counting | memory is never freed | [09-memory.md](../spec/09-memory.md) |
| `match` | use `if`/`else if` chains | [03-expressions.md](../spec/03-expressions.md) |
| `async` | sequential only | [10-concurrency.md](../spec/10-concurrency.md) |
| UI and web | terminal programs only | [13-ui.md](../spec/13-ui.md), [14-web.md](../spec/14-web.md) |
| systems (OS/kernels) | no freestanding target yet | [15-systems.md](../spec/15-systems.md) |
| tooling (`vela`, LSP, formatter) | `velac` only | [25-tooling.md](../spec/25-tooling.md) |
| AI, graphics, media, games, DB | not in the compiler | docs 20–36 |

The column on the right is the point: none of this is undefined. Every missing
feature has a document that says what it will be, with examples, diagnostics and
rules. Reading a spec document is how you find out whether a feature you want is
already designed, and what it will look like when it lands.

## 8.3 The order things will land

The roadmap is not a wish list; each step depends on the one before.

1. **A type checker** over the values that already exist (`num`, `str`, `bool`,
   `nil`, `list`, `map`), catching `"a" + 1` mistakes before the program runs.
2. **Closures** — function values with captures, which unlocks `map`/`filter`
   style code.
3. **Structs and traits** — nominal records, methods, interfaces.
4. **Reference counting and the cycle collector** — bounded memory.
5. **Modules and packages** — multi-file programs, `use`, visibility.
6. **`Result`, `Option`, `match`** — errors as values.
7. **The UI and web backends** — apps and sites.
8. **The systems backend** — freestanding targets.

Every one of those is a document in [`spec/`](../spec/README.md), written before
the compiler work, which is the opposite order from how most languages do it and
the reason this repository can be honest about what it has.

## 8.4 How to help

* **Try things and report what breaks.** A program that looks valid and fails is
  a compiler bug; the test suite is where it goes.
* **Write a test.** Add `tests/cases/name.vela` and `name.out`; `make test` runs
  it forever after. That is the cheapest contribution with the longest life.
* **Read a spec document and disagree.** The RFC process is in
  [`spec/rfc/`](../spec/rfc/README.md): a proposal names the documents it changes
  and the principle it serves.
* **Port something small.** A program from another language, translated with the
  map in [19-migration.md](../spec/19-migration.md), is the best test of whether
  the design is usable.

## 8.5 Reference card

```vela
# comments

let x = 1                # immutable
mut y = 2                # mutable
y += 1

# values
nil   true   false   42   2.5   "text"   [1, 2]   {a: 1}

# strings
"hello ${name}"          # interpolation
len(s)  upper(s)  lower(s)  trim(s)
split(s, ",")  join(xs, "-")  contains(s, "x")
replace(s, "a", "b")  indexOf(s, "x")
startsWith(s, "a")  endsWith(s, "z")

# collections
xs[0]  xs[-1]  xs[1] = 9        # binding must be mut
push(xs, 4)  at(xs, 0)  set(xs, 0, 9)
len(xs)  contains(xs, 4)  indexOf(xs, 4)
m.name  m["name"]  m.k = 1  keys(m)  values(m)
has(m, "k")  remove(m, "k")

# numbers
+ - * / %   == != < <= > >=   && || !
abs(v)  sqrt(v)  floor(v)  ceil(v)  num("12")  str(12)

# control flow
if cond { } else if cond { } else { }
while cond { }
for x in xs { }        # list, map keys, or a string
for i in range(n) { }  # 0..n-1 ; range(a, b) is a..b-1
break   continue

# functions
fn name(a, b) {
  return a + b
}

# failure
assert cond
error("message")

# output
print(v)    println(v)
```

## 8.6 One last program

It uses every feature in the language, and it is the shape of program 0.2 is
good at: a small tool with data, logic and a report.

```vela
fn sum(xs) {
  mut total = 0
  for x in xs {
    total += x
  }
  return total
}

fn average(xs) {
  if len(xs) == 0 {
    error("average of an empty list")
  }
  return sum(xs) / len(xs)
}

fn report(title, xs) {
  println("== ${title} ==")
  println("count:   ${len(xs)}")
  println("sum:     ${sum(xs)}")
  println("average: ${average(xs)}")
  println("values:  ${join(xs, ", ")}")
}

report("scores", [90, 72, 85, 100])
report("empty", [])
```

The second call stops with a clear message — which is exactly what 0.2 does
instead of exceptions. When `Result` lands (chapter 8 §8.3, step 6), that
`error("average of an empty list")` becomes a `Result` a caller can handle. Until
then, it is a documented, deliberate stop.

Write programs. Report what hurts. That is how the language gets better.
