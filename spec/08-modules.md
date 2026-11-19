# 08 — Modules and packages

**Status:** `spec`. 0.1 has a single global namespace per file and no packages.

---

## 1. Modules

A module is a namespace and a visibility boundary.

```vela
mod geometry {
  pub struct Point { x: Float, y: Float }

  pub fn area(p: Point) -> Float { p.x * p.y }

  fn helper() { }              # private to geometry
}

geometry::Point { x: 1.0, y: 2.0 }
geometry::area(p)
```

### 1.1 File modules

| On disk | Declared as |
| --- | --- |
| `src/main.vela` | the crate root |
| `src/geometry.vela` | `mod geometry` |
| `src/geometry/shape.vela` | `mod shape` **inside** `geometry` |
| `src/geometry/mod.vela` | the module `geometry` itself (with submodules) |

The compiler walks from `src/main.vela` following `mod` declarations; a
`mod name` with no body means `name.vela` or `name/mod.vela` next to the current
file. Files not reachable that way are not compiled.

### 1.2 Inline modules

`mod name { ... }` nests a module inside a file. It is a real namespace, not a
syntactic grouping: names inside are not visible outside without `name::` or a
`use`.

### 1.3 Attributes on modules

```vela
#[cfg(target: "ios")]
mod platform_ios
```

`mod` may be attributed with anything in doc 12 §4; `cfg` and `doc` matter most.

---

## 2. Paths and `use`

```vela
use geometry::Point                            # one item
use geometry::{Point, area}                    # a group
use geometry::{area as computeArea}            # rename
use geometry::*                                # everything public
use std::{fs, io::{File, Read}}
use self::shape                                # current module
use super::shared                              # parent module
use crate::db                                  # crate root
```

Rules:

* `use` brings a name into the current module's namespace. It does not re-export
  unless written `pub use`.
* `use` is ordered and idempotent; duplicates are `W-MOD-010`.
* A name brought in by `use` may be shadowed by a local declaration, with a
  warning (`W-MOD-011`).
* Glob imports are allowed but their names lose to explicit imports and to local
  declarations. An ambiguous glob (two globs providing the same name, both used)
  is `E-MOD-020`.

The prelude (`std::prelude`) is imported automatically: `print`, `println`,
`len`, `str`, `num`, `List`, `Map`, `Set`, `Str`, `Option`, `Result`, `panic`,
`assert`, `typeName`. Anything else must be `use`d — a deliberate difference
from scripting languages, because a reader should be able to see where a name
comes from.

---

## 3. Visibility

| Form | Visible to |
| --- | --- |
| (none) | the module and its descendants |
| `pub` | everywhere |
| `pub(crate)` | this package |
| `pub(package: "name")` | a named package |
| `pub(in a::b)` | the module path `a::b` and below |
| `private` | the owning declaration's `impl` blocks only |

An item's visibility may not exceed the visibility of a type it exposes in a
signature (`E-MOD-030` — "private type in public interface"). This is the rule
that keeps a library's API from accidentally leaking an internal type.

---

## 4. The manifest

A package is a directory with `vela.pkg` at its root.

```toml
[package]
name        = "acme/dashboard"
version     = "1.4.0"
edition     = "2026"
description = "The Acme status board"
license     = "MIT"
authors     = ["Ada <ada@acme.example>"]
profile     = "web"              # core | app | web | sys
strict      = true
entry       = "src/main.vela"

[deps]
std  = "1"
http = "^3.2"
db   = "0.9"

[devDeps]
testkit = "1"

[targets.ios]
profile = "app"
entry   = "src/app.vela"

[deps.ios]
metal = "0.4"

[targets.wasm]
profile = "web"
entry   = "src/client.vela"

[features]
default = ["tls"]
tls     = []
metrics = ["dep:prometheus"]

[serve]
root = "public"
port = 8080

[build]
optimise = "speed"               # none | speed | size | debug
warnings = "deny"
```

### 4.1 Fields, completely

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | `scope/name` or a bare name for an unscoped package |
| `version` | yes | semver, no leading `v` |
| `edition` | yes | which spec edition the source is written against |
| `profile` | yes | the default profile |
| `strict` | no | `true` to check in `strict` mode (default `false`) |
| `entry` | no | overrides the profile's default entry file |
| `description`, `license`, `authors`, `homepage`, `repository` | no | metadata |
| `deps` | no | runtime dependencies |
| `devDeps` | no | only for `vela test` |
| `features` | no | named sets of optional dependencies or flags |
| `targets` | no | per-target overrides of `profile`, `entry`, and deps |
| `serve` | no | server configuration for `vela serve` |
| `build` | no | optimisation and warning policy |
| `[assets]` | no | asset roots (doc 13 §9) |
| `[registry]` | no | alternate registry URL |

An unknown key is `E-PKG-010` (never silently ignored: a typo in `devdeps`
should not look like it worked).

---

## 5. Dependency resolution

* Version requirements are semver ranges: `"1"` (^1), `"^3.2"`, `"~0.9.1"`,
  `"=1.0.0"`, `"*"`, `">=2 <4"`.
* Resolution is performed once and written to `vela.lock`, which MUST be
  committed for applications and MAY be committed for libraries.
* `vela build --frozen` refuses to change the lock; CI uses it.
* Two packages that require incompatible versions of the same name are an error
  unless one is renamed:
  `db2 = { package = "acme/db", version = "2" }`.
* Resolution is maximal-matching with no backtracking surprises: the algorithm is
  a simple lowest-compatible selection, documented so that two toolchains produce
  the same lock file (`planned`: a formal algorithm with a reference
  implementation).

---

## 6. Features

```toml
[features]
default  = ["tls"]
tls      = ["dep:openssl"]
metrics  = []
```

```vela
#[cfg(feature: "metrics")]
pub fn record(name: Str, value: Float) { ... }
```

* A feature is a compile-time flag, resolved before compilation.
* `dep:name` makes an optional dependency available only with the feature.
* Features are **additive**: enabling one may not break another. A feature that
  removes functionality is `W-PKG-020`.

---

## 7. Coherence across packages

This is the rule that makes separate compilation predictable.

1. An `impl Trait for Type` must be written in a module that owns `Trait` or owns
   `Type`.
2. A package may not add conformance to two foreign types
   (`E-GEN-010`, doc 07 §8).
3. Two conformances for the same pair anywhere in the dependency graph are
   `E-GEN-011`, reported with both locations and the dependency path to each.

`extension` blocks are exempt only in the sense that they add methods, not
conformance — and the compiler still rejects a name collision with an inherent
method (`E-DATA-080`).

---

## 8. Conditional compilation

```vela
#[cfg(target: "ios")]        fn homeIndicator() { ... }
#[cfg(profile: "sys")]       fn halt() -> Never { ... }
#[cfg(os: "linux")]          fn epoll() { ... }
#[cfg(arch: "aarch64")]      fn fence() { ... }
#[cfg(feature: "tls")]       fn handshake() { ... }
#[cfg(test)]                 mod tests { ... }
#[cfg(all(debug))]           fn dump() { ... }
#[cfg(any(os: "macos", os: "ios"))]  fn darwin() { ... }
#[cfg(not(target: "wasm"))]  fn threads() { ... }
```

`cfg` accepts `all(...)`, `any(...)`, `not(...)`, and the keys `target`,
`profile`, `os`, `arch`, `feature`, `test`, `debug`, `release`, `version`.

Conditional compilation removes the item **before** type checking, so a
`sys`-only function may use `Ptr` in a file that also compiles for `web`.

---

## 9. Workspaces

**Planned.**

```toml
[workspace]
members = ["app", "server", "shared"]
```

One lock file, one `vela build` at the root, shared feature resolution. Until it
lands, a package may depend on a sibling by path:

```toml
[deps]
shared = { path = "../shared" }
```

---

## 10. The registry

**Status:** registry protocol `spec`; hosted instance `planned` (`registry.vela.dev`).

A registry is a content-addressed store plus a name index. The protocol is small
enough to implement, which is the point: a private registry is a first-class
feature, not a fork of the toolchain.

### 10.1 Publishing

```
POST /v1/packages/{scope}/{name}/{version}
     body: application/octet-stream (the package archive)
     headers: Authorization: Bearer <token>
              X-Vela-Checksum: sha256:<hex>
              X-Vela-Manifest: base64(vela.pkg)

200  { "published": "...", "checksum": "sha256:..." }
409  { "error": "version exists" }
403  { "error": "scope not owned" }
```

* **Immutable.** A version, once published, can never be replaced; the registry
  rejects a second upload with `409`, and the only remedy is a new version. This
  is what makes a lock file meaningful.
* **`yank`.** `POST /v1/packages/{scope}/{name}/{version}/yank` hides a version
  from new resolutions. Existing locks keep working; a new resolution that would
  pick it fails with a message naming the yank reason.
* **Checksum.** The archive's SHA-256 is recorded; `vela build` verifies it on
  download (`E-PKG-030`).
* **Scope ownership.** A scope is claimed once and owned by an account or an
  organisation; publishing into it requires a token with `publish` on that scope.
* **Validation on upload.** The registry runs `vela build --frozen` and
  `vela test` in a sandbox before accepting; a package that fails is rejected with
  the log. (A registry that hosts broken packages is a registry nobody uses twice.)
* **Size and file limits.** 50 MiB per package; no binaries outside `assets/`
  unless the package declares `[package] binaries = true`.
* **Licence.** A `license` field is required and is shown on the page; a package
  without one is rejected.

### 10.2 Resolving

```
GET /v1/packages/{scope}/{name}
     → { versions: [...], yanked: [...], latest: "1.4.2" }
GET /v1/packages/{scope}/{name}/{version}/download
     → the archive
GET /v1/search?q=database&profile=core&sort=downloads
```

Resolution uses the versions index, then downloads by exact version. Every
download is verified against the lock's hash; a registry compromise therefore
cannot silently change a dependency that is already locked.

### 10.3 Authentication

* Tokens are scoped (`publish`, `yank`, `read:private`) and revocable.
* Two-factor is required to create a token that can publish into an organisation.
* CI tokens expire (default 90 days) and are bound to a repository when the
  registry is GitHub-integrated.
* `vela login` stores the token in the platform's secret store (doc 24 §3), never
  in `vela.pkg` or a shell history.

### 10.4 Private registries

```toml
[registry]
default  = "https://registry.vela.dev"
private  = "https://packages.acme.internal"
scope    = { "acme" = "private" }
```

A package in a `private` scope resolves from the private registry and nowhere
else; a public dependency of a private package resolves from the default. This is
one configuration block, and `vela vendor` still produces an offline tree.

### 10.5 Moderation and takedown

* A report opens a review; a confirmed malware report yanks the version and blocks
  the publisher.
* A takedown is recorded permanently: the version stays in the index as
  `"taken_down": true` with a reason, so a build that depended on it fails with an
  explanation instead of "not found".
* Namesquatting policy: a scope that publishes nothing for 12 months may be
  reclaimed after notice.

---

## 11. Layout of a package

```
dashboard/
  vela.pkg
  vela.lock
  README.md
  src/
    main.vela
    routing.vela
    components/
      mod.vela
      card.vela
  assets/
    logo.svg
  tests/
    routing.vela
  spec/                      # optional, non-compiled documentation
```

* `src/main.vela` is the entry unless `entry` says otherwise.
* `tests/*.vela` holds integration tests, compiled against the package as an
  external user would.
* `assets/` is reachable through the `asset` declarations of doc 13 §9.
* Nothing outside `src/` and `tests/` is compiled.

---

## 12. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-MOD-010` | module not found (with the searched paths) |
| `E-MOD-020` | ambiguous name from two globs |
| `E-MOD-030` | private type in a public interface |
| `E-MOD-040` | cyclic module inclusion |
| `E-MOD-050` | cyclic package dependency |
| `W-MOD-010` | duplicate `use` |
| `W-MOD-011` | shadowed import |
| `E-PKG-010` | unknown manifest key |
| `E-PKG-020` | version requirement does not match any published version |
| `E-PKG-030` | downloaded package hash mismatch |
| `E-PKG-040` | missing `vela.lock` under `--frozen` |
| `W-PKG-020` | non-additive feature |

---

Next: [09-memory.md](09-memory.md).
