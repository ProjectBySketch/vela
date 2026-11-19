# 20 — Databases and persistence

**Status:** `spec`. Module: `db` (provisional). Related: doc 08 (packages), doc 14
§9 (web data), doc 24 (security).

Vela's answer to persistence is **typed SQL, not an ORM**. You write SQL; the
compiler checks it against your schema at build time; the result type comes from
the query. There is no lazy loading, no hidden N+1, and no query builder to learn.

---

## 1. Connections and pools

```vela
let pool = try db.open("postgres://localhost/acme")?
defer pool.close()

let db = try db.open("sqlite://./data/app.db", options: DbOptions {
  journal: .wal,
  busyTimeout: 5s,
  foreignKeys: true,
})?
```

| Kind | URL |
| --- | --- |
| SQLite (bundled) | `sqlite://./path.db`, `sqlite::memory:` |
| PostgreSQL | `postgres://user:pass@host:5432/db?sslmode=require` |
| MySQL / MariaDB | `mysql://user:pass@host/db` |
| ClickHouse (analytics, `planned`) | `clickhouse://...` |

`db.open` returns a `Pool`, not a single connection:

```vela
let pool = try db.pool(url, size: 16, idle: 30s, lifetime: 30m)?
```

* A `Pool` is a `shared struct` and is `Send + Share`: pass it across tasks
  freely.
* `pool.query(sql, params...)` borrows a connection for the duration of the call
  and returns it on drop, including on error or panic.
* Under `async`, a blocked pool suspends the task rather than the thread.

---

## 2. Typed queries

```vela
#[query]
const TOP_CUSTOMERS = """
  select id, name, total_cents
  from customers
  where total_cents > $1
  order by total_cents desc
  limit $2
"""

let rows: List<Customer> =
  try pool.query(TOP_CUSTOMERS, minCents, limit)?
```

Rules:

* A `#[query]` constant is parsed and **checked against the schema snapshot** at
  compile time. A column that does not exist, a type mismatch in a predicate, an
  `insert` with a wrong arity — all compile errors (`E-DB-010`), with the line
  and column in the SQL.
* The row type is inferred from the `select` list and the schema, so `Customer`
  above needs no annotation. Naming a struct (`as Customer`) checks that the
  fields match the projection exactly.
* Parameters are `$1`, `$2`, … (or `?` for SQLite) and are always **bound**, never
  interpolated. Interpolating a `Str` into SQL is `E-WEB-030` (doc 14 §6).
* A query that returns no rows yields `List<T>`; `queryOne` yields `T?`;
  `execute` yields `Affected { rows: Int }`.

### 2.1 Untyped escape

```vela
let value: Json = try pool.queryRaw(sql)?.into(0)
```

`queryRaw` exists for migrations, admin tools and dynamic SQL. It returns
`List<Json>`, it is never checked, and the lint reports every use (`W-DB-010`) so
a codebase cannot quietly become string-built SQL.

---

## 3. Schema declarations

One module owns the schema; everything else derives from it.

```vela
schema App {
  table customer {
    id:         Uuid      primaryKey
    name:       Str       length(max: 120)
    email:      Str       unique
    createdAt:  Instant   default now
    mut total:  Int       default 0
  }

  table order {
    id:         Uuid      primaryKey
    customerId: Uuid      references customer.id onDelete cascade
    total:      Int
    placedAt:   Instant   default now
  }

  index order { customerId, placedAt }
  index order { placedAt desc } name "order_recent"
}
```

`schema` is a declaration, not a runtime call: `vela db check` compares it with
the live database and reports drift; `vela db migrate` generates the migration
(doc 20 §4).

### 3.1 Column types

| Schema type | SQLite | PostgreSQL | MySQL |
| --- | --- | --- | --- |
| `Int` | `integer` | `bigint` | `bigint` |
| `Float` | `real` | `double precision` | `double` |
| `Bool` | `integer` | `boolean` | `tinyint(1)` |
| `Str` | `text` | `text` | `longtext` |
| `Str length(max: n)` | `text` | `varchar(n)` | `varchar(n)` |
| `Bytes` | `blob` | `bytea` | `longblob` |
| `Instant` | `integer` (ms) | `timestamptz` | `datetime(6)` |
| `Date` | `text` (ISO) | `date` | `date` |
| `Uuid` | `text` | `uuid` | `char(36)` |
| `Json` | `text` (validated) | `jsonb` | `json` |
| `enum E` | `text` + check | native enum | `enum(...)` |
| `List<T>` | child table | array (if supported) | child table |
| `Vec(n)` | `blob` | `vector` | (none) |

A type without a mapping on the target dialect is `E-DB-020` at build time,
naming the dialect — not a runtime surprise in production.

---

## 4. Migrations

A migration is a numbered, immutable pair of steps.

```vela
// migrations/0007_add_order_total.vela
migration "0007_add_order_total" {
  up {
    alter table order {
      add total: Int default 0
    }
  }
  down {
    alter table order {
      drop total
    }
  }
}
```

Rules:

* Filenames sort lexicographically; the applied set is recorded in a
  `vela_migrations` table with a checksum. A migration whose checksum changed
  after being applied is `E-DB-030` — never silently re-run.
* `vela db migrate` applies pending migrations inside one transaction per
  migration, **except** on dialects where DDL is not transactional (MySQL), where
  it says so before running and requires `--yes`.
* `vela db migrate --dry-run` prints the statements and asks for nothing.
* Destructive changes (`drop table`, `drop column`, narrowing a type) are
  refused unless the migration declares `#[dangerous]` with a reason string,
  because "it worked in staging" is not a backup.
* A migration may be generated from the schema diff (`vela db diff`), and the
  generated file is ordinary, reviewable Vela.

---

## 5. Transactions

```vela
let placed = try pool.transaction(|tx| {
  let order = try tx.insert(Order { customerId: id, total: total })?
  try tx.exec("update customer set total = total + $1 where id = $2", total, id)?
  Ok(order)
})?
```

* `transaction` takes a closure that receives a `Tx`; committing happens when it
  returns `Ok`, rolling back on `Err` or panic.
* Nested `transaction` calls become savepoints (where the dialect has them) or
  join the outer transaction (SQLite); the difference is documented per driver,
  not guessed.
* Isolation level: `pool.transaction(isolation: .serialisable, ...)`; the default
  is the dialect's default and is printed by `vela db info`.

---

## 6. Repositories (the 10% an ORM is actually for)

```vela
let customers = db.repository::<Customer>(pool)
let c = try customers.find(id)?
let all = try customers.where(|c| c.total > 1000).orderBy(.total, .desc).limit(50).all()?
```

`repository::<T>` generates CRUD from the schema, for one table, with:

* `find(id)`, `all()`, `insert(T)`, `update(T)`, `delete(id)`, `count()`;
* a query builder whose predicates are checked against the column types —
  `c.total > 1000` is a column plus an `Int`, and `c.name > 3` is a compile
  error, not a query that returns nothing;
* **no lazy loading**: a relationship is loaded by an explicit join or an
  explicit second query. The N+1 problem is not avoided by the library; it is
  impossible to write by accident.

A repository is a thin layer over typed SQL. If it gets in the way,
`pool.query` with `#[query]` is always there, and the repository's generated SQL
is printed by `vela db explain`.

---

## 7. Pagination and cursors

```vela
let page = try customers.page(size: 50, after: lastSeen)?
while page.hasNext {
  process(page.items)
  page = try customers.page(size: 50, after: page.cursor)?
}
```

Keyset pagination is the default (`after`), because `offset` degrades. `page`
returns a `Cursor` that is a signed, opaque `Str` — the client cannot fabricate
one, and the server cannot be walked past the sort key.

---

## 8. Search and semi-structured data

| Need | Vela |
| --- | --- |
| full text | `db.search(table, query, fields: [...])` — FTS5 on SQLite, `tsvector` on PostgreSQL, `MATCH` on MySQL |
| JSON columns | `Json` type; `row.data["user"]["id"].asInt()`; a `->>` path is generated for the dialect |
| vector search | `Vec(dimensions)` column; `db.nearest(table, vector, k)` — `pgvector`, `sqlite-vss`, or a pure-Vela HNSW index (`planned`) |
| geospatial (`planned`) | `Point` column, `db.near(...)` over PostGIS |
| time series | a `timeBucket(interval)` helper that emits the dialect's `date_trunc` / `strftime` |

---

## 9. Testing against a database

```vela
#[test]
fn placingAnOrder() {
  with db = db.testDialect(.sqlite) {        # in-memory, schema applied
    let order = try placeOrder(seedCustomer(), 1000)?
    assertEq(try db.count("order")?, 1)
    assertEq(order.total, 1000)
  }   # rolled back and destroyed
}

#[test]
#[dbFixture("postgres://localhost/acme_test")]
fn realDialect() { ... }
```

* Each test gets a transaction that is rolled back, unless it opts into
  `#[isolatedDb]` for a test that must commit.
* `vela test --db postgres://…` runs the whole suite against a real dialect; the
  same tests then run on every dialect the package claims to support, which is
  the only way a "supports MySQL" claim means anything.

---

## 9.1 Multi-tenancy and sharding

```vela
let tenant = pool.tenant(tenantId)        // row-level, enforced by a generated predicate
let shard = shards.for(tenantId)          // ring hash over a declared shard list
```

A `tenancy` declaration in the schema adds a `tenantId` column to every table and
a generated row-level predicate to every query built through the repository; a
query that bypasses it is `E-DB-040`.

---

## 10. Observability

```vela
pool.onQuery(|q| {
  metrics.histogram("db.query", q.duration, tags: { table: q.table })
})
```

`QueryInfo` gives `sql`, `params` (redacted by type), `duration`, `rows`,
`table`, `txId`. Parameters whose type is `Secret` are printed as `***`.

Slow-query threshold: `db.open(..., slowQuery: 200ms)`, which logs with the
statement and a redacted parameter list.

---

## 11. Errors

```vela
enum DbError {
  connection(lost: Bool)
  timeout(waitedMs: Int)
  constraint(kind: ConstraintKind, table: Str, detail: Str)
  syntax(near: Str)
  noRows
  typeMismatch(column: Str, expected: Str, found: Str)
  pooled  (pool exhausted)
  other(code: Int, message: Str)
}
```

Constraint violations are mapped from each dialect's codes, not passed through as
strings: a unique violation is `.constraint(kind: .unique, ...)` everywhere,
which is what makes `catch DbError::constraint(.unique, ...)` portable.

---

## 12. Diagnostics

| Code | Meaning |
| --- | --- |
| `E-DB-010` | query does not match the schema |
| `E-DB-020` | schema type has no mapping for this dialect |
| `E-DB-030` | applied migration's checksum changed |
| `E-DB-040` | query bypasses the tenant predicate |
| `E-DB-050` | destructive migration without `#[dangerous]` |
| `E-DB-060` | repository used with a table that has no primary key |
| `W-DB-010` | `queryRaw` used (unchecked SQL) |
| `W-DB-020` | query without an index on the predicate column (`vela db lint`) |

---

Next: [21-graphics.md](21-graphics.md).
