# 14 — Web

**Status:** `spec`.

Vela's `web` profile is the replacement for HTML, CSS, JavaScript and TypeScript.
It reuses the view and style system of [13-ui.md](13-ui.md) unchanged: a page is a
view, a style is a style, and the compiler emits DOM operations, CSS and — where
the program needs it — WebAssembly.

---

## 1. The four ways to ship

A `web` package builds to one of four shapes, chosen by target:

| Target | Command | Output | Client JS shipped |
| --- | --- | --- | --- |
| `client` | `vela build --target wasm-client` | `index.html` + `app.wasm` + `app.css` | WASM only, no hand-written JS |
| `static` | `vela build --target static` | one `.html` per route + CSS + assets | none |
| `server` | `vela build --target server` | a native server binary | none by default |
| `hybrid` | `vela build --target hybrid` | server + WASM islands | only the islands that need it |

The last two are what makes Vela a candidate for a real site rather than a demo:
the default answer to "does this page need client JavaScript?" is no.

---

## 2. Pages and components

```vela
page Home() {
  column(style: PageStyle) {
    header()
    each(products) { |p| ProductCard(p) }
  }
}

component ProductCard(product: Product) {
  row(style: CardStyle) {
    image(product.image, alt: product.name).size(64dp)
    text(product.name)
  }
}
```

* `page` is a view that may be routed to and that serves as a document root.
* `component` is a view that may be embedded and, on the hybrid target, marked as
  an island: `component Checkout() @island { ... }`.
* Both are ordinary views from doc 13: same elements, same styles, same state.
* A `page` may declare `title`, `description`, `lang` and `head`:

```vela
page Product(id: Str) {
  title = "${product.name} — Acme"
  description = product.summary
  lang = "en"

  head {
    meta(property: "og:image", content: product.image.url)
    link(rel: "canonical", href: canonicalUrl(id))
  }

  ProductDetail(product)
}
```

`head` is typed too: `meta`, `link`, `script`, `style` (a style block, not a
string) are the only members, so an unclosed tag cannot exist.

---

## 3. The client model

On the `client` and `hybrid` targets, a page is compiled to WASM that owns its
DOM subtree.

```vela
page Counter() @client {
  state count: Int = 0

  column(pad: 24dp, gap: 8dp) {
    text("${count}")
    button("+1", onTap: { count += 1 })
  }
}
```

* Events are typed: `onTap`, `onInput`, `onSubmit`, `onKey`, `onFocus`,
  `onBlur`, `onScroll`, `onDragStart`, `onDrop`. The handler receives an `Event`
  with `target`, `value`, `key`, `modifiers`, `position`.
* There is no virtual DOM; the same diffing engine as doc 13 §19 applies,
  emitting DOM mutations directly.
* No JavaScript is written or emitted for application logic. The WASM module
  imports a small host surface (`dom.setAttribute`, `dom.setText`, …) and the
  runtime is a 6 KB shim, so the bundle is predictable.
* `@client` marks a subtree as client-rendered; `@static` marks one as
  server-rendered and never hydrated; the default is inherited from the target.
* Forms: `form(onSubmit: |f| { ... })` gives a typed `FormData`, and validation
  runs the same functions on both sides (see §9).

### 3.1 Loading a client page without WASM yet

The server emits the same tree as HTML first, so the page paints before the module
arrives; hydration attaches event handlers to the existing nodes and does not
re-create them. A page that never uses `state` is compiled as `static` even on the
`client` target, because there is nothing to hydrate — this is automatic and
reported in the build summary.

---

## 4. Routes

```vela
#[app]
view Root() {
  routes {
    "/"                   => Home()
    "/products"           => Products()
    "/products/:id"       => Product(id: params.id)
    "/products/:id/edit"  => ProductEdit(id: params.id)
    "*"                   => NotFound()
  }
}
```

* A segment `:name` captures one path segment; `*rest` captures the remainder.
* `params.id` is a `Str`; `params.int("id")?` converts with a `Result`.
* Route parameters are validated before the page renders: `"/products/:id:Int"`
  is the typed form (`E-WEB-010` when a conversion fails, which renders the
  package's `error(400)` page).
* The same declaration produces:
  * on `server`: HTTP handlers;
  * on `static`: one HTML file per static route, and a directory per dynamic one
    only if `[build] prerender` lists values;
  * on `client`: history entries, so `router.push("/products/42")` changes the URL
    and the view without a reload;
  * and deep links, because the URL is the route and the state is the route's
    parameters.
* Nested layouts: `layout(name) { }` wraps any route whose page declares
  `layout: name`.

---

## 5. Server

```toml
[serve]
root = "public"
port = 8080
```

```vela
#[app]
fn main() -> Result<Void, Error> {
  let app = server.new()
  app.use(logging())
  app.use(session.cookie(secret: env.require("SESSION_SECRET")))
  app.routes(Root())
  app.static("/assets", from: "dist/assets")
  app.listen(port: 8080)
}
```

* `server.new()` produces an `App`; `app.routes(Root())` mounts the same view tree
  that the client would render, as a server-rendered route table.
* A handler is either a page (returns HTML) or an explicit API function:

```vela
@get("/api/products/:id")
fn getProduct(req: Request) -> Result<Json<Product>, ApiError> {
  guard let id = req.params.int("id") else { fail ApiError.badRequest("id") }
  guard let p = try db.products.find(id)? else { fail ApiError.notFound() }
  Ok(Json(p))
}

@post("/api/cart")
fn addToCart(req: Request) -> Result<Json<Cart>, ApiError> {
  let body = try req.json::<AddToCart>()?
  Ok(Json(try cart.add(body.productId, body.qty)?))
}
```

* `@get`, `@post`, `@put`, `@patch`, `@delete`, `@any` declare API routes.
* `req` gives `params`, `query`, `headers`, `cookies`, `json::<T>()`, `form()`,
  `body()`, `ip`, `method`.
* `Json<T>` requires `#[derive(Json)]` on `T`, which is where the field names and
  validation live, so an endpoint cannot accept a shape the type does not
  describe.
* A handler that returns `Err` renders the package's error page for that status or
  the JSON error envelope for `/api`.
* Middleware is `Func(Handler) -> Handler`; the framework ships `logging`,
  `cors`, `compress`, `rateLimit`, `csrf`, `session`, `auth`, `timeout`.

---

## 6. Security defaults

The web profile is the one where the wrong default is a breach, so:

| Concern | Default |
| --- | --- |
| HTML injection | impossible: `Markup` escapes; only `Markup.trust` bypasses, and it is `E-WEB-020` in a `web` module unless the package allows it |
| CSRF | `form()` requires a token; `session.cookie` issues and verifies it |
| XSS via attribute | attributes are typed; an event attribute cannot be written |
| SQL injection | `db.query` takes interpolated **parameters**, never a string built by `+` (`E-WEB-030` on a `Str` concatenated into SQL) |
| Path traversal | `assets.serve` normalises and refuses `..` |
| Open redirect | `redirect(url)` refuses anything not in the route table or `[serve] allowRedirects` |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` are on unless explicitly relaxed, and relaxing one is `W-WEB-010` |
| CSP | `app.csp("<policy>")`; the default policy forbids inline scripts, which the compiler can guarantee because it emits none |
| Secrets | `env.require("X")` fails at startup if missing, so a deploy cannot half-configure |
| Unsafe code | `#![deny(unsafe)]` is the default for `web` packages |
| Panic in a handler | caught, logged, and rendered as a 500; the process does not exit (`W-ERR-010` warns about `unwrap()`) |

---

## 7. `Markup`

`Markup` is a type for HTML, and `Str` is not one.

```vela
let safe: Markup = html.p("hello <world>")       # escaped: &lt;world&gt;
let unsafe: Markup = html.raw("<b>x</b>")        # requires Markup.trust
let composed = safe ++ html.br ++ html.text(userInput)   # still escaped
```

* `html.*` builds tags: `html.p`, `html.div`, `html.span`, `html.a(href:)`,
  `html.ul`, `html.li`, `html.table`, and `html.tag("custom", attrs, children)`
  for anything else.
* Interpolation into a `Markup` value escapes; the type system prevents the
  two-step "build a string, then mark it safe" that every template language
  eventually grows.
* A page never produces a `Str` of HTML; `page` returns the tree, and the renderer
  produces `Markup` from it. This is why the escaping claim is structural rather
  than a policy.
* `html.sanitise(untrusted: Str) -> Markup` is the one function that accepts
  untrusted markup, and it is an allow-list sanitiser.

---

## 8. Assets and output

```toml
[assets]
root   = "assets"
public = "dist"
```

```
dist/
  index.html
  products/42.html
  assets/
    app.wasm
    app.css
    logo.2a4f.svg          # content-hashed
    Inter-400.woff2
  manifest.json
```

* CSS is generated from the styles actually used: a style that no reachable view
  applies is not emitted (`W-UI-050` reports dead styles by name).
* Class names are content-addressed and stable across builds, so long-lived
  caches are safe.
* Images are converted per target density and format; `asset` (doc 13 §14) is the
  only way an image enters the build.
* `manifest.json` is the asset map; a template cannot reference a missing file,
  because assets are typed values.

---

## 9. Data

```vela
#[derive(Json)]
struct AddToCart {
  productId: Int
  qty: Int = 1
  note: Str?
}
```

`#[derive(Json)]` gives `toJson`, `fromJson`, from a field-level
`#[json(name: "product_id")]`, and a validation hook:

```vela
impl Validate for AddToCart {
  fn validate(self) -> Result<Void, ValidationError> {
    if self.qty < 1 { fail ValidationError.range("qty", min: 1) }
    Ok(unit)
  }
}
```

* The same `fromJson` and the same `validate` run in the browser (for instant
  feedback) and on the server (because the browser can lie). There is no second
  definition of "valid".
* `FormData` converts to a struct through the same path: `form.parse::<AddToCart>()`.
* `db` is an interface, not an ORM: `db.query(sql, params...)`,
  `db.exec(sql, params...)`, `db.transaction { |tx| ... }` with `tx` auto-rolled
  back on an error. Every parameter is bound, never interpolated.

---

## 10. Browser APIs

| Module | Surface |
| --- | --- |
| `web.fetch` | `fetch(url, method:, headers:, body:) -> Result<Response, NetError>`, `Response.json::<T>()`, `Response.text()`, streaming via `Response.body` |
| `web.ws` | `ws.connect(url)`, `socket.send(v)`, `for msg in socket`, `socket.close()` |
| `web.storage` | `storage.local`, `storage.session`, typed get/set with a `Json` value |
| `web.history` | driven by `routes` (doc 14 §4); `router.push`, `router.replace`, `router.back` |
| `web.clipboard` | `clipboard.write(text:)`, `clipboard.read()` |
| `web.worker` | `worker.start(comptime fn)` for a WASM worker; `serviceWorker.register(...)` for the offline shell (`planned` behind `#![serviceWorker]`) |
| `web.notify` | `notify.request()`, `notify.show(title:, body:)` |
| `web.geo` | `geo.current() -> Result<Position, GeoError>` |
| `web.dom` | the escape hatch: `dom.query(sel)`, `dom.setAttribute`, `dom.on` — available but `#![deny(web.dom)]` turns it into an error |
| `web.url` | parse/build/encode query strings |
| `web.crypto` | `randomBytes`, `sha256`, `hmac`, `aesGcm` (the platform's own, not a JS library) |

`web.dom` exists so that a migration does not stop at the first incompatibility,
and the lint exists so that a codebase does not slowly become a DOM program with
a Vela header.

---

## 11. Static generation, islands, hydration

```toml
[build]
prerender = ["/", "/about", "/pricing"]
islands   = "auto"          # auto | all | none
```

* `static` target: every route in `prerender` becomes an HTML file at build time.
  A route that reads a request (`req`, a cookie, a session) cannot be prerendered
  and is `E-WEB-040`.
* `islands = auto` marks a `component ... @island` as the hydration boundary; the
  rest of the page has no client code at all.
* Hydration is resumable in the sense that matters: it attaches handlers and
  adopts existing DOM, it does not re-render. A mismatch between server and client
  markup is a build-time error in `hybrid` mode (both are produced by the same
  code), not a runtime warning.
* Streaming: `page ... @stream` sends the shell first and awaits `Suspense`
  regions. The rules:

  | Rule | Detail |
  | --- | --- |
  | Shell first | the `<head>`, the layout and every region that does not suspend are flushed immediately |
  | `Suspense(fallback:)` | marks a region that may be pending; its fallback is sent in the shell |
  | Resolution order | each resolved region is sent as a chunk that replaces its fallback, in completion order |
  | Errors | a region that fails sends an error boundary payload; the rest of the page is unaffected |
  | Transport | chunked HTML by default; over HTTP/2 each chunk is one DATA frame (doc 23 §3) |
  | Frames | the first chunk is under 14 KB so the first paint does not wait for a second round trip |
  | Client | no JavaScript is required to render a streamed region; an island inside one hydrates when it arrives |
  | Cancellation | a client disconnect cancels the pending regions (doc 10 §4) |

  A prerendered route may not stream (`E-WEB-090`), because there is no response
  to stream into; it renders the resolved page.

---

## 12. Performance budget

Stated as contract, because a web target without one is a joke:

| Budget | Limit |
| --- | --- |
| Client runtime (host shim + allocator) | ≤ 8 KB gzipped |
| Application WASM | ≤ 100 KB for a typical page; `vela build --stats` lists the top 10 contributors |
| CSS for a page | ≤ 20 KB, only the styles reachable from that route |
| First contentful paint (static target) | one round trip, no JS blocking |
| Hydration cost (island) | ≤ 4 ms per island on a 4× CPU throttle |
| Route change | ≤ 50 ms from click to painted |

`vela build --budget` fails the build when a limit is exceeded, which makes "we
will optimise later" a decision someone has to make on purpose.

---

## 13. Deploying

Deployment — containers, canaries, rollback, observability, secrets — is specified
in [39-cloud.md](39-cloud.md). The web-specific part is only what artifact each
target produces:

| Host | Artifact |
| --- | --- |
| any static host | the `dist/` tree from the `static` target |
| a container | the `server` binary (native, no JVM, no Node) + `dist/` |
| a CDN edge | the `hybrid` output: HTML + islands |
| the Vela registry's pages (`planned`) | `vela deploy` |

The server binary links only libc on Linux and macOS; there is no runtime to
install, because the Vela runtime is compiled into it.

---

## 14. What this replaces, side by side

**A counter, three ways.**

```html
<!-- HTML + CSS + JS -->
<div class="counter">
  <span id="n">0</span>
  <button onclick="inc()">+1</button>
</div>
<style>
  .counter { display: flex; gap: 8px; align-items: center; }
  #n { font: 16px system-ui; }
</style>
<script>
  let count = 0;
  function inc() {
    count++;
    document.getElementById('n').textContent = count;
  }
</script>
```

```vela
page Counter() {
  state count: Int = 0
  row(gap: 8dp, align: .center) {
    text("${count}").fontSize(16dp)
    button("+1", onTap: { count += 1 })
  }
}
```

**Three files, two languages and one leak of escaping become one declaration.**

**A form, three ways.**

```html
<form onsubmit="return validate(event)">
  <input name="email" required>
  <button>Subscribe</button>
</form>
<script>
  function validate(e) {
    e.preventDefault();
    const email = e.target.email.value;
    if (!email.includes('@')) { alert('bad email'); return false; }
    fetch('/api/subscribe', { method: 'POST', body: JSON.stringify({ email }) });
  }
</script>
```

```vela
page Subscribe() {
  state email: Str = ""

  form(onSubmit: |f| {
    match f.parse::<Subscribe>() {
      Ok(body) => { try web.fetch.post("/api/subscribe", body)?; }
      Err(e)   => { error.text = e.message(); }
    }
  }) {
    field(email, onChange: |v| { email = v })
      .label("Email")
      .invalid(not email.isEmpty and not email.contains("@"))
    submitButton("Subscribe")
  }
}
```

The validation is the `Subscribe` type's `validate`, which the server runs too.

---

## 15. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-WEB-010` | route parameter failed its type conversion |
| `E-WEB-020` | `Markup.trust` in a module that forbids it |
| `E-WEB-030` | a `Str` interpolated into SQL |
| `E-WEB-040` | prerendering a route that reads the request |
| `E-WEB-050` | `web.dom` use where the module denies it |
| `E-WEB-060` | a handler in a `static` package |
| `E-WEB-070` | an island whose props are not `Json` |
| `E-WEB-080` | hydration mismatch (hybrid target, build time) |
| `W-WEB-010` | relaxed cookie flag |
| `W-WEB-020` | budget exceeded (`--budget`) |
| `W-UI-050` | dead style |

---

Next: [15-systems.md](15-systems.md).
