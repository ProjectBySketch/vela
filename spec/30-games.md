# 30 — Games and real-time simulation

**Status:** `spec`. Modules: `game` (unstable), plus `gfx` (doc 21) and `audio`
(doc 22).

A game is the hardest case for a language: a fixed frame budget, state that is
mutated by everything, and a determinism requirement if it is networked. Vela's
answer is a small, explicit toolkit — entities, systems, a fixed-step loop, and
deterministic randomness — layered on the graphics and audio modules it already
has.

---

## 1. The game loop

```vela
#[game]
fn main() -> Result<Void, Error> {
  let app = game.app(
    title: "Vela Blocks",
    size: (1280, 720),
    fixedStep: 1.0 / 60.0,
    maxCatchUp: 5,
  )

  app.onStart(|g| { loadLevel(g, "levels/01.json") })
  app.onFixedUpdate(|g, dt| { movement(g, dt); physics(g, dt) })
  app.onUpdate(|g, alpha| { interpolate(g, alpha) })
  app.onRender(|g| { render(g) })
  app.run()
}
```

* **Fixed step** for simulation (`onFixedUpdate`), variable-rate `onUpdate` for
  interpolation and input, `onRender` for drawing. Mixing them is how a game
  becomes frame-rate dependent, so the three callbacks are separate on purpose.
* `maxCatchUp` bounds the spiral of death: after that many steps the simulation
  drops time and says so (`game.stats.droppedSteps`).
* A headless mode (`app.headless(steps: 600)`) runs the simulation with no window
  and no renderer, which is what a deterministic test and a server authority use.

---

## 2. Entities and systems

```vela
#[derive(Component)]
struct Position { x: Float, y: Float }

#[derive(Component)]
struct Velocity { x: Float, y: Float }

#[derive(Component)]
struct Sprite { image: Image, layer: Int }

#[derive(Component, Tag)]
struct Player

fn movement(world: World, dt: Float) {
  for (pos, vel) in world.query(Position, Velocity) {
    pos.x += vel.x * dt
    world.set(e, pos)
  }
}

fn render(world: World) {
  for (e, sprite, pos) in world.query(Entity, Sprite, Point2) {
    gfx.drawSprite(sprite.image, at: pos, z: sprite.layer)
  }
}
```

* An entity is an opaque handle (`Entity`), not an array index. Components are
  ordinary `struct`s declared with `#[derive(Component)]`.
* `world.query(A, B)` iterates entities that have both, without allocating per
  frame; a query is compiled to an archetype iteration, and `vela build --stats`
  reports the archetype count.
* Systems are functions; the schedule is a list of stages (`start`, `input`,
  `fixed`, `update`, `render`, `end`) and a system declares its stage with a hook
  (`app.onFixedUpdate(movement)`). There is no reflection, no stringly-typed
  system name.
* Structural changes (spawn/despawn) during a query are deferred to the end of the
  stage, so a query never invalidates itself — the classic ECS crash, prevented by
  the API rather than by a rule to remember.

---

## 3. Input

```vela
app.onInput(|input| {
  if input.pressed(.space) { player.jump() }
  if input.down(.left) { player.walk(-1.0) }
  let aim = input.pointerPosition
  let scroll = input.scroll
  if input.device(.gamepad)?.button(.a).pressed { interact() }
})
```

* Actions are declared once (`actions.vela`) with default bindings per device, and
  a player can rebind them:

```vela
actions GameActions {
  jump  = [key(.space), pad(.a), touch(.tapTwoFinger)]
  left  = [key(.a), key(.arrowLeft), pad(.dpadLeft)]
  pause = [key(.escape), pad(.start)]
}
```

* `input.pressed` (this frame), `input.down` (held), `input.released`; a game that
  uses `down` for a menu has a repeat bug, so `input.repeated(action, delay: 300ms)`
  exists.
* Touch, mouse, keyboard and gamepad share one model; a device that is absent
  reports `nil` rather than an error.

---

## 4. Physics

Two levels, both optional:

| Level | API |
| --- | --- |
| **kinematic** (built in) | AABB and circle overlap, raycasts, sweep, tilemap collision, platformer resolution with coyote time and corner correction |
| **rigid body** (module) | `physics.world3d(gravity:)`, colliders (box, sphere, capsule, mesh), restitution/friction, constraints (distance, hinge), a fixed-step solver |

```vela
let body = physics.rigidBody(shape: .capsule(radius: 0.3, height: 1.7), mass: 70.0)
world.add(body.at((0.0, 1.0, 0.0)))
```

The solver is deterministic for a given step sequence and float mode; a networked
game replays inputs, not states (§7). A variable-step solver is not provided,
because a replayable game cannot have one.

---

## 5. Animation and tweens

```vela
let tween = game.tween(from: (x: 0.0, y: 0.0), to: (x: 100.0, y: 50.0), duration: 1s)
  .curve(.easeOutCubic)
tween.onDone { explode() }
```

* Tweens are values with a time; `game.update` advances them; they are cancelled by
  dropping them.
* Sprite-sheet animation is an `Animation` asset with frames, fps and events on
  named frames (`"hit"`), so a gameplay event is tied to the frame it belongs to.
* Everything animatable is a pure function of time (§1), which is what makes a
  replay exact.

---

## 6. Determinism

| Source | Guarantee |
| --- | --- |
| `math.sin/cos/exp` | may differ between platforms (IEEE does not fix transcendentals) — use `math.det.sin` for a replayable simulation |
| random | `rand.seeded(n)` is a portable xoshiro256** sequence, identical everywhere |
| iteration order | query order is archetype creation order, stable for a run |
| float mode | fixed to binary64 with no fast-math; a build that would change it is refused (`E-GAME-010`) |
| physics | fixed step, deterministic solver |
| input | recorded as an ordered list of events with frame numbers |

`app.record("replay.bin")` and `app.replay(bytes)` capture and replay a session
exactly; a test asserts that a 600-step headless run produces the same state hash
on every platform.

---

## 7. Netcode

```vela
let net = game.netcode(authority: .server, tickRate: 60, inputDelay: 2)
net.onClientInput { player, input, frame | queue(player, input, frame) }
net.onStateSnapshot { snapshot | predict(snapshot) }
```

Three modes, declared rather than discovered:

| Mode | For | Mechanism |
| --- | --- | --- |
| `lockstep` | RTS, turn-ish | all clients exchange inputs, simulate the same tick |
| `rollback` | fighting, racing | local prediction, rollback on mismatch, resimulation |
| `serverAuthority` | shooters, MMOs | server simulates, clients interpolate and predict locally |

The state that must be hashed for rollback is derived from the components marked
`#[synced]`; a component that is not marked is not sent, and a system that mutates
`#[synced]` state outside the fixed step is `E-GAME-020`.

---

## 8. Saving

```vela
#[derive(SaveGame)]
struct Progress {
  level: Int
  checkpoint: Vec3
  inventory: List<Item>
}

try save.write("slot1", progress)?
let p = try save.read::<Progress>("slot1")?
```

`#[derive(SaveGame)]` writes a versioned, checksummed binary (doc 26 §7) with a
migration hook for an older version. A save from a future version is refused with
a message, not loaded into a corrupt state.

---

## 9. Testing games

```vela
#[test]
fn playerCannotWalkThroughWalls() {
  let sim = game.headless(level: "levels/01.json", seed: 42)
  sim.spawn(player, at: (10.0, 0.0))
  for _ in 0..<120 { sim.step(input: .hold(.right)) }
  assert(state.player.x < 200.0)
  assertEq(collisions.count, 1)
}

#[test]
fn replayIsStable() {
  let a = game.headless(steps: 600, seed: 1).hash()
  let b = game.replayHeadless("fixtures/replay.bin")?
  assertEq(a, b.hash())
}
```

A headless simulation with a seeded random source is the only way a game's logic
gets tested at all; that is why `headless` is part of the module and not an
afterthought.

---

## 9.1 Multiplayer testing

`game.fakeNet()` runs two or more clients in one process with programmable latency,
jitter and packet loss. A rollback test asserts that the predicted state matches
the authoritative one after N frames of 100 ms delay.

---

## 10. Performance targets

| Profile | Target |
| --- | --- |
| 2D, 500 sprites | 60 fps on a 2018 phone |
| 3D, 200 instanced meshes | 60 fps on a 2020 laptop |
| Fixed step | 60 Hz with ≤ 2 ms of simulation |
| Allocation | zero per frame in the update loop (`vela run --profile-mem` shows any) |

An allocation in `onFixedUpdate` is `W-GAME-030` when it is provable, and reported
as a per-frame allocation count otherwise.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-GAME-010` | a build mode that would break determinism |
| `E-GAME-020` | `#[synced]` state mutated outside the fixed step |
| `E-GAME-030` | query over a component type that was never registered |
| `E-GAME-040` | save file version newer than the program |
| `E-GAME-050` | action bound twice on the same device |
| `W-GAME-030` | allocation in the fixed update loop |
| `W-GAME-040` | `input.down` used for a one-shot action |

---

Next: [31-plugins.md](31-plugins.md).
