# 1 — Getting started

## 1.1 What you need

A C compiler and `make`. Vela compiles to C and lets the platform's own compiler
finish the job, so there is no runtime to install and no toolchain to download.

| Platform | You need |
| --- | --- |
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Debian / Ubuntu / WSL | `build-essential` |
| iOS | nothing here — use the `.ipa` artifact |

## 2. Build the compiler

From the repository root:

```sh
make
```

That produces two things:

* `build/velac` — the compiler, about 2,000 lines of C;
* `build/runtime/` — `vela_runtime.c`, `vela_runtime.h` and `vela_main.c`, which
  every generated program links against.

Check it:

```sh
./build/velac --version      # velac 0.2.0 (Vela 0.2.0)
./build/velac --help
```

If you installed the `.deb` or the `.dmg`, plain `velac` works from anywhere and
looks for its runtime in `<prefix>/lib/vela/runtime`.

## 3. Your first program

Create `hello.vela`:

```vela
println("hello, world")
```

Build and run it:

```sh
./build/velac hello.vela -o hello
./hello
```

```
hello, world
```

Three things happened, and they are worth knowing about because you will read
the output of step 2 many times:

1. `velac` read `hello.vela` and wrote `hello.c` next to the binary.
2. It invoked your C compiler (`cc`) on `hello.c`, `vela_runtime.c` and
   `vela_main.c`.
3. The result is a native executable. No interpreter, no VM.

### Reading the generated C

```sh
./build/velac hello.vela --emit-c -o hello.c
```

`hello.c` is short and readable:

```c
#include "vela_runtime.h"

vela_value vela_main(void) {
  vela_println(vela_str("hello, world"));
  return vela_nil();
}
```

Every Vela value becomes a `vela_value`, and every operation becomes a call into
the runtime. That is why the compiler is small and why the same generated C can
run on macOS, Linux and inside an iOS app. When something behaves strangely,
reading this file is the fastest way to understand why.

## 4. Useful flags

```sh
velac prog.vela                  # builds ./prog and ./prog.c
velac prog.vela -o build/prog    # choose the output path
velac prog.vela --emit-c -o x.c  # stop after generating C
velac --cc clang prog.vela       # choose the C compiler
velac --runtime ./runtime p.vela # point at the runtime directory
```

`velac` finds the runtime in `$VELA_RUNTIME`, next to itself, or in
`<prefix>/lib/vela/runtime` — in that order.

## 5. Run the test suite

```sh
make test
```

Every file in `tests/cases/` is compiled and run, and its stdout is compared with
the matching `.out` file. When you change the compiler, this is the check that
matters.

## 6. Your second program

```vela
# greet.vela
let name = "Ada"
let age = 36

println("${name} is ${age} years old")
println("next year: ${age + 1}")
println("name in upper case: ${upper(name)}")
```

```
Ada is 36 years old
next year: 37
name in upper case: ADA
```

`${...}` inside a string is interpolation: it runs any expression and splices the
result in. It is the idiomatic way to build text in Vela — more on that in the
next chapter.

## 7. What just happened, in one table

| You wrote | The compiler did |
| --- | --- |
| `let name = "Ada"` | `vela_value v_name = vela_str("Ada");` |
| `println(...)` | `vela_println(...);` |
| `${age + 1}` | `vela_add(vela_num(36), vela_num(1))` |
| `upper(name)` | `vela_builtin_upper(v_name)` |

## 8. If something fails

| Message | Means |
| --- | --- |
| `velac: cannot open 'x.vela'` | the path is wrong |
| `x.vela:3: error: expected '}'` | a brace is missing; the line is where the parser gave up |
| `expected an expression` | usually a stray operator, a comma, or a map key missing a value |
| `undefined variable 'x'` | the name is not in scope at that point |
| `cannot assign to 'x': ... 'mut'` | you reassigned a `let` |
| `undefined variable ...` after an `if` | the variable was declared inside the block and is not visible outside |

Now you can build and run. Chapter 2 is the actual language.
