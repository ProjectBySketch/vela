# 22 — Media: image, audio, video

**Status:** `spec`. Modules: `image`, `audio`, `video`, `camera`, `media`
(unstable). Related: doc 21 (graphics), doc 13 §14 (assets).

Three pipelines, one rule: **media is data, never a device you talk to directly**.
Decoding returns a value; playback is a node in a graph; capture is a stream you
subscribe to. Every one of them can be tested without a screen or a speaker.

---

## 1. Image

```vela
let img = try image.decode(try fs.read("photo.jpg"))?
let small = img.resize(to: (320, 240), fit: .cover)
let round = small.roundCorners(radius: 16.0)
try fs.write("avatar.png", try round.encode(.png(quality: 0.9)))?
```

| Function | Notes |
| --- | --- |
| `decode(bytes) -> Result<Image, MediaError>` | PNG, JPEG, GIF, WebP, HEIC, TIFF, BMP, SVG (rasterised at a requested size) |
| `encode(format, quality:)` | PNG, JPEG, WebP, AVIF (`planned`), HEIC (`app` only) |
| `resize`, `crop`, `fit(.cover/.contain/.fill)`, `rotate(deg)`, `flip` | resampling is Lanczos by default, `nearest` available |
| `blur`, `sharpen`, `brightness`, `contrast`, `saturate`, `gamma` | linear-light by default |
| `composite`, `mask`, `blend(mode)` | `sourceOver`, `multiply`, `screen`, … |
| `toColourSpace(.sRGB/.p3/.linear)` | explicit, because implicit conversion is how images go wrong |
| `exif()`, `withOrientationApplied()` | orientation is applied on decode unless `applyOrientation: false` |
| `thumbnail(max: 256)` | fast path per platform (ImageIO on Apple) |
| `averageColour()`, `dominantColours(n)` | for placeholders and theme extraction |
| `pixel(x, y)`, `eachPixel(fn)` | the escape hatch; both are explicit about colour space |

`Image` is a value type with copy-on-write backing. Decoding is `async` above a
threshold (`media.asyncThreshold`, default 64 KiB of compressed data) and never
blocks a UI frame (`E-UI-120`).

### 1.1 Animated images

`image.frames(bytes)` yields `Animation { frames: List<Image>, delays: List<Duration>, loop: Int }`.
GIF, APNG and animated WebP are supported; animations render through doc 21's
sprite layer so they batch with the rest of the scene.

---

## 2. Audio

Audio is a **graph**, not a callback: you describe sources, effects and a sink,
and the engine pulls.

```vela
let engine = audio.engine(sampleRate: 48_000, channels: 2)
let music = try engine.file(assets.load("loop.ogg"))?
music.gain(0.6).loop(true).play()

let tone = audio.oscillator(.sine, frequency: 440.0)
  .gain(0.2)
  .envelope(attack: 10ms, decay: 80ms, sustain: 0.4, release: 200ms)
engine.out(tone)

engine.onEvent { e |
  match e {
    AudioEvent::ended(node)    => log.debug("ended ${node.id}")
    AudioEvent::peak(node, db) => meters.show(node.id, db)
    AudioEvent::interrupted    => music.pause()
  }
}
```

| Node | Purpose |
| --- | --- |
| `oscillator(waveform, frequency)` | sine, square, saw, triangle, noise (white/pink/brown) |
| `file(asset)` | decoded stream, optional preload |
| `microphone()` | capture (doc 24 §5 permissions) |
| `mixer(inputs...)` | sum with per-input gain and pan |
| `gain`, `pan`, `spatial(position:)` | gain staging and 3D positioning |
| `filter(.lowPass/.highPass/.bandPass/...)` | biquad with cutoff and resonance |
| `delay(time, feedback)`, `reverb(preset)`, `compressor`, `limiter`, `eq(...)` | effects |
| `analyser(size)` | returns a `Spectrum` and a `Waveform` per frame, for visualisers |
| `recorder(file)` | writes the graph's output |
| `recorderCapture` | records the microphone with a level meter |

`midi` (in the same module) enumerates inputs, receives note/CC events, and sends
to an instrument node: `midi.input().onNote { n | synth.noteOn(n.note, n.velocity) }`.

### 2.1 Real-time constraints

* The audio callback is a separate, high-priority context. It may not allocate, may
  not `await`, and may not touch the UI (`E-SYS-020`-style rule, reported as
  `E-MEDIA-010`).
* All graph mutation happens off the callback thread; a change is applied at the
  next buffer boundary, so there is no glitch from resizing a buffer.
* Latency is declared: `audio.engine(latency: .low)` asks for 128 frames and
  reports what it got (`engine.actualLatency`), because a promise you cannot keep
  is worse than a number.

---

## 3. Video

```vela
let decoder = try video.decoder(asset) ?
let size = (decoder.width, decoder.height)

try video.render(to: "out.mp4", size: size, fps: 30) { |frame| 
  frame.draw(scene, at: frame.time)
}
```

| Function | Notes |
| --- | --- |
| `decode(asset)` / `decoder.stream()` | H.264/HEVC/VP9/AV1 decoding via the platform, frames as `Image` |
| `seek(to:)`, `frame(at:)` | precise seek; `frame(at:)` is O(1) for intra-frame positions |
| `encode(frames, codec, bitrate, fps)` | H.264/HEVC; hardware where available |
| `remux` | container change without re-encode |
| `thumbnail(at:)` | one frame, for scrubbing |
| `capture(screen:)` / `capture(camera:)` | frame sources (doc 24 §5) |

Video is deliberately **not** a widget. Playing a video is a `video.player`
node in doc 13's element tree that exposes `isPlaying`, `position` and `onEnd`;
everything else (decode, frames) is the module above. That keeps a media pipeline
testable in a headless build.

---

## 4. Streaming pipelines

```vela
with pipeline = media.pipeline() {
  video.decoder(url)
    |> media.scale(to: (1280, 720))
    |> audio.resample(to: 48_000)
    |> media.encode(.h264(bitrate: 4_500_000))
    |> upload(socket)
}
```

* Every stage is back-pressured: a slow consumer pauses the producer rather than
  growing a queue. A queue that exceeds its declared bound is a
  `E-MEDIA-020` diagnostic at run time with the stage names, which is the only
  way to debug a live stream without a profiler.
* Stages run on the task pool; frame order is preserved per stream.
* Latency budget: `media.pipeline(latency: 200ms)`; a stage that cannot keep up
  drops frames (reported in `PipelineStats.dropped`) rather than stalling every
  other stream.

---

## 5. Capture and permissions

```vela
guard try camera.requestAccess()? else { fail MediaError.permissionDenied }
with cam = try camera.open(.back, format: .w1920h1080f30)?
    for frame in cam.frames() {
  scene.draw(frame)
}
```

Capture follows the capability model in doc 24 §5: `camera`, `microphone` and
`screen` are requested in `vela.pkg` permissions and enforced by the platform; a
call without the permission is a compile error in `app` and `web`, and a
documented run-time check in `core`.

---

## 6. Colour, timing and determinism

* Frames carry a timestamp from the source; a pipeline never invents one.
* Resampling audio uses the same sample rate at every stage unless a stage
  declares a conversion.
* `image.decode` and `video.frame` are deterministic for the same bytes; encoding
  is deterministic only when `deterministic: true` is passed (it disables
  hardware-specific rate control), which is what a golden-file test needs.
* Subtitles: `media.subtitles(bytes)` returns cues with text, start and end, and
  a renderer that respects `safeArea` and font scaling.

---

## 7. Testing media

```vela
#[test]
fn resizesKeepingAspect() {
  let img = try image.decode(fixtures.bytes("test.png"))?
  let out = img.resize(to: (100, 100), fit: .contain)
  assertEq(out.width, 100)
  assert(out.height <= 100)
}

#[test]
fn toneIsSilent() {
  let engine = audio.engine(sampleRate: 8_000, channels: 1, offline: true)
  let tone = audio.oscillator(.sine, frequency: 100).gain(0.0)
  engine.out(tone)
  let samples = engine.render(duration: 100ms)
  assert(samples.all(|s| s.abs() < 0.0001))
}
```

`offline: true` runs the graph as fast as possible and returns samples — no audio
device, no CI runner with speakers, no flaky test.

---

## 8. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-MEDIA-010` | allocation or `await` in an audio callback |
| `E-MEDIA-020` | pipeline queue exceeded its bound |
| `E-MEDIA-030` | codec not available on this target |
| `E-MEDIA-040` | capture without a declared permission |
| `E-MEDIA-050` | colour-space conversion without an explicit request |
| `W-MEDIA-010` | full-size image decoded on the UI task |
| `W-MEDIA-020` | encode without `deterministic` in a test |

---

Next: [23-networking.md](23-networking.md).
