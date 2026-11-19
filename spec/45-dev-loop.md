# 45 — The development loop

**Status:** `spec`. Tool: `vela dev` (doc 25). Related: doc 40 (build), doc 41
(testing), doc 28 (compiler).

The distance between an idea and a running program is a language feature. Vela's
loop is: save, see the change in place, with state preserved where it can be, and
with the ability to step backwards when it cannot.

---

## 1. `vela dev`

```sh
vela dev                 # watch, rebuild, reload
vela dev --target ios    # a simulator with hot reload
vela dev --docker        # the container image, rebuilt on change
vela dev --db seed.json  # a migrated, seeded local database
```

What it does:

1. Builds the package (doc 40's incremental graph).
2. Starts the program — a server, an app on a simulator, a page in a browser, or a
   binary in a terminal.
3. Watches the input set of the build (sources, assets, `vela.pkg`, build script
   inputs) and rebuilds only the modules that changed.
4. Applies the change to the **running** program (§2) instead of restarting it
   where that is safe, and restarts where it is not.
5. Streams logs, errors and metrics from the program to the terminal.

A rebuild that fails prints the diagnostics and keeps the previous program running
— a syntax error never costs a restart and a lost session.

---

## 2. Hot reload

Reload is a typed operation, not a magic trick. Each change is classified:

| Change | Behaviour |
| --- | --- |
| a function body | patched in place; the new code is used by the next call |
| a `const` | inlined at its use sites; those call sites are patched |
| a `struct` field added at the end | state preserved; new field takes its default |
| a `struct` field removed or reordered | state reset for that type (`E-DEV-010` if `#[keepState]` demanded otherwise) |
| a resource with `Drop` | rebuilt; outstanding ones are dropped first, in order |
| an `async fn` signature | affected tasks are cancelled and their scopes re-run |
| a `static` initialiser | re-run; the old value is dropped |
| the `main` entry | the process restarts, state lost, said so |
| a linked native library | full restart |

* **State preservation.** `state` in a `view` (doc 13), a signal (doc 43) and a
  `static` keep their values across a patch when the type is compatible. A value
  that cannot be preserved resets, and the overlay lists what reset.
* **Opt out.** `#[keepState]` on a state holder makes an incompatible change an
  error rather than a silent reset; `#[resetOnReload]` forces a reset.
* **Web.** A page reloads only the changed island; the rest of the DOM, scroll
  position, focus and form state are preserved. A full page reload happens only
  when the shell changed (`E-DEV-020` explains why).
* **Server.** A request in flight finishes on the old code; the next request uses
  the new one (`vela dev` keeps two versions live for one grace period).
* **Not hot-patchable.** A change to `unsafe` code, a plugin ABI, a struct layout
  that crossed a boundary, or anything in a `sys` package is a restart. The
  overlay names the reason; it never pretends.

---

## 3. Time travel

The debugger records a trace of state changes and lets you step backwards.

```sh
vela run --record session.vtrace
vela replay session.vtrace --at 1200ms
```

* Recording captures: function calls with arguments, state writes, effect
  boundaries (a request, a frame, a syscall) and the values a `debug.inspect` asked
  for. It is off by default and bounded by memory.
* Replay is **deterministic** because a program's inputs are: time comes from an
  injected clock, randomness from a seeded generator, network from a recorded
  transcript, and the task scheduler's interleavings are recorded per suspension
  point (doc 10 §14). A non-deterministic program replays to the same divergence
  point and says so.
* Reverse execution is a re-run from the last checkpoint plus the recorded inputs,
  not a reverse interpreter: each checkpoint is every N events (default 1,000), so
  stepping backwards is O(checkpoint), not O(history).
* `--at <time>` jumps to a point; `--break-on <condition>` stops when a Vela
  expression becomes true; both are available in the DAP (doc 25 §4.1) so an
  editor gets them for free.

---

## 4. Live inspection

```vela
debug.inspect("cart", cart)         # shown in the inspector while running
debug.measure("checkout") { ... }   # timing, in the same panel
debug.assertInvariant { cart.total >= 0.0 }
```

* The inspector shows a live tree: state, signals, tasks, open connections, the
  last N requests, memory per allocation site.
* `vela dev --inspect` opens it in a browser for a server or a page, in a panel for
  an app.
* Any value can be edited from the inspector in a development build (that is what
  hot reload is for); a production build has no inspector and no `debug.inspect`
  (`E-DEV-030` if the call survives a release compile — it is removed, and a
  `comptime` reference to it is an error).

---

## 5. Dev overlay

An `app` build in development shows a small overlay (toggle: three-finger tap or
`⌘D`):

| Panel | Shows |
| --- | --- |
| frames | frame time, dropped frames, the slowest view |
| memory | live bytes, allocations per frame, the cycle collector's count |
| network | requests, latencies, failures |
| logs | the last 200 lines with levels |
| state | the signals and `state` of the current screen |
| a11y | labels missing, touch targets too small, contrast warnings |

Each panel is a view (doc 13) and the overlay is compiled out of a release build,
so it costs nothing to ship.

---

## 6. Remote and device debugging

| Situation | How |
| --- | --- |
| an iOS device | `vela run --device <udid> --debug`, DAP over the network, symbols from the build |
| a Linux server | `vela run --remote user@host --debug` starts the binary under a debug stub and tunnels DAP |
| a browser | the WASM build maps to DWARF; Chrome/WebKit devtools step through Vela source |
| a kernel | `vela run --qemu --gdb` (doc 15 §12) |
| a production crash | a symbol map plus a crash dump (doc 37 §12), replayed locally |

Remote debugging is the same protocol and the same source mapping as local; there
is no reduced "remote profile" with fewer features.

---

## 7. Feedback speed as a contract

| Action | Budget |
| --- | --- |
| incremental rebuild of one module | ≤ 150 ms for a 100 kLOC package |
| hot patch to a running app | ≤ 250 ms |
| full rebuild (cold cache) | reported by `--stats`; a regression is a bug |
| `vela check` on one file | ≤ 40 ms |
| test run of one test | ≤ 200 ms plus the test |
| diagnostic to screen | as it is produced; no batching behind a slow step |

These are in the same category as doc 27's performance contract: a number the
toolchain reports and CI can watch, not an aspiration.

---

## 8. What a session looks like

```
$ vela dev --target ios
  ✓ build  x86_64-apple-ios-simulator  1.4s
  ✓ launch iPhone 16 simulator
  ✓ app running — tap to inspect

  edit src/Cart.vela:42  ✓ patched in 180ms   (state preserved: 3 signals, 1 view)
  edit src/Checkout.vela  ✗ error E-TYPE-030 at 18:22 — previous version still running
  edit assets/logo.svg   ✓ asset reloaded
  edit src/App.vela:1    ↻ restart required: entry point changed
```

That transcript is the whole feature: what changed, how long it took, what was
preserved, what failed, and what forced a restart.

---

## 9. What is deliberately not here

* No REPL-driven state that diverges from the source. A patch is applied to a
  program built from the source on disk; `vela repl` is for exploration, not for
  building a session you cannot rebuild.
* No silent code replacement across an `unsafe` boundary or an ABI change.
* No "live coding" of a release build: a production binary has no patching surface,
  by design (doc 24 §1: no ambient authority).
* No automatic commit, no snapshot of your work. The loop edits files; git is
  yours.

---

## 10. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-DEV-010` | hot reload cannot preserve state and `#[keepState]` forbids reset |
| `E-DEV-020` | full reload required (with the reason) |
| `E-DEV-030` | development-only API reached from a release build |
| `W-DEV-010` | rebuild slower than the budget in §7 |
| `W-DEV-020` | state reset on reload without `#[resetOnReload]` |

---

Back to the [index](README.md).
