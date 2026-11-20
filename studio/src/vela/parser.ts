import {
  Attribute,
  BlockExpr,
  Diagnostic,
  EnumVariant,
  Expr,
  FnParam,
  FnStmt,
  GenericParam,
  MatchArm,
  MatchPattern,
  ProgramAST,
  Stmt,
  StructField,
  StyleProp,
  Token,
  TokenKind,
  TypeRef,
  UiBodyItem,
  UiNodeExpr,
} from './types';
import { lexVela } from './lexer';

export function parseVela(tokens: Token[]): { ast: ProgramAST; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  let pos = 0;
  let strict = false;
  let noStructLit = false; // prevents `if x {` or `for x in y {` from parsing `x {` as struct literal

  const peek = (offset = 0): Token => tokens[Math.min(pos + offset, tokens.length - 1)];
  const check = (kind: TokenKind, offset = 0): boolean => peek(offset).kind === kind;
  const advance = (): Token => {
    const t = peek();
    if (pos < tokens.length - 1) pos++;
    return t;
  };
  const match = (...kinds: TokenKind[]): boolean => {
    if (kinds.includes(peek().kind)) {
      advance();
      return true;
    }
    return false;
  };
  const skipSemis = () => {
    while (check('SEMI')) advance();
  };
  const expect = (kind: TokenKind, msg: string): Token => {
    if (check(kind)) return advance();
    const t = peek();
    diagnostics.push({
      code: 'E-PARSE-001',
      severity: 'error',
      message: `${msg} (got '${t.lexeme || t.kind}')`,
      line: t.line,
      col: t.col,
    });
    return t;
  };

  function parseProgram(): ProgramAST {
    const stmts: Stmt[] = [];
    while (!check('EOF')) {
      skipSemis();
      if (check('EOF')) break;
      if (check('HASH_BANG_LBRACKET')) {
        advance();
        const attrName = expectIdentLike();
        if (attrName === 'strict') strict = true;
        while (!check('RBRACKET') && !check('EOF')) advance();
        match('RBRACKET');
        continue;
      }
      try {
        stmts.push(parseTopStmt());
      } catch (e) {
        // Recover to next statement
        diagnostics.push({
          code: 'E-PARSE-002',
          severity: 'error',
          message: e instanceof Error ? e.message : 'Syntax error',
          line: peek().line,
          col: peek().col,
        });
        advance();
      }
      skipSemis();
    }
    return { strict, stmts };
  }

  function expectIdentLike(): string {
    const t = peek();
    if (
      t.kind === 'IDENT' ||
      t.kind === 'TYPE' ||
      t.kind === 'STATE' ||
      t.kind === 'WHEN' ||
      t.kind === 'STYLE' ||
      t.kind === 'VIEW' ||
      t.kind === 'COMPONENT' ||
      t.kind === 'PAGE' ||
      t.kind === 'THEME' ||
      t.kind === 'IN' ||
      t.kind === 'IS' ||
      t.kind === 'SHARED' ||
      t.kind === 'SPAWN'
    ) {
      advance();
      return t.lexeme;
    }
    return expect('IDENT', 'Expected identifier').lexeme;
  }

  function parseAttributes(): Attribute[] {
    const attrs: Attribute[] = [];
    while (check('HASH_LBRACKET') || (check('AT') && (check('IDENT', 1) || check('WHEN', 1)))) {
      if (check('HASH_LBRACKET')) {
        const line = advance().line;
        const name = expectIdentLike();
        const args: string[] = [];
        if (match('LPAREN')) {
          while (!check('RPAREN') && !check('EOF')) {
            args.push(advance().lexeme);
            match('COMMA');
          }
          match('RPAREN');
        }
        match('RBRACKET');
        attrs.push({ name, args, line });
      } else if (check('AT')) {
        const line = advance().line;
        const name = expectIdentLike();
        const args: string[] = [];
        if (match('LPAREN')) {
          while (!check('RPAREN') && !check('EOF')) {
            const tok = advance();
            args.push(tok.value !== undefined ? String(tok.value) : tok.lexeme);
            match('COMMA');
          }
          match('RPAREN');
        }
        attrs.push({ name, args, line });
      }
    }
    return attrs;
  }

  function parseTopStmt(): Stmt {
    const attrs = parseAttributes();
    let isPub = false;
    if (match('PUB')) {
      isPub = true;
      if (match('LPAREN')) {
        while (!check('RPAREN') && !check('EOF')) advance();
        match('RPAREN');
      }
    }

    if (check('USE')) return parseUseStmt();
    if (check('MOD')) return parseModStmt(isPub);
    if (check('CONST')) return parseConstStmt(isPub);
    if (check('STATIC')) return parseStaticStmt();
    if (check('TYPE')) return parseTypeAliasStmt();
    if (check('STRUCT') || (check('SHARED') && check('STRUCT', 1))) return parseStructStmt(isPub, attrs);
    if (check('ENUM')) return parseEnumStmt(isPub, attrs);
    if (check('TRAIT')) return parseTraitStmt();
    if (check('IMPL')) return parseImplStmt();
    if (check('FN') || (check('ASYNC') && check('FN', 1)) || (check('GEN') && check('FN', 1))) {
      return parseFnStmt(isPub, attrs);
    }
    if (check('THEME')) return parseThemeStmt();
    if (check('STYLE')) return parseStyleStmt();
    if (check('VIEW') || check('COMPONENT') || check('PAGE')) return parseUiDeclStmt(attrs);
    if (check('MMIO')) return parseMmioStmt();
    if (check('SCENE3D')) return parseScene3DStmt();
    if (check('SHADER')) return parseShaderStmt();

    return parseStmt();
  }

  function parseUseStmt(): Stmt {
    const line = advance().line; // use
    const path: string[] = [expectIdentLike()];
    let items: string[] | undefined;
    let alias: string | undefined;
    while (match('COLON_COLON')) {
      if (match('STAR')) {
        items = ['*'];
        break;
      }
      if (match('LBRACE')) {
        items = [];
        while (!check('RBRACE') && !check('EOF')) {
          items.push(expectIdentLike());
          match('COMMA');
        }
        expect('RBRACE', 'Expected } in use list');
        break;
      }
      path.push(expectIdentLike());
    }
    if (match('AS')) alias = expectIdentLike();
    return { kind: 'UseStmt', path, items, alias, line };
  }

  function parseModStmt(isPub: boolean): Stmt {
    const line = advance().line; // mod
    const name = expectIdentLike();
    expect('LBRACE', 'Expected { after mod name');
    const body: Stmt[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      body.push(parseTopStmt());
      skipSemis();
    }
    expect('RBRACE', 'Expected } at end of mod');
    return { kind: 'ModStmt', name, body, isPub, line };
  }

  function parseConstStmt(isPub: boolean): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    let typeAnn: TypeRef | undefined;
    if (match('COLON')) typeAnn = parseTypeRef();
    expect('ASSIGN', 'Expected = in const');
    const value = parseExpr();
    return { kind: 'ConstStmt', name, typeAnn, value, isPub, line };
  }

  function parseStaticStmt(): Stmt {
    const line = advance().line;
    const isMut = match('MUT');
    const name = expectIdentLike();
    let typeAnn: TypeRef | undefined;
    if (match('COLON')) typeAnn = parseTypeRef();
    expect('ASSIGN', 'Expected = in static');
    const value = parseExpr();
    return { kind: 'StaticStmt', name, isMut, typeAnn, value, line };
  }

  function parseTypeAliasStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    expect('ASSIGN', 'Expected = in type alias');
    const typeAnn = parseTypeRef();
    let refinement: Expr | undefined;
    if (match('IN')) {
      refinement = parseExpr();
    }
    return { kind: 'TypeAliasStmt', name, typeAnn, refinement, line };
  }

  function parseGenericParams(): GenericParam[] {
    const params: GenericParam[] = [];
    if (!match('LT')) return params;
    while (!check('GT') && !check('EOF')) {
      const name = expectIdentLike();
      const bounds: string[] = [];
      if (match('COLON')) {
        bounds.push(expectIdentLike());
        while (match('PLUS')) bounds.push(expectIdentLike());
      }
      params.push({ name, bounds });
      if (!match('COMMA')) break;
    }
    expect('GT', 'Expected > after generic parameters');
    return params;
  }

  function parseTypeRef(): TypeRef {
    let ref: TypeRef;
    if (check('LPAREN')) {
      advance();
      const elements: TypeRef[] = [];
      while (!check('RPAREN') && !check('EOF')) {
        elements.push(parseTypeRef());
        if (!match('COMMA')) break;
      }
      expect('RPAREN', 'Expected ) in tuple type');
      ref = { kind: 'tuple', elements };
    } else if (check('LBRACKET')) {
      advance();
      const elem = parseTypeRef();
      let size: number | string | undefined;
      if (match('SEMI')) {
        size = advance().lexeme;
      }
      expect('RBRACKET', 'Expected ] in array type');
      ref = { kind: 'array', base: elem, size };
    } else {
      const name = expectIdentLike();
      if (name === 'Func' && check('LPAREN')) {
        advance();
        const params: TypeRef[] = [];
        while (!check('RPAREN') && !check('EOF')) {
          params.push(parseTypeRef());
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected ) in Func type');
        let ret: TypeRef = { kind: 'named', name: 'Void' };
        if (match('ARROW')) ret = parseTypeRef();
        ref = { kind: 'func', params, ret };
      } else if (name === 'Tensor' && match('LT')) {
        const dtype = expectIdentLike();
        let shape: (number | string)[] = [];
        if (match('COMMA') && match('LBRACKET')) {
          while (!check('RBRACKET') && !check('EOF')) {
            const t = advance();
            shape.push(t.kind === 'NUMBER' ? Number(t.value) : t.lexeme);
            match('COMMA');
          }
          expect('RBRACKET', 'Expected ] in Tensor shape');
        }
        expect('GT', 'Expected > in Tensor type');
        ref = { kind: 'tensor', dtype, shape };
      } else {
        const generics: TypeRef[] = [];
        if (match('LT')) {
          while (!check('GT') && !check('EOF')) {
            if (check('LBRACKET')) {
              // e.g. Tensor<[?, 784]> or nested shape
              generics.push(parseTypeRef());
            } else {
              generics.push(parseTypeRef());
            }
            if (!match('COMMA')) break;
          }
          expect('GT', 'Expected > in generic type');
        }
        // Handle Linear(784, 256) style constructor-like type in #[derive(Module)]
        if (check('LPAREN')) {
          advance();
          const dims: string[] = [];
          while (!check('RPAREN') && !check('EOF')) {
            dims.push(advance().lexeme);
            match('COMMA');
          }
          expect('RPAREN', 'Expected )');
          ref = { kind: 'named', name: `${name}(${dims.join(',')})`, generics };
        } else {
          ref = { kind: 'named', name, generics };
        }
      }
    }
    while (match('QUESTION')) {
      ref = { kind: 'optional', base: ref };
    }
    if (match('PIPE')) {
      const right = parseTypeRef();
      ref = { kind: 'union', members: [ref, right] };
    }
    return ref;
  }

  function parseStructStmt(isPub: boolean, attrs: Attribute[]): Stmt {
    const isShared = match('SHARED');
    const line = expect('STRUCT', 'Expected struct').line;
    const name = expectIdentLike();
    const generics = parseGenericParams();
    expect('LBRACE', 'Expected { in struct');
    const fields: StructField[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      const isMut = match('MUT');
      const fname = expectIdentLike();
      expect('COLON', 'Expected : after field name');
      const typeAnn = parseTypeRef();
      let defaultVal: Expr | undefined;
      if (match('ASSIGN')) defaultVal = parseExpr();
      fields.push({ name: fname, isMut, typeAnn, defaultVal });
      match('COMMA');
      skipSemis();
    }
    expect('RBRACE', 'Expected } at end of struct');
    return { kind: 'StructStmt', name, isShared, isPub, generics, fields, attrs, line };
  }

  function parseEnumStmt(isPub: boolean, attrs: Attribute[]): Stmt {
    const line = advance().line; // enum
    const name = expectIdentLike();
    const generics = parseGenericParams();
    expect('LBRACE', 'Expected { in enum');
    const variants: EnumVariant[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      const vname = expectIdentLike();
      const fields: { name?: string; typeAnn: TypeRef }[] = [];
      if (match('LPAREN')) {
        while (!check('RPAREN') && !check('EOF')) {
          if ((check('IDENT') || check('TYPE')) && check('COLON', 1)) {
            const fn = advance().lexeme;
            advance(); // :
            fields.push({ name: fn, typeAnn: parseTypeRef() });
          } else {
            fields.push({ typeAnn: parseTypeRef() });
          }
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected ) in enum variant');
      }
      variants.push({ name: vname, fields });
      match('COMMA');
      skipSemis();
    }
    expect('RBRACE', 'Expected } in enum');
    return { kind: 'EnumStmt', name, isPub, generics, variants, attrs, line };
  }

  function parseTraitStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    const generics = parseGenericParams();
    expect('LBRACE', 'Expected { in trait');
    const methods: FnStmt[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      methods.push(parseFnHeaderAndMaybeBody(true));
      skipSemis();
    }
    expect('RBRACE', 'Expected } in trait');
    return { kind: 'TraitStmt', name, generics, methods, line };
  }

  function parseImplStmt(): Stmt {
    const line = advance().line;
    const generics = parseGenericParams();
    const first = expectIdentLike();
    // Skip generic args on trait/type
    if (check('LT')) parseGenericParams();
    let traitName: string | undefined;
    let targetName = first;
    if (check('IDENT') && peek().lexeme === 'for') {
      advance();
      traitName = first;
      targetName = expectIdentLike();
      if (check('LT')) parseGenericParams();
    }
    expect('LBRACE', 'Expected { in impl');
    const methods: FnStmt[] = [];
    const invariants: Expr[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      if (match('INVARIANT')) {
        invariants.push(parseExpr());
        skipSemis();
        continue;
      }
      const attrs = parseAttributes();
      const isPub = match('PUB');
      methods.push(parseFnStmt(isPub, attrs));
      skipSemis();
    }
    expect('RBRACE', 'Expected } in impl');
    return { kind: 'ImplStmt', traitName, targetName, generics, methods, invariants, line };
  }

  function parseFnHeaderAndMaybeBody(allowEmptyBody: boolean): FnStmt {
    const isAsync = match('ASYNC');
    const isGen = match('GEN');
    const line = expect('FN', 'Expected fn').line;
    const name = expectIdentLike();
    const generics = parseGenericParams();
    expect('LPAREN', 'Expected ( after function name');
    const params: FnParam[] = [];
    while (!check('RPAREN') && !check('EOF')) {
      const isMut = match('MUT');
      const isConsuming = check('IDENT') && peek().lexeme === 'consuming' ? (advance(), true) : false;
      const pname = expectIdentLike();
      let typeAnn: TypeRef | undefined;
      if (match('COLON')) {
        // Handle `account: mut Account`
        match('MUT');
        typeAnn = parseTypeRef();
      }
      let defaultVal: Expr | undefined;
      if (match('ASSIGN')) defaultVal = parseExpr();
      params.push({ name: pname, isMut, isConsuming, typeAnn, defaultVal });
      if (!match('COMMA')) break;
    }
    expect('RPAREN', 'Expected ) after parameters');
    let retType: TypeRef | undefined;
    if (match('ARROW')) retType = parseTypeRef();
    const requires: Expr[] = [];
    const ensures: Expr[] = [];
    while (check('REQUIRES') || check('ENSURES') || check('WHERE')) {
      if (match('REQUIRES')) requires.push(parseExpr());
      else if (match('ENSURES')) ensures.push(parseExpr());
      else if (match('WHERE')) {
        // skip where clause bounds
        while (!check('LBRACE') && !check('EOF')) advance();
      }
    }
    let body: BlockExpr = { kind: 'BlockExpr', stmts: [], line };
    if (check('LBRACE')) {
      body = parseBlockExpr();
    } else if (!allowEmptyBody) {
      expect('LBRACE', 'Expected { for function body');
    }
    return { kind: 'FnStmt', name, isAsync, isGen, generics, params, retType, requires, ensures, attrs: [], body, line };
  }

  function parseFnStmt(isPub: boolean, attrs: Attribute[]): FnStmt {
    const fn = parseFnHeaderAndMaybeBody(false);
    fn.isPub = isPub;
    fn.attrs = attrs;
    return fn;
  }

  function parseThemeStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    let parent: string | undefined;
    if (match('EXTENDS')) parent = expectIdentLike();
    expect('LBRACE', 'Expected { in theme');
    const tokensList: { key: string; value: Expr }[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      let key = expectIdentLike();
      while (match('DOT')) key += '.' + expectIdentLike();
      expect('ASSIGN', 'Expected = in theme token');
      const value = parseExpr();
      tokensList.push({ key, value });
      skipSemis();
    }
    expect('RBRACE', 'Expected } in theme');
    return { kind: 'ThemeStmt', name, parent, tokens: tokensList, line };
  }

  function parseStylePropValue(): Expr {
    // Handles values like `1dp solid token.line` or `token.space.md` or `row`
    const first = parseExpr();
    if (!check('RBRACE') && !check('SEMI') && !check('WHEN') && !check('AT') && peek().line === (first as { line: number }).line) {
      // Multi-token CSS-like value such as `1dp solid token.line` or `background, shadow`
      const parts: Expr[] = [first];
      while (
        !check('RBRACE') &&
        !check('SEMI') &&
        !check('WHEN') &&
        !check('AT') &&
        !check('EOF') &&
        peek().line === (first as { line: number }).line
      ) {
        if (check('IDENT') && check('COLON', 1)) break; // next prop on same line
        if (match('COMMA')) {
          parts.push(parseExpr());
        } else {
          parts.push(parseExpr());
        }
      }
      if (parts.length > 1) {
        return { kind: 'TupleExpr', items: parts, line: (first as { line: number }).line };
      }
    }
    return first;
  }

  function parseStylePropsBlock(): { props: StyleProp[]; states: { state: string; props: StyleProp[] }[]; media: { cond: string; props: StyleProp[] }[] } {
    expect('LBRACE', 'Expected { in style');
    const props: StyleProp[] = [];
    const states: { state: string; props: StyleProp[] }[] = [];
    const media: { cond: string; props: StyleProp[] }[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      if (match('WHEN')) {
        match('DOT');
        const stateName = expectIdentLike();
        const nested = parseStylePropsBlock();
        states.push({ state: stateName, props: nested.props });
        continue;
      }
      if (check('AT') && check('WHEN', 1)) {
        advance(); advance();
        let cond = '';
        while (!check('LBRACE') && !check('EOF')) {
          cond += (cond ? ' ' : '') + advance().lexeme;
        }
        const nested = parseStylePropsBlock();
        media.push({ cond, props: nested.props });
        continue;
      }
      const key = expectIdentLike();
      expect('COLON', 'Expected : in style property');
      const value = parseStylePropValue();
      props.push({ key, value });
      skipSemis();
    }
    expect('RBRACE', 'Expected } in style');
    return { props, states, media };
  }

  function parseStyleStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    let parent: string | undefined;
    if (match('EXTENDS')) parent = expectIdentLike();
    const { props, states, media } = parseStylePropsBlock();
    return { kind: 'StyleStmt', name, parent, props, states, media, line };
  }

  function parseUiDeclStmt(attrs: Attribute[]): Stmt {
    const kw = advance();
    const uiKind = kw.lexeme as 'view' | 'component' | 'page';
    const name = expectIdentLike();
    expect('LPAREN', 'Expected ( in UI declaration');
    const params: FnParam[] = [];
    while (!check('RPAREN') && !check('EOF')) {
      const pname = expectIdentLike();
      let typeAnn: TypeRef | undefined;
      if (match('COLON')) typeAnn = parseTypeRef();
      let defaultVal: Expr | undefined;
      if (match('ASSIGN')) defaultVal = parseExpr();
      params.push({ name: pname, typeAnn, defaultVal });
      if (!match('COMMA')) break;
    }
    expect('RPAREN', 'Expected )');
    let isIsland = false;
    if (check('AT') && check('IDENT', 1) && peek(1).lexeme === 'island') {
      advance(); advance();
      isIsland = true;
    }
    expect('LBRACE', 'Expected { in UI declaration');
    const body = parseUiBodyItems();
    expect('RBRACE', 'Expected } in UI declaration');
    return { kind: 'UiDeclStmt', uiKind, name, params, isIsland, attrs, body, line: kw.line };
  }

  function parseUiBodyItems(): UiBodyItem[] {
    const items: UiBodyItem[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      if (match('STATE')) {
        const name = expectIdentLike();
        let typeAnn: TypeRef | undefined;
        if (match('COLON')) typeAnn = parseTypeRef();
        expect('ASSIGN', 'Expected = in state');
        const expr = parseExpr();
        items.push({ kind: 'state', name, typeAnn, expr });
        skipSemis();
        continue;
      }
      if (check('IDENT') && check('ASSIGN', 1)) {
        const name = advance().lexeme;
        advance(); // =
        const expr = parseExpr();
        items.push({ kind: 'propAssign', name, expr });
        skipSemis();
        continue;
      }
      if (check('LET') || check('MUT') || check('GUARD') || check('RETURN') || check('IF') || check('FOR')) {
        items.push({ kind: 'stmt', stmt: parseStmt() });
        skipSemis();
        continue;
      }
      // UI element node like `column(style: Shell) { ... }` or `routes { ... }` or `theme(...) { ... }`
      const expr = parseExpr();
      if (expr.kind === 'UiCallExpr') {
        items.push({ kind: 'node', node: expr.node });
      } else {
        items.push({ kind: 'stmt', stmt: { kind: 'ExprStmt', expr, line: (expr as { line: number }).line || peek().line } });
      }
      skipSemis();
    }
    return items;
  }

  function parseMmioStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    expect('AT', 'Expected @ in mmio');
    const baseAddr = Number(expect('NUMBER', 'Expected base address').value ?? 0);
    expect('LBRACE', 'Expected { in mmio');
    const fields: { name: string; typeAnn: TypeRef; offset: number }[] = [];
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      const fname = expectIdentLike();
      expect('COLON', 'Expected : in mmio field');
      const typeAnn = parseTypeRef();
      expect('AT', 'Expected @ offset in mmio field');
      const offset = Number(expect('NUMBER', 'Expected offset').value ?? 0);
      fields.push({ name: fname, typeAnn, offset });
      skipSemis();
    }
    expect('RBRACE', 'Expected } in mmio');
    return { kind: 'MmioStmt', name, baseAddr, fields, line };
  }

  function parseScene3DStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    const params: FnParam[] = [];
    if (match('LPAREN')) {
      while (!check('RPAREN') && !check('EOF')) {
        const pname = expectIdentLike();
        let typeAnn: TypeRef | undefined;
        if (match('COLON')) typeAnn = parseTypeRef();
        let defaultVal: Expr | undefined;
        if (match('ASSIGN')) defaultVal = parseExpr();
        params.push({ name: pname, typeAnn, defaultVal });
        if (!match('COMMA')) break;
      }
      expect('RPAREN', 'Expected )');
    }
    const body = parseBlockExpr();
    return { kind: 'Scene3DStmt', name, params, body, line };
  }

  function parseShaderStmt(): Stmt {
    const line = advance().line;
    const name = expectIdentLike();
    let stage = 'fragment';
    if (match('LPAREN')) {
      stage = expectIdentLike();
      match('RPAREN');
    }
    expect('LBRACE', 'Expected { in shader');
    let depth = 1;
    let body = '';
    while (depth > 0 && !check('EOF')) {
      const t = advance();
      if (t.kind === 'LBRACE') depth++;
      else if (t.kind === 'RBRACE') {
        depth--;
        if (depth === 0) break;
      }
      body += t.lexeme + ' ';
    }
    return { kind: 'ShaderStmt', name, stage, body: body.trim(), line };
  }

  function parseBlockExpr(): BlockExpr {
    const line = expect('LBRACE', 'Expected {').line;
    const stmts: Stmt[] = [];
    let tail: Expr | undefined;
    while (!check('RBRACE') && !check('EOF')) {
      skipSemis();
      if (check('RBRACE')) break;
      const stmt = parseStmt();
      skipSemis();
      if (check('RBRACE') && stmt.kind === 'ExprStmt') {
        tail = stmt.expr;
      } else {
        stmts.push(stmt);
      }
    }
    expect('RBRACE', 'Expected }');
    return { kind: 'BlockExpr', stmts, tail, line };
  }

  function parseStmt(): Stmt {
    skipSemis();
    const t = peek();

    if (check('LET') || check('MUT')) {
      const isMut = advance().kind === 'MUT';
      if (match('LPAREN')) {
        const pattern: string[] = [];
        while (!check('RPAREN') && !check('EOF')) {
          pattern.push(expectIdentLike());
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected ) in tuple destructure');
        expect('ASSIGN', 'Expected =');
        const value = parseExpr();
        return { kind: 'LetStmt', name: pattern.join(','), pattern, isMut, value, line: t.line };
      }
      const name = expectIdentLike();
      let typeAnn: TypeRef | undefined;
      if (match('COLON')) typeAnn = parseTypeRef();
      expect('ASSIGN', 'Expected = in binding');
      const value = parseExpr();
      return { kind: 'LetStmt', name, isMut, typeAnn, value, line: t.line };
    }

    if (check('IF')) {
      const line = advance().line;
      const prev = noStructLit;
      noStructLit = true;
      const cond = parseExpr();
      noStructLit = prev;
      const thenBranch = parseBlockExpr();
      let elseBranch: BlockExpr | Stmt | undefined;
      if (match('ELSE')) {
        if (check('IF')) elseBranch = parseStmt();
        else elseBranch = parseBlockExpr();
      }
      return { kind: 'IfStmt', cond, thenBranch, elseBranch, line };
    }

    if (check('WHILE')) {
      const line = advance().line;
      const prev = noStructLit;
      noStructLit = true;
      const cond = parseExpr();
      noStructLit = prev;
      const body = parseBlockExpr();
      return { kind: 'WhileStmt', cond, body, line };
    }

    if (check('LOOP')) {
      const line = advance().line;
      const body = parseBlockExpr();
      return { kind: 'LoopStmt', body, line };
    }

    if (check('FOR')) {
      const line = advance().line;
      const pattern: string[] = [];
      if (match('LPAREN')) {
        while (!check('RPAREN') && !check('EOF')) {
          pattern.push(expectIdentLike());
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected )');
      } else {
        pattern.push(expectIdentLike());
      }
      expect('IN', 'Expected in after for binding');
      const prev = noStructLit;
      noStructLit = true;
      const iter = parseExpr();
      noStructLit = prev;
      const body = parseBlockExpr();
      return { kind: 'ForStmt', pattern, iter, body, line };
    }

    if (check('RETURN')) {
      const line = advance().line;
      let value: Expr | undefined;
      if (!check('RBRACE') && !check('SEMI') && !check('EOF') && peek().line === line) {
        value = parseExpr();
      }
      return { kind: 'ReturnStmt', value, line };
    }

    if (check('FAIL')) {
      const line = advance().line;
      const value = parseExpr();
      return { kind: 'FailStmt', value, line };
    }

    if (check('YIELD')) {
      const line = advance().line;
      const value = parseExpr();
      return { kind: 'YieldStmt', value, line };
    }

    if (check('BREAK')) {
      const line = advance().line;
      let value: Expr | undefined;
      if (!check('RBRACE') && !check('SEMI') && !check('EOF') && peek().line === line) {
        value = parseExpr();
      }
      return { kind: 'BreakStmt', value, line };
    }

    if (check('CONTINUE')) {
      return { kind: 'ContinueStmt', line: advance().line };
    }

    if (check('DEFER')) {
      const line = advance().line;
      const body = check('LBRACE') ? parseBlockExpr() : parseExpr();
      return { kind: 'DeferStmt', body, line };
    }

    if (check('GUARD')) {
      const line = advance().line;
      const prev = noStructLit;
      noStructLit = true;
      if (match('LET')) {
        const letName = expectIdentLike();
        expect('ASSIGN', 'Expected = in guard let');
        const cond = parseExpr();
        noStructLit = prev;
        expect('ELSE', 'Expected else in guard');
        const elseBranch = parseBlockExpr();
        return { kind: 'GuardStmt', isLet: true, letName, cond, elseBranch, line };
      }
      const cond = parseExpr();
      noStructLit = prev;
      expect('ELSE', 'Expected else in guard');
      const elseBranch = parseBlockExpr();
      return { kind: 'GuardStmt', cond, elseBranch, line };
    }

    // Expression or Assignment
    const expr = parseExpr();
    if (check('ASSIGN') || check('PLUS_EQ') || check('MINUS_EQ') || check('STAR_EQ') || check('SLASH_EQ') || check('Q_Q_EQ')) {
      const opTok = advance();
      const val = parseExpr();
      return { kind: 'AssignStmt', target: expr, op: opTok.lexeme, value: val, line: opTok.line };
    }
    return { kind: 'ExprStmt', expr, line: (expr as { line: number }).line || t.line };
  }

  // Pratt / Precedence expression parser
  function parseExpr(): Expr {
    return parsePipeline();
  }

  function parsePipeline(): Expr {
    let left = parseNilCoalesce();
    while (match('PIPE_GT')) {
      const right = parseNilCoalesce();
      left = { kind: 'BinaryExpr', op: '|>', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseNilCoalesce(): Expr {
    let left = parseOr();
    while (match('Q_Q')) {
      const right = parseOr();
      left = { kind: 'BinaryExpr', op: '??', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseOr(): Expr {
    let left = parseAnd();
    while (check('OR_OR') || check('OR')) {
      const op = advance().lexeme;
      const right = parseAnd();
      left = { kind: 'BinaryExpr', op: '||', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseAnd(): Expr {
    let left = parseBitOr();
    while (check('AND_AND') || check('AND')) {
      advance();
      const right = parseBitOr();
      left = { kind: 'BinaryExpr', op: '&&', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseBitOr(): Expr {
    let left = parseBitXor();
    while (check('PIPE') && !check('PIPE', 1)) {
      // Be careful not to consume closure | if not infix
      advance();
      const right = parseBitXor();
      left = { kind: 'BinaryExpr', op: '|', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseBitXor(): Expr {
    let left = parseBitAnd();
    while (match('CARET')) {
      const right = parseBitAnd();
      left = { kind: 'BinaryExpr', op: '^', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseBitAnd(): Expr {
    let left = parseEquality();
    while (match('AMP')) {
      const right = parseEquality();
      left = { kind: 'BinaryExpr', op: '&', left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseEquality(): Expr {
    let left = parseComparison();
    while (check('EQ') || check('NE')) {
      const op = advance().lexeme;
      const right = parseComparison();
      left = { kind: 'BinaryExpr', op, left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseComparison(): Expr {
    let left = parseRange();
    while (check('LT') || check('LE') || check('GT') || check('GE')) {
      const op = advance().lexeme;
      const right = parseRange();
      left = { kind: 'BinaryExpr', op, left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseRange(): Expr {
    let left = parseShift();
    if (check('DOT_DOT_LT') || check('DOT_DOT_EQ')) {
      const tok = advance();
      const inclusive = tok.kind === 'DOT_DOT_EQ';
      const right = parseShift();
      return { kind: 'RangeExpr', start: left, end: right, inclusive, line: tok.line };
    }
    return left;
  }

  function parseShift(): Expr {
    let left = parseTerm();
    while (check('SHL') || check('SHR')) {
      const op = advance().lexeme;
      const right = parseTerm();
      left = { kind: 'BinaryExpr', op, left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseTerm(): Expr {
    let left = parseFactor();
    while (check('PLUS') || check('MINUS')) {
      const op = advance().lexeme;
      const right = parseFactor();
      left = { kind: 'BinaryExpr', op, left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseFactor(): Expr {
    let left = parseCast();
    while (check('STAR') || check('SLASH') || check('PERCENT')) {
      const op = advance().lexeme;
      const right = parseCast();
      left = { kind: 'BinaryExpr', op, left, right, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseCast(): Expr {
    let left = parseUnary();
    while (match('AS')) {
      const typeAnn = parseTypeRef();
      left = { kind: 'CastExpr', expr: left, typeAnn, line: (left as { line: number }).line };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (check('BANG') || check('NOT') || check('MINUS') || check('TILDE')) {
      const opTok = advance();
      const op = opTok.kind === 'NOT' ? '!' : opTok.lexeme;
      return { kind: 'UnaryExpr', op, expr: parseUnary(), line: opTok.line };
    }
    if (check('AWAIT')) {
      const line = advance().line;
      return { kind: 'AwaitExpr', expr: parseUnary(), line };
    }
    if (check('SPAWN')) {
      const line = advance().line;
      return { kind: 'SpawnExpr', expr: parseUnary(), line };
    }
    if (check('TRY')) {
      const line = advance().line;
      const expr = parseUnary();
      if (match('CATCH')) {
        let catchVar: string | undefined;
        if (check('IDENT') && !check('LBRACE')) {
          catchVar = advance().lexeme;
        }
        const catchBody = parseBlockExpr();
        return { kind: 'TryExpr', expr, catchVar, catchBody, line };
      }
      return { kind: 'TryExpr', expr, line };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary();
    while (true) {
      if (match('LPAREN')) {
        const args = parseCallArgs();
        expr = { kind: 'CallExpr', callee: expr, args, line: (expr as { line: number }).line };
        // Trailing block/closure for UI nodes or calls like `group.spawn { work(i) }` or `column(...) { ... }`
        if (!noStructLit && check('LBRACE') && isUiOrTrailingBlock(expr)) {
          expr = attachTrailingBlock(expr);
        }
      } else if (check('COLON_COLON') && check('LT', 1)) {
        // Turbofish ::<Type>(args)
        advance(); // ::
        advance(); // <
        const typeArgs: TypeRef[] = [];
        while (!check('GT') && !check('EOF')) {
          typeArgs.push(parseTypeRef());
          if (!match('COMMA')) break;
        }
        expect('GT', 'Expected > in generic call');
        expect('LPAREN', 'Expected ( after ::<T>');
        const args = parseCallArgs();
        expr = { kind: 'CallExpr', callee: expr, typeArgs, args, line: (expr as { line: number }).line };
      } else if (match('DOT') || match('Q_DOT')) {
        const optional = tokens[pos - 1].kind === 'Q_DOT';
        const member = expectIdentLike();
        expr = { kind: 'MemberExpr', target: expr, member, optional, line: (expr as { line: number }).line };
      } else if (match('LBRACKET') || match('Q_LBRACKET')) {
        const optional = tokens[pos - 1].kind === 'Q_LBRACKET';
        const index = parseExpr();
        expect('RBRACKET', 'Expected ]');
        expr = { kind: 'IndexExpr', target: expr, index, optional, line: (expr as { line: number }).line };
      } else if (match('QUESTION')) {
        expr = { kind: 'TryQExpr', expr, line: (expr as { line: number }).line };
      } else if (
        !noStructLit &&
        check('LBRACE') &&
        ((expr.kind === 'IdentExpr' && isUiTagOrTrailing(expr.name)) || expr.kind === 'MemberExpr')
      ) {
        // e.g. `column { ... }`, `routes { ... }`, or `group.spawn { ... }`
        const callExpr: Expr = { kind: 'CallExpr', callee: expr, args: [], line: expr.line };
        expr = attachTrailingBlock(callExpr);
      } else {
        break;
      }
    }
    return expr;
  }

  function isUiTagOrTrailing(name: string): boolean {
    const uiNames = new Set([
      'column', 'row', 'grid', 'zstack', 'scroll', 'canvas', 'text', 'button',
      'image', 'field', 'link', 'each', 'routes', 'theme', 'toggle', 'spacer', 'card',
    ]);
    return uiNames.has(name);
  }

  function isUiOrTrailingBlock(expr: Expr): boolean {
    if (expr.kind === 'CallExpr' && expr.callee.kind === 'IdentExpr') {
      return isUiTagOrTrailing(expr.callee.name) || expr.callee.name === 'app' || expr.callee.name === 'route';
    }
    if (expr.kind === 'CallExpr' && expr.callee.kind === 'MemberExpr') {
      return true; // e.g. `xs.map { |x| ... }` or `group.spawn { ... }`
    }
    return false;
  }

  function attachTrailingBlock(expr: Expr): Expr {
    if (expr.kind === 'CallExpr' && expr.callee.kind === 'IdentExpr' && isUiTagOrTrailing(expr.callee.name)) {
      const tag = expr.callee.name;
      advance(); // {
      // Check if it's `each(xs) { |x| ... }`
      if (tag === 'each' && check('PIPE')) {
        const closure = parseClosureExpr(false);
        // unwrap closure block? or keep as children
        expect('RBRACE', 'Expected }');
        return {
          kind: 'CallExpr',
          callee: expr.callee,
          args: [...expr.args, { value: closure }],
          line: expr.line,
        };
      }
      if (tag === 'routes') {
        const children: UiBodyItem[] = [];
        while (!check('RBRACE') && !check('EOF')) {
          const pathExpr = parseExpr();
          expect('FAT_ARROW', 'Expected => in routes');
          const viewExpr = parseExpr();
          children.push({
            kind: 'node',
            node: {
              tag: 'route',
              args: [{ value: pathExpr }, { value: viewExpr }],
              modifiers: [],
              children: [],
              line: peek().line,
            },
          });
          match('COMMA');
          skipSemis();
        }
        expect('RBRACE', 'Expected } in routes');
        return {
          kind: 'UiCallExpr',
          node: { tag, args: expr.args, modifiers: [], children, line: expr.line },
          line: expr.line,
        };
      }
      const children = parseUiBodyItems();
      expect('RBRACE', 'Expected }');
      return {
        kind: 'UiCallExpr',
        node: { tag, args: expr.args, modifiers: [], children, line: expr.line },
        line: expr.line,
      };
    }

    // Regular trailing closure e.g. `group.spawn { work(i) }` or `xs.each { |x| ... }`
    if (expr.kind === 'CallExpr') {
      let closure: Expr;
      if (check('LBRACE') && check('PIPE', 1)) {
        advance(); // {
        closure = parseClosureExpr(false);
        expect('RBRACE', 'Expected }');
      } else {
        const blk = parseBlockExpr();
        closure = { kind: 'ClosureExpr', params: [], body: blk, line: blk.line };
      }
      return {
        kind: 'CallExpr',
        callee: expr.callee,
        args: [...expr.args, { value: closure }],
        line: expr.line,
      };
    }
    return expr;
  }

  function parseCallArgs(): { name?: string; value: Expr }[] {
    const args: { name?: string; value: Expr }[] = [];
    while (!check('RPAREN') && !check('EOF')) {
      if ((check('IDENT') || check('STYLE') || check('TYPE') || check('STATE')) && check('COLON', 1)) {
        const name = advance().lexeme;
        advance(); // :
        const value = parseExpr();
        args.push({ name, value });
      } else {
        args.push({ value: parseExpr() });
      }
      if (!match('COMMA')) break;
    }
    expect('RPAREN', 'Expected ) after arguments');
    return args;
  }

  function parseClosureExpr(isMove: boolean): Expr {
    const line = peek().line;
    const params: string[] = [];
    if (match('OR_OR')) {
      // || expr
    } else {
      expect('PIPE', 'Expected | in closure');
      while (!check('PIPE') && !check('EOF')) {
        params.push(expectIdentLike());
        if (!match('COMMA')) break;
      }
      expect('PIPE', 'Expected | after closure params');
    }
    const body = check('LBRACE') ? parseBlockExpr() : parseExpr();
    return { kind: 'ClosureExpr', params, isMove, body, line };
  }

  function parsePrimary(): Expr {
    const t = peek();

    if (check('NUMBER')) {
      advance();
      return { kind: 'LiteralExpr', litType: 'num', value: Number(t.value ?? 0), line: t.line };
    }
    if (check('UNIT_NUMBER')) {
      advance();
      return { kind: 'LiteralExpr', litType: 'num', value: Number(t.value ?? 0), unit: t.unit, line: t.line };
    }
    if (check('TRUE')) { advance(); return { kind: 'LiteralExpr', litType: 'bool', value: true, line: t.line }; }
    if (check('FALSE')) { advance(); return { kind: 'LiteralExpr', litType: 'bool', value: false, line: t.line }; }
    if (check('NIL')) { advance(); return { kind: 'LiteralExpr', litType: 'nil', value: null, line: t.line }; }
    if (check('CHAR')) { advance(); return { kind: 'LiteralExpr', litType: 'char', value: String(t.value ?? ''), line: t.line }; }
    if (check('COLOR')) { advance(); return { kind: 'LiteralExpr', litType: 'color', value: String(t.value ?? '#000000'), line: t.line }; }

    if (check('STRING')) {
      advance();
      const s = String(t.value ?? '');
      if (t.raw !== 'raw' && s.includes('${')) {
        return parseInterpString(s, t.line);
      }
      return { kind: 'LiteralExpr', litType: 'str', value: s.replace(/\\\$/g, '$'), line: t.line };
    }

    if (check('PIPE') || check('OR_OR')) {
      return parseClosureExpr(false);
    }

    if (check('MOVE') && (check('PIPE', 1) || check('OR_OR', 1))) {
      advance();
      return parseClosureExpr(true);
    }

    if (match('LPAREN')) {
      if (match('RPAREN')) return { kind: 'TupleExpr', items: [], line: t.line };
      // Check named tuple `(y: 12dp, x: 20dp)`
      if (check('IDENT') && check('COLON', 1)) {
        const entries: { key: Expr; value: Expr }[] = [];
        while (!check('RPAREN') && !check('EOF')) {
          const k = expectIdentLike();
          expect('COLON', 'Expected :');
          const v = parseExpr();
          entries.push({ key: { kind: 'LiteralExpr', litType: 'str', value: k, line: t.line }, value: v });
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected )');
        return { kind: 'MapExpr', entries, line: t.line };
      }
      const first = parseExpr();
      if (match('COMMA')) {
        const items: Expr[] = [first];
        while (!check('RPAREN') && !check('EOF')) {
          items.push(parseExpr());
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected )');
        return { kind: 'TupleExpr', items, line: t.line };
      }
      expect('RPAREN', 'Expected )');
      return first;
    }

    if (match('LBRACKET')) {
      const items: Expr[] = [];
      if (match('RBRACKET')) return { kind: 'ListExpr', items, line: t.line };
      const first = parseExpr();
      // List comprehension: `[expr for x in iter (if cond)?]`
      if (match('FOR')) {
        const varName = expectIdentLike();
        expect('IN', 'Expected in in list comprehension');
        const iter = parseExpr();
        let cond: Expr | undefined;
        if (match('IF')) cond = parseExpr();
        expect('RBRACKET', 'Expected ] at end of comprehension');
        return { kind: 'ListCompExpr', body: first, varName, iter, cond, line: t.line };
      }
      // Fixed array repeat `[0; 20]`
      if (match('SEMI')) {
        const countExpr = parseExpr();
        expect('RBRACKET', 'Expected ]');
        const count = countExpr.kind === 'LiteralExpr' && typeof countExpr.value === 'number' ? Math.min(countExpr.value, 256) : 16;
        for (let k = 0; k < count; k++) items.push(first);
        return { kind: 'ListExpr', items, line: t.line };
      }
      items.push(first);
      while (match('COMMA')) {
        if (check('RBRACKET')) break;
        items.push(parseExpr());
      }
      expect('RBRACKET', 'Expected ]');
      return { kind: 'ListExpr', items, line: t.line };
    }

    if (match('LBRACE')) {
      // Map literal `{name: "Ada", "age": 36}`
      const entries: { key: Expr; value: Expr }[] = [];
      while (!check('RBRACE') && !check('EOF')) {
        let key: Expr;
        if (check('STRING')) {
          const st = advance();
          key = { kind: 'LiteralExpr', litType: 'str', value: String(st.value ?? ''), line: st.line };
        } else {
          const id = expectIdentLike();
          key = { kind: 'LiteralExpr', litType: 'str', value: id, line: peek().line };
        }
        expect('COLON', 'Expected : in map literal');
        const value = parseExpr();
        entries.push({ key, value });
        if (!match('COMMA')) break;
      }
      expect('RBRACE', 'Expected }');
      return { kind: 'MapExpr', entries, line: t.line };
    }

    if (match('DOT')) {
      const name = expectIdentLike();
      return { kind: 'ImplicitDotExpr', name, line: t.line };
    }

    if (check('IF')) {
      const line = advance().line;
      const prev = noStructLit;
      noStructLit = true;
      const cond = parseExpr();
      noStructLit = prev;
      const thenBranch = parseBlockExpr();
      let elseBranch: Expr | undefined;
      if (match('ELSE')) {
        elseBranch = check('IF') ? parsePrimary() : parseBlockExpr();
      }
      return { kind: 'IfExpr', cond, thenBranch, elseBranch, line };
    }

    if (check('MATCH')) {
      const line = advance().line;
      const prev = noStructLit;
      noStructLit = true;
      const target = parseExpr();
      noStructLit = prev;
      expect('LBRACE', 'Expected { in match');
      const arms: MatchArm[] = [];
      while (!check('RBRACE') && !check('EOF')) {
        const patterns: MatchPattern[] = [parseMatchPattern()];
        while (match('PIPE')) patterns.push(parseMatchPattern());
        let guard: Expr | undefined;
        if (match('IF')) guard = parseExpr();
        expect('FAT_ARROW', 'Expected => in match arm');
        const body = check('LBRACE') ? parseBlockExpr() : parseExpr();
        arms.push({ patterns, guard, body, line: peek().line });
        match('COMMA');
        skipSemis();
      }
      expect('RBRACE', 'Expected } in match');
      return { kind: 'MatchExpr', target, arms, line };
    }

    if (check('COMPTIME')) {
      const line = advance().line;
      return { kind: 'ComptimeExpr', body: parseBlockExpr(), line };
    }

    if (check('UNSAFE')) {
      const line = advance().line;
      return { kind: 'UnsafeExpr', body: parseBlockExpr(), line };
    }

    if (check('IDENT') && t.lexeme === 'asm!') {
      const line = advance().line;
      expect('LPAREN', 'Expected ( after asm!');
      const instructions: string[] = [];
      while (!check('RPAREN') && !check('EOF')) {
        const ins = advance();
        instructions.push(String(ins.value ?? ins.lexeme));
        match('COMMA');
      }
      expect('RPAREN', 'Expected ) after asm!');
      return { kind: 'AsmExpr', instructions, line };
    }

    if (check('IDENT') || check('TYPE') || check('STATE') || check('STYLE') || check('VIEW') || check('THEME')) {
      const name = advance().lexeme;
      if (name === 'self') return { kind: 'SelfExpr', line: t.line };

      // Enum::Variant or Path::Member
      if (match('COLON_COLON')) {
        if (match('LT')) {
          // Turbofish on ident e.g. Ptr<UInt8>.fromAddr(...)
          const typeArgs: TypeRef[] = [];
          while (!check('GT') && !check('EOF')) {
            typeArgs.push(parseTypeRef());
            if (!match('COMMA')) break;
          }
          expect('GT', 'Expected >');
          return { kind: 'IdentExpr', name, line: t.line };
        }
        const member = expectIdentLike();
        return { kind: 'PathExpr', base: name, member, line: t.line };
      }

      // Generic angle brackets on Type like Ptr<UInt8>.fromAddr(...)
      if (check('LT') && /^[A-Z]/.test(name)) {
        // Look ahead to see if matching > is followed by . or :: or (
        const savePos = pos;
        try {
          advance(); // <
          let depth = 1;
          while (depth > 0 && !check('EOF')) {
            if (check('LT')) depth++;
            else if (check('GT')) depth--;
            advance();
          }
          if (check('DOT') || check('COLON_COLON') || check('LPAREN')) {
            // Valid generic type ref on expression!
            return { kind: 'IdentExpr', name, line: t.line };
          }
        } catch {
          // ignore
        }
        pos = savePos;
      }

      // Struct literal `Point { x: 1.0, y: 2.0 }` or `Cart { }`
      if (!noStructLit && check('LBRACE') && /^[A-Z]/.test(name)) {
        advance(); // {
        const fields: { name: string; value: Expr }[] = [];
        while (!check('RBRACE') && !check('EOF')) {
          const fname = expectIdentLike();
          expect('COLON', 'Expected : in struct literal');
          const value = parseExpr();
          fields.push({ name: fname, value });
          if (!match('COMMA')) break;
        }
        expect('RBRACE', 'Expected } in struct literal');
        return { kind: 'StructLitExpr', name, fields, line: t.line };
      }

      return { kind: 'IdentExpr', name, line: t.line };
    }

    diagnostics.push({
      code: 'E-PARSE-003',
      severity: 'error',
      message: `Unexpected token '${t.lexeme || t.kind}' in expression`,
      line: t.line,
      col: t.col,
    });
    advance();
    return { kind: 'LiteralExpr', litType: 'nil', value: null, line: t.line };
  }

  function parseMatchPattern(): MatchPattern {
    const t = peek();
    if (check('IDENT') && t.lexeme === '_') {
      advance();
      return { kind: 'Wildcard' };
    }
    if (check('NIL')) { advance(); return { kind: 'Literal', value: null }; }
    if (check('TRUE')) { advance(); return { kind: 'Literal', value: true }; }
    if (check('FALSE')) { advance(); return { kind: 'Literal', value: false }; }
    if (check('STRING') || check('CHAR')) { advance(); return { kind: 'Literal', value: String(t.value ?? '') }; }
    if (check('MINUS') && check('NUMBER', 1)) {
      advance();
      const nt = advance();
      return { kind: 'Literal', value: -Number(nt.value ?? 0) };
    }
    if (check('NUMBER')) {
      const start = parsePrimary();
      if (check('DOT_DOT_LT') || check('DOT_DOT_EQ')) {
        const inclusive = advance().kind === 'DOT_DOT_EQ';
        const end = parsePrimary();
        return { kind: 'Range', start, end, inclusive };
      }
      return { kind: 'Literal', value: Number(t.value ?? 0) };
    }
    if (check('IDENT')) {
      const name = advance().lexeme;
      if (match('COLON_COLON')) {
        const variant = expectIdentLike();
        const bindings: string[] = [];
        if (match('LPAREN')) {
          while (!check('RPAREN') && !check('EOF')) {
            bindings.push(expectIdentLike());
            if (!match('COMMA')) break;
          }
          expect('RPAREN', 'Expected ) in enum pattern');
        }
        return { kind: 'Enum', enumName: name, variant, bindings };
      }
      if (match('LPAREN')) {
        const bindings: string[] = [];
        while (!check('RPAREN') && !check('EOF')) {
          bindings.push(expectIdentLike());
          if (!match('COMMA')) break;
        }
        expect('RPAREN', 'Expected ) in pattern');
        return { kind: 'Enum', variant: name, bindings };
      }
      return { kind: 'Ident', name };
    }
    advance();
    return { kind: 'Wildcard' };
  }

  function parseInterpString(raw: string, line: number): Expr {
    const parts: ({ type: 'text'; text: string } | { type: 'expr'; expr: Expr })[] = [];
    let i = 0;
    let buf = '';
    while (i < raw.length) {
      if (raw[i] === '\\' && raw[i + 1] === '$') {
        buf += '$';
        i += 2;
        continue;
      }
      if (raw[i] === '$' && raw[i + 1] === '{') {
        if (buf) {
          parts.push({ type: 'text', text: buf });
          buf = '';
        }
        i += 2;
        let depth = 1;
        let code = '';
        while (i < raw.length && depth > 0) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') {
            depth--;
            if (depth === 0) { i++; break; }
          }
          code += raw[i++];
        }
        const subLex = lexVela(code);
        const subParsed = parseVela(subLex.tokens);
        const subStmt = subParsed.ast.stmts[0];
        const expr: Expr =
          subStmt && subStmt.kind === 'ExprStmt'
            ? subStmt.expr
            : { kind: 'LiteralExpr', litType: 'str', value: '', line };
        parts.push({ type: 'expr', expr });
      } else {
        buf += raw[i++];
      }
    }
    if (buf) parts.push({ type: 'text', text: buf });
    return { kind: 'InterpStrExpr', parts, line };
  }

  const ast = parseProgram();
  return { ast, diagnostics };
}
