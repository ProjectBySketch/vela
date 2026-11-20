import { SqlTableSnapshot } from './types';

interface TableData {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export class VelaSqlEngine {
  private tables = new Map<string, TableData>();
  private txBackup: Map<string, TableData> | null = null;
  public routes: { method: string; path: string; handler: string }[] = [];

  public exec(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const clean = sql.trim().replace(/;+$/, '');
    const upper = clean.toUpperCase();

    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION') {
      this.txBackup = new Map();
      for (const [k, v] of this.tables.entries()) {
        this.txBackup.set(k, {
          name: v.name,
          columns: [...v.columns],
          rows: v.rows.map((r) => ({ ...r })),
        });
      }
      return [];
    }

    if (upper === 'COMMIT') {
      this.txBackup = null;
      return [];
    }

    if (upper === 'ROLLBACK') {
      if (this.txBackup) {
        this.tables = this.txBackup;
        this.txBackup = null;
      }
      return [];
    }

    // CREATE TABLE name (col1 TYPE, col2 TYPE, ...)
    const createMatch = clean.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.+)\)$/is);
    if (createMatch) {
      const name = createMatch[1];
      const cols = createMatch[2]
        .split(',')
        .map((c) => c.trim().split(/\s+/)[0])
        .filter(Boolean);
      if (!this.tables.has(name)) {
        this.tables.set(name, { name, columns: cols, rows: [] });
      }
      return [];
    }

    // INSERT INTO name (c1, c2) VALUES (v1, v2)
    const insertMatch = clean.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)$/is);
    if (insertMatch) {
      const name = insertMatch[1];
      const cols = insertMatch[2].split(',').map((s) => s.trim());
      const vals = this.splitArgs(insertMatch[3]).map((v) => this.parseLiteral(v, params));
      let tbl = this.tables.get(name);
      if (!tbl) {
        tbl = { name, columns: cols, rows: [] };
        this.tables.set(name, tbl);
      }
      const row: Record<string, unknown> = {};
      cols.forEach((c, idx) => {
        row[c] = vals[idx] ?? null;
      });
      tbl.rows.push(row);
      return [row];
    }

    // SELECT cols FROM name [WHERE ...] [ORDER BY ...] [LIMIT n]
    const selectMatch = clean.match(
      /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/is
    );
    if (selectMatch) {
      const selCols = selectMatch[1].trim();
      const tblName = selectMatch[2];
      const whereClause = selectMatch[3];
      const orderCol = selectMatch[4];
      const orderDir = (selectMatch[5] || 'ASC').toUpperCase();
      const limit = selectMatch[6] ? parseInt(selectMatch[6], 10) : undefined;

      const tbl = this.tables.get(tblName);
      if (!tbl) return [];

      let rows = tbl.rows.filter((r) => (whereClause ? this.evalWhere(r, whereClause, params) : true));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = a[orderCol] as number | string;
          const bv = b[orderCol] as number | string;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderDir === 'DESC' ? -cmp : cmp;
        });
      }
      if (limit !== undefined) rows = rows.slice(0, limit);

      if (selCols === '*') return rows.map((r) => ({ ...r }));
      const wanted = selCols.split(',').map((c) => c.trim());
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const w of wanted) out[w] = r[w];
        return out;
      });
    }

    // UPDATE name SET k = v WHERE ...
    const updateMatch = clean.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is);
    if (updateMatch) {
      const tbl = this.tables.get(updateMatch[1]);
      if (!tbl) return [];
      const assigns = updateMatch[2].split(',').map((p) => p.split('=').map((x) => x.trim()));
      const whereClause = updateMatch[3];
      let changed = 0;
      for (const r of tbl.rows) {
        if (!whereClause || this.evalWhere(r, whereClause, params)) {
          for (const [k, v] of assigns) {
            r[k] = this.parseLiteral(v, params);
          }
          changed++;
        }
      }
      return [{ updated: changed }];
    }

    // DELETE FROM name WHERE ...
    const delMatch = clean.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/is);
    if (delMatch) {
      const tbl = this.tables.get(delMatch[1]);
      if (!tbl) return [];
      const before = tbl.rows.length;
      const whereClause = delMatch[2];
      tbl.rows = whereClause ? tbl.rows.filter((r) => !this.evalWhere(r, whereClause, params)) : [];
      return [{ deleted: before - tbl.rows.length }];
    }

    return [];
  }

  private splitArgs(str: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    let qChar = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (inQ) {
        cur += ch;
        if (ch === qChar) inQ = false;
      } else if (ch === "'" || ch === '"') {
        inQ = true;
        qChar = ch;
        cur += ch;
      } else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  private parseLiteral(tok: string, params: unknown[]): unknown {
    const t = tok.trim();
    const pm = t.match(/^\$(\d+)$/);
    if (pm) return params[parseInt(pm[1], 10) - 1];
    if (t === '?') return params.shift();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      return t.slice(1, -1);
    }
    if (t.toLowerCase() === 'true') return true;
    if (t.toLowerCase() === 'false') return false;
    if (t.toLowerCase() === 'null') return null;
    if (!Number.isNaN(Number(t))) return Number(t);
    return t;
  }

  private evalWhere(row: Record<string, unknown>, clause: string, params: unknown[]): boolean {
    const m = clause.match(/^(\w+)\s*(=|!=|<>|<|<=|>|>=|LIKE)\s*(.+)$/i);
    if (!m) return true;
    const colVal = row[m[1]];
    const op = m[2].toUpperCase();
    const rhs = this.parseLiteral(m[3], params);
    if (op === '=') return colVal === rhs;
    if (op === '!=' || op === '<>') return colVal !== rhs;
    if (op === '<') return Number(colVal) < Number(rhs);
    if (op === '<=') return Number(colVal) <= Number(rhs);
    if (op === '>') return Number(colVal) > Number(rhs);
    if (op === '>=') return Number(colVal) >= Number(rhs);
    if (op === 'LIKE') {
      const pat = String(rhs).replace(/%/g, '.*');
      return new RegExp(`^${pat}$`, 'i').test(String(colVal));
    }
    return true;
  }

  public snapshot(): SqlTableSnapshot[] {
    return Array.from(this.tables.values()).map((t) => ({
      name: t.name,
      columns: t.columns,
      rows: t.rows.map((r) => ({ ...r })),
    }));
  }
}
