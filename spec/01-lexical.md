# 01 — Lexical structure

**Status:** `spec`. `velac` 0.1 implements only the subset marked `impl` in
[00-status.md](00-status.md).

This document defines how source text becomes tokens. Everything after this is
grammar ([18-grammar.md](18-grammar.md)) and semantics.

---

## 1. Source text

| Property | Rule |
| --- | --- |
| Encoding | UTF-8. A byte-order mark is honoured and is not part of the first token. |
| Invalid UTF-8 | compile error `E-LEX-001`, with byte offset. |
| Line endings | `\n` and `\r\n` both end a line. A lone `\r` is `E-LEX-002`. |
| File extension | `.vela` |
| Maximum identifier length | none |
| Null bytes | compile error `E-LEX-003` |

---

## 2. Layout

Vela has **no significant newlines and no semicolons**. Whitespace separates
tokens; `{` `}` `(` `)` `[` `]` do the grouping. A statement ends where the next
one begins to parse, which is unambiguous because no statement form can be
continued by a token that starts another statement.

```vela
let a = 1 let b = 2 print(a + b)      # legal, and formatted onto three lines
```

A `;` is accepted and ignored, so that generated code and pasted snippets
survive. `vela fmt` never emits one.

Two conventions, not rules, keep programs readable: one statement per line, and
no more than one blank line in a row inside a block.

---

## 3. Comments

| Form | Meaning |
| --- | --- |
| `# ...` to end of line | comment (`impl`) |
| `// ...` to end of line | comment (`impl`) |
| `/* ... */` | block comment, **nests** (`spec`) |
| `/// ...` | doc comment for the next declaration (`spec`) |
| `/** ... */` | block doc comment (`spec`) |
| `//! ...` | module doc comment, must precede all declarations (`spec`) |

```vela
# a comment
// another, identical meaning
/* a block comment /* with a nested one */ still the comment */
```

An unterminated block comment is `E-LEX-010` at the opening `/*`.

### Doc comments

A doc comment attaches to the declaration that follows it. Its content is
Markdown. A fenced block tagged `vela` inside a doc comment is a **doc test**: it
is compiled and run by `vela test --doc`, and its expected output is given by a
`// =>` line.

```vela
/// Adds two numbers.
///
/// ```
/// assertEq(add(2, 3), 5)   // =>
/// ```
pub fn add(a: Num, b: Num) -> Num { a + b }
```

---

## 4. Identifiers

```
ident      := identStart identCont*
identStart := "a".."z" | "A".."Z" | "_" | unicodeXIDStart
identCont  := "a".."z" | "A".."Z" | "0".."9" | "_" | unicodeXIDContinue
```

A lone `_` is not an identifier; it is the **discard pattern** (doc 04 §6) and
may appear wherever a binding name may.

Identifiers are case-sensitive. Three naming conventions are enforced by the
linter (`vela check --lint`), never by the parser:

| Kind | Convention | Example |
| --- | --- | --- |
| value, function, module | `lowerCamel`, `snake_case` accepted in `core` | `totalPrice`, `total_price` |
| type, trait, view, style | `UpperCamel` | `HttpRequest`, `Card` |
| constant | `SCREAMING_SNAKE` | `MAX_RETRIES` |

---

## 5. Keywords

### 5.1 Reserved words (60)

These can never be identifiers. A trailing `_` makes them usable:
`let_`, `match_`, `type_`.

```
as      async   await   actor   break   catch   comptime  const   continue
defer   else    enum    extern  fail    false   fn        for     guard
if      impl    import  in      interface  is    let       loop    macro
match   mod     mut     nil     of      open    or        and     not
pub     return  select  self    shared  spawn   static    struct  super
theme   trait   true    try     type    unsafe  use       view    when
where   while   yield   style   assert  panic
```

`and`, `or`, `not` are reserved as alternative spellings of `&&`, `||`, `!`;
`vela fmt` rewrites them to the symbols. `assert` and `panic` are reserved
because they are also statement forms (doc 11 §5).

### 5.2 Contextual keywords (18)

These are ordinary identifiers except in the positions listed. This keeps
`theme`, `state`, `style` usable as field names, which matters when bridging to
JSON and to CSS-shaped data.

| Word | Recognised only as | Note |
| --- | --- | --- |
| `state`, `bind`, `env`, `computed` | a `view` member modifier | doc 13 §4 |
| `anim`, `keyframes`, `transition` | a `style` member | doc 13 §7 |
| `token` | a `theme` member | doc 13 §6 |
| `asset` | a top-level declaration | doc 13 §9 |
| `page`, `component` | a top-level declaration in `web` | doc 14 §2 |
| `route` | an attribute or a `web` declaration | doc 14 §4 |
| `derive`, `cfg`, `test`, `bench`, `inline`, `deprecated` | inside `#[...]` | doc 12 §4 |
| `Int`, `Float`, `Num`, `Bool`, `Str`, `Char`, `Bytes`, `List`, `Set`, `Map`,
`Tuple`, `Func`, `Range`, `Option`, `Result`, `Task`, `Channel`, `Ptr`,
`Volatile`, `Opaque`, `Any`, `Void`, `Never`, `Error` | a type position | doc 02 §3 |

Because they are contextual, `let state = 1` is legal at top level and
`struct S { style: Str }` declares a field called `style`.

---

## 6. Numeric literals

### 6.1 Integers

```
42          1_000_000     0x2A    0o52    0b101010
1u8   1i8  1u16  1i16  1u32  1i32  1u64  1i64  usize  isize
```

| Form | Type |
| --- | --- |
| no radix prefix, no suffix | `Int` (= 64-bit signed) in `strict`; `Num` in `loose` |
| `0x` `0o` `0b` | as above |
| `<digits><suffix>` | the named type; the value MUST fit or `E-LEX-020` |
| value that does not fit `Int` | `E-LEX-021`, unless an `u64` suffix is given |

`_` may appear between digits and nowhere else (`1_` is `E-LEX-022`). A trailing
letter that is not a known suffix is `E-LEX-023` (`123abc` does not lex as a
number followed by an identifier).

### 6.1.1 Literal adaptation

An unsuffixed integer literal takes the type its **context** requires when one is
required — a field of type `UInt8`, a parameter of type `IntSize`, a return
position, an indexed assignment — and is `Int` when no context does. The literal
must fit the required type (`E-LEX-021` otherwise, naming the value and the
type), which is what lets `Uart.ier.write(0)` mean "write the byte zero" without
a cast, while `Uart.ier.write(300)` stays an error instead of silently becoming
`44`.

The same rule applies to float literals: `1.0` in a `Float32` position is a
`Float32`. No other conversion is implicit — only literals adapt, so a variable
of type `Int` never becomes a `UInt8` without `as`.


### 6.2 Floating point

```
1.5      .5      1.5e3     1e-9     2.0f32     0x1p4
```

| Form | Type |
| --- | --- |
| digits `.` digits, optional exponent | `Float` (= binary64) |
| with `f32` suffix | `Float32` |
| hexadecimal float `0x1p4` | `Float`, exact |

`1.` is `E-LEX-030`; write `1.0`. `Infinity` and `NaN` are not literals; they
are `Float.inf` and `Float.nan` (doc 16).

### 6.3 The `Num` rule

`Num` is the union `Int | Float`. In `loose` mode, `1` and `1.0` are
indistinguishable to a reader and legal everywhere a number is expected; in
`strict` mode the compiler keeps them distinct and rejects mixing them without
an explicit conversion (doc 02 §5). This is why the same source can be a script
and a reliable program.

---

## 7. Character literals

```
'a'   '\n'   '\u{1F600}'   '\''   '\\'
```

A `Char` is one Unicode scalar value. A literal containing more than one scalar
is `E-LEX-040`.

---

## 8. String literals

Four forms.

### 8.1 Simple

```vela
"hello\nworld\u{41}\t\"quoted\"\\ \e"
```

Escapes: `\n \r \t \0 \\ \" \' \e` (escape, 0x1B), `\xNN` (one byte, must be
< 0x80 in a `Str`), `\u{...}` (one scalar), `\{` (a literal `{` where
interpolation would otherwise start), and `\` followed by a newline (line
continuation, which removes the newline and all leading whitespace on the next
line).

An unknown escape is `E-LEX-050`. An unescaped newline inside `"` is
`E-LEX-051`; use `"""`.

### 8.2 Interpolated

Any `"` string is interpolated. `${` starts an expression, which is formatted
with `Display` and spliced in:

```vela
let name = "world"
let n = 3
println("hello ${name}, you are ${n * 7} and ${if n > 2 { "old" } else { "new" }}")
```

Rules:

* Any expression may appear, including blocks; `${}` is `E-LEX-052`.
* An unterminated `${` is `E-LEX-053`.
* Interpolation calls `fmt.display` (doc 16). It never falls back to a debug
  representation.
* `\${` produces the two characters `${`.

### 8.3 Multi-line

```vela
let text = """
    Dear ${name},

    Your total is ${total}.
    """
```

Rules: the content begins after the newline that follows the opening `"""`.
The closing delimiter's indentation is removed from every non-blank line; if a
line has less indentation, that is `E-LEX-060` rather than a silent surprise.
A leading and trailing blank line is removed. Interpolation is active.

### 8.4 Raw

```vela
r"C:\path\no\escapes"      r#"contains "quotes" freely"#
```

No escapes and no interpolation. `r#"..."#` with any number of `#` allows the
delimiter to appear inside.

### 8.5 What strings are not

A `Str` is an immutable UTF-8 sequence with a length in bytes and a length in
*graphemes* available in O(1) only after indexing (doc 02 §3.5). It is never a
byte buffer: use `Bytes` for that. It is never markup: use `Markup` for HTML.

---

## 9. Attributes

An attribute annotates the declaration that follows:

```vela
#[derive(Eq, Hash, Display)]
#[repr(C)]
shared struct Key { id: Int, tag: Str }

#[cfg(target: "ios")]
fn haptic() { ... }

#[test]
fn arithmetic() { assertEq(1 + 1, 2) }
```

```
attribute  := "#" "[" attrBody "]"
attrBody   := path ( "(" attrArgs? ")" )?
attrArgs   := attrArg ( "," attrArg )*
attrArg    := literal | path | IDENT ":" literal | IDENT ":" path
```

The full list of 59 attributes and their meanings is doc 12 §4. An unknown
attribute is `E-LEX-070`. An attribute in the wrong position is `E-LEX-071`. An
attribute repeated where only one is allowed is `E-LEX-072`.

`#` followed by `[` is an attribute only where a declaration or statement may
begin; everywhere else `#` starts a comment. There is no ambiguity because `#[`
is not a valid comment prefix use.

---

## 10. Directive and shebang

A file may begin with `#!/usr/bin/env vela`; it is treated as a comment. A file
may begin with a **file directive**:

```vela
#![strict]              # static checking on for this module
#![deny(unsafe)]        # this module contains no unsafe code
#![profile("sys")]      # the module's profile (also settable in vela.pkg)
```

Directives MAY only precede all other items. A directive in the middle of a
file is `E-LEX-080`. `#!` followed by anything other than a known directive is
`E-LEX-081` — except in a file whose first two bytes make it a shebang, which is
always a comment.

---

## 11. Punctuation and operators

```
(  )  [  ]  {  }  ,  .  ..  ..<  ..=  :  ;  ::  ?  !  ...
+  -  *  /  %  **  &  |  ^  ~  <<  >>  >>>  |>  ??  ??=
=  +=  -=  *=  /=  %=  **=  <<=  >>=  &=  |=  ^=  ??=
==  !=  <  <=  >  >=  =>  ->  <-  &&  ||  @  #
```

| Token | Used by |
| --- | --- |
| `..` | open range `a..` |
| `..<` `..=` | bounded range |
| `::` | path separator in `use` and qualified paths |
| `?` | optional type `T?`, propagation operator `expr?` |
| `!` | logical not; `never` type `Never` spelling is `!` only in signatures |
| `...` | spread; variadic parameter |
| `**` | exponentiation (`spec`, not yet a 0.1 operator) |
| `>>>` | logical right shift (unsigned) |
| `|>` | pipeline |
| `??` `??=` | nil coalescing, nil-coalescing assignment |
| `=>` | `match` arm |
| `->` | return type, function type |
| `<-` | channel send in `select` arms |
| `@` | wrapper binding in views (doc 13 §4); reserved elsewhere |

`++` and `--` do not exist. Writing them is `E-LEX-090` with the hint "use
`x += 1`".

---

## 12. Token summary

```
token      := IDENT | KEYWORD | INT | FLOAT | CHAR | STRING | PUNCT | ATTR | EOF
STRING     := '"' char* '"' | '"""' ... '"""' | 'r' '#'* '"' ... '"' '#'*
```

The lexer produces a flat token list with byte offsets, line numbers and column
numbers, because diagnostics report all three. It performs no grammar decisions
except the one in §9 (`#[` as attribute).

---

## 13. Diagnostics from this document

| Code | Meaning |
| --- | --- |
| `E-LEX-001` | invalid UTF-8 |
| `E-LEX-002` | lone `\r` |
| `E-LEX-003` | null byte in source |
| `E-LEX-010` | unterminated block comment |
| `E-LEX-020` | integer literal overflows its type |
| `E-LEX-021` | integer literal does not fit `Int` |
| `E-LEX-022` | misplaced `_` in a numeral |
| `E-LEX-023` | unknown numeric suffix |
| `E-LEX-030` | trailing `.` in a float literal |
| `E-LEX-040` | `Char` literal with more than one scalar |
| `E-LEX-050` | unknown escape |
| `E-LEX-051` | unescaped newline in `"` |
| `E-LEX-052` | empty interpolation `${}` |
| `E-LEX-053` | unterminated interpolation |
| `E-LEX-060` | multi-line string dedent failure |
| `E-LEX-070` | unknown attribute |
| `E-LEX-071` | attribute in the wrong position |
| `E-LEX-072` | duplicated attribute |
| `E-LEX-080` | directive after an item |
| `E-LEX-081` | unknown directive |
| `E-LEX-090` | `++` or `--` |

---

## 14. An example that exercises all of it

```vela
#!/usr/bin/env vela
#![strict]

/// Escapes a value for a shell command.
pub fn quote(s: Str) -> Str {
  let escaped = s.replace("'", r"'\''")
  "'${escaped}'"
}

#[test]
fn quoting() {
  assertEq(quote("it's"), r"'it'\''s'")
}

let hex = 0xFF_FF
let big = 1_000_000usize
let small = 1u8
let ratio = 0.5f32
let face = '\u{1F600}'
let block = """
    plain
    text with ${hex} interpolation
    """
```

---

Next: [02-types.md](02-types.md) — the type system.
