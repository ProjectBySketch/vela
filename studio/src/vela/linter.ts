import { BlockExpr, Diagnostic, ProgramAST, Stmt } from './types';

/**
 * Vela Language Linter (`vela lint`)
 * Implements spec/34-style.md §3 and spec/25-tooling.md §4 rules.
 */
export function lintVela(source: string, ast: ProgramAST): Diagnostic[] {
  const lints: Diagnostic[] = [];
  const lines = source.split('\n');

  // 1. Bare TODO comment check + line length > 100
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (/\bTODO\b(?!\([^)]+\):)/.test(raw)) {
      lints.push({
        code: 'W-STYLE-003',
        severity: 'warning',
        message: 'Bare TODO comment without owner tag',
        line: lineNo,
        col: Math.max(1, raw.indexOf('TODO') + 1),
        hint: 'Use # TODO(name): description so tasks remain trackable.',
      });
    }
    if (raw.length > 108) {
      lints.push({
        code: 'W-FMT-001',
        severity: 'info',
        message: `Line exceeds 100-column style guide (${raw.length} chars)`,
        line: lineNo,
        col: 101,
        hint: 'Run Format (vela fmt) or wrap long arguments.',
      });
    }
  });

  function checkBlockDepth(block: BlockExpr, depth: number) {
    if (depth > 4) {
      lints.push({
        code: 'W-STYLE-002',
        severity: 'warning',
        message: `Nesting depth ${depth} exceeds recommended limit of 4`,
        line: block.line,
        col: 1,
        hint: 'Use `guard cond else { ... }` for early exits to flatten control flow.',
      });
      return;
    }
    for (const s of block.stmts) {
      checkStmt(s, depth);
    }
  }

  function collectAssignedNames(block: BlockExpr, out: Set<string>) {
    for (const s of block.stmts) {
      if (s.kind === 'AssignStmt' && s.target.kind === 'IdentExpr') {
        out.add(s.target.name);
      } else if (s.kind === 'ExprStmt' && s.expr.kind === 'CallExpr') {
        // mutating method call on identifier (e.g. xs.push(1)) counts as mutation
        if (s.expr.callee.kind === 'MemberExpr' && s.expr.callee.target.kind === 'IdentExpr') {
          out.add(s.expr.callee.target.name);
        }
      } else if (s.kind === 'IfStmt') {
        collectAssignedNames(s.thenBranch, out);
        if (s.elseBranch && s.elseBranch.kind === 'BlockExpr') collectAssignedNames(s.elseBranch, out);
      } else if (s.kind === 'WhileStmt' || s.kind === 'ForStmt' || s.kind === 'LoopStmt') {
        collectAssignedNames(s.body, out);
      }
    }
  }

  function checkStmt(stmt: Stmt, depth = 0) {
    switch (stmt.kind) {
      case 'StructStmt':
      case 'EnumStmt':
      case 'ThemeStmt':
      case 'StyleStmt': {
        if (!/^[A-Z]/.test(stmt.name)) {
          lints.push({
            code: 'W-NAME-001',
            severity: 'warning',
            message: `Type/style declaration '${stmt.name}' should use UpperCamelCase`,
            line: stmt.line,
            col: 1,
          });
        }
        if (stmt.kind === 'StructStmt' && stmt.fields.length > 20) {
          lints.push({
            code: 'W-SIZE-003',
            severity: 'warning',
            message: `Struct '${stmt.name}' has ${stmt.fields.length} fields (recommended max 20)`,
            line: stmt.line,
            col: 1,
          });
        }
        break;
      }

      case 'FnStmt': {
        if (stmt.params.filter((p) => p.typeAnn?.name === 'Bool').length >= 3) {
          lints.push({
            code: 'W-API-002',
            severity: 'warning',
            message: `Function '${stmt.name}' takes 3+ Bool parameters`,
            line: stmt.line,
            col: 1,
            hint: 'Group boolean flags into an options struct for readable call sites.',
          });
        }
        const mutated = new Set<string>();
        collectAssignedNames(stmt.body, mutated);
        for (const inner of stmt.body.stmts) {
          if (inner.kind === 'LetStmt' && inner.isMut && !mutated.has(inner.name)) {
            lints.push({
              code: 'W-MEM-001',
              severity: 'info',
              message: `Variable '${inner.name}' is declared 'mut' but never mutated`,
              line: inner.line,
              col: 1,
              hint: `Change 'mut ${inner.name}' to 'let ${inner.name}'.`,
            });
          }
        }
        checkBlockDepth(stmt.body, depth + 1);
        break;
      }

      case 'IfStmt': {
        checkBlockDepth(stmt.thenBranch, depth + 1);
        if (stmt.elseBranch && stmt.elseBranch.kind === 'BlockExpr') {
          checkBlockDepth(stmt.elseBranch, depth + 1);
        }
        break;
      }

      case 'WhileStmt':
      case 'ForStmt':
      case 'LoopStmt': {
        checkBlockDepth(stmt.body, depth + 1);
        break;
      }

      case 'ModStmt':
      case 'ImplStmt': {
        const list = stmt.kind === 'ModStmt' ? stmt.body : stmt.methods;
        for (const s of list) checkStmt(s, depth);
        break;
      }

      case 'ExprStmt': {
        // Check interpolated SQL strings in db.exec / db.query
        if (
          stmt.expr.kind === 'CallExpr' &&
          stmt.expr.callee.kind === 'MemberExpr' &&
          stmt.expr.callee.target.kind === 'IdentExpr' &&
          stmt.expr.callee.target.name === 'db' &&
          (stmt.expr.callee.member === 'exec' || stmt.expr.callee.member === 'query')
        ) {
          const arg0 = stmt.expr.args[0]?.value;
          if (arg0 && arg0.kind === 'InterpStrExpr') {
            lints.push({
              code: 'W-SEC-001',
              severity: 'warning',
              message: 'Interpolated SQL string in db call risks SQL injection',
              line: stmt.line,
              col: 1,
              hint: 'Use parameterized placeholders ($1, $2) with an argument list.',
            });
          }
        }
        break;
      }
    }
  }

  for (const s of ast.stmts) checkStmt(s, 0);
  return lints;
}
