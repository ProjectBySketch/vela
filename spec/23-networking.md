# 23 — Networking

**Status:** `spec`. Modules: `net`, `http`, `http2`, `quic`, `dns`, `grpc`,
`mqtt`, `sse` (provisional). Related: doc 14 (web), doc 24 (security).

Doc 16 lists the surface. This document is about the **rules**: what happens on
failure, how a client stays alive, and how a program states its reliability
requirements instead of hoping.

---

## 1. Layers

```
application     http, http2, quic-streams, grpc, mqtt, sse, ws
transport       tls 1.3+, quic, tcp, udp
names           dns
policy          connect rules, proxies, retries, timeouts, budgets
readiness       epoll / kqueue / io_uring / GCD / browser
```

A program may use any layer, and the layer below is always visible: `http2` is
implemented on `tls` on `tcp`, and a program that needs control can drop one
level without leaving the language.

---

## 2. Connections

```vela
let sock = try tcp.connect("example.com", 443, options: ConnectOptions {
  connect: 3s,
  noDelay: true,
  keepAlive: 30s,
})?
defer sock.close()

try sock.write(payload)?
let reply = try sock.read(4096)?
```

* Every operation that can block has a **timeout in its options**, and every
  timeout has a default (5 s connect, 30 s idle read). A call with no reachable
  timeout is `E-NET-010`.
* `close()` is idempotent; `defer sock.close()` is the idiom, never a bare call.
* `sock.read(n)` returns `Result<Bytes, NetError>` and **may return fewer than `n`
  bytes** — `readExactly(n)` is the one that does not, and its name says so.
* `sock.into(buffered:)`, `sock.split()` for a reader and a writer half.

### 2.1 Address policy

`tcp.connect(host, port)` resolves and tries every address, preferring IPv6 and
falling back to IPv4 ("happy eyeballs", 250 ms stagger). Connecting to a private
address from a `web` server route is refused by default (SSRF), unless the rules
allow it:

```toml
[net]
allowPrivate = false
allowHosts   = ["api.internal.example"]
denyHosts    = []
maxConnectionsPerHost = 32
```

A connection blocked by policy is `NetError::policy`, never a hang.

---

## 3. HTTP/1.1 and HTTP/2

```vela
let client = http.client(ClientOptions {
  baseUrl: "https://api.example.com",
  poolSize: 8,
  http2: true,
  defaultHeaders: {"user-agent": "acme/1.0"},
})

let res = try client.get("/v1/users", query: {"page": "2"}, timeout: 5s)?
match res.status {
  s if s.isSuccess => println(try res.text()?)
  s if s.isClientError => fail HttpError.rejected(res)
  _ => fail HttpError.server(res)
}
```

* One `Client` owns its pool; a per-call `http.get(...)` creates a temporary one
  and is allowed only for scripts (`W-NET-010` in `core`/`app` packages).
* HTTP/2 is used when the TLS handshake negotiates it; HTTP/3 (`quic`) when the
  target has UDP and the option is on.
* Redirects: followed up to `followRedirects` (default 5), and a redirect to a
  different origin drops `Authorization` unless the session says otherwise.
* Retries: `retry` wrapper (§6), never a silent automatic retry of a non-idempotent
  method — the compiler knows which methods are idempotent from the `@get`/`@post`
  attributes of the server side, and from an explicit `idempotent: true`.
* Bodies: `Bytes`, `Str`, `Json` (`body.json::<T>()`), a `Reader` for streaming
  upload, and an `io.Writer` for streamed download.

### 5.1 HTTP/3 and QUIC

```vela
let q = try quic.connect("example.com", 443, alpn: ["h3"])?
let stream = try q.openStream()?
try stream.write(requestBytes)?
```

QUIC streams are the primitive; `http3` is built from them. Datagrams are
available for game traffic (`q.datagram()`), with the same session and TLS
machinery.

---

## 4. WebSocket, SSE, gRPC, MQTT

```vela
let ws = try ws.connect("wss://chat.example.com/room/1")?
for msg in ws {
  match msg {
    WsMessage::text(t) => handle(t),
    WsMessage::binary(b) => handleBytes(b),
    WsMessage::closed(code, reason) => break,
  }
}
```

| Protocol | Shape |
| --- | --- |
| `ws` | a bidirectional stream of text/binary with ping/pong handled for you |
| `sse` | a stream of `Event { id, type, data, retry }`; reconnection with `Last-Event-ID` |
| `grpc` | generated from `.proto` by `vela bindgen --proto`, four call kinds, typed messages (doc 31 `#[derive(Proto)]`, `planned`) |
| `mqtt` | client with QoS 0/1/2, retained messages, topic filters, and a session store |

All four obey the same rules: no unbounded queue, no retry storm, and a closed
stream is a value (`nil` from `recv`, or `WsMessage::closed`) rather than a panic.

---

## 5. DNS

```vela
let records = try dns.lookup("example.com", type: .a)?
let mx = try dns.resolve("example.com", type: .mx)?
```

System resolver by default; a custom resolver (`dns.resolver(servers: [...])`)
for tests and private zones, with DNS-over-TLS and DNS-over-HTTPS. Caching
honours the record TTL and is capped (`maxTtl: 300s`) so a bad TTL cannot pin a
stale address for a day.

---

## 6. Reliability policy

This is the part most networking code gets wrong by accident. Vela makes it
explicit and composable:

```vela
let policy = net.policy(
  timeout: 3s,
  retries: net.retry(max: 3, backoff: .exponential(base: 200ms, jitter: .full)),
  breaker: net.breaker(failures: 5, cooldown: 30s),
  rate: net.rateLimit(perSecond: 20, burst: 40),
  budget: net.budget(deadline: 10s),       # total, across retries
)

let res = try policy.run { client.get("/v1/search", query: q) }?
```

| Building block | Meaning |
| --- | --- |
| `timeout` | per attempt |
| `retries` | attempts with backoff and jitter; the last error is returned |
| `breaker` | after N consecutive failures, fail fast for a cooldown |
| `rateLimit` | token bucket per host, shared by every task using the policy |
| `budget` | a total deadline: retries cannot exceed it |
| `hedge` (`planned`) | start a second attempt after a delay, take the first answer |

A retry may not exceed the budget (`E-NET-020` at construction if it could), and
a non-idempotent request is never retried implicitly.

---

## 7. Proxies and TLS

```vela
net.proxy("http://proxy.example:8080", noProxy: ["localhost", "*.internal"])
http.client(ClientOptions { tls: .defaults.requireTls13() })
```

`http_proxy`/`https_proxy`/`no_proxy` are honoured by default. TLS verification
is **on** and cannot be disabled by a flag — a test that needs a self-signed
certificate adds it to the trust store for the test:

```vela
#[test]
fn againstLocalServer() {
  with server = testServer(cert: fixtures.cert("localhost.pem")) {
    http.client(ClientOptions { trust: server.certificate })
  }
}
```

`tls.insecure()` does not exist. The closest is a test-only trust store, which is
a line of code a reviewer can see.

---

## 8. Servers

Doc 14 §5 covers the request side. Server-side networking also needs:

| Concern | Vela |
| --- | --- |
| backpressure | bounded accept queue; a full queue stops accepting rather than growing memory |
| slow clients | read and write deadlines per connection, defaults 10 s / 30 s |
| timeouts | `app.readTimeout`, `app.writeTimeout`, `app.idleTimeout` |
| connection limits | `app.maxConnections`, per-IP caps |
| graceful shutdown | on `SIGTERM`, stop accepting, drain for `gracePeriod`, then cancel tasks |
| HTTP/2 | enabled by default behind TLS |
| HTTP/3 | `app.http3(true)` when UDP is available |
| proxies | `X-Forwarded-For` is trusted only from declared proxy ranges (`E-NET-030` otherwise) |
| health | `app.health("/healthz")` reports liveness and readiness separately |

---

## 9. Observability

```vela
net.onRequest { r |
  trace.span("http", attributes: {
    "http.method": r.method, "http.route": r.route, "http.status": r.status,
  })
}
```

Every request carries a trace context; client calls propagate it; a server
exposes it as `req.traceId`. Metrics: connections opened, requests, latency
histograms, retries, breaker state. A program that does not configure a sink pays
the cost of an atomics increment, nothing more.

---

## 10. Testing networking

```vela
#[test]
async fn retriesOnTimeout() {
  let fake = net.fake()
  fake.on("/slow").delay(200ms).reply(200, "late")
  fake.on("/slow").delay(0ms).reply(200, "ok")     # second attempt succeeds

  let res = try net.policy(timeout: 100ms, retries: net.retry(max: 2)).run {
    fake.client().get("/slow")
  }?
  assertEq(try res.text()?, "ok")
  assertEq(fake.count("/slow"), 2)
}
```

`net.fake()` is an in-process server with programmable delays, failures and
assertions on the requests it received. `#[network]` runs a test against a real
socket on a loopback port when the fake is not enough.

---

## 12. Wire formats and observability

* gRPC messages are `#[derive(Proto)]` structs (doc 38 §1); a `.proto` file is
  generated from the type by `vela build --emit-proto`, and a `.proto` file that
  arrives first is turned into a Vela type by `vela bindgen --proto`. Field numbers
  live in the type, so a renumbering is a reviewable diff.
* HTTP request/response bodies use the codecs in doc 38: JSON by default,
  MessagePack or CBOR when the header asks, and a `Accept:` negotiation helper
  that picks from a declared preference list.
* Observability is OpenTelemetry over OTLP; the wire format, sampling and exporter
  configuration are specified in [39-cloud.md](39-cloud.md) §5, and an instrumented
  `http` client propagates `traceparent` without the program doing anything.

---

## 13. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-NET-010` | blocking call with no reachable timeout |
| `E-NET-020` | retry policy can exceed its budget |
| `E-NET-030` | forwarded header trusted from an undeclared proxy |
| `E-NET-040` | plaintext HTTP from a `web` server route |
| `E-NET-050` | unbounded queue in a stream handler |
| `W-NET-010` | per-call client in a long-lived package |
| `W-NET-020` | non-idempotent request inside a retry policy |

---

Next: [24-security.md](24-security.md).
