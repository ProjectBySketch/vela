# 21 — Graphics, 2D and 3D

**Status:** `spec`. Modules: `gfx` (unstable), `paint` (via doc 13 §17).

Vela has a rendering model that is the same on every backend: a scene of nodes, a
render graph, and shaders written in Vela. The platform layer maps this to Metal
on Apple, to WebGL2/WebGPU on the web, to Vulkan on Linux, to a software
rasteriser on `sys`, and to the DOM for the 2D UI in doc 13.

---

## 1. Coordinates, units, colour

* Right-handed, **Y up** in 3D; **Y down** in UI space (doc 13). The `gfx`
  module is explicit: `Space::ui`, `Space::world`, `Space::clip`.
* Lengths are `Float` in world units; the camera projection decides pixels.
* Colour is linear-light `Color` for 3D and sRGB for UI; conversion is explicit
  (`color.toLinear()`) and is applied by the renderer, never silently.
* Time is `Duration`; every animation is a pure function of time.

---

## 2. The 2D layer

Doc 13's `canvas` is immediate-mode painting. `gfx` adds retained 2D for
documents, editors, charts and games.

```vela
let scene = gfx.scene2d()
scene.add(gfx.node(name: "board")
  .rect(x: 0, y: 0, w: 800, h: 600, fill: #F5F0E8)
  .stroke(width: 1.0, color: #D8D0C0))

for piece in pieces {
  scene.add(gfx.node(name: "piece/${piece.id}")
    .at(piece.x, piece.y)
    .size(48, 48)
    .image(assets.load(piece.sprite))
    .rotate(piece.angle)
    .z(piece.layer))
}
```

| Primitive | Note |
| --- | --- |
| `rect`, `roundRect`, `circle`, `ellipse`, `line`, `polygon`, `path` | filled, stroked, or both |
| `text` | SDF-rendered, sub-pixel positioned, shaped through doc 29's text stack |
| `image` | atlas-backed when possible, with tint and nine-slice |
| `sprite` | batched when it shares an atlas and a blend mode |
| `particles` | a GPU emitter with a deterministic mode (`seed:`) |
| `group` | a transform and a clip, no draw of its own |
| `mask` | alpha, luminance or a path |

Transforms compose as `translate · rotate · scale · skew` around an anchor;
`z` orders within a parent, and `zIndex` is stable for equal values (insertion
order), which is what makes hit-testing and diffing deterministic.

---

## 3. Hit testing and picking

```vela
let hit = scene.pick(at: (x, y))          // topmost node whose bounds contain it
let node = scene.pickExact(at: (x, y))    // respects the path, not the bounds box
```

Picking uses the same transform hierarchy as rendering, so a rotated node is
picked in its own space. A node may opt out (`interactive: false`) to let the
press through — the mechanism behind doc 13's `pointerEvents: none`.

---

## 4. The 3D layer

```vela
let world = gfx.world()
world.camera(Camera.perspective(fov: 60deg, near: 0.1, far: 1000.0)
  .at((0.0, 2.0, 8.0))
  .looking(at: (0.0, 1.0, 0.0)))

world.light(Light.directional(direction: (-0.3, -1.0, -0.4), intensity: 3.0))
world.light(Light.point(at: (0.0, 3.0, 0.0), colour: #FFD8A0, range: 12.0))

let mesh = try world.mesh(assets.model("chair.glb"))?
world.add(mesh.material(Material.standard(albedo: #8B5E3C, roughness: 0.7)))

world.add(mesh.clone()
  .at((2.0, 0.0, 0.0))
  .scale(0.5)
  .material(Material.standard(albedo: #B0B7C3, metalness: 0.9, roughness: 0.2)))
```

| Concept | API |
| --- | --- |
| camera | `perspective`, `orthographic`, `fisheye`; `at`, `looking`, `up`, `projection` |
| transform | `at`, `rotate`, `scale`, `quaternion`, `parent` |
| mesh | from glTF/OBJ/USD (`planned`), or built from vertices/indices |
| geometry | `box`, `sphere`, `plane`, `cylinder`, `torus`, `capsule` |
| material | `standard` (metallic-roughness), `unlit`, `custom(shader)` |
| texture | from an image asset, a render target, or a depth buffer |
| light | directional, point, spot, ambient, IBL (`planned`: a prefiltered cubemap) |

Instancing:

```vela
world.instances(mesh, count: 10_000) { |i, transform| transform.of(positions[i]) }
```

One draw call; the per-instance data is a buffer, and the compiler generates the
struct from the closure's usage rather than making you declare a vertex layout.

---

## 5. Shaders in Vela

A shader is a Vela function with typed inputs and no allocation. It is type
checked, then compiled to MSL, WGSL, SPIR-V or GLSL depending on the target.

```vela
shader fade(fragment) {
  in colour: Vec4
  in uv: Vec2
  uniform time: Float
  uniform tint: Color

  out Frag { color: Vec4 }

  let band = 0.5 + 0.5 * math.sin(uv.y * 20.0 + time)
  return Frag { color: colour * tint * band }
}
```

Rules for shader bodies — deliberately narrower than a function:

* no allocation, no `Str`, no closures, no `await`, no `unsafe`;
* arithmetic is `Float`/`Vec2`/`Vec3`/`Vec4`/`Mat2`/`Mat3`/`Mat4`, with swizzles
  (`v.xyz`), `dot`, `cross`, `normalise`, `mix`, `clamp`, `smoothstep`, `step`,
  `reflect`, `refract`, `texture(sampler, uv)`;
* `if` and `for` are allowed with compile-time bounds; a dynamic loop bound is
  `E-GFX-010` (GPU divergence is not a thing to guess about);
* recursion is `E-GFX-011`;
* a uniform is read-only, a varying is interpolated, an `out` is written once.

The advantage over writing GLSL is the same one Vela has everywhere: the
`Material.standard(...)` and the shader that extends it share types, so a
mismatched uniform is a compile error rather than a black screen.

### 5.1 Compute

```vela
compute blur(input: Texture, output: Texture, radius: Int) {
  local shared: [[Vec4; 256]; 1]
  let pixel = global.invocation
  ...
}
```

`compute` takes workgroup size from the declaration (`#[workgroup(16, 16, 1)]`),
reads and writes storage buffers/textures, and is launched with
`world.dispatch(blur, groups: (w/16, h/16, 1))`. `sys` gets a software fallback
that is slow but correct, so a program that uses compute still runs everywhere.

---

## 6. Render graph and passes

```vela
let graph = gfx.graph()
graph.pass("shadow") { p | p.render(shadows: [sun], of: scene) }
graph.pass("main")   { p | p.render(scene, into: .screen, with: [shadowMap("shadow")]) }
graph.pass("bloom")  { p | p.compute(bloom, from: "main", strength: 0.6) }
graph.pass("ui")     { p | p.render2d(uiScene) }
```

* Passes declare inputs and outputs; the graph topologically sorts them and
  resolves barriers. A pass that reads a target before it is written is
  `E-GFX-020`.
* A target is a `Texture` with a format, size, and sample count. `.screen` is the
  default framebuffer.
* Frame timing per pass is reported by `vela run --profile-gpu`.

---

## 7. Offscreen rendering and determinism

```vela
let image = try gfx.renderHeadless(scene,
  size: (1920, 1080), samples: 4, seed: 7)?
try image.writePng("frame.png")?
```

Headless rendering exists so that a renderer can be tested. With `seed:`, particle
emitters, sampling jitter and shader noise are deterministic, so a golden-image
test compares bytes rather than "looks about right". `vela test` supports
`assertImageMatches(image, "golden/frame.png", tolerance: 0.002)`.

---

## 8. Charts

Charts are a first-class module because every app needs one and nobody should
write an axis twice.

```vela
chart.line(series, x: .time, y: .value)
  .axis(.x, format: .date("MMM d"))
  .axis(.y, format: .number(compact: true))
  .tooltip { p | text("${p.series}: ${p.y}") }
  .style(ChartStyle)
```

Charts render through doc 13's `canvas` on the UI layer, so they are styled by the
same 214 properties and are accessible (each point is announced through a summary
table for screen readers, generated from the data).

---

## 9. Colour management

| Concept | Vela |
| --- | --- |
| working space | linear `Rgb` for 3D, sRGB for UI |
| wide gamut | `Color.p3(...)`, `Color.rec2020(...)`; converted per display |
| HDR | `HdrColor` with a declared peak luminance; tonemapping is a pass (`ACES`, `Reinhard`, `none`) |
| transfer function | applied at decode and at output, never in the middle of a pipeline |
| colour blindness | a preview mode (`colourBlindMode: .deuteranopia`) in `vela run --ui-audit` |

---

## 10. Performance contract

| Situation | Guarantee |
| --- | --- |
| Sprite batch | ≤ 1 draw call per atlas + blend mode |
| Instanced mesh | 1 draw call |
| UI frame | 16.6 ms for 500 elements on a 2020 phone (doc 19 §19) |
| Headless render | deterministic with `seed:` |
| Shader compile | at build time (`velac --emit shaders`), never in a frame |
| Asset load | `async`, off the render task, with a progress value |

`vela build --gfx-stats` reports draw calls, triangle counts, texture memory and
the shader variants emitted per target.

---

## 11. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-GFX-010` | dynamic loop bound in a shader |
| `E-GFX-011` | recursion in a shader |
| `E-GFX-020` | render graph reads a target before writing it |
| `E-GFX-025` | vertex layout does not match the shader's inputs |
| `E-GFX-030` | material/shader uniform mismatch |
| `E-GFX-040` | texture format not supported on this target |
| `E-GFX-050` | mesh asset missing an attribute the material needs |
| `W-GFX-010` | texture larger than the target's limit |

---

Next: [22-media.md](22-media.md).
