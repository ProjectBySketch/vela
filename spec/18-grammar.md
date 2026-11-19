# 18 — Grammar

**Status:** `spec`. This is the complete grammar of Vela 1.0 (edition 2026) in
EBNF. It is normative: a program that this grammar derives and that satisfies the
static rules in docs 02–17 is a valid Vela program.

Notation: `{ X }` is zero or more, `[ X ]` is optional, `X | Y` is alternative,
`( X )` groups, and terminals are quoted.

---

## 1. Source and items

```ebnf
source        = [ shebang ] , { directive } , { item } ;
shebang       = "#!/" , { ? any character except newline ? } ;
directive     = "#!" , "[" , directiveBody , "]" ;
directiveBody = "strict"
              | "deny" , "(" , path , ")"
              | "allow" , "(" , path , ")"
              | "profile" , "(" , string , ")"
              | "noStd"
              | "keepAsserts"
              | "traceErrors" ;

item          = { attribute } , visibility , itemKind ;

itemKind      = fnDecl
              | structDecl
              | enumDecl
              | unionDecl
              | traitDecl
              | implDecl
              | extensionDecl
              | interfaceDecl
              | modDecl
              | useDecl
              | typeDecl
              | constDecl
              | staticDecl
              | macroDecl
              | viewDecl
              | styleDecl
              | themeDecl
              | assetDecl
              | externBlock
              | directive ;

visibility    = [ "pub" , [ "(" , ( "crate"
                                 | "package" , ":" , string
                                 | "in" , path ) , ")" ] ]
              | "private" ;
```

---

## 2. Attributes

```ebnf
attribute     = "#" , "[" , attrBody , "]" ;
attrBody      = path , [ "(" , [ attrArg , { "," , attrArg } , [ "," ] ] , ")" ] ;
attrArg       = literal
              | path
              | ident , ":" , ( literal | path | ident )
              | ident , "(" , attrArg , { "," , attrArg } , ")" ;
```

---

## 3. Declarations

### 3.1 Functions

```ebnf
fnDecl        = [ "async" ] , "fn" , ident , [ typeParams ] ,
                "(" , [ params ] , ")" ,
                [ "->" , type ] ,
                [ effectList ] ,
                [ "where" , whereClause ] ,
                block ;

params        = param , { "," , param } , [ "," ] ;
param         = [ "borrow" | "consuming" ] , ident , [ ":" , type ] ,
                [ "=" , expr ]
              | "..." , ident , ":" , type
              | "self"
              | "mut" , "self" ;

effectList    = ident , { ident } ;          (* io, unsafe, ui *)
whereClause   = whereItem , { "," , whereItem } ;
whereItem     = type , ":" , bounds
              | type , "::" , ident , ":" , bounds ;
```

### 3.2 Types with fields

```ebnf
structDecl    = [ "shared" ] , "struct" , ident , [ typeParams ] ,
                [ ":" , bounds ] , [ "where" , whereClause ] ,
                "{" , { field , [ "," ] } , "}" ;
field         = { attribute } , visibility , [ "mut" ] , ident ,
                ":" , type , [ "=" , expr ] ;

enumDecl      = "enum" , ident , [ typeParams ] , [ ":" , bounds ] ,
                "{" , { variant , [ "," ] } , "}" ;
variant       = ident , [ "=" , intLit ]
              | ident , "(" , [ variantField , { "," , variantField } , [ "," ] ] , ")"
              | ident , "{" , { field , [ "," ] } , "}" ;
variantField  = [ ident , ":" ] , type ;

unionDecl     = "union" , ident , "{" , { field , [ "," ] } , "}" ;
```

### 3.3 Traits and impls

```ebnf
traitDecl     = "trait" , ident , [ typeParams ] ,
                [ ":" , bounds ] ,
                [ "where" , whereClause ] ,
                "{" , { traitItem } , "}" ;
traitItem     = fnDecl
              | "type" , ident , [ ":" , bounds ]
              | "const" , ident , [ ":" , type ] , [ "=" , expr ] ;

implDecl      = "impl" , [ typeParams ] , type ,
                [ "for" , type ] ,
                [ "by" , postfixExpr ] ,
                [ "where" , whereClause ] ,
                "{" , { fnDecl | typeAssoc | constDecl } , "}" ;
typeAssoc     = "type" , ident , "=" , type ;

extensionDecl = "extension" , type , [ "where" , whereClause ] ,
                "{" , { fnDecl } , "}" ;

interfaceDecl = "interface" , ident , "{" , { fnDecl | field } , "}" ;
```

### 3.4 Modules, imports, aliases

```ebnf
modDecl       = "mod" , ident , ( ";" | "{" , { item } , "}" ) ;

useDecl       = "use" , useTree , ";" ;
useTree       = usePath
              | usePath , "::" , "{" , useTree , { "," , useTree } , [ "," ] , "}"
              | "*" ;
usePath       = ( "self" | "super" | "crate" | ident )
                , { "::" , ident } , [ "as" , ident ] ;

typeDecl      = [ "opaque" ] , "type" , ident , [ typeParams ] , "=" , type ;
constDecl     = "const" , ident , [ ":" , type ] , "=" , expr ;
staticDecl    = "static" , [ "mut" ] , ident , [ ":" , type ] , "=" , expr ;
```

### 3.5 Macros

```ebnf
macroDecl     = "macro" , ident , "(" , [ macroParams ] , ")" , "{" , tokenTree , "}" ;
macroParams   = macroParam , { "," , macroParam } , [ "," ] ;
macroParam    = ident , [ "..." ] ;

tokenTree     = { token | macSplice | macInterp | "{" , tokenTree , "}"
                | "(" , tokenTree , ")" | "[" , tokenTree , "]" } ;
macSplice     = "$(" , tokenTree , ")" ;
macInterp     = "${" , expr , "}" ;
```

### 3.6 Views, styles, themes, assets

```ebnf
viewDecl      = ( "view" | "page" | "component" ) , ident ,
                "(" , [ propList ] , ")" , [ viewModifier ] ,
                "{" , { viewItem } , "}" ;
propList      = prop , { "," , prop } , [ "," ] ;
prop          = [ "@" ] , ident , ":" , type , [ "=" , expr ] ;
viewModifier  = "@" , ident ;               (* @client, @static, @island *)

viewItem      = stateMember
              | bindMember
              | envMember
              | computedMember
              | hookMember
              | assignment
              | expr ;

stateMember   = "state" , ident , ":" , type , [ "=" , expr ] ;
bindMember    = "bind" , ident , ":" , type ;
envMember     = "env" , ident , ":" , type , [ "=" , expr ] ;
computedMember= "computed" , ident , [ ":" , type ] , "=" , expr ;
hookMember    = ( "onAppear" | "onDisappear" ) , block
              | ( "onTick" | "onKey" | "onResize" | "onFocusChange" )
                , "(" , [ argList ] , ")" , block ;

styleDecl     = "style" , ident , [ "extends" , ident ] , "{" , { styleItem } , "}" ;
styleItem     = styleProp
              | "when" , "." , ident , "{" , { styleProp } , "}"
              | "@when" , whenCond , "{" , { styleProp } , "}"
              | "transition" , ":" , ident , { "," , ident }
              | "anim" , ident , "(" , [ argList ] , ")" , "{" , { animStep } , "}"
              | "keyframes" , ident , "{" , { keyframe , [ "," ] } , "}" ;
styleProp     = ident , ":" , expr , [ "," ] ;
whenCond      = expr ;
animStep      = ( "from" | "to" | ident ) , "{" , { styleProp } , "}" ;
keyframe      = ( "from" | "to" | percent | intLit , "%" ) ,
                "{" , { styleProp } , "}" ;

themeDecl     = ( "theme" , ident , [ "extends" , ident ] ) , "{" , { themeItem } , "}" ;
themeItem     = "token" , "." , ident , "=" , expr ;

assetDecl     = "asset" , ident , ":" , type , "=" , string ;
```

---

## 4. Types

```ebnf
type          = unionType ;
unionType     = interType , [ "|" , unionType ] ;
interType     = postfixType , [ "&" , interType ] ;
postfixType   = primaryType , [ "?" ] ;

primaryType   = "(" , [ type , { "," , type } , [ "," ] ] , ")"
              | "[" , type , "]"                        (* List *)
              | "{" , type , ":" , type , "}"           (* Map *)
              | "[" , type , ";" , expr , "]"           (* fixed array *)
              | "Func" , "(" , [ typeParamsList ] , ")" , "->" , type
              | "weak" , type
              | "owned" , type
              | "borrowed" , type
              | "static" , type
              | "!" | "Any" | "Void"
              | path , [ typeArgs ] ;

typeArgs      = "<" , type , { "," , type } , [ "," ] , ">" ;
typeParams    = "<" , typeParam , { "," , typeParam } , [ "," ] , ">" ;
typeParam     = ident , [ ":" , bounds ]
              | "const" , ident , ":" , type ;
bounds        = path , { "+" , path } ;
path          = ident , { "::" , ident } ;
```

---

## 5. Statements

```ebnf
block         = "{" , { statement } , [ expr ] , "}" ;
statement     = item                           (* a nested declaration *)
              | letStmt
              | mutStmt
              | constStmt
              | staticStmt
              | ifStmt
              | whileStmt
              | loopStmt
              | forStmt
              | labelledLoop
              | matchStmt
              | deferStmt
              | guardStmt
              | withStmt
              | returnStmt
              | breakStmt
              | continueStmt
              | failStmt
              | assertStmt
              | assignment
              | exprStmt ;

letStmt       = "let" , pattern , [ ":" , type ] , "=" , expr ;
mutStmt       = "mut" , pattern , [ ":" , type ] , "=" , expr ;
constStmt     = "const" , ident , [ ":" , type ] , "=" , expr ;
staticStmt    = "static" , [ "mut" ] , ident , [ ":" , type ] , "=" , expr ;

ifStmt        = "if" , expr , block , { "else" , "if" , expr , block } ,
                [ "else" , block ] ;
ifLetStmt     = "if" , ( "let" , pattern , "=" , expr | expr ) ,
                { "," , expr } , block , [ "else" , block ] ;

whileStmt     = "while" , [ "let" , pattern , "=" ] , expr , block ;
loopStmt      = "loop" , block ;
forStmt       = "for" , pattern , "in" , expr , [ "if" , expr ] , block ;
labelledLoop  = ident , ":" , ( forStmt | whileStmt | loopStmt ) ;

matchStmt     = "match" , expr , "{" , { matchArm } , "}" ;
matchArm      = pattern , [ "if" , expr ] , "=>" , ( block | expr ) , [ "," ] ;

deferStmt     = "defer" , statement ;
guardStmt     = "guard" , ( "let" , pattern , "=" , expr | expr ) ,
                { "," , expr } , "else" , block ;
withStmt      = "with" , ident , "=" , expr , block ;

returnStmt    = "return" , [ expr ] ;
breakStmt     = "break" , [ ident ] , [ expr ] ;
continueStmt  = "continue" , [ ident ] ;
failStmt      = "fail" , expr ;
assertStmt    = ( "assert" | "assertEq" | "assertNe" | "panic" | "unreachable" )
                , [ "(" , [ argList ] , ")" ] ;

assignment    = postfixExpr , assignOp , expr ;
assignOp      = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "<<=" | ">>="
              | "&=" | "|=" | "^=" | "??=" ;
exprStmt      = expr ;
```

---

## 6. Expressions

```ebnf
expr          = pipeline ;
pipeline      = coalesce , { "|>" , coalesce } ;
coalesce      = orExpr , { "??" , orExpr } ;          (* right-assoc in practice *)
orExpr        = andExpr , { "||" , andExpr } ;
andExpr       = equality , { "&&" , equality } ;
equality      = comparison , { ( "==" | "!=" ) , comparison } ;
comparison    = range , [ ( "<" | "<=" | ">" | ">=" ) , range ] ;
range         = bitOr , [ ( "..<" | "..=" | ".." ) , bitOr ] ;
bitOr         = bitXor , { "|" , bitXor } ;
bitXor        = bitAnd , { "^" , bitAnd } ;
bitAnd        = shift , { "&" , shift } ;
shift         = additive , { ( "<<" | ">>" | ">>>" ) , additive } ;
additive      = multiplicative , { ( "+" | "-" ) , multiplicative } ;
multiplicative= power , { ( "*" | "/" | "%" ) , power } ;
power         = unary , [ "**" , power ] ;            (* right-assoc *)
unary         = ( "!" | "-" | "~" | "+" ) , unary
              | postfix ;
postfix       = primary , { postfixOp } ;
postfixOp     = "." , ident , [ "(" , [ argList ] , ")" ]
              | "?." , ident
              | "[" , expr , "]"
              | "?[" , expr , "]"
              | "(" , [ argList ] , ")"
              | "?"                                    (* error propagation *)
              | "as" , type
              | "is" , [ "not" ] , type ;

primary       = literal
              | path , [ typeArgs ]
              | "self" | "super"
              | "(" , [ expr , { "," , expr } , [ "," ] ] , ")"
              | "[" , [ listElems ] , "]"
              | "[" , expr , ";" , expr , "]"             (* repeat literal *)
              | "[" , expr , "for" , forClauses , "]"
              | "{" , [ mapElems ] , "}"
              | "{" , expr , "for" , forClauses , "}"
              | path , "{" , [ fieldInits ] , "}"        (* struct / map literal *)
              | closure
              | "if" , expr , block , [ "else" , block ]
              | "match" , expr , "{" , { matchArm } , "}"
              | "try" , expr , [ "catch" , [ type , "as" ] , ident , block ,
                                 { "catch" , [ type , "as" ] , ident , block } ]
              | "unsafe" , [ "(" , string , ")" ] , block
              | "comptime" , block
              | "loop" , block
              | block
              | "await" , expr
              | "spawn" , block
              | "select" , "{" , { selectArm } , "}" ;

literal       = intLit | floatLit | string | charLit
              | "true" | "false" | "nil"
              | "b" , string ;
string        = simpleString | multiString | rawString | interpolatedString ;

listElems     = listElem , { "," , listElem } , [ "," ] ;
listElem      = expr | "..." , expr ;
mapElems      = mapElem , { "," , mapElem } , [ "," ] ;
mapElem       = expr , ":" , expr ;
fieldInits    = fieldInit , { "," , fieldInit } , [ "," ] ;
fieldInit     = ident , [ ":" , expr ]
              | ".." , expr ;
forClauses    = pattern , "in" , expr , { ( "if" , expr ) | ( "for" , pattern , "in" , expr ) } ;

closure       = "|" , [ closureParams ] , "|" , ( expr | block )
              | "{" , "|" , [ closureParams ] , "|" , { statement } , [ expr ] , "}" ;
closureParams = closureParam , { "," , closureParam } ;
closureParam  = ident , [ ":" , type ] ;

argList       = arg , { "," , arg } , [ "," ] ;
arg           = [ ident , ":" ] , expr
              | "..." , expr
              | closure ;

selectArm     = ( "let" , pattern , "=" , expr | expr ) , "=>" , ( block | expr )
              | "timeout" , "(" , expr , ")" , "=>" , ( block | expr )
              | "else" , "=>" , ( block | expr ) ;
```

---

## 7. Patterns

```ebnf
pattern       = altPattern ;
altPattern    = primaryPattern , { "|" , primaryPattern } ;
primaryPattern= "_"
              | "let" , ident
              | ident , "@" , primaryPattern
              | literal
              | "-" , literal
              | primaryPattern , ".." , primaryPattern
              | "(" , [ pattern , { "," , pattern } , [ "," ] ] , ")"
              | "[" , [ pattern , { "," , pattern } , [ "," ] ] , "]"
              | "[" , pattern , "," , "..." , [ ident ] , "]"
              | path , [ "(" , [ pattern , { "," , pattern } , [ "," ] ] , ")" ]
              | path , "{" , [ patternFields ] , "}"
              | ident , ":" , type
              | "not" , primaryPattern ;
patternFields = ( ident | ident , ":" , pattern ) ,
                { "," , ( ident | ident , ":" , pattern ) } , [ "," ] ;
```

---

## 8. Lexical

```ebnf
intLit        = ( "0x" , hexDigit , { hexDigit | "_" } )
              | ( "0o" , octDigit , { octDigit | "_" } )
              | ( "0b" , binDigit , { binDigit | "_" } )
              | ( digit , { digit | "_" } )
              , [ intSuffix ] ;
intSuffix     = "i8" | "i16" | "i32" | "i64"
              | "u8" | "u16" | "u32" | "u64"
              | "usize" | "isize" ;

floatLit      = digit , { digit | "_" } , "." , digit , { digit | "_" }
                , [ exponent ] , [ "f32" ]
              | digit , { digit | "_" } , exponent , [ "f32" ]
              | "0x" , hexDigit , { hexDigit } , "p" , [ "-" ] , digit , { digit } ;
exponent      = ( "e" | "E" ) , [ "+" | "-" ] , digit , { digit } ;

charLit       = "'" , ( escape | ? any scalar except ' and \ ? ) , "'" ;
simpleString  = '"' , { charEscape | interpolation | ? any char except " and \ ? } , '"' ;
multiString   = '"""' , ? anything, closing indentation rules ? , '"""' ;
rawString     = "r" , { "#" } , '"' , ? anything ? , '"' , { "#" } ;
interpolation = "${" , expr , "}" ;
escape        = "\" , ( "n" | "r" | "t" | "0" | "\" | '"' | "'" | "e" | "$" | "{" )
              | "\x" , hexDigit , hexDigit
              | "\u{" , hexDigit , { hexDigit } , "}"
              | "\" , newline ;
```

---

## 9. Lexical disambiguation

Three rules make the grammar unambiguous where it looks like it might not be.

1. **`#[` at item or statement start is an attribute**; `#` anywhere else begins
   a comment (doc 01 §9).
2. **`<` opens type arguments only in a type position, or after a path followed
   by a type and `>`.** `Foo<Bar>(x)` in expression position is a generic call,
   and `Foo::<Bar>(x)` forces that reading when a value named `Bar` also exists.
3. **A `{` after a path in expression position is a struct literal**, except when
   that path is in a condition (`if x { }`), where a struct literal must be
   parenthesised: `if (x) { }`. This is the one rule a human ever notices, and it
   exists because `if xs { }` must keep working for `Bool`-returning `xs` after a
   refactor.

---

## 10. Complete example, parsed

```vela
#!/usr/bin/env vela
#![strict]

use std::{list, str}

const GREETING = "hello"

view Banner(text: Str, tone: Tone = .info) {
  state hovered: Bool = false

  row(pad: 12dp, gap: 8dp)
    .style(BannerStyle)
    .onHover(|h| { hovered = h })
  {
    icon("info")
    text(text).fontSize(15dp)
  }
}

enum Tone { info, warn, error }

style BannerStyle {
  background: token.surface
  radius: 8dp
  when .hover { background: token.surfaceAlt }
}

fn shout(s: Str) -> Str {
  s |> str.upper + "!"
}

#[test]
fn shoutWorks() {
  assertEq(shout("hi"), "HI!")
}

fn main() {
  for i in 0..<3 {
    print("${GREETING} ${i}")
  }

  let counts: Map<Str, Int> = {"a": 1, "b": 2}
  guard let a = counts["a"] else { return }
  assert(a == 1, "a should be 1")

  let shapes = [Shape::circle(1.0), Shape::rect(2.0, 3.0)]
  let total = shapes.fold(0.0, |acc, s| acc + s.area())
  println("total: ${total}")
}
```

Every production in it appears above. Nothing in this file is a special case.

---

Back to the [index](README.md).
