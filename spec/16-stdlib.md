# 16 — The standard library

**Status:** `spec`. `velac` 0.1 ships 15 builtins and no modules.

40 modules here, plus 18 specialised ones specified in their own documents. The
prelude (`core`) is imported everywhere; every other module needs
a `use`. Items are shown by signature; `…` means "and the obvious siblings".

Availability per profile:

| Marker | Modules |
| --- | --- |
| everywhere | `core`, `mem`, `num`, `int`, `float`, `math`, `str`, `char`, `bytes`, `list`, `map`, `set`, `iter`, `option`, `result`, `fmt`, `cmp` |
| `core`, `app`, `web`, `sys` | `json`, `regex`, `time`, `rand`, `crypto` |
| `core`, `app`, `web` | `env`, `path`, `fs`, `io`, `process`, `cli`, `log`, `net`, `http`, `tls`, `db`, `task`, `sync`, `thread`, `test` |
| `app`, `web` | `ui`, `web`, `server` |
| `sys` | `sys` |

Using a module the profile does not have is `E-MOD-060` with the list of
profiles that do.

### 1.1 Modules specified elsewhere

| Module | Document | Purpose |
| --- | --- | --- |
| `gfx`, `paint`, `chart` | [21-graphics.md](21-graphics.md) | scenes, shaders, compute, charts |
| `image`, `audio`, `video`, `media`, `camera` | [22-media.md](22-media.md) | decode, audio graph, pipelines, capture |
| `http2`, `quic`, `dns`, `grpc`, `mqtt`, `sse` | [23-networking.md](23-networking.md) | protocol layers |
| `secrets` | [24-security.md](24-security.md) | platform key store |
| `db` | [20-databases.md](20-databases.md) | schema, migrations, repositories |
| `i18n` | [29-i18n.md](29-i18n.md) | catalogues, locales, plural rules |
| `game`, `physics`, `save` | [30-games.md](30-games.md) | ECS, simulation, netcode |
| `plugins` | [31-plugins.md](31-plugins.md) | host side of the plugin ABI |
| `embedded`, `hal` | [32-embedded.md](32-embedded.md) | microcontrollers |
| `tensor`, `nn`, `train`, `infer`, `tokenize`, `embed`, `serve` | [36-ai.md](36-ai.md) | machine learning |
| `cbor`, `msgpack`, `proto`, `toml`, `yaml`, `csv`, `parquet`, `data` | [38-serialization.md](38-serialization.md) | formats and dataframes |
| `observability`, `deploy`, `config` | [39-cloud.md](39-cloud.md) | telemetry, deployment, typed configuration |

`db` appears in both lists: its query surface is part of this document, its
schema and migration surface is doc 20.

---

## 1. `core`

The prelude. Everything here is in scope without a `use`.

| Item | Signature |
| --- | --- |
| `print` | `fn print(...xs: List<ToText>)` |
| `println` | `fn println(...xs: List<ToText>)` |
| `eprint` / `eprintln` | stderr |
| `len` | `fn len(x: ToLen) -> Int` |
| `assert` / `assertEq` / `assertNe` | `fn assert(cond: Bool, msg: Str = "")` |
| `panic` | `fn panic(msg: Str) -> Never` |
| `unreachable` | `fn unreachable() -> Never` |
| `typeName` | `fn typeName(x: Any) -> Str` |
| `clone` | `fn clone<T: Clone>(x: T) -> T` |
| `identity` | `fn identity<T>(x: T) -> T` |
| `unit` | `const unit: Unit` — the value of `Void` where a value is needed |
| `Type` | `Type.of(T)`, `Type.name(x)` (doc 12 §5) |
| `Error`, `Display`, `Debug`, `Eq`, `Ord`, `Hash`, `Clone`, `Default`, `ToText`, `ToLen`, `Send`, `Share`, `Numeric`, `Iterable`, `Iterator`, `Closable`, `Drop` | traits |

`Unit` is a one-value type, so that `Result<Unit, E>` reads better than
`Result<Void, E>`.

---

## 2. `mem`

| Item | Signature |
| --- | --- |
| `Allocator` | trait: `alloc`, `free`, `resize` (doc 09 §8) |
| `system` | the OS allocator |
| `arena(cap)` | bump allocator, freed at once |
| `pool<T>(n)` | fixed-size slots |
| `slab<T>(n)` | typed free list |
| `buddy(order)` | power-of-two page allocator (`sys` and `core`) |
| `null` | always-failing allocator |
| `tracking` | wrapper that records allocations for leak tests |
| `alloc(size, align)` | allocate a raw block |
| `free(ptr)` | release a block |
| `sizeOf<T>()` / `alignOf<T>()` | compile-time, `comptime`-usable |
| `swap<T>(a, b)` | exchange two values |
| `replace<T>(dst, src)` | write and return the old value |
| `take<T>(dst)` | read and zero |
| `transmute<A, B>(v)` | same-size reinterpretation (`unsafe`) |
| `zero(ptr, n)` / `copy(dst, src, n)` / `move(dst, src, n)` | raw memory (`unsafe`) |
| `collect()` | run the cycle collector |
| `stats()` | `(allocations, bytes, live, peak)` |

---

## 3. Numbers

### 3.1 `num` — the `Num` helpers

`toFloat`, `toInt` (truncating), `round`, `floor`, `ceil`, `trunc`, `abs`, `sign`,
`min`, `max`, `clamp`, `isNan`, `isInf`, `isFinite`, `parse`, `format`,
`formatWith(precision:)`, `toHex`, `toBase(n)`.

### 3.2 `int`

`Int.MAX`, `Int.MIN`, `UInt.MAX`, `bitLen`, `countOnes`, `leadingZeros`,
`trailingZeros`, `rotateLeft`, `rotateRight`, `wrappingAdd`/`wrappingSub`/
`wrappingMul` (explicit wraparound), `checkedAdd` → `Result`, `saturatingAdd`,
`gcd`, `lcm`, `pow`, `isqrt`, `toStr(radix:)`, `fromStr(s, radix:)`,
`fromStrRadix`, `random(range)`.

### 3.3 `float`

`Float.inf`, `Float.nan`, `Float.epsilon`, `Float.maxSafeInteger`, `isNan`,
`totalOrder`, `toBits`, `fromBits`, `roundTo(decimalPlaces:)`,
`format(precision:, style:)` where style is `fixed`, `scientific`, `general`,
`percent`, `currency(code:)`.

Every float printed by Vela is the **shortest string that round-trips** (Grisu/
Ryu), so `0.1 + 0.2` prints `0.30000000000000004` and `1.0 / 3.0` prints
`0.3333333333333333`, exactly as a reader would expect from a binary float.

### 3.4 `math`

Constants: `pi`, `e`, `tau`, `sqrt2`, `ln2`, `ln10`.
Functions: `sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2
log10 pow sqrt cbrt hypot floor ceil round trunc fmod modf clamp lerp
toRadians toDegrees`.

### 3.5 `cmp`

`Ordering` (`less`, `equal`, `greater`), `min`, `max`, `clamp`, `compare`,
`reverse`, plus the hashers: `hash.fnv1a`, `hash.sip`, `hash.xxh3`, and
`Hash.default` (SipHash-1-3, keyed per process so that a hash-flooding attack
cannot be built from outside).

---

## 4. Text

### 4.1 `str`

| Category | Items |
| --- | --- |
| query | `len`, `byteLen`, `isEmpty`, `contains`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, `count(sub)` |
| transform | `upper`, `lower`, `capitalise`, `trim`, `trimStart`, `trimEnd`, `replace`, `replaceAll`, `repeat`, `padStart`, `padEnd`, `slice`, `split`, `splitLines`, `join`, `reverse` |
| parse | `toInt`, `toFloat`, `toBytes`, `chars`, `graphemes`, `words` |
| compare | `eq`, `eqIgnoreCase`, `compare`, `levenshtein` |
| build | `Builder` with `write`, `writeLine`, `writeInt`, `writeFloat`, `field(name:, value:)`, `finish()` |
| escape | `escapeHtml`, `escapeJson`, `escapeSql` (for logging only — never for queries) |

### 4.2 `char`

`isDigit`, `isLetter`, `isWhitespace`, `isUpper`, `isLower`, `isAlphaNumeric`,
`toUpper`, `toLower`, `toInt`, `fromInt(n) -> Char?`, `toStr`.

### 4.3 `bytes`

`new`, `withCapacity`, `fromStr`, `toString` (fallible), `len`, `at`, `set`,
`push`, `append`, `slice`, `toHex`, `fromHex`, `toBase64`, `fromBase64`,
`readInt(offset, width, endian)`, `writeInt(offset, value, width, endian)`,
`compare`, `startsWith`.

### 4.4 `fmt`

```vela
fmt.of(value)                        # Display, allocates a Str
fmt.debug(value)                     # Debug, structural
fmt.format("{name}: {count, pad: 4}", (name: "x", count: 7))
```

Format spec: `{name}`, `{name, width: 8}`, `{name, align: "right"}`,
`{n, pad: "0"}`, `{f, precision: 2}`, `{f, style: "percent"}`, `{d, base: 16}`,
`{{` and `}}` for literals. `fmt.writeTo(w: Writer, spec, args)` formats into an
`io.Writer` without allocating, which is what `sys` uses.

### 4.5 `regex`

`regex.new(pattern) -> Result<Regex, RegexError>`, `.matches(s)`, `.find(s)`,
`.findAll(s)`, `.captures(s)`, `.replace(s, template)`, `.split(s)`.
Compiled once, `const`-able: `const EMAIL = comptime { regex.new("…")? }`.
The engine is a backtracking-free Thompson NFA, so a hostile pattern cannot
exponential, at the cost of no backreferences (`E-RUN-060` names the construct).

---

## 5. Collections

### 5.1 `list`

`new`, `withCapacity`, `of`, `len`, `isEmpty`, `at`, `get`, `set`, `first`,
`last`, `push`, `pushAll`, `pop`, `insert`, `removeAt`, `remove`, `clear`,
`sort`, `sortBy(key:)`, `sorted`, `reverse`, `reversed`, `slice`, `indexOf`,
`contains`, `map`, `filter`, `fold`, `reduce`, `any`, `all`, `find`, `count`,
`sum`, `product`, `join`, `unique`, `chunk(n)`, `zip`, `flatten`, `copy`,
`fill`, `swap`, `shuffle`, `min`, `max`, `extend`, `take(n)`, `skip(n)`.

### 5.2 `map`

`new`, `withCapacity`, `of`, `len`, `isEmpty`, `get`, `getOr`, `set`, `remove`,
`contains`, `keys`, `values`, `entries`, `clear`, `merge`, `forEach`, `map`,
`filter`, `toList`.

Insertion-ordered; `keys()` and `values()` follow insertion order; removing and
re-inserting moves a key to the end.

### 5.3 `set`

`new`, `of`, `len`, `add`, `remove`, `contains`, `union`, `intersection`,
`difference`, `symmetricDifference`, `isSubset`, `toList`, `clear`.

### 5.4 `iter`

The lazy protocol: `Iterator` (doc 07 §4) plus adapters `map`, `filter`,
`take`, `skip`, `enumerate`, `zip`, `chain`, `flatMap`, `chunk`, `window`,
`peekable`, and terminals `collect`, `count`, `sum`, `fold`, `first`, `last`,
`any`, `all`, `each`.

`Range`, `List`, `Map`, `Str`, `Bytes` and `Channel` are `Iterable`.
A naive pipeline (`xs.map(f).filter(g)`) allocates once per stage; `xs.iter()
.map(f).filter(g).collect()` allocates once. Both are legal; `vela check --lint`
suggests the second past two stages.

---

## 6. `json`

```vela
json.parse(text) -> Result<Json, JsonError>
json.parseAs::<T>(text) -> Result<T, JsonError>       # needs #[derive(Json)]
json.write(value) -> Str                              # compact
json.writePretty(value, indent: 2) -> Str
```

`Json` is the untyped tree (`object`, `array`, `string`, `number`, `bool`,
`null`) with `get`, `at`, `asStr`, `asInt`, `asFloat`, `asBool`, and a path form
`j["user"]["name"].asStr()`. Numbers keep their written form so that a large
integer does not become a rounded float on the way through.

---

## 7. Time

`time.now() -> Instant`, `time.monotonic()`, `time.sleep(d)`, `time.sleepUntil(i)`,
`Instant` arithmetic, `time.cancelled()`, `time.timeout(d, fn)`.

`datetime` (in the same module): `DateTime.parse(s, format)`, `.format(f)`,
`.add(Duration)`, `.toUtc()`, `.toLocal()`, `.year/.month/.day/.hour/...`,
`Duration` with `fromSeconds`/`fromMillis`/`fromNanos` and arithmetic.

Formatting uses ISO 8601 by default and rejects an ambiguous format string at
compile time when it is a literal (`E-STD-010`).

---

## 8. `rand`

`rand.int(lo, hi)`, `rand.float()`, `rand.bool(p)`, `rand.pick(xs)`,
`rand.shuffle(xs)`, `rand.seed(n)` (a `SplitMix64`/`xoshiro256` generator),
`rand.cryptoBytes(n)` (from the OS, `E-RUN-070` if unavailable).

`rand` is seeded from the OS unless the program seeds it, and a seeded program
produces the same sequence on every platform — which is what makes a simulation
reproducible.

---

## 9. `crypto`

Hash: `sha256`, `sha512`, `blake3`, `hmac(k, data)`.
KDF: `hkdf`, `pbkdf2(iterations:)`, `argon2id`.
AEAD: `aesGcm(key, nonce, plaintext, aad)`, `chacha20Poly1305`.
Asymmetric: `ed25519.sign/verify`, `x25519.exchange`.
Encoding: `base64`, `hex`.
`uuid.v4()`, `uuid.v7()`, `uuid.parse`, `uuid.toString`.
`constantTimeEq(a, b)` — the comparison that every token check must use, provided
so that nobody writes `==` by accident.

Everything here delegates to the platform's own vetted implementation where one
exists (CommonCrypto on Apple, WebCrypto on web, the kernel's RNG on `sys`), and
falls back to a small constant-time implementation otherwise.

---

## 10. Environment and files

### 10.1 `env`

`env.get(name) -> Str?`, `env.require(name) -> Str` (`E-RUN-080` when missing),
`env.set`, `env.args() -> List<Str>`, `env.cwd()`, `env.exit(code) -> Never`,
`env.platform() -> Platform`, `env.arch() -> Str`, `env.profile() -> Str`.

### 10.2 `path`

`join(...parts)`, `dirname`, `basename`, `ext`, `stem`, `normalise`, `isAbsolute`,
`relativeTo`, `toNative`, `list`.

### 10.3 `fs`

`read(p) -> Result<Bytes, IoError>`, `readStr(p)`, `write(p, bytes)`,
`writeStr(p, s)`, `append`, `create`, `open(p, mode:)`, `remove`, `rename`,
`copy`, `mkdir`, `mkdirAll`, `removeDir`, `readDir(p) -> List<DirEntry>`,
`metadata(p) -> Metadata` (`size`, `mode`, `modified`, `isDir`, `isSymlink`),
`exists`, `temp(suffix:)`, `walk(p, fn)`.
`File` has `read(n)`, `readAll()`, `write(bytes)`, `writeStr`, `seek`, `tell`,
`flush`, `lock`, `close` (via `Closable`).

### 10.4 `io`

`Reader` and `Writer` traits; `copy`, `tee`, `buffered`, `lines(reader)`,
`readExactly(n)`, `readUntil(byte)`, `Stdout`, `Stderr`, `Stdin`, `null`.
Everything in the library that writes takes a `Writer`, which is why the same
`print`, `fmt.writeTo` and `logging` work on a terminal, a socket, a file and an
in-memory buffer.

### 10.5 `process`

`process.run(cmd, args, opts) -> Result<Output, IoError>` where `Output` has
`status`, `stdout`, `stderr`; `process.spawn`, `process.exit(code)` (never
`return`s), `process.pid()`, `process.kill(pid)`, `process.env`.

`process.run` never goes through a shell unless `shell: true` is passed, and
then the command string is an array, not a concatenation — the same
injection-proofing as SQL parameters.

---

## 11. `cli`

```vela
let args = cli.parse("acme build [files...] --out/-o <path> --release")
# returns a typed Args with .flag("release"), .opt("out"), .many("files")
```

`cli.parse(spec)` builds a parser from a one-line usage string, with `--help`
generated from it, unknown-flag errors that suggest the closest match, and
`--no-` prefixes for booleans. `cli.prompt(question)`, `cli.confirm`,
`cli.select(options)`, `cli.progress(n)` for interactive tools.

---

## 12. `log`

`log.debug/info/warn/error(msg)`, `log.withField(k, v)`, `log.child(name)`,
`log.setLevel`, `log.addSink(fn)`, `log.json()`.
Compiled in: `sys` with a static level; out of: release builds below `info` when
`[build] logLevel = "info"` (`E-STD-020` at compile time for a `Str`
concatenation in a disabled level, replaced by a no-op).

---

## 13. Networking

### 13.1 `net`

`tcp.connect(host, port) -> Result<Socket, NetError>`, `tcp.listen(addr)`,
`udp.socket()`, `Socket` with `read`, `write`, `readAll`, `close`,
`setTimeout(d)`, `SocketAddr` parse/format, `dns.resolve(host)`,
`ipv4.parse`, `ipv6.parse`.

### 13.2 `http`

Client: `http.get/post/put/patch/delete/request` returning
`Result<Response, HttpError>`; `Request` with `headers`, `body`, `query`,
`timeout`, `followRedirects`; `Response` with `status`, `headers`, `text()`,
`bytes()`, `json::<T>()`.
Server: doc 14 §5.
An interface `Transport` lets a program supply its own (a test fake, a proxy).

### 13.3 `tls`

`tls.client(host)`, `tls.server(config)`, `Certificate`, `TlsConfig` with
`certs`, `key`, `minVersion`, `alpn`. Platform-backed (Secure Transport /
Network.framework on Apple, OpenSSL on Linux, the browser on web).

### 13.4 `db`

```vela
db.open(url) -> Result<Connection, DbError>
conn.query(sql, params...) -> Result<List<Row>, DbError>
conn.exec(sql, params...) -> Result<Int, DbError>
conn.transaction(|tx| -> Result<T, E>) -> Result<T, DbError|E>
```

Drivers: SQLite (bundled), PostgreSQL, MySQL, and an interface for the rest.
Parameters are always bound (doc 14 §6).

---

## 14. Concurrency

### 14.1 `task`

`task.spawn(fn)`, `task.group()`, `Task<T>` with `await`, `cancel`, `timeout`,
`isDone`, `result()`; `task.yield()`, `task.current()`, `task.sleep(d)` (an
awaiting sleep, unlike `time.sleep`).

### 14.2 `sync`

`Channel<T>` (`bounded`, `unbounded`, `send`, `trySend`, `recv`, `close`,
`len`, `isClosed`), `Mutex<T>`, `RwLock<T>`, `Atomic<T>`, `Once<T>`,
`Barrier(n)`, `Semaphore(n)`, `WaitGroup`, `select`.

### 14.3 `thread`

`thread.spawn`, `thread.join`, `thread.current`, `thread.sleep`,
`thread.pool(n)`, `thread.count()` (`core` and `sys` only).

---

## 15. Development

### 15.1 `test`

`#[test]`, `#[bench]`, `mount` (doc 13 §20), `assertOk`, `assertErr`,
`assertSome`, `assertNone`, `assertNear(a, b, tol)`, `assertContains`,
`assertPanics`, `assertDoesNotPanic`, `fixture`, `tempDir()`.

### 15.2 `debug`

`debug.print(value)`, `debug.dump(value)` (structural, multi-line),
`debug.trace()`, `debug.assert`, `debug.breakpoint()` (`SIGTRAP`), `debug.stopwatch()`.

---

## 16. `ui`

Views and elements (doc 13 §2–3), styles and the 214 properties (§9), themes and
tokens (§10), states and queries (§11), animation (§12), accessibility (§13),
assets (§14), navigation (§15), gestures (§16), `Painter` (§17).

---

## 17. `web`

`web.fetch`, `web.ws`, `web.storage`, `web.history`, `web.clipboard`,
`web.worker`, `web.notify`, `web.geo`, `web.crypto`, `web.url`, `web.dom`
(escape hatch, doc 14 §10), `html.*` and `Markup` (doc 14 §7), `form`, `Json`
helpers, `params`, `router`.

## 18. `server`

`server.new()`, `App` with `use`, `routes`, `static`, `listen`, `csp`,
`error(handler)`; `Request`, `Response`, `Session`, `Cookie`; middleware
`logging`, `cors`, `compress`, `rateLimit`, `csrf`, `session`, `auth`, `timeout`;
`@get`, `@post`, `@put`, `@patch`, `@delete`, `@any` attributes (doc 14 §5).

## 19. `sys`

| Area | Items |
| --- | --- |
| raw memory | `Ptr<T>` (`read`, `write`, `add`, `sub`, `cast`, `isNull`, `addr`), `Ptr.fromAddr`, `volatile.at` |
| registers | `mmio` blocks, `Volatile<T>` |
| CPU | `interrupts.disable/enable/areEnabled/without`, `cpu.halt`, `cpu.pause`, `cpu.fence`, `cpu.ioWait`, `cpu.id`, `cpu.readCycleCounter` |
| pages | `page.alloc`, `page.free`, `page.map`, `page.unmap`, `page.mapRange`, `page.flags` |
| ports (x86) | `port.in8/16/32`, `port.out8/16/32` |
| syscalls | `#[syscall(n)]`, `extern "syscall"`, `userland.enter` |
| boot | `BootInfo`, `memory.init`, `interrupts.init`, `smp.startCores` |
| console | `serial.init`, `serial.writeStr`, `serial.read`, `framebuffer.init`, `framebuffer.blit` |
| context | `context.switchTo`, `context.save`, `context.restore` |
| abi | `abi.call`, `abi.stackSize`, `abi.align` |

---

## 20. Stability

| Tier | Modules | Policy |
| --- | --- | --- |
| **stable** | `core mem num int float math str char bytes list map set iter option result fmt cmp json time rand crypto env path fs io process cli log test` | breaking change needs a new edition |
| **provisional** | `net http tls db task sync thread debug regex` | may change between minor versions with a deprecation cycle |
| **unstable** | `ui web server sys` | may change in any release; the spec tracks it |

A program may pin `std = "1"` in `vela.pkg` and be sure that no `provisional`
change breaks it without a deprecation warning first (`W-STD-010`).

---

## 21. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-STD-010` | malformed format string in a literal |
| `E-STD-020` | `Str` concatenation in a disabled log level |
| `E-MOD-060` | module not available in this profile |
| `E-RUN-060` | unsupported regex construct (backreference) |
| `E-RUN-070` | no secure random source |
| `E-RUN-080` | required environment variable missing |
| `W-STD-010` | use of a provisional API marked for change |

---

Next: [17-ffi.md](17-ffi.md).
