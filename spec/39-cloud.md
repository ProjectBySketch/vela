# 39 — Deployment, cloud and operations

**Status:** `spec`. Related: doc 14 §13 (web deploy), doc 23 §9 (observability),
doc 24 (security), doc 25 (CLI).

A Vela program is a single native binary or a `dist/` tree. This document is what
turns that into an operation: how it is packaged, deployed, observed, scaled and
rolled back, and what the toolchain does versus what the platform does.

---

## 1. Deployable shapes

| Shape | Built by | Runs on |
| --- | --- | --- |
| native binary | `vela build --release --target x86_64-unknown-linux-gnu` | any Linux container, VM, or bare metal |
| static binary | `--target x86_64-unknown-linux-musl` | scratch containers, no libc |
| container image | `vela build --emit oci` | a registry, then a container runtime |
| static site | `vela build --target static` | a CDN or object store |
| hybrid site | `--target hybrid` | a CDN for HTML + a server for islands and APIs |
| iOS/macOS app | `.ipa` / `.dmg` (doc 00) | devices |
| kernel image | `--target *-unknown-none` | hardware or QEMU |
| Wasm module | `--target wasm32-wasi` | any WASI host |

Every shape above comes out of `vela build` with no extra tooling, except the
container image, which needs a Dockerfile:

```dockerfile
FROM scratch
COPY build/x86_64-unknown-linux-musl/release/server /server
COPY public/ /public/
EXPOSE 8080
ENTRYPOINT ["/server"]
```

`vela build --emit oci` writes that Dockerfile and the layers, and refuses a
binary that links a library not present in the image (`E-CLOUD-010`).

---

## 2. Configuration

Configuration is typed, layered and declared — no `getenv` scattered through the
code.

```vela
#[derive(Config)]
struct Settings {
  #[env("PORT")]
  port: Int = 8080

  #[env("DATABASE_URL")]
  database: Secret<Str>

  #[env("LOG_LEVEL")]
  logLevel: LogLevel = .info

  #[env("FEATURE_METRICS")]
  metrics: Bool = false

  #[nested]
  limits: Limits = Limits { }
}
```

```vela
let settings = try Settings.load()?          // env vars, then defaults
let settings = try Settings.loadFrom("config.toml")?
```

* `#[env]` names the variable; `#[derive(Config)]` generates `load`, a validation
  pass, and a `--print-config` mode that redacts `Secret` fields.
* A required field with no value is a startup failure naming the variable
  (`E-CLOUD-020`), not a `nil` three requests later.
* Precedence: command line, then environment, then the config file, then defaults.
  One order, documented, and `--print-config` shows the resolved values with their
  source.

---

## 3. Environments and secrets

```toml
[deploy.staging]
target    = "container"
registry  = "ghcr.io/acme"
replicas  = 2
region    = "eu-west-1"
env       = { LOG_LEVEL = "debug" }
secrets   = ["DATABASE_URL", "SESSION_SECRET"]

[deploy.production]
target    = "container"
registry  = "ghcr.io/acme"
replicas  = 4
region    = ["eu-west-1", "us-east-1"]
secrets   = ["DATABASE_URL", "SESSION_SECRET", "STRIPE_KEY"]
canary    = { percent = 10, observe = "5m" }
```

A secret is supplied by the platform's store (doc 24 §3) and referenced by name;
`vela deploy` checks that every declared secret exists before it starts a rollout,
because a half-configured deployment is worse than a failed one.

---

## 4. Deploying

```sh
vela deploy staging
vela deploy production --canary 10% --observe 5m
vela deploy production --rollback
```

| Step | What happens |
| --- | --- |
| 1 | `vela build --release --frozen` on the CI machine, reproducible |
| 2 | the artifact is uploaded to the registry with its SBOM (`planned`) |
| 3 | the platform pulls it, starts the new version, waits for `/healthz` readiness |
| 4 | traffic moves: all at once, or a declared canary percentage |
| 5 | the canary is observed for the declared window against the declared metrics |
| 6 | promote, or roll back automatically if the metrics regress |

`vela deploy` talks to a **deploy adapter** (a small Vela program or a shell
command) declared in the manifest, so the toolchain does not need to know about
every cloud:

```toml
[deploy.adapters.kubernetes]
command = "kubectl apply -f -"
kind    = "kubernetes"
```

Three adapters are specified: `container` (Docker/Podman), `kubernetes` (kubectl
or the API), and `static` (sync a `dist/` tree to a bucket or a CDN). A cloud with
its own API is a package, not a language feature.

---

## 5. Observability

Observability has a wire format (doc 35 said it did not; this is it):
**OpenTelemetry**, exported over OTLP/HTTP.

```vela
observability.init(Service {
  name: "checkout",
  version: "1.4.0",
  environment: "production",
  traces: .otlp("http://collector:4318/v1/traces"),
  metrics: .otlp("http://collector:4318/v1/metrics"),
  logs: .otlp("http://collector:4318/v1/logs"),
  sample: .parentBased(.ratio(0.1)),
})
```

| Signal | API |
| --- | --- |
| traces | `trace.span("name") { }`, attributes, events, status, propagation from `traceparent` |
| metrics | `metrics.counter`, `.histogram`, `.gauge`, `.upDownCounter`, with attributes |
| logs | `log.info/warn/error` with a trace id, structured fields, redaction (doc 24 §9) |
| profiles | `profile.cpu(duration)` (`planned`), exported as pprof |

* `http`, `db`, `net` and `task` instrument themselves; a program that calls
  `observability.init` gets request latency, query latency and task metrics
  without writing any.
* Signals are batched and exported off the request path; a collector that is down
  drops after a bounded queue and increments `observability.dropped`, never blocks.
* An exporter that is not configured costs an atomics increment per event.

---

## 6. Health, readiness and shutdown

```vela
app.health("/healthz", check: {
  .liveness  => { Ok(unit) },
  .readiness => { try db.ping()?; try cache.ping()?; Ok(unit) },
})
```

* Liveness reports whether the process is alive; readiness whether it can serve.
  Conflating them is how a restart loop starts.
* On `SIGTERM`: stop accepting, drain in-flight requests for `gracePeriod`
  (default 30 s), flush telemetry, exit 0 (`E-CLOUD-030` if a handler exceeds the
  grace period, naming the route).
* A `TaskGroup` for the server owns every request task, so shutdown is
  cancellation rather than a thread kill.

---

## 7. Scaling

| Concern | Guidance the spec states |
| --- | --- |
| stateless servers | sessions in a cookie or a shared store, never in process memory |
| connection pools | sized per replica, not per machine (`db.pool(size: replicas * 8)`) |
| background work | a queue (a channel that outlives a request is a leak); a worker process |
| caching | an interface (`cache`), with an in-memory and a Redis implementation |
| rate limits | per instance, or shared when the platform needs it (doc 23 §6) |
| sticky sessions | not required by anything in doc 14's design |
| autoscaling | driven by the metrics in §5, not by CPU alone |

A Vela server is horizontally scalable by construction: no global mutable state
across requests (doc 04 §2.4), no in-process session, and a readiness probe that
reflects real dependencies.

---

## 8. Cost and efficiency

* `vela build --stats` reports binary size; a server under 4 MiB is normal, and a
  scratch container is tens of MiB rather than hundreds.
* Startup is measured (doc 27 §5): a cold start that is slow is a `W-PERF-010`
  with the number.
* Idle memory is reported by `mem.stats()` in a debug build and exported as a
  metric in production, so "it grows slowly" is a graph, not a rumour.
* No sidecar, no runtime, no JVM: the deployment's attack surface and its memory
  footprint are the program's.

---

## 9. Local development parity

```sh
vela dev            # watch, rebuild, restart on change, stream logs
vela dev --docker   # build the image locally and run it, so the container is tested
vela dev --seed     # a local database with fixtures, migrated and seeded
```

`vela dev` runs the same binary and the same configuration loading as production;
the difference is a development config file and a watcher. The classic "works
locally, fails deployed" comes from a different code path, and there is not one.

---

## 10. CI/CD

```yaml
jobs:
  test:
    - vela build --frozen
    - vela fmt --check
    - vela lint --deny warnings
    - vela test --coverage
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - vela deploy staging
      - vela deploy production --canary 10% --observe 5m
```

* The pipeline is the same commands a developer runs; nothing is CI-only.
* A deploy is a `vela deploy` call, so a rollback is the same command with
  `--rollback`, available from a laptop during an incident.
* The artifact is reproducible (doc 26 §8), so "what is running" has a hash that
  can be rebuilt.

---

## 11. Failure handling

| Failure | Behaviour |
| --- | --- |
| bad config or missing secret | fail at startup, before serving (`E-CLOUD-020`) |
| database unreachable | readiness fails; the server stays up and does not serve |
| a dependency is slow | timeout + circuit breaker (doc 23 §6), not a hung request |
| a panic in a handler | caught, 500, trace id, process stays up (doc 14 §6) |
| the platform kills the process | graceful drain on SIGTERM; the in-flight request returns or is retried by the client |
| a deploy regresses a metric | canary auto-rollback (§4) |
| a disk fills | logs are bounded and rotated; the app never writes unbounded state |

---

## 12. Multi-region

| Concern | Vela |
| --- | --- |
| routing | a DNS or anycast concern; the app is stateless |
| data | read replicas and a declared `primary` region; writes go to the primary |
| clocks | `Instant` is monotonic per process; `time.now()` is wall clock and is documented as unsynchronised |
| ids | `uuid.v7()` is time-ordered and region-independent, which is what makes multi-region writes merge cleanly |
| consistency | stated per endpoint: `.consistentRead()` or not |

---

## 13. Running the whole thing

A complete small service, end to end, in one package:

```vela
#[derive(Config)]
struct Settings {
  #[env("PORT")] port: Int = 8080
  #[env("DATABASE_URL")] database: Secret<Str>
}

#[app]
view Root() {
  routes { "/" => Home() }
}

fn main() -> Result<Void, Error> {
  let settings = try Settings.load()?
  observability.init(Service { name: "site", version: VERSION })

  let pool = try db.open(settings.database.expose())?
  let app = server.new()
  app.use(logging()).use(compress()).use(rateLimit(perSecond: 100))
  app.routes(Root())
  app.health("/healthz", check: { .readiness => { try pool.ping()?; Ok(unit) } })
  app.listen(port: settings.port)
}
```

`vela build --release`, one container, one metrics endpoint, a readiness probe and
a rollback command. That is the deployment story.

---

## 14. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-CLOUD-010` | image links a library not present in the image |
| `E-CLOUD-020` | required configuration or secret missing at startup |
| `E-CLOUD-030` | request exceeded the shutdown grace period |
| `E-CLOUD-040` | deploy target declares a secret the platform does not provide |
| `E-CLOUD-050` | manifest deploys a debug build |
| `W-CLOUD-010` | in-process session or cache in a service with more than one replica |
| `W-CLOUD-020` | unbounded queue in a request path |

---

Back to the [index](README.md).
