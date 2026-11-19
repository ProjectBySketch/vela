# 3 — Lists and maps

## 3.1 Lists

```vela
let xs = [1, 2, 3]
let mixed = [1, "two", true]      # legal: values are dynamic
let empty = []
```

| Operation | Result |
| --- | --- |
| `len(xs)` | number of items |
| `xs[0]` | first item |
| `xs[-1]` | last item (negative counts from the end) |
| `xs[i]` | item `i`, panic if out of range |
| `xs[i] = v` | replace (the binding must be `mut`) |
| `push(xs, v)` | append, returns the list |
| `at(xs, i)` | same as `xs[i]` |
| `set(xs, i, v)` | same as `xs[i] = v` |
| `contains(xs, v)` | `true` if an equal item is present |
| `indexOf(xs, v)` | position, or `-1` |
| `xs + ys` | a new list with both |
| `join(xs, ", ")` | string of the items |

```vela
mut xs = [10, 20, 30]
println(xs[0])        # 10
println(xs[-1])       # 30
xs[1] = 99
push(xs, 40)
println(xs)           # [10, 99, 30, 40]
println(len(xs))      # 4
println(contains(xs, 99))    # true
println(indexOf(xs, 30))     # 2
```

An out-of-range index stops the program instead of returning `nil`, because a
silent `nil` from a list is almost always a bug:

```vela
println([1, 2][5])
```

```
vela: runtime error: []: index 5 is out of range for a list of 2 item(s)
```

### Lists are shared, not copied

```vela
mut a = [1, 2, 3]
mut b = a
b[0] = 99
println(a)      # [99, 2, 3] — same list!
```

`b = a` copies the reference. If you need an independent copy, build one:

```vela
mut b = []
for x in a {
  push(b, x)
}
b[0] = 1
println(a)      # unchanged
```

This is the single most important thing to know about Vela's collections. It is
also why `push` inside a function changes the caller's list.

## 3.2 Maps

A map is a set of key/value pairs that remembers insertion order. It is Vela's
record type.

```vela
let user = {name: "Ada", age: 36}
println(user.name)         # Ada
println(user["age"])       # 36
println(len(user))         # 2
println(keys(user))        # [name, age]
println(values(user))      # [Ada, 36]
println(has(user, "name")) # true
```

| Operation | Result |
| --- | --- |
| `m.key` | value for key `"key"` |
| `m["key"]` | the same |
| `m[keyExpr]` | a computed key |
| `m.k = v` / `m[k] = v` | insert or update (binding must be `mut`) |
| `keys(m)`, `values(m)` | lists, in insertion order |
| `has(m, k)` | `true`/`false` |
| `remove(m, k)` | delete a key, returns the map |
| `len(m)` | number of keys |
| `for k in m` | iterate the keys |

Reading a missing key yields `nil`, which is why `has` exists:

```vela
mut counts = {}
println(counts["a"])          # nil
counts["a"] = 1               # insert
println(has(counts, "a"))     # true
remove(counts, "a")
println(has(counts, "a"))     # false
```

### Keys are values

A key can be any value, and equality is by value. In practice keys are strings
(the `name:` form makes them strings) and numbers:

```vela
mut byId = {}
byId[7] = "seven"
println(byId[7])       # seven
```

### Records

The `{name: ...}` form and dot access are designed to be used together:

```vela
let p = {name: "Ada", role: "engineer", active: true}
println("${p.name} is a ${p.role}")

if p.active {
  println("online")
}
```

Nesting works, and so does a list of records:

```vela
let people = [
  {name: "Ada", age: 36},
  {name: "Grace", age: 45},
]

for person in people {
  println("${person.name} (${person.age})")
}
```

### A map of lists

```vela
mut byRole = {}
byRole["admin"] = ["ada", "grace"]
byRole["user"] = ["linus"]

for role in byRole {
  println("${role}: ${join(byRole[role], ", ")}")
}
```

## 3.3 `nil` inside collections

`nil` is a value like any other, so a list can contain it:

```vela
let xs = [1, nil, 3]
println(len(xs))     # 3
println(xs[1])       # nil
```

Check before using an element that may be missing, or use `has`/`contains`.

## 3.4 Building a collection with a loop

There is no `map`/`filter` builtin in 0.2; a loop is the idiom, and it is worth
being fluent in because it always works:

```vela
let numbers = [1, 2, 3, 4, 5, 6]

mut evens = []
mut total = 0
for n in numbers {
  if n % 2 == 0 {
    push(evens, n)
    total += n
  }
}
println(evens)      # [2, 4, 6]
println(total)      # 12
```

## 3.5 Copying, again

Both lists and maps are shared. Two functions that look correct can fight over
the same map, so pass data deliberately: a function that mutates a collection
should say so in its name (`addItem`, `fill`), and a function that must not
change it should build its own result.

```vela
fn withExtra(xs, v) {
  mut out = []
  for x in xs {
    push(out, x)
  }
  push(out, v)
  return out
}

let original = [1, 2]
let bigger = withExtra(original, 3)
println(original)     # [1, 2]
println(bigger)       # [1, 2, 3]
```

## 3.6 Exercises

1. Build `[1, 2, ..., 10]` with a loop and print its sum.
2. Count the words in a sentence: `split` it, then count with a map.
3. Given a list of names, print them sorted by length (any simple sort).
4. Build a map from a list of pairs `["a=1", "b=2"]` using `split(pair, "=")`.
5. Write `fn reverse(xs)` that returns a new reversed list without changing the
   input.
