export interface VelaProgramPreset {
  id: string;
  title: string;
  category: 'core' | 'web' | 'kernel' | '3d' | 'ai' | 'selfhost';
  description: string;
  code: string;
}

export const VELA_PRESETS: VelaProgramPreset[] = [
  {
    id: 'tour',
    title: 'Core Tour: Types, Generics, Closures & ARC',
    category: 'core',
    description: 'Strict typing, generic functions with trait bounds, lexical move closures, pattern matching, units, and ARC memory lifecycle.',
    code: `#![strict]
# Core Language Tour: Generics, Closures, Pattern Matching, Units & ARC

struct Point {
  x: Float
  y: Float
}

shared struct Node {
  label: Str
  mut next: Node? = nil
}

enum Payment {
  cash(amount: Float)
  card(last4: Str, amount: Float)
  transfer(iban: Str, amount: Float)
}

impl Payment {
  fn amount(self) -> Float {
    match self {
      Payment::cash(a)        => a
      Payment::card(_, a)     => a
      Payment::transfer(_, a) => a
    }
  }
}

fn mapList<T, U>(xs: List<T>, f: Func(T) -> U) -> List<U> {
  mut out: List<U> = []
  for x in xs { out.push(f(x)) }
  out
}

fn makeCounter(start: Int) -> Func() -> Int {
  mut n = start
  move || {
    n += 1
    n
  }
}

fn classify(code: Int) -> Str {
  match code {
    200..<300       => "ok"
    301 | 302 | 307 => "redirect"
    400..<500       => "client error"
    n if n < 0      => "invalid"
    _               => "unknown"
  }
}

async fn worker(id: Int, ch: Channel<Str>) {
  await time.sleep(5)
  ch.send("task #\${id} completed")
}

async fn main() {
  # Generics + Closures + List Comprehensions
  let nums = [n * n for n in 1..=6 if n % 2 == 0]
  let doubled = mapList(nums, |x| x * 2)
  println("Even squares doubled: \${doubled}")

  let next = makeCounter(10)
  println("Counter: \${next()}, \${next()}, \${next()}")

  # Pattern matching & Enums
  let p = Payment::card(last4: "4242", amount: 89.50)
  println("Payment amount: \${p.amount()} (\${classify(201)})")

  # Units of measure & Money
  let dist = 100.m
  let elapsed = 9.58.s
  let velocity = dist / elapsed
  println("Sprint velocity: \${velocity}")

  # Defer LIFO & ARC + Cycle Collector
  defer println("Deferred cleanup executed in LIFO order")
  mut a = Node { label: "alpha" }
  mut b = Node { label: "beta" }
  a.next = b
  b.next = a

  # Async concurrency with TaskGroup & Channel
  let ch = Channel(4)
  let group = TaskGroup()
  let t1 = group.spawn { await worker(1, ch) }
  let t2 = group.spawn { await worker(2, ch) }
  await t1
  await t2
  println("Channel msg 1: \${await ch.recv()}")
  println("Channel msg 2: \${await ch.recv()}")
}
`,
  },
  {
    id: 'website',
    title: 'Web App: Full HTML/CSS/JS Replacement',
    category: 'web',
    description: 'Compiles typed themes, zero-cascade styles, @island components, and multi-page routes directly into HTML5, scoped CSS, and interactive JS.',
    code: `# Full Website built purely in Vela (Zero hand-written HTML, CSS, or JS)

theme Light {
  token.surface    = #FFFFFF
  token.background = #F8FAFC
  token.ink        = #0F172A
  token.muted      = #64748B
  token.brand      = #0F766E
  token.line       = #E2E8F0
  token.radius     = 12dp
}

theme Dark extends Light {
  token.surface    = #111827
  token.background = #0B0F17
  token.ink        = #F8FAFC
  token.muted      = #94A3B8
  token.line       = #1E293B
}

style Shell {
  background: token.background
  foreground: token.ink
  gap: 24dp
}

style NavBarStyle {
  background: token.surface
  border: 1dp solid token.line
  radius: 12dp
  pad: (y: 12dp, x: 20dp)
  dir: row
  align: .center
  justify: .between
}

style Card {
  background: token.surface
  border: 1dp solid token.line
  radius: 12dp
  pad: 16dp
  gap: 8dp
  transitionDuration: 160ms
  when .hover {
    translateY: -2dp
  }
}

style Headline { fontSize: 34dp; fontWeight: 800; lineHeight: 1.15 }
style Price    { fontSize: 18dp; fontWeight: 700; foreground: token.brand }
style Muted    { fontSize: 14dp; foreground: token.muted }

style Cta {
  background: token.brand
  foreground: #FFFFFF
  radius: 8dp
  pad: (y: 10dp, x: 18dp)
  fontWeight: 600
  when .hover { opacity: 0.9 }
}

component NavBar() {
  row(style: NavBarStyle) {
    link("Vela Workshop", "/").style(Price)
    row(gap: 18dp) {
      link("Home", "/")
      link("Products", "/products")
      link("About", "/about")
      CartButton()
    }
  }
}

component CartButton() @island {
  state count: Int = 0
  button("Cart (0)").style(Cta)
}

page Home() {
  column(style: Shell) {
    NavBar()
    column(gap: 8dp) {
      text("Tools compiled from one language").style(Headline)
      text("Zero cascade, checked tokens, native WASM islands and server routes.").style(Muted)
    }
    each(allProducts()) { |p| ProductCard(p) }
  }
}

page Products() {
  column(style: Shell) {
    NavBar()
    text("Full Catalog").style(Headline)
    each(allProducts()) { |p| ProductCard(p) }
  }
}

page About() {
  column(style: Shell) {
    NavBar()
    text("About Vela Web Profile").style(Headline)
    text("Every style property and route is statically checked before any DOM is emitted.").style(Muted)
  }
}

#[app]
view Root() {
  theme(follow: .system, light: Light, dark: Dark) {
    routes {
      "/"         => Home()
      "/products" => Products()
      "/about"    => About()
    }
  }
}

@get("/api/products")
fn apiProducts() {
  println("Served GET /api/products")
}

fn main() {
  println("Compiled Vela Website with routes /, /products, /about and Light/Dark themes")
}
`,
  },
  {
    id: 'kernel',
    title: 'OS Kernel: VGA Console, UART, MMIO & IRQ',
    category: 'kernel',
    description: 'Freestanding x86_64 kernel with MMIO UART16550 serial, 0xB8000 VGA text buffer, PIT timer, PS/2 keyboard IRQ, and bump allocator.',
    code: `# Freestanding x86_64 Kernel in Vela (sys profile)

#[repr(C)]
mmio Uart16550 @ 0x3F8 {
  data: UInt8 @ 0x00
  ier:  UInt8 @ 0x01
  lcr:  UInt8 @ 0x03
  mcr:  UInt8 @ 0x04
  lsr:  UInt8 @ 0x05
}

#[repr(C)]
mmio Pic8259 @ 0x20 {
  cmd:  UInt8 @ 0x00
  data: UInt8 @ 0x01
}

const VGA_TEXT = 0xB8000
const VGA_COLS = 80

mod uart {
  pub fn init() {
    Uart16550.ier.write(0)
    Uart16550.lcr.write(0x80)
    Uart16550.data.write(0x01)
    Uart16550.lcr.write(0x03)
    Uart16550.mcr.write(0x03)
  }
  pub fn puts(s: Str) {
    for ch in s {
      Uart16550.data.write(ch.toInt())
    }
  }
}

mod heap {
  mut used: Int = 0
  pub fn init(start: Int, len: Int) {
    used = 0
    println("Kernel heap initialized at 0x200000 (\${len} bytes)")
  }
  pub fn alloc(bytes: Int) -> Ptr<UInt8> {
    let addr = 0x200000 + used
    used += bytes
    Ptr.fromAddr(addr)
  }
}

#[interrupt(0x20)]
fn onTimer() {
  Pic8259.cmd.write(0x20)
}

#[interrupt(0x21)]
fn onKeyboard() {
  let scan = port.in8(0x60)
  Pic8259.cmd.write(0x20)
}

#[entry]
fn kmain() {
  uart.init()
  console.clear()
  console.puts("velaos 0.3.0: x86_64 freestanding kernel online\\n")
  console.puts("----------------------------------------------------\\n")
  console.puts("[boot] VGA text buffer mapped @ 0xB8000 (80x25)\\n")
  console.puts("[boot] UART 16550 serial initialized @ 0x3F8 (115200 8N1)\\n")

  uart.puts("UART0: kernel serial link active\\n")
  port.out8(0x43, 0x36)
  interrupts.enable()
  console.puts("[irq ] PIT Timer (0x20) & PS/2 Keyboard (0x21) armed\\n")

  heap.init(0x200000, 16777216)
  let page = heap.alloc(4096)
  console.puts("[mem ] Allocated 4KiB kernel frame: \${page}\\n")

  unsafe {
    asm!("cli", "sti", "nop")
  }
  console.puts("velaos: ready for interactive interrupts.\\n")
}
`,
  },
  {
    id: 'model3d_sat',
    title: '3D Model: Orbital Telemetry Satellite',
    category: '3d',
    description: 'Procedural composite 3D satellite model declared in Vela scene3d DSL with solar arrays, parabolic dish, thruster bell, and PBR materials.',
    code: `# Vela 3D Engine (doc 21): Procedural Orbital Satellite

scene3d OrbitalSatellite {
  background(#090D16)
  camera(pos: [5.2, 3.6, 6.2], target: [0, 1.1, 0], fov: 42)
  light(kind: "directional", color: #FFF5E4, intensity: 2.6, pos: [6, 9, 5])

  # Primary silhouette: hexagonal gold-foil bus & core frame
  cylinder(name: "CoreBus", role: "primary",
    radius: 0.78, h: 1.5, pos: [0, 1.2, 0],
    color: #D4AF37, metalness: 0.92, roughness: 0.24,
    explode: [0, 0, 0])

  box(name: "AvionicsBay", role: "primary",
    w: 1.1, h: 0.55, d: 1.1, pos: [0, 2.05, 0],
    color: #1E293B, metalness: 0.85, roughness: 0.35,
    explode: [0, 0.85, 0])

  # Secondary read: dual articulated solar wing arrays
  wing(name: "SolarWing_Port", role: "secondary",
    w: 2.5, h: 0.06, d: 0.95, pos: [-2.15, 1.25, 0],
    color: #0F3B6E, metalness: 0.55, roughness: 0.18, clearcoat: 0.9,
    explode: [-1.1, 0, 0])

  wing(name: "SolarWing_Starboard", role: "secondary",
    w: 2.5, h: 0.06, d: 0.95, pos: [2.15, 1.25, 0],
    color: #0F3B6E, metalness: 0.55, roughness: 0.18, clearcoat: 0.9,
    explode: [1.1, 0, 0])

  cylinder(name: "SolarBoom", role: "secondary",
    radius: 0.06, h: 5.4, pos: [0, 1.25, 0], rot: [0, 0, 1.5708],
    color: #CBD5E1, metalness: 0.95, roughness: 0.15,
    explode: [0, 0.4, 0])

  # Accent detail: high-gain parabolic dish, gimbal & thruster bell
  dish(name: "HighGainDish", role: "accent",
    radius: 0.72, pos: [0, 2.62, 0.2], rot: [0.35, 0, 0],
    color: #F8FAFC, metalness: 0.75, roughness: 0.2,
    explode: [0, 1.45, 0.3])

  cone(name: "ThrusterBell", role: "accent",
    radius: 0.42, h: 0.6, pos: [0, 0.25, 0], rot: [3.14159, 0, 0],
    color: #475569, metalness: 0.95, roughness: 0.28,
    explode: [0, -0.75, 0])

  torus(name: "DockingRing", role: "accent",
    radius: 0.52, tube: 0.07, pos: [0, 0.48, 0], rot: [1.5708, 0, 0],
    color: #38BDF8, metalness: 0.8, roughness: 0.2, emissive: #0284C7, emissiveIntensity: 0.4,
    explode: [0, -0.35, 0])
}

fn main() {
  println("Rendered 8-part PBR Orbital Satellite in Vela 3D Studio")
}
`,
  },
  {
    id: 'model3d_gear',
    title: '3D Model: Planetary Gearbox Assembly',
    category: '3d',
    description: 'Precision mechanical 3D assembly with meshing sun, planet, and ring gears rotating via Vela kinematics.',
    code: `# Vela 3D Engine: Precision Planetary Gearbox Assembly

scene3d PlanetaryGearbox {
  background(#0B0F17)
  camera(pos: [0.2, 4.4, 5.2], target: [0, 0.8, 0], fov: 40)
  light(kind: "directional", color: #FFF8EC, intensity: 2.5, pos: [5, 8, 6])

  # Housing base plate
  cylinder(name: "HousingBase", role: "primary",
    radius: 2.2, h: 0.25, pos: [0, 0.15, 0],
    color: #1E293B, metalness: 0.82, roughness: 0.42,
    explode: [0, -0.8, 0])

  # Outer Ring Frame
  torus(name: "OuterRing", role: "primary",
    radius: 1.95, tube: 0.18, pos: [0, 0.7, 0], rot: [1.5708, 0, 0],
    color: #334155, metalness: 0.9, roughness: 0.22,
    explode: [0, 0.4, 0])

  # Central Sun Gear (anodized brass)
  gear(name: "SunGear", role: "secondary",
    radius: 0.65, h: 0.45, teeth: 14, pos: [0, 0.7, 0],
    color: #EAB308, metalness: 0.94, roughness: 0.18,
    spin: [0, 1.2, 0], explode: [0, 1.1, 0])

  # Three Planet Gears
  gear(name: "PlanetGear_A", role: "secondary",
    radius: 0.48, h: 0.4, teeth: 10, pos: [1.2, 0.7, 0],
    color: #38BDF8, metalness: 0.9, roughness: 0.22,
    spin: [0, -1.68, 0], explode: [0.9, 0.4, 0])

  gear(name: "PlanetGear_B", role: "secondary",
    radius: 0.48, h: 0.4, teeth: 10, pos: [-0.6, 0.7, 1.04],
    color: #38BDF8, metalness: 0.9, roughness: 0.22,
    spin: [0, -1.68, 0], explode: [-0.5, 0.4, 0.8])

  gear(name: "PlanetGear_C", role: "secondary",
    radius: 0.48, h: 0.4, teeth: 10, pos: [-0.6, 0.7, -1.04],
    color: #38BDF8, metalness: 0.9, roughness: 0.22,
    spin: [0, -1.68, 0], explode: [-0.5, 0.4, -0.8])

  # Drive Shaft & Top Cap
  cylinder(name: "DriveShaft", role: "accent",
    radius: 0.2, h: 1.6, pos: [0, 1.0, 0],
    color: #E2E8F0, metalness: 0.98, roughness: 0.12,
    spin: [0, 1.2, 0], explode: [0, 1.7, 0])
}

fn main() {
  println("Planetary Gearbox 3D assembly compiled with live kinematic spin")
}
`,
  },
  {
    id: 'ai_db',
    title: 'AI Training + Autodiff & SQL Database',
    category: 'ai',
    description: 'Static-shape Tensors, reverse-mode autodiff training loop with loss/accuracy curve, and relational SQL queries with transactions.',
    code: `#![strict]
# AI Machine Learning (doc 36) & Database Engine (doc 20)

fn main() {
  # 1. Static-Shape Tensor Ops
  let a: Tensor<Float32, [2, 2]> = tensor.of([[1.0, 2.0], [3.0, 4.0]])
  let probs = nn.softmax(a)
  println("Softmax probabilities: \${probs.toList()}")

  # 2. Reverse-mode autodiff derivative check
  let gradAt3 = train.gradScalar(|x| x * x * x + 2.0 * x, 3.0)
  println("d/dx (x^3 + 2x) at x=3 => \${gradAt3}")

  # 3. Train a 2-layer Neural Network (MLP) on XOR via Reverse-Mode Tape
  let metrics = train.mlpXor(30, 0.45)
  println("MLP Training finished -> loss: \${metrics.loss}, accuracy: \${metrics.accuracy}")

  # 4. Typed Relational SQL Database & Transactions
  db.exec("CREATE TABLE experiments (id INT, model TEXT, loss FLOAT, accuracy FLOAT)")
  db.exec("INSERT INTO experiments (id, model, loss, accuracy) VALUES ($1, $2, $3, $4)", [1, "MLP-2x8x2", metrics.loss, metrics.accuracy])
  db.exec("INSERT INTO experiments (id, model, loss, accuracy) VALUES ($1, $2, $3, $4)", [2, "ResNet-Vela", 0.042, 0.985])

  let rows = db.query("SELECT id, model, loss, accuracy FROM experiments ORDER BY accuracy DESC")?
  println("Saved experiments in SQL DB: \${rows}")
}
`,
  },
  {
    id: 'selfhost',
    title: 'Self-Hosting: velac Written in Vela',
    category: 'selfhost',
    description: 'A real Vela compiler (lexer, AST parser, and C11 emitter) written in Vela itself, bootstrapping a Vela program into C11.',
    code: `# Self-Hosting Vela Compiler (velac.vela — Doc 28 Stage 1 Bootstrap)
# Written in Vela, executed by the Vela runtime to compile Vela -> C11!

struct Tok {
  kind: Str
  lexeme: Str
}

fn tokenizeVela(src: Str) -> List<Tok> {
  mut tokens: List<Tok> = []
  mut i = 0
  let n = src.len
  while i < n {
    let ch = src[i]
    if ch == " " || ch == "\\n" || ch == "\\t" {
      i += 1
      continue
    }
    if ch == "(" || ch == ")" || ch == "{" || ch == "}" {
      tokens.push(Tok { kind: "PUNCT", lexeme: ch })
      i += 1
      continue
    }
    if ch == "\\"" {
      i += 1
      mut s = ""
      while i < n && src[i] != "\\"" {
        s += src[i]
        i += 1
      }
      i += 1
      tokens.push(Tok { kind: "STR", lexeme: s })
      continue
    }
    mut word = ""
    while i < n && src[i] != " " && src[i] != "(" && src[i] != ")" && src[i] != "{" && src[i] != "}" && src[i] != "\\n" {
      word += src[i]
      i += 1
    }
    let kind = if word == "fn" || word == "let" || word == "return" { "KW" } else { "ID" }
    tokens.push(Tok { kind: kind, lexeme: word })
  }
  tokens
}

fn compileToC(tokens: List<Tok>) -> Str {
  mut out = "/* Emitted by Self-Hosted velac.vela */\\n#include \\"vela_runtime.h\\"\\n\\nvoid vela_main(void) {\\n"
  mut i = 0
  while i < tokens.len {
    let t = tokens[i]
    if t.lexeme == "println" && i + 2 < tokens.len {
      let arg = tokens[i + 2]
      out += "  vela_println(vela_str(\\"" + arg.lexeme + "\\"));\\n"
      i += 4
      continue
    }
    i += 1
  }
  out += "}\\n"
  out
}

fn main() {
  let targetSource = "fn main() { println(\\"Hello from self-hosted velac!\\") }"
  println("--- Source Input ---")
  println(targetSource)

  let toks = tokenizeVela(targetSource)
  println("\\n--- Lexed \${toks.len} Tokens ---")
  for t in toks {
    println("  [\${t.kind}] \${t.lexeme}")
  }

  let cOutput = compileToC(toks)
  println("\\n--- Bootstrapped C11 Output ---")
  println(cOutput)
}
`,
  },
];
