# 40 — The build system

**Status:** `spec`. Tool: `vela build` (doc 25 §2). Related: doc 08 (packages), doc
27 (performance), doc 39 (cloud).

The build is part of the language because a language whose build is a pile of
shell scripts has no reproducible story. Vela's build is declared, hermetic,
incremental, cacheable and reproducible, and every one of those words has a
section here.

---

## 1. Targets and matrices

```toml
[targets]
default = "x86_64-unknown-linux-gnu"

[targets.x86_64-unknown-linux-gnu]
profile = "core"

[targets.aarch64-apple-ios]
profile = "app"
bundle  = "app.vela.store"
team    = "env:APPLE_TEAM_ID"

[targets.wasm32-unknown-unknown]
profile = "web"
features = ["client"]

[targets.x86_64-unknown-none]
profile = "sys"
linkerScript = "boot/linker.ld"
```

`vela build --matrix` prints every target the package supports with its profile,
features and artifact, and `--matrix ci` emits a GitHub Actions matrix (or a JSON
matrix for anything else) so a CI file does not hand-maintain a list that drifts
from the manifest.

```yaml
# generated, not written by hand
strategy:
  matrix: ${{ fromJSON(needs.matrix.outputs.value) }}
```

---

## 2. Workspaces

```toml
[workspace]
members = ["app", "server", "shared", "tools/*"]
default-members = ["app", "server"]
```

* One `vela.lock` for the workspace, one dependency graph, unified feature
  resolution.
* `vela build -p server` builds one member; `vela build` builds the default
  members; `--workspace` builds all.
* A member's dependencies may be path-relative (`shared = { path = "../shared" }`)
  or registry versions; a workspace member always wins over a registry version of
  the same name inside the workspace, which is what makes a monorepo's "edit and
  see it" loop work.
* `[workspace.deps]` declares a dependency once; a member uses
  `serde = { workspace = true }`, so twenty members cannot drift to twenty
  versions.
* `cargo`-style inheritance of `edition`, `license`, `authors`, `version` is
  supported through `[workspace.package]`.

---

## 3. Build scripts and generators

Two mechanisms, both hermetic:

### 3.1 `build.vela`

An optional program at the package root, compiled by the same compiler and run in
a sandbox before the package is compiled:

```vela
// build.vela
fn main(build: Build) -> Result<Void, Error> {
  build.watch("schema/*.json")
  let schema = try json.decode::<Schema>(try fs.read("schema/db.json")?)?
  try build.writeFile("src/generated/models.vela", generateModels(schema))

  if build.target.os == "linux" {
    build.linkSystem("sqlite3")
    build.env("SQLITE_BUNDLED", "0")
  }
  Ok(unit)
}
```

* It runs with no network, a writable `OUT_DIR` and read access to the package,
  so it cannot touch anything outside its declared inputs (`E-BUILD-010`).
* Its declared inputs (`watch`) and outputs (`writeFile`) become graph nodes, so a
  second build with unchanged inputs does not run it.
* It may set link flags, environment variables for compilation and `cfg` values
  (`build.cfg("has_avx2", "1")`), which is the supported way to reflect a probe
  result — not a `#[cfg]` that has to be maintained by hand.

### 3.2 Declared generators

```toml
[build.generators]
"proto/api.proto"   = ["vela", "bindgen", "--proto", "-o", "src/api.vela"]
"assets/icons/*.svg" = ["vela", "asset", "--out", "src/icons.vela"]
```

A generator is a command with declared inputs and outputs. It is cached the same
way a build script is; a generator that writes outside its declared outputs is an
error, not a surprise in a diff.

---

## 4. Hermeticity

A build may read only:

* the package's own files (minus `.gitignore`d paths),
* its dependencies' files,
* the compiler and the declared toolchain,
* `OUT_DIR`.

A build that reads `$HOME`, a global cache directory or the wall clock is
`E-BUILD-020` when it is detectable (a generator with a `time.now()` call outside
a declared input), and the hermetic sandbox refuses the rest at the syscall level
on Linux. This is what makes the remote cache in §6 sound: an output can be reused
only if its inputs are all known.

---

## 5. Incrementality

| Unit | Cache key |
| --- | --- |
| a module | source hash + `cfg` set + dependency **interface** hashes + compiler version |
| a build script | its declared input hashes + its own source + target |
| a generator | input file hashes + command line + tool version |
| a link step | object hashes + link flags + libraries |
| a package | the whole graph's keys |

* "Interface hash" means the public API of a dependency: signatures, types, inline
  bodies, derives, doc comments. Changing a private function does not rebuild
  dependents; changing a signature does.
* `vela build --explain` answers "why did this rebuild?" with the first key that
  changed, per module. Without that command, incremental builds become folklore.
* Parallelism is per module, with a bounded job count (`--jobs`), and the output
  is deterministically ordered in the logs.

---

## 6. Caching

```toml
[build.cache]
local  = ".vela/cache"
remote = "https://cache.acme.internal/"
mode   = "read-write"        # off | read | read-write
```

* The local cache is keyed by the graph hash of §5; it is content-addressed and can
  be deleted at any time.
* The remote cache uses the same keys, so a CI job and a laptop share work. A
  cache hit is verified by re-hashing the artifact, so a poisoned or corrupt entry
  cannot inject code (`E-BUILD-030`).
* `--offline` uses the local cache only; `--no-cache` bypasses both, which is what
  a reproducibility check uses.

---

## 7. Reproducibility

`vela build --release --frozen --verify-repro` builds twice, in two different
directories, and compares bytes. The guarantees that make this possible (sorted
symbols, no timestamps, remapped paths, deterministic generic order) are doc 26
§8. A build that is not reproducible is `E-BUILD-040` with the first differing
offset and the two symbol names.

Every release artifact records:

```json
{ "target": "x86_64-unknown-linux-gnu",
  "compiler": "1.0.0 (abc1234)",
  "inputs": "sha256:…",
  "artifact": "sha256:…",
  "reproducible": true }
```

which is what `vela deploy` and the SBOM (doc 24 §7.2) refer to.

---

## 8. Cross-compilation

```sh
vela build --target aarch64-unknown-linux-musl
vela build --target aarch64-apple-ios --release
```

* A target triple selects the profile defaults, the linker, the sysroot and the
  libc. A `-none` target means freestanding (doc 15 §2).
* Toolchains are described in the manifest, not in environment variables:

```toml
[toolchain.aarch64-unknown-linux-musl]
cc      = "aarch64-linux-musl-gcc"
strip   = "aarch64-linux-musl-strip"
sysroot = "env:MUSL_SYSROOT"
```

* `vela toolchain list` prints what is installed and what is missing, per target.
  A missing toolchain is a message, not a linker error in the middle of a build.
* Linking against a system library that is not present for the target is
  `E-BUILD-050` at resolve time, with the package that asked for it.

---

## 9. Profiles and flags

| Flag | Effect |
| --- | --- |
| `--debug` | no inlining, all checks, debug info, no cycle collector tuning |
| `--release` | `speed` optimisation, `assert` removed, symbols stripped |
| `--release --size` | optimise for size |
| `--release --asserts` | release performance, `assert` kept |
| `--release --lto` | link-time optimisation across packages |
| `--sanitize=thread,address,undefined` | instrumentation for a test build |
| `--coverage` | instrument for `vela test --coverage` |

There is no "fast and loose" mode that changes semantics (doc 27 §9).

---

## 10. Artifacts

| `--emit` | Output |
| --- | --- |
| `bin` (default) | executable |
| `lib` | static library (`.a`) or dynamic (`.so`/`.dylib`) |
| `c` | lowered C for a `core` package |
| `llvm`, `ir`, `asm`, `obj` | intermediate forms |
| `app` | `.app` bundle or `.ipa` (doc 00) |
| `dmg`, `deb` | installers |
| `oci` | a container image layout with a Dockerfile (doc 39 §1) |
| `sbom` | CycloneDX document |
| `symbols` | a symbol map for crash reports |
| `docs` | rendered documentation (doc 25 §6) |

`vela build --emit app --target aarch64-apple-ios` produces the same unsigned
`.ipa` this repository's CI produces, which is what makes the artifact workflow a
language feature rather than a collection of scripts.

---

## 11. Build-time guarantees

| Guarantee | Enforced by |
| --- | --- |
| a build script cannot reach the network | sandbox + declared inputs |
| a dependency cannot widen permissions | doc 24 §2 |
| a cached artifact matches its key | re-hash on read |
| a release build is reproducible | `--verify-repro` |
| two builds in a row run no build script twice | graph keys |
| a missing toolchain fails before compilation | resolve step |

---

## 12. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-BUILD-010` | build script used an undeclared input or wrote outside `OUT_DIR` |
| `E-BUILD-020` | non-hermetic access (clock, home, network) |
| `E-BUILD-030` | cache entry failed hash verification |
| `E-BUILD-040` | build is not reproducible |
| `E-BUILD-050` | system library missing for the target |
| `E-BUILD-060` | workspace member version conflict |
| `W-BUILD-010` | build script slower than a second on every build |
| `W-BUILD-020` | generator output not committed and no CI step regenerates it |

---

Next: [41-testing.md](41-testing.md).
