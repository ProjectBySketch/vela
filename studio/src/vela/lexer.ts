import { Token, TokenKind, Diagnostic } from './types';

const KEYWORDS: Record<string, TokenKind> = {
  let: 'LET',
  mut: 'MUT',
  const: 'CONST',
  static: 'STATIC',
  fn: 'FN',
  async: 'ASYNC',
  await: 'AWAIT',
  gen: 'GEN',
  yield: 'YIELD',
  spawn: 'SPAWN',
  struct: 'STRUCT',
  shared: 'SHARED',
  enum: 'ENUM',
  trait: 'TRAIT',
  impl: 'IMPL',
  type: 'TYPE',
  mod: 'MOD',
  use: 'USE',
  pub: 'PUB',
  match: 'MATCH',
  if: 'IF',
  else: 'ELSE',
  while: 'WHILE',
  for: 'FOR',
  in: 'IN',
  loop: 'LOOP',
  break: 'BREAK',
  continue: 'CONTINUE',
  return: 'RETURN',
  fail: 'FAIL',
  try: 'TRY',
  catch: 'CATCH',
  defer: 'DEFER',
  guard: 'GUARD',
  move: 'MOVE',
  unsafe: 'UNSAFE',
  comptime: 'COMPTIME',
  requires: 'REQUIRES',
  ensures: 'ENSURES',
  invariant: 'INVARIANT',
  where: 'WHERE',
  as: 'AS',
  is: 'IS',
  not: 'NOT',
  and: 'AND',
  or: 'OR',
  true: 'TRUE',
  false: 'FALSE',
  nil: 'NIL',
  theme: 'THEME',
  style: 'STYLE',
  view: 'VIEW',
  component: 'COMPONENT',
  page: 'PAGE',
  mmio: 'MMIO',
  scene3d: 'SCENE3D',
  shader: 'SHADER',
  state: 'STATE',
  when: 'WHEN',
  extends: 'EXTENDS',
};

const UNIT_SUFFIXES = new Set([
  'm', 'km', 'cm', 'mm', 's', 'ms', 'h', 'kg', 'g', 'dp', 'px', 'rem', 'money', 'usd', 'eur',
]);

export function lexVela(src: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const peek = (offset = 0) => (i + offset < n ? src[i + offset] : '\0');
  const advance = () => {
    const ch = src[i++];
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < n) {
    const c = peek();
    const d = peek(1);

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance();
      continue;
    }

    // Semicolon (ignored or emitted)
    if (c === ';') {
      tokens.push({ kind: 'SEMI', lexeme: ';', line, col });
      advance();
      continue;
    }

    // Attributes #[...] or #![...]
    if (c === '#' && d === '[') {
      const startCol = col;
      advance();
      advance();
      tokens.push({ kind: 'HASH_LBRACKET', lexeme: '#[', line, col: startCol });
      continue;
    }
    if (c === '#' && d === '!' && peek(2) === '[') {
      const startCol = col;
      advance();
      advance();
      advance();
      tokens.push({ kind: 'HASH_BANG_LBRACKET', lexeme: '#![', line, col: startCol });
      continue;
    }

    // Color literals #RRGGBB or #RRGGBBAA or #RGB (when hex digits follow #)
    if (c === '#' && /[0-9a-fA-F]{3,8}/.test(src.slice(i + 1, i + 9))) {
      // Check if it looks like a hex color (3, 4, 6, or 8 hex chars and not followed by space/comment prose)
      const match = src.slice(i + 1).match(/^([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
      if (match) {
        const startCol = col;
        let hex = '#';
        advance();
        for (let k = 0; k < match[1].length; k++) {
          hex += advance();
        }
        tokens.push({ kind: 'COLOR', lexeme: hex, value: hex, line, col: startCol });
        continue;
      }
    }

    // Comments: # ... or // ...
    if (c === '#' || (c === '/' && d === '/')) {
      while (i < n && peek() !== '\n') advance();
      continue;
    }

    // Block comments /* ... */ (supports nesting)
    if (c === '/' && d === '*') {
      let depth = 1;
      advance();
      advance();
      while (i < n && depth > 0) {
        if (peek() === '/' && peek(1) === '*') {
          depth++;
          advance();
          advance();
        } else if (peek() === '*' && peek(1) === '/') {
          depth--;
          advance();
          advance();
        } else {
          advance();
        }
      }
      continue;
    }

    // Raw string r"..."
    if (c === 'r' && d === '"') {
      const startLine = line;
      const startCol = col;
      advance(); // r
      advance(); // "
      let str = '';
      while (i < n && peek() !== '"') {
        str += advance();
      }
      if (peek() === '"') advance();
      else {
        diagnostics.push({ code: 'E-LEX-001', severity: 'error', message: 'Unterminated raw string', line: startLine, col: startCol });
      }
      tokens.push({ kind: 'STRING', lexeme: str, value: str, raw: 'raw', line: startLine, col: startCol });
      continue;
    }

    // Multi-line """...""" or regular string "..."
    if (c === '"') {
      const startLine = line;
      const startCol = col;
      if (d === '"' && peek(2) === '"') {
        advance(); advance(); advance();
        let str = '';
        while (i < n && !(peek() === '"' && peek(1) === '"' && peek(2) === '"')) {
          str += advance();
        }
        if (peek() === '"') { advance(); advance(); advance(); }
        tokens.push({ kind: 'STRING', lexeme: str, value: str, line: startLine, col: startCol });
        continue;
      }
      advance();
      let str = '';
      while (i < n && peek() !== '"') {
        const ch = advance();
        if (ch === '\\' && i < n) {
          const esc = advance();
          if (esc === 'n') str += '\n';
          else if (esc === 't') str += '\t';
          else if (esc === 'r') str += '\r';
          else if (esc === '"') str += '"';
          else if (esc === '\\') str += '\\';
          else if (esc === '$') str += '\\$'; // preserve escaped \$
          else str += esc;
        } else if (ch === '$' && peek() === '{') {
          // Keep ${...} intact in value so parser can split interpolations cleanly, tracking nested braces
          str += '${';
          advance();
          let braceDepth = 1;
          while (i < n && braceDepth > 0) {
            const ic = advance();
            if (ic === '{') braceDepth++;
            else if (ic === '}') braceDepth--;
            else if (ic === '"') {
              str += '"';
              while (i < n && peek() !== '"') {
                const sc = advance();
                str += sc;
                if (sc === '\\' && i < n) str += advance();
              }
              if (peek() === '"') str += advance();
              continue;
            }
            str += ic;
          }
        } else {
          str += ch;
        }
      }
      if (peek() === '"') advance();
      else {
        diagnostics.push({ code: 'E-LEX-002', severity: 'error', message: 'Unterminated string literal', line: startLine, col: startCol });
      }
      tokens.push({ kind: 'STRING', lexeme: str, value: str, line: startLine, col: startCol });
      continue;
    }

    // Char literal 'a'
    if (c === "'") {
      const startLine = line;
      const startCol = col;
      advance();
      let ch = '';
      if (peek() === '\\') {
        advance();
        const esc = advance();
        if (esc === 'n') ch = '\n';
        else if (esc === 't') ch = '\t';
        else if (esc === '0') ch = '\0';
        else ch = esc;
      } else if (i < n) {
        ch = advance();
      }
      if (peek() === "'") advance();
      tokens.push({ kind: 'CHAR', lexeme: ch, value: ch, line: startLine, col: startCol });
      continue;
    }

    // Numbers (hex, bin, oct, float, unit suffixes, percentage)
    if (/[0-9]/.test(c)) {
      const startLine = line;
      const startCol = col;
      let raw = '';
      if (c === '0' && (d === 'x' || d === 'X')) {
        raw += advance() + advance();
        while (i < n && /[0-9a-fA-F_]/.test(peek())) {
          const ch = advance();
          if (ch !== '_') raw += ch;
        }
        const val = parseInt(raw.slice(2), 16);
        // Optional type suffix like u8, u16, u32, u64, i64
        while (i < n && /[a-zA-Z0-9]/.test(peek())) advance();
        tokens.push({ kind: 'NUMBER', lexeme: raw, value: val, line: startLine, col: startCol });
        continue;
      }
      if (c === '0' && (d === 'b' || d === 'B')) {
        raw += advance() + advance();
        while (i < n && /[01_]/.test(peek())) {
          const ch = advance();
          if (ch !== '_') raw += ch;
        }
        const val = parseInt(raw.slice(2), 2);
        tokens.push({ kind: 'NUMBER', lexeme: raw, value: val, line: startLine, col: startCol });
        continue;
      }
      while (i < n && /[0-9_]/.test(peek())) {
        const ch = advance();
        if (ch !== '_') raw += ch;
      }
      // Decimal point (only if followed by digit, not range `..<` or method `10.abs()` or unit `5.m`)
      if (peek() === '.' && /[0-9]/.test(peek(1))) {
        raw += advance();
        while (i < n && /[0-9_]/.test(peek())) {
          const ch = advance();
          if (ch !== '_') raw += ch;
        }
      }
      // Scientific notation
      if ((peek() === 'e' || peek() === 'E') && /[0-9+\-]/.test(peek(1))) {
        raw += advance();
        if (peek() === '+' || peek() === '-') raw += advance();
        while (i < n && /[0-9_]/.test(peek())) {
          const ch = advance();
          if (ch !== '_') raw += ch;
        }
      }
      const numVal = Number(raw);
      // Unit suffix via dot: e.g. 5.m, 9.58.s, 0.0.km, 5.00.money
      if (peek() === '.' && /[a-zA-Z]/.test(peek(1))) {
        const saveI = i;
        const saveLine = line;
        const saveCol = col;
        advance(); // .
        let unitIdent = '';
        while (i < n && /[a-zA-Z0-9_]/.test(peek())) unitIdent += advance();
        if (UNIT_SUFFIXES.has(unitIdent)) {
          tokens.push({ kind: 'UNIT_NUMBER', lexeme: `${raw}.${unitIdent}`, value: numVal, unit: unitIdent, line: startLine, col: startCol });
          continue;
        } else {
          // Restore so it parses as member call like 5.toFloat()
          i = saveI;
          line = saveLine;
          col = saveCol;
        }
      }
      // Attached unit suffix like 14dp, 160ms, 100%, 1u8, 1.5f32
      if (peek() === '%') {
        advance();
        tokens.push({ kind: 'UNIT_NUMBER', lexeme: `${raw}%`, value: numVal, unit: '%', line: startLine, col: startCol });
        continue;
      }
      if (/[a-zA-Z]/.test(peek())) {
        let suffix = '';
        while (i < n && /[a-zA-Z0-9]/.test(peek())) suffix += advance();
        if (UNIT_SUFFIXES.has(suffix)) {
          tokens.push({ kind: 'UNIT_NUMBER', lexeme: `${raw}${suffix}`, value: numVal, unit: suffix, line: startLine, col: startCol });
          continue;
        }
        // e.g. u8, i32, f32, i64, usize
        tokens.push({ kind: 'NUMBER', lexeme: raw, value: numVal, line: startLine, col: startCol });
        continue;
      }
      tokens.push({ kind: 'NUMBER', lexeme: raw, value: numVal, line: startLine, col: startCol });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(c)) {
      const startLine = line;
      const startCol = col;
      let ident = '';
      while (i < n && /[a-zA-Z0-9_]/.test(peek())) {
        ident += advance();
      }
      // Special asm! macro
      if (ident === 'asm' && peek() === '!') {
        advance();
        tokens.push({ kind: 'IDENT', lexeme: 'asm!', line: startLine, col: startCol });
        continue;
      }
      const kind = KEYWORDS[ident] ?? 'IDENT';
      tokens.push({ kind, lexeme: ident, line: startLine, col: startCol });
      continue;
    }

    // Multi-char operators & punctuation
    const startCol = col;
    const two = c + d;
    const three = c + d + peek(2);

    if (three === '..<') { advance(); advance(); advance(); tokens.push({ kind: 'DOT_DOT_LT', lexeme: '..<', line, col: startCol }); continue; }
    if (three === '..=') { advance(); advance(); advance(); tokens.push({ kind: 'DOT_DOT_EQ', lexeme: '..=', line, col: startCol }); continue; }
    if (three === '...') { advance(); advance(); advance(); tokens.push({ kind: 'ELLIPSIS', lexeme: '...', line, col: startCol }); continue; }
    if (three === '??=') { advance(); advance(); advance(); tokens.push({ kind: 'Q_Q_EQ', lexeme: '??=', line, col: startCol }); continue; }

    if (two === '::') { advance(); advance(); tokens.push({ kind: 'COLON_COLON', lexeme: '::', line, col: startCol }); continue; }
    if (two === '->') { advance(); advance(); tokens.push({ kind: 'ARROW', lexeme: '->', line, col: startCol }); continue; }
    if (two === '=>') { advance(); advance(); tokens.push({ kind: 'FAT_ARROW', lexeme: '=>', line, col: startCol }); continue; }
    if (two === '|>') { advance(); advance(); tokens.push({ kind: 'PIPE_GT', lexeme: '|>', line, col: startCol }); continue; }
    if (two === '?.') { advance(); advance(); tokens.push({ kind: 'Q_DOT', lexeme: '?.', line, col: startCol }); continue; }
    if (two === '?[') { advance(); advance(); tokens.push({ kind: 'Q_LBRACKET', lexeme: '?[', line, col: startCol }); continue; }
    if (two === '??') { advance(); advance(); tokens.push({ kind: 'Q_Q', lexeme: '??', line, col: startCol }); continue; }
    if (two === '<<') { advance(); advance(); tokens.push({ kind: 'SHL', lexeme: '<<', line, col: startCol }); continue; }
    if (two === '>>') { advance(); advance(); tokens.push({ kind: 'SHR', lexeme: '>>', line, col: startCol }); continue; }
    if (two === '+=') { advance(); advance(); tokens.push({ kind: 'PLUS_EQ', lexeme: '+=', line, col: startCol }); continue; }
    if (two === '-=') { advance(); advance(); tokens.push({ kind: 'MINUS_EQ', lexeme: '-=', line, col: startCol }); continue; }
    if (two === '*=') { advance(); advance(); tokens.push({ kind: 'STAR_EQ', lexeme: '*=', line, col: startCol }); continue; }
    if (two === '/=') { advance(); advance(); tokens.push({ kind: 'SLASH_EQ', lexeme: '/=', line, col: startCol }); continue; }
    if (two === '==') { advance(); advance(); tokens.push({ kind: 'EQ', lexeme: '==', line, col: startCol }); continue; }
    if (two === '!=') { advance(); advance(); tokens.push({ kind: 'NE', lexeme: '!=', line, col: startCol }); continue; }
    if (two === '<=') { advance(); advance(); tokens.push({ kind: 'LE', lexeme: '<=', line, col: startCol }); continue; }
    if (two === '>=') { advance(); advance(); tokens.push({ kind: 'GE', lexeme: '>=', line, col: startCol }); continue; }
    if (two === '&&') { advance(); advance(); tokens.push({ kind: 'AND_AND', lexeme: '&&', line, col: startCol }); continue; }
    if (two === '||') { advance(); advance(); tokens.push({ kind: 'OR_OR', lexeme: '||', line, col: startCol }); continue; }

    const singleMap: Record<string, TokenKind> = {
      '(': 'LPAREN',
      ')': 'RPAREN',
      '{': 'LBRACE',
      '}': 'RBRACE',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      ',': 'COMMA',
      ':': 'COLON',
      '.': 'DOT',
      '@': 'AT',
      '?': 'QUESTION',
      '|': 'PIPE',
      '&': 'AMP',
      '^': 'CARET',
      '~': 'TILDE',
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '/': 'SLASH',
      '%': 'PERCENT',
      '=': 'ASSIGN',
      '<': 'LT',
      '>': 'GT',
      '!': 'BANG',
    };

    if (singleMap[c]) {
      advance();
      tokens.push({ kind: singleMap[c], lexeme: c, line, col: startCol });
      continue;
    }

    diagnostics.push({
      code: 'E-LEX-003',
      severity: 'warning',
      message: `Unexpected character '${c}'`,
      line,
      col: startCol,
    });
    advance();
  }

  tokens.push({ kind: 'EOF', lexeme: '', line, col });
  return { tokens, diagnostics };
}
