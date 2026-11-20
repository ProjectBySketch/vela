export type TokenKind =
  | 'EOF'
  | 'IDENT'
  | 'NUMBER'
  | 'STRING'
  | 'CHAR'
  | 'COLOR'
  | 'UNIT_NUMBER'
  // Keywords
  | 'LET'
  | 'MUT'
  | 'CONST'
  | 'STATIC'
  | 'FN'
  | 'ASYNC'
  | 'AWAIT'
  | 'GEN'
  | 'YIELD'
  | 'SPAWN'
  | 'STRUCT'
  | 'SHARED'
  | 'ENUM'
  | 'TRAIT'
  | 'IMPL'
  | 'TYPE'
  | 'MOD'
  | 'USE'
  | 'PUB'
  | 'MATCH'
  | 'IF'
  | 'ELSE'
  | 'WHILE'
  | 'FOR'
  | 'IN'
  | 'LOOP'
  | 'BREAK'
  | 'CONTINUE'
  | 'RETURN'
  | 'FAIL'
  | 'TRY'
  | 'CATCH'
  | 'DEFER'
  | 'GUARD'
  | 'MOVE'
  | 'UNSAFE'
  | 'COMPTIME'
  | 'REQUIRES'
  | 'ENSURES'
  | 'INVARIANT'
  | 'WHERE'
  | 'AS'
  | 'IS'
  | 'NOT'
  | 'AND'
  | 'OR'
  | 'TRUE'
  | 'FALSE'
  | 'NIL'
  | 'THEME'
  | 'STYLE'
  | 'VIEW'
  | 'COMPONENT'
  | 'PAGE'
  | 'MMIO'
  | 'SCENE3D'
  | 'SHADER'
  | 'STATE'
  | 'WHEN'
  | 'EXTENDS'
  // Punctuation
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'COLON'
  | 'COLON_COLON'
  | 'SEMI'
  | 'DOT'
  | 'DOT_DOT_LT'
  | 'DOT_DOT_EQ'
  | 'ELLIPSIS'
  | 'AT'
  | 'HASH_LBRACKET'
  | 'HASH_BANG_LBRACKET'
  | 'QUESTION'
  | 'Q_DOT'
  | 'Q_LBRACKET'
  | 'Q_Q'
  | 'Q_Q_EQ'
  | 'ARROW'
  | 'FAT_ARROW'
  | 'PIPE_GT'
  | 'PIPE'
  | 'AMP'
  | 'CARET'
  | 'TILDE'
  | 'SHL'
  | 'SHR'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'ASSIGN'
  | 'PLUS_EQ'
  | 'MINUS_EQ'
  | 'STAR_EQ'
  | 'SLASH_EQ'
  | 'EQ'
  | 'NE'
  | 'LT'
  | 'LE'
  | 'GT'
  | 'GE'
  | 'AND_AND'
  | 'OR_OR'
  | 'BANG';

export interface Token {
  kind: TokenKind;
  lexeme: string;
  value?: string | number;
  unit?: string;
  line: number;
  col: number;
  raw?: string;
}

export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  col: number;
  hint?: string;
}

export interface TypeRef {
  kind: 'named' | 'func' | 'tuple' | 'tensor' | 'array' | 'optional' | 'union' | 'unit';
  name?: string;
  generics?: TypeRef[];
  params?: TypeRef[];
  ret?: TypeRef;
  elements?: TypeRef[];
  dtype?: string;
  shape?: (number | string)[];
  size?: number | string;
  base?: TypeRef;
  members?: TypeRef[];
  unitExpr?: string;
}

export interface Attribute {
  name: string;
  args: string[];
  line: number;
}

export type Stmt =
  | { kind: 'UseStmt'; path: string[]; items?: string[]; alias?: string; line: number }
  | { kind: 'ModStmt'; name: string; body: Stmt[]; isPub?: boolean; line: number }
  | { kind: 'ConstStmt'; name: string; typeAnn?: TypeRef; value: Expr; isPub?: boolean; line: number }
  | { kind: 'StaticStmt'; name: string; isMut: boolean; typeAnn?: TypeRef; value: Expr; line: number }
  | { kind: 'TypeAliasStmt'; name: string; typeAnn: TypeRef; refinement?: Expr; line: number }
  | { kind: 'LetStmt'; name: string; pattern?: string[]; isMut: boolean; typeAnn?: TypeRef; value: Expr; line: number }
  | { kind: 'AssignStmt'; target: Expr; op: string; value: Expr; line: number }
  | { kind: 'FnStmt'; name: string; isPub?: boolean; isAsync?: boolean; isGen?: boolean; generics: GenericParam[]; params: FnParam[]; retType?: TypeRef; requires?: Expr[]; ensures?: Expr[]; attrs: Attribute[]; body: BlockExpr; line: number }
  | { kind: 'StructStmt'; name: string; isShared: boolean; isPub?: boolean; generics: GenericParam[]; fields: StructField[]; attrs: Attribute[]; line: number }
  | { kind: 'EnumStmt'; name: string; isPub?: boolean; generics: GenericParam[]; variants: EnumVariant[]; attrs: Attribute[]; line: number }
  | { kind: 'TraitStmt'; name: string; generics: GenericParam[]; methods: FnStmt[]; line: number }
  | { kind: 'ImplStmt'; traitName?: string; targetName: string; generics: GenericParam[]; methods: FnStmt[]; invariants: Expr[]; line: number }
  | { kind: 'ThemeStmt'; name: string; parent?: string; tokens: { key: string; value: Expr }[]; line: number }
  | { kind: 'StyleStmt'; name: string; parent?: string; props: StyleProp[]; states: { state: string; props: StyleProp[] }[]; media: { cond: string; props: StyleProp[] }[]; line: number }
  | { kind: 'UiDeclStmt'; uiKind: 'view' | 'component' | 'page'; name: string; params: FnParam[]; isIsland?: boolean; attrs: Attribute[]; body: UiBodyItem[]; line: number }
  | { kind: 'MmioStmt'; name: string; baseAddr: number; fields: { name: string; typeAnn: TypeRef; offset: number }[]; line: number }
  | { kind: 'Scene3DStmt'; name: string; params: FnParam[]; body: BlockExpr; line: number }
  | { kind: 'ShaderStmt'; name: string; stage: string; body: string; line: number }
  | { kind: 'IfStmt'; cond: Expr; thenBranch: BlockExpr; elseBranch?: BlockExpr | Stmt; line: number }
  | { kind: 'WhileStmt'; cond: Expr; body: BlockExpr; line: number }
  | { kind: 'LoopStmt'; body: BlockExpr; line: number }
  | { kind: 'ForStmt'; pattern: string[]; iter: Expr; body: BlockExpr; line: number }
  | { kind: 'ReturnStmt'; value?: Expr; line: number }
  | { kind: 'FailStmt'; value: Expr; line: number }
  | { kind: 'YieldStmt'; value: Expr; line: number }
  | { kind: 'BreakStmt'; value?: Expr; line: number }
  | { kind: 'ContinueStmt'; line: number }
  | { kind: 'DeferStmt'; body: BlockExpr | Expr; line: number }
  | { kind: 'GuardStmt'; isLet?: boolean; letName?: string; cond: Expr; elseBranch: BlockExpr; line: number }
  | { kind: 'ExprStmt'; expr: Expr; line: number };

export type FnStmt = Extract<Stmt, { kind: 'FnStmt' }>;

export interface GenericParam {
  name: string;
  bounds: string[];
}

export interface FnParam {
  name: string;
  isMut?: boolean;
  isConsuming?: boolean;
  typeAnn?: TypeRef;
  defaultVal?: Expr;
}

export interface StructField {
  name: string;
  isMut: boolean;
  typeAnn: TypeRef;
  defaultVal?: Expr;
}

export interface EnumVariant {
  name: string;
  fields: { name?: string; typeAnn: TypeRef }[];
}

export interface StyleProp {
  key: string;
  value: Expr;
}

export interface UiBodyItem {
  kind: 'state' | 'propAssign' | 'stmt' | 'node';
  name?: string;
  typeAnn?: TypeRef;
  expr?: Expr;
  stmt?: Stmt;
  node?: UiNodeExpr;
}

export interface UiNodeExpr {
  tag: string;
  args: { name?: string; value: Expr }[];
  modifiers: { name: string; args: { name?: string; value: Expr }[] }[];
  children: UiBodyItem[];
  line: number;
}

export interface BlockExpr {
  kind: 'BlockExpr';
  stmts: Stmt[];
  tail?: Expr;
  line: number;
}

export type Expr =
  | BlockExpr
  | { kind: 'LiteralExpr'; litType: 'num' | 'str' | 'bool' | 'nil' | 'char' | 'color'; value: string | number | boolean | null; unit?: string; line: number }
  | { kind: 'InterpStrExpr'; parts: ({ type: 'text'; text: string } | { type: 'expr'; expr: Expr })[]; line: number }
  | { kind: 'IdentExpr'; name: string; line: number }
  | { kind: 'SelfExpr'; line: number }
  | { kind: 'ImplicitDotExpr'; name: string; line: number }
  | { kind: 'ListExpr'; items: Expr[]; line: number }
  | { kind: 'ListCompExpr'; body: Expr; varName: string; iter: Expr; cond?: Expr; line: number }
  | { kind: 'TupleExpr'; items: Expr[]; line: number }
  | { kind: 'MapExpr'; entries: { key: Expr; value: Expr }[]; line: number }
  | { kind: 'StructLitExpr'; name: string; fields: { name: string; value: Expr }[]; line: number }
  | { kind: 'PathExpr'; base: string; member: string; line: number }
  | { kind: 'UnaryExpr'; op: string; expr: Expr; line: number }
  | { kind: 'BinaryExpr'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'RangeExpr'; start: Expr; end: Expr; inclusive: boolean; line: number }
  | { kind: 'CastExpr'; expr: Expr; typeAnn: TypeRef; line: number }
  | { kind: 'CallExpr'; callee: Expr; typeArgs?: TypeRef[]; args: { name?: string; value: Expr }[]; line: number }
  | { kind: 'IndexExpr'; target: Expr; index: Expr; optional?: boolean; line: number }
  | { kind: 'MemberExpr'; target: Expr; member: string; optional?: boolean; line: number }
  | { kind: 'ClosureExpr'; params: string[]; isMove?: boolean; body: Expr; line: number }
  | { kind: 'IfExpr'; cond: Expr; thenBranch: BlockExpr; elseBranch?: Expr; line: number }
  | { kind: 'MatchExpr'; target: Expr; arms: MatchArm[]; line: number }
  | { kind: 'TryExpr'; expr: Expr; catchVar?: string; catchBody?: BlockExpr; line: number }
  | { kind: 'TryQExpr'; expr: Expr; line: number }
  | { kind: 'AwaitExpr'; expr: Expr; line: number }
  | { kind: 'SpawnExpr'; expr: Expr; line: number }
  | { kind: 'ComptimeExpr'; body: BlockExpr; line: number }
  | { kind: 'UnsafeExpr'; body: BlockExpr; line: number }
  | { kind: 'AsmExpr'; instructions: string[]; line: number }
  | { kind: 'UiCallExpr'; node: UiNodeExpr; line: number };

export interface MatchArm {
  patterns: MatchPattern[];
  guard?: Expr;
  body: Expr;
  line: number;
}

export type MatchPattern =
  | { kind: 'Wildcard' }
  | { kind: 'Literal'; value: string | number | boolean | null }
  | { kind: 'Range'; start: Expr; end: Expr; inclusive: boolean }
  | { kind: 'Ident'; name: string }
  | { kind: 'Enum'; enumName?: string; variant: string; bindings: string[] };

export interface ProgramAST {
  strict: boolean;
  stmts: Stmt[];
}

// Runtime Value types
export type VelaValue =
  | { tag: 'nil' }
  | { tag: 'bool'; val: boolean }
  | { tag: 'num'; val: number; isInt?: boolean }
  | { tag: 'str'; val: string; arcId?: number }
  | { tag: 'char'; val: string }
  | { tag: 'color'; val: string }
  | { tag: 'unitVal'; val: number; unit: string }
  | { tag: 'money'; cents: number; currency: string }
  | { tag: 'list'; items: VelaValue[]; arcId?: number }
  | { tag: 'tuple'; items: VelaValue[] }
  | { tag: 'map'; entries: Map<string, VelaValue>; arcId?: number }
  | { tag: 'struct'; typeName: string; fields: Map<string, VelaValue>; isShared: boolean; arcId?: number }
  | { tag: 'enum'; typeName: string; variant: string; payload: VelaValue[]; namedPayload?: Map<string, VelaValue> }
  | { tag: 'option'; some: boolean; val?: VelaValue }
  | { tag: 'result'; ok: boolean; val: VelaValue }
  | { tag: 'fn'; name: string; params: FnParam[]; body: Expr | BlockExpr; env: RuntimeEnv; isAsync?: boolean; isGen?: boolean; isMove?: boolean }
  | { tag: 'nativeFn'; name: string; call: (args: VelaValue[], named?: Map<string, VelaValue>) => Promise<VelaValue> | VelaValue }
  | { tag: 'tensor'; dtype: string; shape: number[]; data: number[]; grad?: number[]; requiresGrad?: boolean; id?: number }
  | { tag: 'task'; id: number; name: string; promise: Promise<VelaValue>; status: 'running' | 'done' | 'failed'; result?: VelaValue }
  | { tag: 'channel'; id: number; capacity: number; buffer: VelaValue[]; waiters: ((v: VelaValue) => void)[]; closed: boolean }
  | { tag: 'mutex'; id: number; value: VelaValue; locked: boolean }
  | { tag: 'ptr'; addr: number; pointeeType: string }
  | { tag: 'db'; name: string }
  | { tag: 'httpServer'; routes: { method: string; path: string; handler: string }[] }
  | { tag: 'scene3d'; objects: Scene3DObject[]; lights: Scene3DLight[]; camera?: Scene3DCamera; bg?: string; fogColor?: string; animationScript?: string };

export interface RuntimeEnv {
  bindings: Map<string, { val: VelaValue; isMut: boolean }>;
  parent?: RuntimeEnv;
}

// Memory & ARC Telemetry
export interface ArcObject {
  id: number;
  label: string;
  kind: string;
  rc: number;
  bytes: number;
  freed: boolean;
  cowCopies: number;
  refs: number[]; // outgoing arcIds for cycle detection
  bornLine: number;
}

export interface ArcEvent {
  step: number;
  op: 'alloc' | 'retain' | 'release' | 'cow_split' | 'drop' | 'cycle_collect';
  objId: number;
  label: string;
  rcAfter: number;
  detail: string;
}

export interface ConcurrencyEvent {
  timeMs: number;
  taskId: number;
  taskName: string;
  kind: 'spawn' | 'await' | 'send' | 'recv' | 'complete' | 'lock';
  detail: string;
}

// Virtual Kernel State
export interface VgaState {
  cols: number;
  rows: number;
  chars: string[]; // 80 * 25
  attrs: number[];
  cursorX: number;
  cursorY: number;
}

export interface MmIoRegisterLog {
  device: string;
  reg: string;
  addr: string;
  op: 'read' | 'write';
  value: string;
}

export interface KernelSnapshot {
  vga: VgaState;
  serialLog: string[];
  ticks: number;
  heapBase: number;
  heapUsed: number;
  heapSize: number;
  allocations: { addr: string; size: number; align: number }[];
  mmioLog: MmIoRegisterLog[];
  interrupts: { vector: string; handler: string; count: number }[];
  asmExecuted: string[];
  ramfsFiles: { path: string; bytes: number; content: string }[];
}

// 3D Scene Graph driven by Vela
export interface Scene3DObject {
  id: string;
  name: string;
  role: 'primary' | 'secondary' | 'accent';
  geometry: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'torusKnot' | 'capsule' | 'extrude' | 'lathe' | 'tube' | 'gear' | 'wing' | 'dish';
  params: Record<string, number>;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  material: {
    color: string;
    roughness: number;
    metalness: number;
    emissive?: string;
    emissiveIntensity?: number;
    transmission?: number;
    clearcoat?: number;
    wireframe?: boolean;
  };
  spin?: [number, number, number];
  explodeVec?: [number, number, number];
}

export interface Scene3DLight {
  kind: 'directional' | 'point' | 'hemisphere' | 'spot';
  color: string;
  groundColor?: string;
  intensity: number;
  position: [number, number, number];
}

export interface Scene3DCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

// Compiled Web Output
export interface CompiledWebOutput {
  html: string;
  css: string;
  js: string;
  bundleHtml: string;
  routes: string[];
  themes: string[];
  styleCount: number;
  componentCount: number;
  diagnostics: Diagnostic[];
}

// Database snapshot
export interface SqlTableSnapshot {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

// ML Training snapshot
export interface MlSnapshot {
  epochs: { epoch: number; loss: number; accuracy: number }[];
  layers: { name: string; shapeIn: string; shapeOut: string; params: number }[];
  lastPrediction?: { input: string; output: number[]; predictedClass: number };
}

export interface VelaSymbol {
  name: string;
  kind: 'fn' | 'struct' | 'enum' | 'trait' | 'mod' | 'theme' | 'style' | 'view' | 'page' | 'component' | 'mmio' | 'scene3d';
  line: number;
  detail: string;
}

export interface CompileAndRunResult {
  success: boolean;
  diagnostics: Diagnostic[];
  stdout: string[];
  cCode: string;
  kernelCode: string;
  webOutput: CompiledWebOutput | null;
  arcObjects: ArcObject[];
  arcEvents: ArcEvent[];
  concurrencyEvents: ConcurrencyEvent[];
  kernelState: KernelSnapshot;
  scenes3d: Scene3DObject[][];
  scene3dFull?: {
    name: string;
    objects: Scene3DObject[];
    lights: Scene3DLight[];
    camera?: Scene3DCamera;
    bg?: string;
  };
  sqlTables: SqlTableSnapshot[];
  httpRoutes: { method: string; path: string; handler: string }[];
  mlSnapshot: MlSnapshot;
  symbols?: VelaSymbol[];
  durationMs: number;
  tokensCount: number;
  astStmtCount: number;
}
