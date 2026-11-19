# 31 — Plugins and extensibility

**Status:** `spec`. Module: `plugins` (unstable). The ABI itself is doc 26 §6.

A plugin is how a Vela program gains a capability its author did not compile in:
a formatter for a new file type, a driver for a niche device, an importer for a
legacy system. Vela supports exactly one plugin mechanism, and it is a sandboxed
one.

---

## 1. Two kinds, one ABI

| Kind | Loaded as | Runs |
| --- | --- | --- |
| **native plugin** | a dynamic library (doc 26 §6) | in the host process, in its own task |
| **wasm plugin** | a `.wasm` module | in the host's sandbox, in its own instance |

Both implement the same declaration, so a plugin author picks one and the host
does not care.

```vela
#[plugin(name: "acme.metrics", version: (1, 2, 0), abi: 3)]
fn init(host: PluginHost) -> Plugin {
  Plugin {
    capabilities: [.network, .filesystem(read: ["data/**"])],
    hooks: {
      "onRequest": |req| { metrics.onRequest(req) },
      "onShutdown": |reason| { metrics.flush() },
    },
    provides: {
      "metrics.query": |q| metrics.query(q),
    },
  }
}
```

* `hooks` are lifecycle callbacks the host calls; `provides` are named functions
  the host can call through `plugin.call("metrics.query", args)`.
* The signature of every hook and provided function is part of the plugin's
  declared interface, so the host type-checks its calls against it when the plugin
  is loaded (`E-PLUG-010` if the interface does not match the host's expectation).
* A plugin cannot add syntax, cannot add keywords and cannot change the compiler.
  That boundary is deliberate: a language with a macro/plugin extension surface
  stops being analysable.

---

## 2. The host side

```vela
let host = plugins.host(capabilities: [.network, .filesystem(read: ["data/**"])])
let metrics = try host.load("libacme_metrics.so")?
log.info("${plugin.name} ${plugin.version}")

let result = try plugin.call("stats.summary", args: ())?.asJson()
```

* The host declares a **ceiling** of capabilities; a plugin that declares more is
  refused at load (`E-SEC-011` style, reported as `E-PLUG-020` with both sets).
* A plugin runs in its own task; a plugin that blocks does not block the host.
* A panic, a trap, or a WASM module that exceeds its memory cap is caught at the
  boundary: the plugin is marked failed, the call returns `Err(PluginError)`, and
  the host keeps running.
* `host.reload(name)` unloads and reloads a plugin atomically: new calls go to the
  new instance, in-flight calls finish on the old one. This is what makes a plugin
  system usable in a long-running service.

---

## 3. Sandboxing

| Kind | Isolation |
| --- | --- |
| native | its own task, no ambient authority, all I/O through the host API, `#![deny(unsafe)]` recommended but not enforceable |
| wasm | full memory isolation, no syscalls, host API only, a fuel limit per call, a memory cap |

A native plugin is native code in the process; the permission model is a
capability check, not a security boundary against a determined attacker, and the
specification says so plainly. That is why a marketplace plugin ships as WASM by
default and native only when it needs the performance of a driver.

WASM plugin limits:

```toml
[plugins.limits]
memory   = "64MiB"
fuel     = 500_000_000      # instructions per call
wall     = 2s
```

Exceeding a limit is `PluginError::limit(name)`, not a hang.

---

## 4. The host API

A plugin sees only what the host exposes. The interface is versioned with the
plugin ABI and is itself declared in Vela:

```vela
interface PluginHost {
  fn log(self, level: LogLevel, message: Str)
  fn now(self) -> Instant
  fn random(self, n: Int) -> UInt64
  fn readFile(self, path: Str) -> Result<Bytes, PluginError>
  fn writeFile(self, path: Str, bytes: Bytes) -> Result<Void, PluginError>
  fn http(self, request: PluginRequest) -> Result<PluginResponse, PluginError>
  fn kv(self) -> KeyValue            # a namespaced key-value store
  fn kvNamespace(self, name: Str) -> KeyValue
}
```

* `host.log` writes to the host's log with the plugin's name as a field.
* `host.log` and `host.log` of a `Secret` value redact it (doc 24 §3).
* `host.filesystem` is scoped to the paths the plugin declared; a path outside is
  `PluginError::permission`.
* `host.call` into another plugin is refused by default; a host may allow a
  declared dependency graph (`plugins.allow("a", "b")`), which is how a plugin
  ecosystem composes without a free-for-all.

---

## 5. Versioning and compatibility

| Change | Allowed |
| --- | --- |
| adding a hook | minor |
| adding a provided function | minor |
| adding a host API function | minor |
| changing a hook's parameters | major |
| removing a hook or a provided function | major |
| changing the ABI number | major |

A host accepts plugins with the same ABI major and any minor ≤ its own; a plugin
that needs a newer minor is refused with a message naming the missing function
(`E-PLUG-030`), which is the difference between "failed to load" and a
twenty-minute debugging session.

---

## 6. Discovery and manifest

A plugin ships as a package with a `[plugin]` section:

```toml
[package]
name    = "acme/metrics"
version = "1.2.0"
profile = "core"

[plugin]
kind         = "wasm"           # or "native"
entry        = "plugin.wasm"
hooks        = ["onRequest", "onShutdown"]
provides     = ["metrics.query"]
capabilities = { network = [], filesystem = { read = ["data/**"] } }
abi          = 3
```

`vela plugin build` produces the artifact and a manifest with its hash, which the
host verifies before loading (`E-PLUG-040` on mismatch).

### 6.1 Distribution

A plugin is published like any package (doc 08 §10), with two additions:

* the registry indexes its **capabilities**, `provides` and ABI version, so a host
  can search for "a plugin that provides `metrics.query` and needs no network";
* the artifact is signed (doc 24 §7.1) and the host verifies the publisher.

A host that installs plugins from a catalogue pins both the package version and the
plugin artifact hash:

```toml
[plugins]
metrics = { package = "acme/metrics", version = "1.2.0", hash: "sha256:…",
            capabilities = { network = [] } }
```

The `hash` is what makes the catalogue a signed index rather than a redirect: a
plugin update is a deliberate manifest change, and a host that receives a
different bytes for the same version refuses to load it.

There is no third-party marketplace in this specification. A registry of plugin
metadata is a package registry with extra fields (above), and building a
commercial store on top of it is an application, not a language feature. What the
language promises is the part that matters: **a published plugin's artifact is
immutable, signed and pinned by hash**, and a host that verifies those three things
is not trusting the catalogue.

---


---

## 7. Testing a plugin

```vela
#[test]
fn metricsCountsRequests() {
  with host = testHost(capabilities: [.network]) {
    let p = try host.load(pluginUnderTest())?
    try p.call("onRequest", args: sampleRequest())?
    let stats = try p.call("metrics.query", args: ())?.asJson()
    assertEq(stats["requests"].asInt()?, 1)
    assertEq(host.logs.count, 0)          # the plugin logged nothing unexpected
  }
}
```

`testHost` provides a fake log, clock, KV store and HTTP client, records every call,
and asserts on the permission set — the same fake-first approach as doc 23 §10.

---

## 8. What plugins are not

* Not a way to add syntax, operators or keywords.
* Not a way to run arbitrary code from the network: a plugin is loaded only from a
  declared dependency or an explicit path, and its hash is checked.
* Not a performance path: a plugin call is a boundary, so a hot loop belongs in
  the host or in a library.
* Not available in `web` (a browser has no dynamic loading) or `sys` (a kernel does
  not load plugins).

---

## 9. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-PLUG-010` | plugin interface does not match the host's expectation |
| `E-PLUG-020` | plugin declares a capability the host does not grant |
| `E-PLUG-030` | plugin needs a newer host API |
| `E-PLUG-040` | plugin artifact hash mismatch |
| `E-PLUG-050` | plugin loaded in a profile that has no dynamic loading |
| `W-PLUG-010` | native plugin used where WASM would do |

---

Next: [32-embedded.md](32-embedded.md).
