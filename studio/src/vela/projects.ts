export interface VelaProjectFile {
  path: string;
  content: string;
  readonly?: boolean;
}

export interface VelaPackageManifest {
  name: string;
  version: string;
  profile: 'core' | 'app' | 'web' | 'sys';
  entry: string;
  description: string;
  dependencies: Record<string, string>;
}

export interface VelaProjectTemplate {
  id: string;
  name: string;
  category: 'core' | 'web' | 'kernel' | '3d' | 'ai' | 'selfhost';
  profile: 'core' | 'app' | 'web' | 'sys';
  description: string;
  files: VelaProjectFile[];
}

export function parseVelaManifest(toml: string): VelaPackageManifest {
  const get = (key: string, fallback: string) => {
    const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
    return m ? m[1] : fallback;
  };
  const profRaw = get('profile', 'core');
  const profile: VelaPackageManifest['profile'] =
    profRaw === 'web' || profRaw === 'sys' || profRaw === 'app' ? profRaw : 'core';

  const deps: Record<string, string> = {};
  const depsMatch = toml.match(/\[dependencies\]([\s\S]*?)(\n\[|$)/);
  if (depsMatch) {
    for (const line of depsMatch[1].split('\n')) {
      const m = line.trim().match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (m) deps[m[1]] = m[2];
    }
  }

  return {
    name: get('name', 'vela-app'),
    version: get('version', '0.3.0'),
    profile,
    entry: get('entry', 'src/main.vela'),
    description: get('description', 'Vela package'),
    dependencies: deps,
  };
}

/**
 * Resolves multi-file `use module::*` / `use module::{a, b}` references inside a Vela project
 * by wrapping sibling `src/<module>.vela` files into `mod <module> { ... }` declarations.
 */
export function bundleProjectSource(files: VelaProjectFile[], entryPath: string): string {
  const entry = files.find((f) => f.path === entryPath) ?? files.find((f) => f.path.endsWith('.vela'));
  if (!entry) return '';

  const modules: string[] = [];
  for (const f of files) {
    if (f.path === entry.path || !f.path.endsWith('.vela')) continue;
    const base = f.path.split('/').pop()!.replace(/\.vela$/, '');
    // Check if the file already declares `mod <base>`
    const hasModDecl = new RegExp(`^\\s*(?:pub\\s+)?mod\\s+${base}\\b`, 'm').test(f.content);
    if (hasModDecl) {
      modules.push(f.content);
    } else {
      modules.push(`mod ${base} {\n${f.content}\n}`);
    }
  }

  if (modules.length === 0) return entry.content;
  return `${modules.join('\n\n')}\n\n${entry.content}`;
}

export const VELA_PROJECT_TEMPLATES: VelaProjectTemplate[] = [
  {
    id: 'tour',
    name: 'Core Tour & Multi-File Package',
    category: 'core',
    profile: 'core',
    description: 'Generics, closures, pattern matching, physical units, ARC lifecycle, async channels, and multi-file modules.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-tour"
version = "0.3.0"
profile = "core"
entry = "src/main.vela"
description = "Core Vela language capabilities and multi-file module tour"

[dependencies]
std-async = "0.3.0"
std-units = "0.3.0"
`,
      },
      {
        path: 'src/geometry.vela',
        content: `# Module imported via \`use geometry::*\` from src/main.vela

pub struct Point {
  x: Float
  y: Float
}

pub fn distance(a: Point, b: Point) -> Float {
  let dx = a.x - b.x
  let dy = a.y - b.y
  sqrt(dx * dx + dy * dy)
}
`,
      },
      {
        path: 'src/main.vela',
        content: `#![strict]
# Vela Language Tour: Modules, Generics, Closures, Units, ARC & Async

use geometry::{Point, distance}

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

async fn worker(id: Int, ch: Channel<Str>) {
  await time.sleep(5)
  ch.send("task #\${id} completed")
}

async fn main() {
  # Multi-file module import
  let p1 = Point { x: 0.0, y: 0.0 }
  let p2 = Point { x: 3.0, y: 4.0 }
  println("Distance from origin: \${distance(p1, p2)}")

  # Generics + Closures + Comprehensions
  let nums = [n * n for n in 1..=6 if n % 2 == 0]
  let doubled = mapList(nums, |x| x * 2)
  println("Even squares doubled: \${doubled}")

  let next = makeCounter(10)
  println("Counter: \${next()}, \${next()}, \${next()}")

  # Pattern matching & Enums
  let pay = Payment::card(last4: "4242", amount: 89.50)
  println("Payment amount: \${pay.amount()}")

  # Units of measure
  let dist = 100.m
  let elapsed = 9.58.s
  println("Sprint velocity: \${dist / elapsed}")

  # Defer LIFO & Cycle-Collected ARC
  defer println("Deferred cleanup executed cleanly")
  mut a = Node { label: "alpha" }
  mut b = Node { label: "beta" }
  a.next = b
  b.next = a

  # Structured Async Concurrency
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
    ],
  },
  {
    id: 'website',
    name: 'Full-Stack Website',
    category: 'web',
    profile: 'web',
    description: 'Build a complete multi-page website purely in Vela without hand-written HTML, CSS, or JS.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-web-store"
version = "0.3.0"
profile = "web"
entry = "src/main.vela"
description = "Full website built purely in Vela UI & Web DSL"

[dependencies]
web-ui = "0.3.0"
http-router = "0.3.0"
`,
      },
      {
        path: 'src/theme.vela',
        content: `# Typed Design Tokens & Zero-Cascade Styles

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
`,
      },
      {
        path: 'src/main.vela',
        content: `# Full Website built purely in Vela (Zero hand-written HTML, CSS, or JS)

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
      text("Websites built cleanly in Vela").style(Headline)
      text("Zero cascade, checked design tokens, @island hydration, and typed HTTP routes.").style(Muted)
    }
    each(allProducts()) { |p| ProductCard(p) }
  }
}

page Products() {
  column(style: Shell) {
    NavBar()
    text("Full Product Catalog").style(Headline)
    each(allProducts()) { |p| ProductCard(p) }
  }
}

page About() {
  column(style: Shell) {
    NavBar()
    text("About Vela Web Builder").style(Headline)
    text("Every style token, layout property, and API route is verified inside Vela.").style(Muted)
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
  println("Built Vela website with routes /, /products, /about")
  println("Dispatch check: \${http.dispatch("GET", "/api/products")}")
}
`,
      },
    ],
  },
  {
    id: 'kernel',
    name: 'VelaOS Kernel',
    category: 'kernel',
    profile: 'sys',
    description: 'Freestanding x86_64 kernel with MMIO UART16550, 0xB8000 VGA display, PIT/PS2 IRQs, bump heap, and in-kernel ramfs.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "velaos-kernel"
version = "0.3.0"
profile = "sys"
entry = "src/main.vela"
description = "Freestanding x86_64 OS kernel written in Vela"

[dependencies]
sys-hal = "0.3.0"
ramfs = "0.3.0"
`,
      },
      {
        path: 'src/uart.vela',
        content: `# UART 16550 Serial Driver @ 0x3F8

#[repr(C)]
mmio Uart16550 @ 0x3F8 {
  data: UInt8 @ 0x00
  ier:  UInt8 @ 0x01
  lcr:  UInt8 @ 0x03
  mcr:  UInt8 @ 0x04
  lsr:  UInt8 @ 0x05
}

pub fn initUart() {
  Uart16550.ier.write(0)
  Uart16550.lcr.write(0x80)
  Uart16550.data.write(0x01)
  Uart16550.lcr.write(0x03)
  Uart16550.mcr.write(0x03)
}

pub fn uartPuts(s: Str) {
  for ch in s {
    Uart16550.data.write(ch.toInt())
  }
}
`,
      },
      {
        path: 'src/main.vela',
        content: `# Freestanding x86_64 Operating System Kernel in Vela

use uart::{initUart, uartPuts}

#[repr(C)]
mmio Pic8259 @ 0x20 {
  cmd:  UInt8 @ 0x00
  data: UInt8 @ 0x01
}

mod heap {
  mut used: Int = 0
  pub fn init(start: Int, len: Int) {
    used = 0
    println("Kernel heap mapped @ 0x200000 (\${len} bytes)")
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
  initUart()
  console.clear()
  console.puts("velaos 0.3.0: x86_64 freestanding kernel online\\n")
  console.puts("----------------------------------------------------\\n")
  console.puts("[boot] VGA text buffer mapped @ 0xB8000 (80x25)\\n")
  console.puts("[boot] UART 16550 serial initialized @ 0x3F8\\n")

  uartPuts("UART0: kernel serial link active\\n")
  port.out8(0x43, 0x36)
  interrupts.enable()
  console.puts("[irq ] PIT Timer (0x20) & PS/2 Keyboard (0x21) armed\\n")

  heap.init(0x200000, 16777216)
  let frame = heap.alloc(4096)
  console.puts("[mem ] Allocated 4KiB frame: \${frame}\\n")

  # Populate in-kernel ramfs filesystem
  os.ramfsWrite("/etc/motd", "Welcome to VelaOS 0.3.0!\\n")
  os.ramfsWrite("/etc/init.vela", "service shell { port: ttyS0 }\\n")
  console.puts("[vfs ] Mounted ramfs files: \${os.ramfsLs()}\\n")

  unsafe {
    asm!("cli", "sti", "nop")
  }
  console.puts("velaos: system ready.\\n")
}
`,
      },
    ],
  },
  {
    id: 'model3d_sat',
    name: '3D Satellite & Game Physics',
    category: '3d',
    profile: 'app',
    description: 'Procedural 3D satellite model with PBR materials, .obj mesh export, and Vela game-engine kinematics.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-orbit-3d"
version = "0.3.0"
profile = "app"
entry = "src/main.vela"
description = "Procedural 3D model studio and game simulation in Vela"

[dependencies]
gfx3d = "0.3.0"
game-physics = "0.3.0"
`,
      },
      {
        path: 'src/main.vela',
        content: `# Vela 3D Engine & Game Simulation (docs 21 & 30)

scene3d OrbitalSatellite {
  background(#090D16)
  camera(pos: [5.2, 3.6, 6.2], target: [0, 1.1, 0], fov: 42)
  light(kind: "directional", color: #FFF5E4, intensity: 2.6, pos: [6, 9, 5])

  cylinder(name: "CoreBus", role: "primary",
    radius: 0.78, h: 1.5, pos: [0, 1.2, 0],
    color: #D4AF37, metalness: 0.92, roughness: 0.24,
    explode: [0, 0, 0])

  box(name: "AvionicsBay", role: "primary",
    w: 1.1, h: 0.55, d: 1.1, pos: [0, 2.05, 0],
    color: #1E293B, metalness: 0.85, roughness: 0.35,
    explode: [0, 0.85, 0])

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
  println("3D Scene: \${gfx3d.sceneName()} (\${gfx3d.partCount()} parts)")
  println("Parts: \${gfx3d.parts()}")

  # Deterministic Game Physics Step & Collision Check
  let sat = game.body("Satellite", 0.0, 0.0, 2.5, 0.0, 1.0)
  let pod = game.body("CargoPod", 3.2, 0.0, -1.5, 0.0, 0.8)
  let entities = [sat, pod]
  for tick in 1..=5 {
    game.step(entities, 0.1)
  }
  println("After 0.5s sim -> collides: \${game.collides(sat, pod)}")
}
`,
      },
    ],
  },
  {
    id: 'model3d_gear',
    name: '3D Planetary Gearbox',
    category: '3d',
    profile: 'app',
    description: 'Precision mechanical 3D assembly with meshing sun and planet gears in Vela.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-gearbox-3d"
version = "0.3.0"
profile = "app"
entry = "src/main.vela"
description = "Procedural mechanical gearbox assembly in Vela 3D"

[dependencies]
gfx3d = "0.3.0"
`,
      },
      {
        path: 'src/main.vela',
        content: `# Vela 3D Engine: Precision Planetary Gearbox Assembly

scene3d PlanetaryGearbox {
  background(#0B0F17)
  camera(pos: [0.2, 4.4, 5.2], target: [0, 0.8, 0], fov: 40)
  light(kind: "directional", color: #FFF8EC, intensity: 2.5, pos: [5, 8, 6])

  cylinder(name: "HousingBase", role: "primary",
    radius: 2.2, h: 0.25, pos: [0, 0.15, 0],
    color: #1E293B, metalness: 0.82, roughness: 0.42,
    explode: [0, -0.8, 0])

  torus(name: "OuterRing", role: "primary",
    radius: 1.95, tube: 0.18, pos: [0, 0.7, 0], rot: [1.5708, 0, 0],
    color: #334155, metalness: 0.9, roughness: 0.22,
    explode: [0, 0.4, 0])

  gear(name: "SunGear", role: "secondary",
    radius: 0.65, h: 0.45, teeth: 14, pos: [0, 0.7, 0],
    color: #EAB308, metalness: 0.94, roughness: 0.18,
    spin: [0, 1.2, 0], explode: [0, 1.1, 0])

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

  cylinder(name: "DriveShaft", role: "accent",
    radius: 0.2, h: 1.6, pos: [0, 1.0, 0],
    color: #E2E8F0, metalness: 0.98, roughness: 0.12,
    spin: [0, 1.2, 0], explode: [0, 1.7, 0])
}

fn main() {
  println("Planetary Gearbox 3D assembly loaded (\${gfx3d.partCount()} meshing parts)")
}
`,
      },
    ],
  },
  {
    id: 'ai_db',
    name: 'AI Autodiff & SQL Backend',
    category: 'ai',
    profile: 'app',
    description: 'Static-shape Tensors, reverse-mode autodiff training loop, and relational SQL database queries.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-ml-backend"
version = "0.3.0"
profile = "app"
entry = "src/main.vela"
description = "Machine learning autodiff and typed SQL backend in Vela"

[dependencies]
ai-tensor = "0.3.0"
sql-engine = "0.3.0"
`,
      },
      {
        path: 'src/main.vela',
        content: `#![strict]
# AI Machine Learning (doc 36) & Database Engine (doc 20)

fn main() {
  # 1. Static-Shape Tensor Ops
  let a: Tensor<Float32, [2, 2]> = tensor.of([[1.0, 2.0], [3.0, 4.0]])
  let probs = nn.softmax(a)
  println("Softmax probabilities: \${probs.toList()}")

  # 2. Reverse-mode autodiff derivative check
  let gradAt3 = train.gradScalar(|x| x * x * x + 2.0 * x, 3.0)
  println("d/dx (x^3 + 2x) at x=3 => \${gradAt3}")

  # 3. Train a 2-layer Neural Network (MLP) on XOR
  let metrics = train.mlpXor(30, 0.45)
  println("MLP Training finished -> loss: \${metrics.loss}, accuracy: \${metrics.accuracy}")

  # 4. Typed Relational SQL Database & Parameterized Queries
  db.exec("CREATE TABLE experiments (id INT, model TEXT, loss FLOAT, accuracy FLOAT)")
  db.exec("INSERT INTO experiments (id, model, loss, accuracy) VALUES ($1, $2, $3, $4)", [1, "MLP-2x8x2", metrics.loss, metrics.accuracy])
  db.exec("INSERT INTO experiments (id, model, loss, accuracy) VALUES ($1, $2, $3, $4)", [2, "ResNet-Vela", 0.042, 0.985])

  let rows = db.query("SELECT id, model, loss, accuracy FROM experiments ORDER BY accuracy DESC")?
  println("Saved experiments in SQL DB: \${rows}")
}
`,
      },
    ],
  },
  {
    id: 'selfhost',
    name: 'Vela Self-Hosting Package',
    category: 'selfhost',
    profile: 'core',
    description: 'Vela lexing and code-generation utilities written directly in Vela itself.',
    files: [
      {
        path: 'vela.pkg',
        content: `[package]
name = "vela-selfhost"
version = "0.3.0"
profile = "core"
entry = "src/main.vela"
description = "Self-hosted Vela lexer & backend written in Vela"
`,
      },
      {
        path: 'src/main.vela',
        content: `# Self-Hosting Vela Lexer & Emitter Written in Vela

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
  let targetSource = "fn main() { println(\\"Hello from self-hosted Vela!\\") }"
  let toks = tokenizeVela(targetSource)
  println("Lexed \${toks.len} tokens:")
  for t in toks {
    println("  [\${t.kind}] \${t.lexeme}")
  }
  println("\\nGenerated target output:\\n\${compileToC(toks)}")
}
`,
      },
    ],
  },
];
