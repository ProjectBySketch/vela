# 44 — Units, quantities and money

**Status:** `spec`. Module: `units` (unstable). Related: doc 02 (types), doc 38
(serialization), doc 29 (formatting).

Most bugs in real software are a number without a unit. Vela makes units part of
the type, so `Duration + Instant` is a compile error, `Meters + Feet` needs a
conversion, and `Money` cannot be added in two currencies.

---

## 1. Declaring a unit

```vela
#[unit]
unit Meter = base("m")

#[unit]
unit Second = base("s")

#[unit]
unit Kilo<T> = scaled(1000.0, T)      # a prefix

#[unit]
unit Foot = 0.3048 * Meter            # derived from a base
#[unit]
unit Mile = 1609.344 * Meter
#[unit]
unit Hour = 3600.0 * Second
#[unit]
unit Kilometer = Kilo<Meter>
```

A unit is a declaration, not a string. It is checked at compile time and carries
its symbol for display:

```vela
let d = 100.0.m
let t = 9.58.s
let speed = d / t                 # Quantity<Float, Meter/Second>
println("${speed}")               # 10.438 m/s
```

---

## 2. Quantities

A quantity is a number with a dimension:

```vela
let length: Quantity<Float, Meter> = 5.0.m
let width:  Quantity<Float, Meter> = 300.0.cm
let area:   Quantity<Float, Meter^2> = length * width
```

Rules:

* Multiplication and division combine dimensions: `Meter / Second` is velocity,
  `Meter^2` is area.
* Addition and subtraction require **the same dimension**, in any compatible unit
  (`5.m + 300.cm` is legal and yields meters); mixing `Meter` and `Second` is
  `E-UNIT-010`.
* Comparison requires the same dimension; `<` on `Meter` and `Kilogram` is
  `E-UNIT-010`.
* A dimensionless quantity is `Quantity<Float, 1>` and converts to a plain number
  with `.value`.
* Transcendental functions require dimensionless arguments: `sin(30.deg)` works
  (degrees are dimensionless by declaration), `sin(5.m)` is `E-UNIT-011`.
* Exponents are integers or rationals known at compile time, so a dimension is
  `Meter^2/Second^3` and the compiler tracks it exactly. A dimension computed at
  run time is `E-UNIT-012`.

### 2.1 Literals

`5.m`, `300.cm`, `9.58.s`, `1.5.h`, `70.kg`, `2.gb`, `60.w`, `20.celsius` are
suffix literals: a number followed by a declared unit's short symbol. A unit with
two symbols (`m` for meter, `min` for minute) is resolved by the longest match, and
an ambiguity is `E-UNIT-020`. A bare `5` is `Int`, never a quantity, so the suffix
is the whole syntax — there is no guessing.

---

## 3. Affine units

Temperature is not a scalar multiple: `0 °C` is not `0 K`, and adding two
temperatures is meaningless.

```vela
#[unit]
unit Celsius = affine(offset: 273.15, scale: 1.0, K)     # as a point

let t = 20.0.celsius         # a temperature point
let delta = 5.0.kelvin       # a difference
t + delta                    # Temperature
t + t                        # E-UNIT-030: a point plus a point
delta + delta                # fine: differences add
```

Affine units are split into a **point** type and a **delta** type, and only the
legal operations are defined. That single distinction prevents the class of bug
where two temperatures are averaged into nonsense.

---

## 4. Money

```vela
let price = 19.99.money(.usd)
let shipping = 4.50.money(.usd)
let total = price + shipping          # 24.49 USD

price + 4.50.money(.eur)              # E-UNIT-040: currency mismatch
let converted = try fx.convert(price, to: .eur, on: date)?
```

* `Money` is an integer amount in the currency's minor unit plus a `Currency`
  code — never a `Float`, because money in binary floating point is a rounding bug
  waiting to be discovered by an accountant.
* Arithmetic is checked: add/subtract require the same currency; multiply and
  divide take a plain number or a ratio; mixing is `E-UNIT-040`.
* Rounding is explicit: `.roundTo(.cent, mode: .halfEven)`; an implicit rounding in
  arithmetic is `E-UNIT-041`.
* Formatting uses doc 16's locale formatter: `money.format(price, locale:)` gives
  `19,99 €`.
* Allocation (splitting a total) uses `money.split(n, remainder: .distribute)` so
  that `100.00` split three ways sums back to `100.00`.

---

## 5. Time

`Instant` and `Duration` are already types (doc 16 §7); the units module makes the
rest explicit:

```vela
let timeout: Quantity<Float, Second> = 30.0.s
let since = time.now() - started      # Duration
let eta = started + timeout           # Instant
started + started                     # E-UNIT-050: instant + instant
```

The rules are the affine rules again: `Instant + Duration` is legal, `Instant +
Instant` is not, `Instant - Instant` is a `Duration`, `Duration + Duration` is
legal. A calendar operation (`+ 1 month`) is `datetime.addMonths(n)` and is
explicit, because a month is not a duration.

---

## 6. Data sizes and rates

```vela
let file: Quantity<UInt64, Byte> = 4.2.gb
let rate: Quantity<Float, Byte/Second> = file / 3.0.s
let bandwidth: Quantity<Float, Bit/Second> = rate * 8.0
```

`Byte`, `Bit`, `Byte/Second`, `Hertz`, `Watt`, `Volt`, `Ampere` and the other SI
derived units are declared in `units.si`; the prefixes (`kilo`, `mega`, `kibi`,
`mebi`) are declared once and compose. A `gb` that means 10⁹ or 2³⁰ is not a
guess: `gb` is decimal, `gib` is binary, and using one where the other is meant is
a documentation problem, not a silent 7 % error.

---

## 7. Physical constants

```vela
units.const.c        # Quantity<Float, Meter/Second>, exactly 299792458
units.const.h        # Planck
units.const.kB       # Boltzmann
units.const.G        # gravitational constant
units.const.NA       # Avogadro
```

Each is a `Quantity` with an uncertainty (`±`), so a computation that mixes
measured and exact constants keeps the uncertainty and can report it:

```vela
let energy = mass * units.const.c ** 2
println("${energy} ± ${energy.uncertainty}")
```

---

## 8. Representation and conversion

| Concern | Rule |
| --- | --- |
| storage | a quantity stores the value in its **base** unit and its dimension in the type; the display unit is a formatting choice |
| JSON | `{"value": 100, "unit": "cm"}` for a struct field; a refined field validates the unit |
| FFI | a quantity crosses as its base-unit `Float`; the unit is in the signature, so it is lost at the boundary by design and documented |
| `sys` | the dimension is a compile-time constant, so it costs nothing at run time |
| precision | a quantity's element type is the number type; `Quantity<Float>` and `Quantity<Float32>` do not silently mix |
| hashing | equal quantities in different display units hash equal (base-unit value plus dimension) |

---

## 9. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-UNIT-010` | adding or comparing different dimensions |
| `E-UNIT-011` | transcendental function on a dimensioned value |
| `E-UNIT-012` | dimension not known at compile time |
| `E-UNIT-020` | ambiguous unit suffix |
| `E-UNIT-030` | adding two affine points |
| `E-UNIT-031` | subtracting an affine point from a delta |
| `E-UNIT-040` | mixing currencies |
| `E-UNIT-041` | implicit rounding of money |
| `E-UNIT-050` | adding two instants |
| `W-UNIT-010` | quantity formatted without a unit |
| `W-UNIT-020` | a `Money` field serialised as a `Float` |

---

Next: [45-dev-loop.md](45-dev-loop.md).
