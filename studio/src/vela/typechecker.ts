import {
  BlockExpr,
  Diagnostic,
  Expr,
  ProgramAST,
  Stmt,
  TypeRef,
} from './types';

interface TypeEnv {
  vars: Map<string, { type: string; isMut: boolean }>;
  parent?: TypeEnv;
}

const VALID_STYLE_PROPS = new Set([
  'background', 'foreground', 'color', 'gap', 'pad', 'padding', 'margin', 'width', 'height',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'radius', 'border', 'shadow',
  'font', 'fontSize', 'fontWeight', 'lineHeight', 'lineClamp', 'align', 'alignSelf',
  'justify', 'dir', 'wrap', 'opacity', 'transition', 'transitionDuration', 'translateY',
  'translateX', 'scale', 'rotate', 'overflow', 'cursor', 'zIndex', 'weight',
]);

export function typecheckVela(ast: ProgramAST): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const structs = new Map<string, { fields: Map<string, { type: string; isMut: boolean }>; isShared: boolean; generics: string[] }>();
  const enums = new Map<string, { variants: Map<string, string[]>; generics: string[] }>();
  const traits = new Map<string, Set<string>>();
  const impls = new Map<string, Set<string>>(); // Type -> methods
  const fns = new Map<string, { params: string[]; ret: string; generics: string[] }>();
  const themes = new Set<string>();
  const styles = new Set<string>();

  const rootEnv: TypeEnv = { vars: new Map() };

  // Pre-seed builtin signatures
  const builtins: Record<string, { params: string[]; ret: string }> = {
    print: { params: ['Any'], ret: 'Void' },
    println: { params: ['Any'], ret: 'Void' },
    len: { params: ['Any'], ret: 'Int' },
    str: { params: ['Any'], ret: 'Str' },
    num: { params: ['Any'], ret: 'Float' },
    type: { params: ['Any'], ret: 'Str' },
    push: { params: ['List', 'Any'], ret: 'Void' },
    at: { params: ['List', 'Int'], ret: 'Any' },
    set: { params: ['List', 'Int', 'Any'], ret: 'Void' },
    range: { params: ['Int'], ret: 'List<Int>' },
    assert: { params: ['Bool'], ret: 'Void' },
    assertEq: { params: ['Any', 'Any'], ret: 'Void' },
    error: { params: ['Str'], ret: 'Never' },
    Ok: { params: ['Any'], ret: 'Result' },
    Err: { params: ['Any'], ret: 'Result' },
    Some: { params: ['Any'], ret: 'Option' },
    split: { params: ['Str', 'Str'], ret: 'List<Str>' },
    join: { params: ['List<Str>', 'Str'], ret: 'Str' },
    upper: { params: ['Str'], ret: 'Str' },
    lower: { params: ['Str'], ret: 'Str' },
    trim: { params: ['Str'], ret: 'Str' },
    contains: { params: ['Any', 'Any'], ret: 'Bool' },
    replace: { params: ['Str', 'Str', 'Str'], ret: 'Str' },
    startsWith: { params: ['Str', 'Str'], ret: 'Bool' },
    endsWith: { params: ['Str', 'Str'], ret: 'Bool' },
    indexOf: { params: ['Any', 'Any'], ret: 'Int' },
    keys: { params: ['Map'], ret: 'List<Str>' },
    values: { params: ['Map'], ret: 'List<Any>' },
    has: { params: ['Map', 'Str'], ret: 'Bool' },
    remove: { params: ['Map', 'Str'], ret: 'Void' },
    abs: { params: ['Float'], ret: 'Float' },
    sqrt: { params: ['Float'], ret: 'Float' },
    floor: { params: ['Float'], ret: 'Float' },
    ceil: { params: ['Float'], ret: 'Float' },
    unreachable: { params: [], ret: 'Never' },
  };
  for (const [k, v] of Object.entries(builtins)) {
    fns.set(k, { ...v, generics: [] });
  }

  function typeRefToStr(ref?: TypeRef): string {
    if (!ref) return 'Any';
    if (ref.kind === 'named') {
      if (ref.generics && ref.generics.length > 0) {
        return `${ref.name}<${ref.generics.map(typeRefToStr).join(', ')}>`;
      }
      return ref.name || 'Any';
    }
    if (ref.kind === 'optional') return `${typeRefToStr(ref.base)}?`;
    if (ref.kind === 'tensor') return `Tensor<${ref.dtype || 'Float32'}, [${(ref.shape || []).join(', ')}]>`;
    if (ref.kind === 'func') return `Func(${(ref.params || []).map(typeRefToStr).join(', ')}) -> ${typeRefToStr(ref.ret)}`;
    if (ref.kind === 'tuple') return `(${(ref.elements || []).map(typeRefToStr).join(', ')})`;
    if (ref.kind === 'array') return `[${typeRefToStr(ref.base)}; ${ref.size ?? ''}]`;
    if (ref.kind === 'union') return (ref.members || []).map(typeRefToStr).join(' | ');
    return 'Any';
  }

  function lookupVar(env: TypeEnv, name: string): { type: string; isMut: boolean } | undefined {
    let cur: TypeEnv | undefined = env;
    while (cur) {
      const found = cur.vars.get(name);
      if (found) return found;
      cur = cur.parent;
    }
    return undefined;
  }

  function isUnitCompatible(t1: string, t2: string): boolean {
    if (t1.startsWith('Unit<') && t2.startsWith('Unit<')) {
      return t1 === t2;
    }
    return true;
  }

  // Pass 1: Collect top-level types, functions, themes, styles
  function collectDecl(stmt: Stmt) {
    if (stmt.kind === 'StructStmt') {
      const fields = new Map<string, { type: string; isMut: boolean }>();
      for (const f of stmt.fields) {
        fields.set(f.name, { type: typeRefToStr(f.typeAnn), isMut: f.isMut });
      }
      structs.set(stmt.name, { fields, isShared: stmt.isShared, generics: stmt.generics.map((g) => g.name) });
    } else if (stmt.kind === 'EnumStmt') {
      const variants = new Map<string, string[]>();
      for (const v of stmt.variants) {
        variants.set(v.name, v.fields.map((f) => typeRefToStr(f.typeAnn)));
      }
      enums.set(stmt.name, { variants, generics: stmt.generics.map((g) => g.name) });
    } else if (stmt.kind === 'TraitStmt') {
      const mset = new Set<string>();
      for (const m of stmt.methods) mset.add(m.name);
      traits.set(stmt.name, mset);
    } else if (stmt.kind === 'ImplStmt') {
      if (!impls.has(stmt.targetName)) impls.set(stmt.targetName, new Set());
      const mset = impls.get(stmt.targetName)!;
      for (const m of stmt.methods) mset.add(m.name);
      if (stmt.traitName && traits.has(stmt.traitName)) {
        const req = traits.get(stmt.traitName)!;
        for (const r of req) {
          if (!mset.has(r)) {
            // Check if trait has default body? Only warn/info if missing
          }
        }
      }
    } else if (stmt.kind === 'FnStmt') {
      fns.set(stmt.name, {
        params: stmt.params.map((p) => typeRefToStr(p.typeAnn)),
        ret: typeRefToStr(stmt.retType),
        generics: stmt.generics.map((g) => g.name),
      });
    } else if (stmt.kind === 'ThemeStmt') {
      themes.add(stmt.name);
    } else if (stmt.kind === 'StyleStmt') {
      styles.add(stmt.name);
      for (const p of stmt.props) {
        if (!VALID_STYLE_PROPS.has(p.key)) {
          diagnostics.push({
            code: 'E-STYLE-001',
            severity: 'error',
            message: `Unknown style property '${p.key}' in style '${stmt.name}'`,
            line: stmt.line,
            col: 1,
            hint: 'Vela styles accept only the checked property schema (doc 13).',
          });
        }
      }
    } else if (stmt.kind === 'ModStmt') {
      for (const s of stmt.body) collectDecl(s);
    }
  }

  for (const s of ast.stmts) collectDecl(s);

  // Pass 2: Check statements & expressions
  function checkBlock(block: BlockExpr, env: TypeEnv): string {
    const child: TypeEnv = { vars: new Map(), parent: env };
    for (const s of block.stmts) {
      checkStmt(s, child);
    }
    if (block.tail) {
      return checkExpr(block.tail, child);
    }
    return 'Void';
  }

  function checkStmt(stmt: Stmt, env: TypeEnv) {
    switch (stmt.kind) {
      case 'ConstStmt': {
        const vt = checkExpr(stmt.value, env);
        const ann = stmt.typeAnn ? typeRefToStr(stmt.typeAnn) : vt;
        env.vars.set(stmt.name, { type: ann, isMut: false });
        break;
      }
      case 'StaticStmt': {
        const vt = checkExpr(stmt.value, env);
        env.vars.set(stmt.name, { type: stmt.typeAnn ? typeRefToStr(stmt.typeAnn) : vt, isMut: stmt.isMut });
        break;
      }
      case 'LetStmt': {
        const vt = checkExpr(stmt.value, env);
        const ann = stmt.typeAnn ? typeRefToStr(stmt.typeAnn) : vt;
        if (ast.strict && stmt.typeAnn && !typesCompatible(ann, vt)) {
          diagnostics.push({
            code: 'E-TYPE-001',
            severity: 'error',
            message: `Type mismatch in '${stmt.name}': expected '${ann}', got '${vt}'`,
            line: stmt.line,
            col: 1,
          });
        }
        if (stmt.pattern) {
          for (const p of stmt.pattern) env.vars.set(p, { type: 'Any', isMut: stmt.isMut });
        } else {
          env.vars.set(stmt.name, { type: ann, isMut: stmt.isMut });
        }
        break;
      }
      case 'AssignStmt': {
        if (stmt.target.kind === 'IdentExpr') {
          const v = lookupVar(env, stmt.target.name);
          if (v && !v.isMut) {
            diagnostics.push({
              code: 'E-MUT-001',
              severity: 'error',
              message: `Cannot assign to immutable binding '${stmt.target.name}' (declare with 'mut')`,
              line: stmt.line,
              col: 1,
              hint: `Change 'let ${stmt.target.name}' to 'mut ${stmt.target.name}'`,
            });
          }
        }
        checkExpr(stmt.target, env);
        checkExpr(stmt.value, env);
        break;
      }
      case 'FnStmt': {
        const fnEnv: TypeEnv = { vars: new Map(), parent: env };
        for (const g of stmt.generics) {
          fnEnv.vars.set(g.name, { type: 'GenericType', isMut: false });
        }
        for (const p of stmt.params) {
          fnEnv.vars.set(p.name, { type: typeRefToStr(p.typeAnn), isMut: !!p.isMut });
        }
        checkBlock(stmt.body, fnEnv);
        break;
      }
      case 'ImplStmt': {
        for (const m of stmt.methods) checkStmt(m, env);
        break;
      }
      case 'ModStmt': {
        const modEnv: TypeEnv = { vars: new Map(), parent: env };
        for (const s of stmt.body) checkStmt(s, modEnv);
        break;
      }
      case 'IfStmt': {
        checkExpr(stmt.cond, env);
        checkBlock(stmt.thenBranch, env);
        if (stmt.elseBranch) {
          if (stmt.elseBranch.kind === 'BlockExpr') checkBlock(stmt.elseBranch, env);
          else checkStmt(stmt.elseBranch, env);
        }
        break;
      }
      case 'WhileStmt': {
        checkExpr(stmt.cond, env);
        checkBlock(stmt.body, env);
        break;
      }
      case 'LoopStmt': {
        checkBlock(stmt.body, env);
        break;
      }
      case 'ForStmt': {
        checkExpr(stmt.iter, env);
        const child: TypeEnv = { vars: new Map(), parent: env };
        for (const p of stmt.pattern) child.vars.set(p, { type: 'Any', isMut: false });
        checkBlock(stmt.body, child);
        break;
      }
      case 'ReturnStmt':
      case 'FailStmt':
      case 'YieldStmt':
      case 'BreakStmt':
        if (stmt.value) checkExpr(stmt.value, env);
        break;
      case 'DeferStmt':
        if (stmt.body.kind === 'BlockExpr') checkBlock(stmt.body, env);
        else checkExpr(stmt.body, env);
        break;
      case 'GuardStmt':
        checkExpr(stmt.cond, env);
        if (stmt.isLet && stmt.letName) env.vars.set(stmt.letName, { type: 'Any', isMut: false });
        checkBlock(stmt.elseBranch, env);
        break;
      case 'ExprStmt':
        checkExpr(stmt.expr, env);
        break;
    }
  }

  function typesCompatible(expected: string, actual: string): boolean {
    if (expected === 'Any' || actual === 'Any' || expected === 'Never' || actual === 'Never') return true;
    if (expected === actual) return true;
    if (expected === 'Float' && (actual === 'Int' || actual === 'Float')) return true;
    if (expected === 'Num' && (actual === 'Int' || actual === 'Float' || actual === 'Num')) return true;
    if (expected.endsWith('?') && (actual === 'Nil' || typesCompatible(expected.slice(0, -1), actual))) return true;
    if (expected.startsWith('List<') && actual.startsWith('List')) return true;
    if (expected.startsWith('Tensor<') && actual.startsWith('Tensor')) {
      // Check tensor static shape compatibility if both specify dimensions
      const eShape = expected.match(/\[(.*?)\]/)?.[1]?.split(',').map((s) => s.trim());
      const aShape = actual.match(/\[(.*?)\]/)?.[1]?.split(',').map((s) => s.trim());
      if (eShape && aShape && eShape.length === aShape.length) {
        for (let i = 0; i < eShape.length; i++) {
          if (eShape[i] !== '?' && aShape[i] !== '?' && eShape[i] !== aShape[i]) {
            return false;
          }
        }
      }
      return true;
    }
    return false;
  }

  function checkExpr(expr: Expr, env: TypeEnv): string {
    switch (expr.kind) {
      case 'LiteralExpr':
        if (expr.unit) {
          if (expr.unit === 'money' || expr.unit === 'usd' || expr.unit === 'eur') return 'Money';
          if (expr.unit === 'm' || expr.unit === 'km' || expr.unit === 'cm') return 'Unit<Length>';
          if (expr.unit === 's' || expr.unit === 'ms' || expr.unit === 'h') return 'Unit<Time>';
          if (expr.unit === 'kg' || expr.unit === 'g') return 'Unit<Mass>';
          return `Unit<${expr.unit}>`;
        }
        if (expr.litType === 'num') return Number.isInteger(expr.value) ? 'Int' : 'Float';
        if (expr.litType === 'str') return 'Str';
        if (expr.litType === 'bool') return 'Bool';
        if (expr.litType === 'nil') return 'Nil';
        if (expr.litType === 'char') return 'Char';
        if (expr.litType === 'color') return 'Color';
        return 'Any';
      case 'InterpStrExpr':
        for (const p of expr.parts) if (p.type === 'expr') checkExpr(p.expr, env);
        return 'Str';
      case 'IdentExpr': {
        const v = lookupVar(env, expr.name);
        if (v) return v.type;
        if (fns.has(expr.name)) return 'Func';
        return 'Any';
      }
      case 'BinaryExpr': {
        const lt = checkExpr(expr.left, env);
        const rt = checkExpr(expr.right, env);
        if ((expr.op === '+' || expr.op === '-') && lt.startsWith('Unit<') && rt.startsWith('Unit<') && !isUnitCompatible(lt, rt)) {
          diagnostics.push({
            code: 'E-UNIT-001',
            severity: 'error',
            message: `Incompatible unit dimensions: cannot apply '${expr.op}' to ${lt} and ${rt}`,
            line: expr.line,
            col: 1,
          });
        }
        if (expr.op === '/' && lt === 'Unit<Length>' && rt === 'Unit<Time>') return 'Unit<Velocity>';
        if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(expr.op)) return 'Bool';
        if (lt === 'Str' && expr.op === '+') return 'Str';
        if (lt === 'Float' || rt === 'Float') return 'Float';
        return lt !== 'Any' ? lt : rt;
      }
      case 'ListExpr':
        for (const it of expr.items) checkExpr(it, env);
        return 'List<Any>';
      case 'ListCompExpr': {
        const child: TypeEnv = { vars: new Map(), parent: env };
        child.vars.set(expr.varName, { type: 'Any', isMut: false });
        checkExpr(expr.iter, env);
        if (expr.cond) checkExpr(expr.cond, child);
        checkExpr(expr.body, child);
        return 'List<Any>';
      }
      case 'CallExpr': {
        for (const a of expr.args) checkExpr(a.value, env);
        if (expr.callee.kind === 'IdentExpr') {
          const fnInfo = fns.get(expr.callee.name);
          if (fnInfo) return fnInfo.ret;
        }
        if (expr.callee.kind === 'MemberExpr' && expr.callee.target.kind === 'IdentExpr' && expr.callee.target.name === 'tensor' && expr.callee.member === 'zeros') {
          const arg0 = expr.args[0]?.value;
          if (arg0 && arg0.kind === 'ListExpr') {
            const dims = arg0.items.map((x) => (x.kind === 'LiteralExpr' ? String(x.value) : '?'));
            return `Tensor<Float32, [${dims.join(', ')}]>`;
          }
        }
        return 'Any';
      }
      case 'ClosureExpr': {
        const child: TypeEnv = { vars: new Map(), parent: env };
        for (const p of expr.params) child.vars.set(p, { type: 'Any', isMut: false });
        if (expr.body.kind === 'BlockExpr') checkBlock(expr.body, child);
        else checkExpr(expr.body, child);
        return 'Func';
      }
      case 'MatchExpr': {
        checkExpr(expr.target, env);
        let hasCatchAll = false;
        for (const arm of expr.arms) {
          const child: TypeEnv = { vars: new Map(), parent: env };
          for (const pat of arm.patterns) {
            if (pat.kind === 'Wildcard' || pat.kind === 'Ident') hasCatchAll = true;
            if (pat.kind === 'Enum') {
              for (const b of pat.bindings) child.vars.set(b, { type: 'Any', isMut: false });
            }
          }
          if (arm.guard) checkExpr(arm.guard, child);
          if (arm.body.kind === 'BlockExpr') checkBlock(arm.body, child);
          else checkExpr(arm.body, child);
        }
        if (ast.strict && !hasCatchAll && expr.arms.length < 2) {
          diagnostics.push({
            code: 'E-MATCH-001',
            severity: 'warning',
            message: 'Match expression may not be exhaustive; consider adding a wildcard _ arm',
            line: expr.line,
            col: 1,
          });
        }
        return 'Any';
      }
      case 'BlockExpr':
        return checkBlock(expr, env);
      case 'IfExpr': {
        checkExpr(expr.cond, env);
        const t1 = checkBlock(expr.thenBranch, env);
        if (expr.elseBranch) checkExpr(expr.elseBranch, env);
        return t1;
      }
      case 'ComptimeExpr':
      case 'UnsafeExpr':
        return checkBlock(expr.body, env);
      case 'StructLitExpr':
        return expr.name;
      default:
        return 'Any';
    }
  }

  for (const s of ast.stmts) {
    checkStmt(s, rootEnv);
  }

  return diagnostics;
}
