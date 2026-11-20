import {
  BlockExpr,
  ConcurrencyEvent,
  EnumVariant,
  Expr,
  FnStmt,
  MatchPattern,
  ProgramAST,
  RuntimeEnv,
  Scene3DCamera,
  Scene3DLight,
  Scene3DObject,
  Stmt,
  StructField,
  VelaValue,
} from './types';
import { ArcMemoryManager } from './memory';
import { VelaMlEngine } from './ml';
import { VelaSqlEngine } from './db';
import { VelaKernelEmulator } from './kernel';

class ReturnSignal {
  constructor(public val: VelaValue) {}
}
class FailSignal {
  constructor(public val: VelaValue) {}
}
class BreakSignal {
  constructor(public val?: VelaValue) {}
}
class ContinueSignal {}

export function formatVelaValue(v: VelaValue): string {
  switch (v.tag) {
    case 'nil':
      return 'nil';
    case 'bool':
      return v.val ? 'true' : 'false';
    case 'num':
      return Object.is(v.val, -0) ? '0' : String(v.val);
    case 'str':
      return v.val;
    case 'char':
      return v.val;
    case 'color':
      return v.val;
    case 'unitVal':
      return `${v.val}.${v.unit}`;
    case 'money':
      return `${(v.cents / 100).toFixed(2)} ${v.currency.toUpperCase()}`;
    case 'list':
      return `[${v.items.map(formatVelaValue).join(', ')}]`;
    case 'tuple':
      return `(${v.items.map(formatVelaValue).join(', ')})`;
    case 'map': {
      const parts: string[] = [];
      for (const [k, val] of v.entries.entries()) {
        parts.push(`${k}: ${formatVelaValue(val)}`);
      }
      return `{${parts.join(', ')}}`;
    }
    case 'struct': {
      const parts: string[] = [];
      for (const [k, val] of v.fields.entries()) {
        parts.push(`${k}: ${formatVelaValue(val)}`);
      }
      return `${v.typeName} { ${parts.join(', ')} }`;
    }
    case 'enum': {
      if (v.payload.length === 0) return `${v.typeName}::${v.variant}`;
      return `${v.typeName}::${v.variant}(${v.payload.map(formatVelaValue).join(', ')})`;
    }
    case 'option':
      return v.some && v.val ? `Some(${formatVelaValue(v.val)})` : 'nil';
    case 'result':
      return v.ok ? `Ok(${formatVelaValue(v.val)})` : `Err(${formatVelaValue(v.val)})`;
    case 'tensor':
      return `Tensor<${v.dtype}, [${v.shape.join(', ')}]>([${v.data.slice(0, 6).map((x) => Number(x.toFixed(3))).join(', ')}${v.data.length > 6 ? ', ...' : ''}])`;
    case 'ptr':
      return `Ptr<${v.pointeeType}>(0x${v.addr.toString(16)})`;
    case 'fn':
      return `<fn ${v.name}>`;
    case 'nativeFn':
      return `<native fn ${v.name}>`;
    case 'task':
      return `<Task #${v.id} ${v.status}>`;
    case 'channel':
      return `<Channel #${v.id} buf=${v.buffer.length}/${v.capacity}>`;
    default:
      return `<${v.tag}>`;
  }
}

export function isTruthy(v: VelaValue): boolean {
  switch (v.tag) {
    case 'nil':
      return false;
    case 'bool':
      return v.val;
    case 'num':
      return v.val !== 0;
    case 'str':
      return v.val.length > 0;
    case 'list':
      return v.items.length > 0;
    case 'map':
      return v.entries.size > 0;
    case 'option':
      return v.some;
    case 'result':
      return v.ok;
    default:
      return true;
  }
}

export function valuesEqual(a: VelaValue, b: VelaValue): boolean {
  if (a.tag === 'option' && !a.some && b.tag === 'nil') return true;
  if (b.tag === 'option' && !b.some && a.tag === 'nil') return true;
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case 'nil':
      return true;
    case 'bool':
    case 'num':
    case 'str':
    case 'char':
    case 'color':
      return a.val === (b as typeof a).val;
    case 'unitVal':
      return a.val === (b as typeof a).val && a.unit === (b as typeof a).unit;
    case 'money':
      return a.cents === (b as typeof a).cents && a.currency === (b as typeof a).currency;
    case 'list':
    case 'tuple': {
      const bi = (b as typeof a).items;
      return a.items.length === bi.length && a.items.every((x, i) => valuesEqual(x, bi[i]));
    }
    case 'map': {
      const bm = (b as typeof a).entries;
      if (a.entries.size !== bm.size) return false;
      for (const [k, v] of a.entries.entries()) {
        const bv = bm.get(k);
        if (!bv || !valuesEqual(v, bv)) return false;
      }
      return true;
    }
    case 'enum': {
      const be = b as typeof a;
      return (
        a.typeName === be.typeName &&
        a.variant === be.variant &&
        a.payload.length === be.payload.length &&
        a.payload.every((p, i) => valuesEqual(p, be.payload[i]))
      );
    }
    case 'struct': {
      const bs = b as typeof a;
      if (a.typeName !== bs.typeName || a.fields.size !== bs.fields.size) return false;
      for (const [k, v] of a.fields.entries()) {
        const bv = bs.fields.get(k);
        if (!bv || !valuesEqual(v, bv)) return false;
      }
      return true;
    }
    default:
      return a === b;
  }
}

export class VelaRuntime {
  public stdout: string[] = [];
  private lineBuf = '';
  public arc = new ArcMemoryManager();
  public ml = new VelaMlEngine();
  public db = new VelaSqlEngine();
  public kernel = new VelaKernelEmulator();
  public concurrencyEvents: ConcurrencyEvent[] = [];
  public scenes3d: Scene3DObject[][] = [];
  public scene3dFull?: {
    name: string;
    objects: Scene3DObject[];
    lights: Scene3DLight[];
    camera?: Scene3DCamera;
    bg?: string;
  };
  private vfs = new Map<string, string>();
  private structs = new Map<string, { isShared: boolean; fields: StructField[] }>();
  private enums = new Map<string, EnumVariant[]>();
  private methods = new Map<string, Map<string, FnStmt>>(); // Type -> methodName -> FnStmt
  private tests: FnStmt[] = [];
  private nextTaskId = 1;
  private nextChanId = 1;
  private startTime = Date.now();
  private steps = 0;
  private readonly MAX_STEPS = 250_000;

  private stepGuard(line: number) {
    if (++this.steps > this.MAX_STEPS) {
      throw new Error(`Execution step limit (${this.MAX_STEPS}) exceeded near line ${line}`);
    }
  }

  private emitPrint(text: string, newline: boolean) {
    this.lineBuf += text;
    if (newline || this.lineBuf.includes('\n')) {
      const parts = this.lineBuf.split('\n');
      if (newline) {
        for (const p of parts) this.stdout.push(p);
        this.lineBuf = '';
      } else {
        for (let i = 0; i < parts.length - 1; i++) this.stdout.push(parts[i]);
        this.lineBuf = parts[parts.length - 1];
      }
    }
  }

  private logConcurrency(taskId: number, taskName: string, kind: ConcurrencyEvent['kind'], detail: string) {
    if (this.concurrencyEvents.length < 200) {
      this.concurrencyEvents.push({
        timeMs: Date.now() - this.startTime,
        taskId,
        taskName,
        kind,
        detail,
      });
    }
  }

  public async execute(ast: ProgramAST): Promise<{ error?: string }> {
    const rootEnv: RuntimeEnv = { bindings: new Map() };
    this.seedStdlib(rootEnv);

    try {
      // First pass: register structs, enums, traits, impls, functions, modules, mmio, scene3d
      for (const stmt of ast.stmts) {
        await this.registerTopDecl(stmt, rootEnv);
      }

      // Second pass: run top-level statements and collect entry points
      let mainFn: VelaValue | undefined;
      let kmainFn: VelaValue | undefined;
      for (const stmt of ast.stmts) {
        if (
          stmt.kind === 'StructStmt' ||
          stmt.kind === 'EnumStmt' ||
          stmt.kind === 'TraitStmt' ||
          stmt.kind === 'ImplStmt' ||
          stmt.kind === 'MmioStmt' ||
          stmt.kind === 'ThemeStmt' ||
          stmt.kind === 'StyleStmt' ||
          stmt.kind === 'UiDeclStmt' ||
          stmt.kind === 'ShaderStmt'
        ) {
          continue;
        }
        if (stmt.kind === 'FnStmt') {
          const val = rootEnv.bindings.get(stmt.name)?.val;
          if (stmt.name === 'main') mainFn = val;
          if (stmt.name === 'kmain' || stmt.attrs.some((a) => a.name === 'entry' || a.name === 'boot')) {
            kmainFn = val;
          }
          continue;
        }
        if (stmt.kind === 'Scene3DStmt') {
          await this.execScene3D(stmt, rootEnv);
          continue;
        }
        await this.execStmt(stmt, rootEnv);
      }

      // Call main() or kmain() if present
      if (mainFn && mainFn.tag === 'fn') {
        let res = await this.invokeFn(mainFn, [{ tag: 'list', items: [] }], new Map());
        if (res.tag === 'task') {
          res = await res.promise;
        }
        if (res.tag === 'result' && !res.ok) {
          this.emitPrint(`vela: runtime error: ${formatVelaValue(res.val)}`, true);
        }
      } else if (kmainFn && kmainFn.tag === 'fn') {
        // In kernel emulation, don't hang forever on haltForever
        await this.invokeFn(kmainFn, [], new Map());
      } else if (this.tests.length > 0 && this.stdout.length === 0) {
        for (const t of this.tests) {
          const fnVal = rootEnv.bindings.get(t.name)?.val;
          if (fnVal && fnVal.tag === 'fn') {
            await this.invokeFn(fnVal, [], new Map());
            this.emitPrint(`[PASS] test ${t.name}`, true);
          }
        }
      }

      if (this.lineBuf.length > 0) {
        this.stdout.push(this.lineBuf);
        this.lineBuf = '';
      }

      // Run Bacon-Rajan cycle collector on root live references
      const roots = new Set<number>();
      for (const b of rootEnv.bindings.values()) {
        this.arc.collectValueIds(b.val, roots);
      }
      this.arc.collectCycles(roots);

      return {};
    } catch (e) {
      if (this.lineBuf.length > 0) {
        this.stdout.push(this.lineBuf);
        this.lineBuf = '';
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === '__KERNEL_HALT__') {
        return {};
      }
      this.stdout.push(`vela: runtime error: ${msg}`);
      return { error: msg };
    }
  }

  public createReplEnv(): RuntimeEnv {
    const env: RuntimeEnv = { bindings: new Map() };
    this.seedStdlib(env);
    return env;
  }

  public async executeReplAst(ast: ProgramAST, env: RuntimeEnv): Promise<{ value?: VelaValue; stdout: string[]; error?: string }> {
    this.stdout = [];
    this.lineBuf = '';
    this.steps = 0;
    let lastVal: VelaValue | undefined;
    try {
      for (const stmt of ast.stmts) {
        await this.registerTopDecl(stmt, env);
      }
      for (const stmt of ast.stmts) {
        if (
          stmt.kind === 'StructStmt' ||
          stmt.kind === 'EnumStmt' ||
          stmt.kind === 'TraitStmt' ||
          stmt.kind === 'ImplStmt' ||
          stmt.kind === 'MmioStmt' ||
          stmt.kind === 'ThemeStmt' ||
          stmt.kind === 'StyleStmt' ||
          stmt.kind === 'UiDeclStmt' ||
          stmt.kind === 'ShaderStmt' ||
          stmt.kind === 'FnStmt' ||
          stmt.kind === 'ModStmt' ||
          stmt.kind === 'UseStmt'
        ) {
          continue;
        }
        if (stmt.kind === 'Scene3DStmt') {
          await this.execScene3D(stmt, env);
          continue;
        }
        if (stmt.kind === 'ExprStmt') {
          lastVal = await this.evalExpr(stmt.expr, env);
        } else {
          await this.execStmt(stmt, env);
        }
      }
      if (this.lineBuf.length > 0) {
        this.stdout.push(this.lineBuf);
        this.lineBuf = '';
      }
      return { value: lastVal, stdout: [...this.stdout] };
    } catch (e) {
      if (this.lineBuf.length > 0) {
        this.stdout.push(this.lineBuf);
        this.lineBuf = '';
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { stdout: [...this.stdout], error: msg };
    }
  }

  private async registerTopDecl(stmt: Stmt, env: RuntimeEnv) {
    if (stmt.kind === 'StructStmt') {
      this.structs.set(stmt.name, { isShared: stmt.isShared, fields: stmt.fields });
      // Also bind struct constructor namespace for Struct.init(...) etc.
      const ns = new Map<string, VelaValue>();
      ns.set('init', {
        tag: 'nativeFn',
        name: `${stmt.name}.init`,
        call: (_args, named) => {
          const fields = new Map<string, VelaValue>();
          for (const f of stmt.fields) {
            // Check MLP Linear(in, out) fields
            if (f.typeAnn.kind === 'named' && f.typeAnn.name?.startsWith('Linear(')) {
              const dims = f.typeAnn.name.slice(7, -1).split(',').map((d) => Number(d.trim()));
              const inD = dims[0] || 4;
              const outD = dims[1] || 2;
              this.ml.recordLayer(f.name, `[?, ${inD}]`, `[?, ${outD}]`, inD * outD + outD);
              const w = this.ml.randn([inD, outD], 0.3);
              const b = this.ml.zeros([outD]);
              const layerMap = new Map<string, VelaValue>();
              layerMap.set('weight', { tag: 'tensor', dtype: 'Float32', shape: w.shape, data: w.data });
              layerMap.set('bias', { tag: 'tensor', dtype: 'Float32', shape: b.shape, data: b.data });
              layerMap.set('forward', {
                tag: 'nativeFn',
                name: 'Linear.forward',
                call: ([x]) => {
                  if (x.tag !== 'tensor') return x;
                  const mm = this.ml.matmul({ shape: x.shape, data: x.data }, w);
                  const res = this.ml.addBias(mm, b);
                  return { tag: 'tensor', dtype: 'Float32', shape: res.shape, data: res.data };
                },
              });
              fields.set(f.name, { tag: 'map', entries: layerMap });
            } else {
              fields.set(f.name, { tag: 'nil' });
            }
          }
          if (named) {
            for (const [k, v] of named.entries()) fields.set(k, v);
          }
          const id = this.arc.alloc(stmt.name, stmt.isShared ? 'SharedStruct' : 'Struct', 64, stmt.line);
          return { tag: 'struct', typeName: stmt.name, fields, isShared: stmt.isShared, arcId: id };
        },
      });
      env.bindings.set(stmt.name, { val: { tag: 'map', entries: ns }, isMut: false });
    } else if (stmt.kind === 'EnumStmt') {
      this.enums.set(stmt.name, stmt.variants);
      const ns = new Map<string, VelaValue>();
      for (const v of stmt.variants) {
        if (v.fields.length === 0) {
          ns.set(v.name, { tag: 'enum', typeName: stmt.name, variant: v.name, payload: [] });
        } else {
          ns.set(v.name, {
            tag: 'nativeFn',
            name: `${stmt.name}::${v.name}`,
            call: (args, named) => {
              const payload = [...args];
              if (named && named.size > 0 && payload.length === 0) {
                for (const vf of v.fields) {
                  if (vf.name && named.has(vf.name)) payload.push(named.get(vf.name)!);
                }
              }
              return { tag: 'enum', typeName: stmt.name, variant: v.name, payload, namedPayload: named };
            },
          });
        }
      }
      env.bindings.set(stmt.name, { val: { tag: 'map', entries: ns }, isMut: false });
    } else if (stmt.kind === 'ImplStmt') {
      if (!this.methods.has(stmt.targetName)) this.methods.set(stmt.targetName, new Map());
      const map = this.methods.get(stmt.targetName)!;
      for (const m of stmt.methods) {
        map.set(m.name, m);
        // Also attach static methods like Route.new to Struct namespace
        const ns = env.bindings.get(stmt.targetName)?.val;
        if (ns && ns.tag === 'map') {
          ns.entries.set(m.name, {
            tag: 'fn',
            name: `${stmt.targetName}.${m.name}`,
            params: m.params,
            body: m.body,
            env,
            isAsync: m.isAsync,
            isGen: m.isGen,
          });
        }
      }
    } else if (stmt.kind === 'FnStmt') {
      const fnVal: VelaValue = {
        tag: 'fn',
        name: stmt.name,
        params: stmt.params,
        body: stmt.body,
        env,
        isAsync: stmt.isAsync,
        isGen: stmt.isGen,
      };
      env.bindings.set(stmt.name, { val: fnVal, isMut: false });
      for (const a of stmt.attrs) {
        if (a.name === 'interrupt') {
          this.kernel.registerInterrupt(a.args[0] || '0x20', stmt.name);
        } else if (a.name === 'test') {
          this.tests.push(stmt);
        } else if (a.name === 'get' || a.name === 'post') {
          this.db.routes.push({ method: a.name.toUpperCase(), path: a.args[0] || '/', handler: stmt.name });
        }
      }
    } else if (stmt.kind === 'ModStmt') {
      const modEnv: RuntimeEnv = { bindings: new Map(), parent: env };
      for (const inner of stmt.body) {
        await this.registerTopDecl(inner, modEnv);
      }
      for (const inner of stmt.body) {
        if (inner.kind === 'LetStmt' || inner.kind === 'ConstStmt' || inner.kind === 'StaticStmt') {
          await this.execStmt(inner, modEnv);
        }
      }
      const modMap = new Map<string, VelaValue>();
      for (const [k, v] of modEnv.bindings.entries()) {
        modMap.set(k, v.val);
      }
      env.bindings.set(stmt.name, { val: { tag: 'map', entries: modMap }, isMut: false });
    } else if (stmt.kind === 'MmioStmt') {
      this.kernel.registerMmio(
        stmt.name,
        stmt.baseAddr,
        stmt.fields.map((f) => f.name)
      );
      const devMap = new Map<string, VelaValue>();
      for (const f of stmt.fields) {
        const regMap = new Map<string, VelaValue>();
        regMap.set('write', {
          tag: 'nativeFn',
          name: `${stmt.name}.${f.name}.write`,
          call: ([val]) => {
            this.kernel.writeMmio(stmt.name, f.name, val.tag === 'num' ? val.val : 0);
            return { tag: 'nil' };
          },
        });
        regMap.set('read', {
          tag: 'nativeFn',
          name: `${stmt.name}.${f.name}.read`,
          call: () => ({ tag: 'num', val: this.kernel.readMmio(stmt.name, f.name), isInt: true }),
        });
        devMap.set(f.name, { tag: 'map', entries: regMap });
      }
      env.bindings.set(stmt.name, { val: { tag: 'map', entries: devMap }, isMut: false });
    } else if (stmt.kind === 'UseStmt') {
      // Resolve use mod::{a, b} or use mod::* from current environment
      let cur: VelaValue | undefined = env.bindings.get(stmt.path[0])?.val;
      for (let i = 1; i < stmt.path.length; i++) {
        if (cur && cur.tag === 'map') {
          cur = cur.entries.get(stmt.path[i]);
        } else {
          cur = undefined;
          break;
        }
      }
      if (stmt.items && cur && cur.tag === 'map') {
        if (stmt.items.length === 1 && stmt.items[0] === '*') {
          for (const [k, v] of cur.entries.entries()) {
            if (!env.bindings.has(k)) env.bindings.set(k, { val: v, isMut: false });
          }
        } else {
          for (const item of stmt.items) {
            const v = cur.entries.get(item);
            if (v) env.bindings.set(item, { val: v, isMut: false });
          }
        }
      } else if (cur) {
        const targetName = stmt.alias || stmt.path[stmt.path.length - 1];
        env.bindings.set(targetName, { val: cur, isMut: false });
      }
    }
  }

  private async execScene3D(stmt: Extract<Stmt, { kind: 'Scene3DStmt' }>, env: RuntimeEnv) {
    const objects: Scene3DObject[] = [];
    const lights: Scene3DLight[] = [];
    let camera: Scene3DCamera | undefined;
    let bg = '#0B0F17';

    const sceneEnv: RuntimeEnv = { bindings: new Map(), parent: env };
    const addObj = (
      geometry: Scene3DObject['geometry'],
      named?: Map<string, VelaValue>,
      args: VelaValue[] = []
    ): VelaValue => {
      const getNum = (k: string, def: number) => {
        const v = named?.get(k);
        return v && v.tag === 'num' ? v.val : def;
      };
      const getStr = (k: string, def: string) => {
        const v = named?.get(k);
        return v && (v.tag === 'str' || v.tag === 'color') ? v.val : def;
      };
      const getVec3 = (k: string, def: [number, number, number]): [number, number, number] => {
        const v = named?.get(k);
        if (v && (v.tag === 'list' || v.tag === 'tuple') && v.items.length >= 3) {
          return [
            v.items[0].tag === 'num' ? v.items[0].val : def[0],
            v.items[1].tag === 'num' ? v.items[1].val : def[1],
            v.items[2].tag === 'num' ? v.items[2].val : def[2],
          ];
        }
        return def;
      };
      const name = getStr('name', args[0]?.tag === 'str' ? args[0].val : `${geometry}_${objects.length + 1}`);
      const roleRaw = getStr('role', 'primary');
      const role: Scene3DObject['role'] =
        roleRaw === 'secondary' || roleRaw === 'accent' ? roleRaw : 'primary';

      const obj: Scene3DObject = {
        id: `obj_${objects.length + 1}`,
        name,
        role,
        geometry,
        params: {
          w: getNum('w', 1.2),
          h: getNum('h', 1.2),
          d: getNum('d', 1.2),
          radius: getNum('radius', 0.8),
          tube: getNum('tube', 0.22),
          teeth: getNum('teeth', 16),
          length: getNum('length', 1.2),
        },
        position: getVec3('pos', [0, 0, 0]),
        rotation: getVec3('rot', [0, 0, 0]),
        scale: getVec3('scale', [1, 1, 1]),
        material: {
          color: getStr('color', '#38BDF8'),
          roughness: getNum('roughness', 0.3),
          metalness: getNum('metalness', 0.7),
          emissive: getStr('emissive', '#000000'),
          emissiveIntensity: getNum('emissiveIntensity', 0),
          transmission: getNum('transmission', 0),
          clearcoat: getNum('clearcoat', 0.4),
        },
        spin: named?.has('spin') ? getVec3('spin', [0, 0, 0]) : undefined,
        explodeVec: named?.has('explode') ? getVec3('explode', [0, 0.6, 0]) : undefined,
      };
      objects.push(obj);
      return { tag: 'str', val: obj.id };
    };

    const geos: Scene3DObject['geometry'][] = [
      'box', 'sphere', 'cylinder', 'cone', 'torus', 'torusKnot', 'capsule', 'gear', 'wing', 'dish', 'lathe', 'tube',
    ];
    for (const g of geos) {
      sceneEnv.bindings.set(g, {
        val: { tag: 'nativeFn', name: g, call: (args, named) => addObj(g, named, args) },
        isMut: false,
      });
    }
    sceneEnv.bindings.set('light', {
      val: {
        tag: 'nativeFn',
        name: 'light',
        call: (_args, named) => {
          const kindRaw = named?.get('kind');
          const kind = kindRaw && kindRaw.tag === 'str' ? (kindRaw.val as Scene3DLight['kind']) : 'directional';
          const colorV = named?.get('color');
          const color = colorV && (colorV.tag === 'color' || colorV.tag === 'str') ? colorV.val : '#FFF7ED';
          const intV = named?.get('intensity');
          const intensity = intV && intV.tag === 'num' ? intV.val : 2.0;
          const posV = named?.get('pos');
          const position: [number, number, number] =
            posV && (posV.tag === 'list' || posV.tag === 'tuple') && posV.items.length >= 3
              ? [
                  posV.items[0].tag === 'num' ? posV.items[0].val : 4,
                  posV.items[1].tag === 'num' ? posV.items[1].val : 6,
                  posV.items[2].tag === 'num' ? posV.items[2].val : 5,
                ]
              : [4, 6, 5];
          lights.push({ kind, color, intensity, position });
          return { tag: 'nil' };
        },
      },
      isMut: false,
    });
    sceneEnv.bindings.set('camera', {
      val: {
        tag: 'nativeFn',
        name: 'camera',
        call: (_args, named) => {
          const posV = named?.get('pos');
          const targetV = named?.get('target');
          const fovV = named?.get('fov');
          camera = {
            position:
              posV && (posV.tag === 'list' || posV.tag === 'tuple') && posV.items.length >= 3
                ? [
                    posV.items[0].tag === 'num' ? posV.items[0].val : 4.5,
                    posV.items[1].tag === 'num' ? posV.items[1].val : 3.2,
                    posV.items[2].tag === 'num' ? posV.items[2].val : 5.5,
                  ]
                : [4.5, 3.2, 5.5],
            target:
              targetV && (targetV.tag === 'list' || targetV.tag === 'tuple') && targetV.items.length >= 3
                ? [
                    targetV.items[0].tag === 'num' ? targetV.items[0].val : 0,
                    targetV.items[1].tag === 'num' ? targetV.items[1].val : 0.8,
                    targetV.items[2].tag === 'num' ? targetV.items[2].val : 0,
                  ]
                : [0, 0.8, 0],
            fov: fovV && fovV.tag === 'num' ? fovV.val : 45,
          };
          return { tag: 'nil' };
        },
      },
      isMut: false,
    });
    sceneEnv.bindings.set('background', {
      val: {
        tag: 'nativeFn',
        name: 'background',
        call: ([c]) => {
          if (c && (c.tag === 'color' || c.tag === 'str')) bg = c.val;
          return { tag: 'nil' };
        },
      },
      isMut: false,
    });

    await this.execBlock(stmt.body, sceneEnv);
    this.scenes3d.push(objects);
    this.scene3dFull = { name: stmt.name, objects, lights, camera, bg };
  }

  private lookup(env: RuntimeEnv, name: string): { val: VelaValue; isMut: boolean } | undefined {
    let cur: RuntimeEnv | undefined = env;
    while (cur) {
      const b = cur.bindings.get(name);
      if (b) return b;
      cur = cur.parent;
    }
    return undefined;
  }

  private async execBlock(block: BlockExpr, env: RuntimeEnv): Promise<VelaValue> {
    const scope: RuntimeEnv = { bindings: new Map(), parent: env };
    const defers: (BlockExpr | Expr)[] = [];
    let result: VelaValue = { tag: 'nil' };

    try {
      for (const s of block.stmts) {
        if (s.kind === 'DeferStmt') {
          defers.push(s.body);
          continue;
        }
        await this.execStmt(s, scope);
      }
      if (block.tail) {
        result = await this.evalExpr(block.tail, scope);
      }
      return result;
    } finally {
      // Run defers in LIFO order
      for (let i = defers.length - 1; i >= 0; i--) {
        const d = defers[i];
        try {
          if (d.kind === 'BlockExpr') await this.execBlock(d, scope);
          else await this.evalExpr(d, scope);
        } catch {
          // ignore secondary errors in defer
        }
      }
      // ARC scope release for heap objects bound in this scope
      for (const [name, binding] of scope.bindings.entries()) {
        if (binding.val.tag === 'struct' && binding.val.arcId) {
          this.arc.release(binding.val.arcId, `Scope exit '${name}'`);
        } else if (binding.val.tag === 'list' && binding.val.arcId) {
          this.arc.release(binding.val.arcId, `Scope exit '${name}'`);
        }
      }
    }
  }

  private async execStmt(stmt: Stmt, env: RuntimeEnv): Promise<void> {
    this.stepGuard(stmt.line);

    switch (stmt.kind) {
      case 'UseStmt':
      case 'TypeAliasStmt':
      case 'StructStmt':
      case 'EnumStmt':
      case 'TraitStmt':
      case 'ImplStmt':
      case 'ThemeStmt':
      case 'StyleStmt':
      case 'UiDeclStmt':
      case 'MmioStmt':
      case 'ShaderStmt':
        return;

      case 'ModStmt':
        await this.registerTopDecl(stmt, env);
        return;

      case 'FnStmt':
        env.bindings.set(stmt.name, {
          val: { tag: 'fn', name: stmt.name, params: stmt.params, body: stmt.body, env, isAsync: stmt.isAsync, isGen: stmt.isGen },
          isMut: false,
        });
        return;

      case 'ConstStmt':
      case 'StaticStmt': {
        const val = await this.evalExpr(stmt.value, env);
        env.bindings.set(stmt.name, { val, isMut: stmt.kind === 'StaticStmt' ? stmt.isMut : false });
        return;
      }

      case 'LetStmt': {
        const val = await this.evalExpr(stmt.value, env);
        if (val.tag === 'struct' && val.arcId) {
          this.arc.retain(val.arcId, `Bound '${stmt.name}'`);
        }
        if (stmt.pattern) {
          const items = val.tag === 'tuple' || val.tag === 'list' ? val.items : [val];
          stmt.pattern.forEach((p, idx) => {
            env.bindings.set(p, { val: items[idx] ?? { tag: 'nil' }, isMut: stmt.isMut });
          });
        } else {
          env.bindings.set(stmt.name, { val, isMut: stmt.isMut });
        }
        return;
      }

      case 'AssignStmt': {
        const rhs = await this.evalExpr(stmt.value, env);
        if (stmt.target.kind === 'IdentExpr') {
          const b = this.lookup(env, stmt.target.name);
          if (!b) throw new Error(`Undefined variable '${stmt.target.name}' at line ${stmt.line}`);
          if (!b.isMut) throw new Error(`Cannot assign to immutable 'let ${stmt.target.name}' at line ${stmt.line}`);
          b.val = this.applyCompoundOp(b.val, stmt.op, rhs, stmt.line);
          return;
        }
        if (stmt.target.kind === 'IndexExpr') {
          const container = await this.evalExpr(stmt.target.target, env);
          const idx = await this.evalExpr(stmt.target.index, env);
          if (container.tag === 'list' && idx.tag === 'num') {
            if (container.arcId) {
              container.arcId = this.arc.cowSplit(container.arcId, 'list', 'List', container.items.length * 16, stmt.line);
            }
            const i = idx.val < 0 ? container.items.length + idx.val : idx.val;
            container.items[Math.floor(i)] = this.applyCompoundOp(container.items[Math.floor(i)] ?? { tag: 'nil' }, stmt.op, rhs, stmt.line);
            return;
          }
          if (container.tag === 'map') {
            if (container.arcId) {
              container.arcId = this.arc.cowSplit(container.arcId, 'map', 'Map', container.entries.size * 24, stmt.line);
            }
            const key = formatVelaValue(idx);
            container.entries.set(key, this.applyCompoundOp(container.entries.get(key) ?? { tag: 'nil' }, stmt.op, rhs, stmt.line));
            return;
          }
        }
        if (stmt.target.kind === 'MemberExpr') {
          const container = await this.evalExpr(stmt.target.target, env);
          if (container.tag === 'map') {
            const cur = container.entries.get(stmt.target.member) ?? { tag: 'nil' };
            container.entries.set(stmt.target.member, this.applyCompoundOp(cur, stmt.op, rhs, stmt.line));
            return;
          }
          if (container.tag === 'struct') {
            const cur = container.fields.get(stmt.target.member) ?? { tag: 'nil' };
            const nextVal = this.applyCompoundOp(cur, stmt.op, rhs, stmt.line);
            container.fields.set(stmt.target.member, nextVal);
            if (container.arcId && nextVal.tag === 'struct' && nextVal.arcId) {
              this.arc.addRefEdge(container.arcId, nextVal.arcId);
            }
            return;
          }
        }
        return;
      }

      case 'IfStmt': {
        const cond = await this.evalExpr(stmt.cond, env);
        if (isTruthy(cond)) {
          await this.execBlock(stmt.thenBranch, env);
        } else if (stmt.elseBranch) {
          if (stmt.elseBranch.kind === 'BlockExpr') await this.execBlock(stmt.elseBranch, env);
          else await this.execStmt(stmt.elseBranch, env);
        }
        return;
      }

      case 'WhileStmt': {
        while (isTruthy(await this.evalExpr(stmt.cond, env))) {
          this.stepGuard(stmt.line);
          try {
            await this.execBlock(stmt.body, env);
          } catch (sig) {
            if (sig instanceof ContinueSignal) continue;
            if (sig instanceof BreakSignal) break;
            throw sig;
          }
        }
        return;
      }

      case 'LoopStmt': {
        while (true) {
          this.stepGuard(stmt.line);
          try {
            await this.execBlock(stmt.body, env);
          } catch (sig) {
            if (sig instanceof ContinueSignal) continue;
            if (sig instanceof BreakSignal) break;
            throw sig;
          }
        }
        return;
      }

      case 'ForStmt': {
        const iterVal = await this.evalExpr(stmt.iter, env);
        const items = this.toIterable(iterVal);
        for (const item of items) {
          this.stepGuard(stmt.line);
          const loopEnv: RuntimeEnv = { bindings: new Map(), parent: env };
          if (stmt.pattern.length > 1 && (item.tag === 'tuple' || item.tag === 'list')) {
            stmt.pattern.forEach((p, idx) => {
              loopEnv.bindings.set(p, { val: item.items[idx] ?? { tag: 'nil' }, isMut: false });
            });
          } else {
            loopEnv.bindings.set(stmt.pattern[0], { val: item, isMut: false });
          }
          try {
            await this.execBlock(stmt.body, loopEnv);
          } catch (sig) {
            if (sig instanceof ContinueSignal) continue;
            if (sig instanceof BreakSignal) break;
            throw sig;
          }
        }
        return;
      }

      case 'ReturnStmt': {
        const val = stmt.value ? await this.evalExpr(stmt.value, env) : ({ tag: 'nil' } as VelaValue);
        throw new ReturnSignal(val);
      }

      case 'FailStmt': {
        const val = await this.evalExpr(stmt.value, env);
        throw new FailSignal(val);
      }

      case 'BreakStmt': {
        const val = stmt.value ? await this.evalExpr(stmt.value, env) : undefined;
        throw new BreakSignal(val);
      }

      case 'ContinueStmt':
        throw new ContinueSignal();

      case 'GuardStmt': {
        const cond = await this.evalExpr(stmt.cond, env);
        if (stmt.isLet && stmt.letName) {
          if (cond.tag === 'option' && cond.some && cond.val) {
            env.bindings.set(stmt.letName, { val: cond.val, isMut: false });
            return;
          }
          if (cond.tag !== 'nil' && !(cond.tag === 'option' && !cond.some)) {
            env.bindings.set(stmt.letName, { val: cond, isMut: false });
            return;
          }
        } else if (isTruthy(cond)) {
          return;
        }
        await this.execBlock(stmt.elseBranch, env);
        return;
      }

      case 'Scene3DStmt':
        await this.execScene3D(stmt, env);
        return;

      case 'ExprStmt':
        await this.evalExpr(stmt.expr, env);
        return;
    }
  }

  private toIterable(v: VelaValue): VelaValue[] {
    if (v.tag === 'list' || v.tag === 'tuple') return v.items;
    if (v.tag === 'map') return Array.from(v.entries.keys()).map((k) => ({ tag: 'str', val: k }));
    if (v.tag === 'str') return v.val.split('').map((c) => ({ tag: 'str', val: c }));
    return [];
  }

  private applyCompoundOp(cur: VelaValue, op: string, rhs: VelaValue, line: number): VelaValue {
    if (op === '=') return rhs;
    if (op === '??=') return cur.tag === 'nil' || (cur.tag === 'option' && !cur.some) ? rhs : cur;
    const baseOp = op.slice(0, -1);
    return this.evalBinary(baseOp, cur, rhs, line);
  }

  private evalBinary(op: string, l: VelaValue, r: VelaValue, line: number): VelaValue {
    if (op === '+') {
      if (l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: l.val + r.val };
      if (l.tag === 'str' || r.tag === 'str') return { tag: 'str', val: formatVelaValue(l) + formatVelaValue(r) };
      if (l.tag === 'list' && r.tag === 'list') return { tag: 'list', items: [...l.items, ...r.items] };
      if (l.tag === 'unitVal' && r.tag === 'unitVal' && l.unit === r.unit) return { tag: 'unitVal', val: l.val + r.val, unit: l.unit };
      if (l.tag === 'money' && r.tag === 'money') return { tag: 'money', cents: l.cents + r.cents, currency: l.currency };
    }
    if (op === '-') {
      if (l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: l.val - r.val };
      if (l.tag === 'unitVal' && r.tag === 'unitVal' && l.unit === r.unit) return { tag: 'unitVal', val: l.val - r.val, unit: l.unit };
      if (l.tag === 'money' && r.tag === 'money') return { tag: 'money', cents: l.cents - r.cents, currency: l.currency };
    }
    if (op === '*') {
      if (l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: l.val * r.val };
      if (l.tag === 'money' && r.tag === 'num') return { tag: 'money', cents: Math.round(l.cents * r.val), currency: l.currency };
      if (l.tag === 'unitVal' && r.tag === 'num') return { tag: 'unitVal', val: l.val * r.val, unit: l.unit };
    }
    if (op === '/') {
      if (l.tag === 'num' && r.tag === 'num') {
        if (r.val === 0) throw new Error(`Division by zero at line ${line}`);
        return { tag: 'num', val: l.val / r.val };
      }
      if (l.tag === 'unitVal' && r.tag === 'unitVal') {
        return { tag: 'unitVal', val: l.val / r.val, unit: `${l.unit}/${r.unit}` };
      }
    }
    if (op === '%') {
      if (l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: l.val % r.val };
    }
    if (op === '&' && l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: (l.val | 0) & (r.val | 0) };
    if (op === '|' && l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: (l.val | 0) | (r.val | 0) };
    if (op === '^' && l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: (l.val | 0) ^ (r.val | 0) };
    if (op === '<<' && l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: (l.val | 0) << (r.val | 0) };
    if (op === '>>' && l.tag === 'num' && r.tag === 'num') return { tag: 'num', val: (l.val | 0) >> (r.val | 0) };
    if (op === '==') return { tag: 'bool', val: valuesEqual(l, r) };
    if (op === '!=') return { tag: 'bool', val: !valuesEqual(l, r) };
    if (op === '<') return { tag: 'bool', val: this.cmpVals(l, r) < 0 };
    if (op === '<=') return { tag: 'bool', val: this.cmpVals(l, r) <= 0 };
    if (op === '>') return { tag: 'bool', val: this.cmpVals(l, r) > 0 };
    if (op === '>=') return { tag: 'bool', val: this.cmpVals(l, r) >= 0 };
    throw new Error(`Invalid binary operation '${l.tag} ${op} ${r.tag}' at line ${line}`);
  }

  private cmpVals(l: VelaValue, r: VelaValue): number {
    if (l.tag === 'num' && r.tag === 'num') return l.val - r.val;
    if (l.tag === 'str' && r.tag === 'str') return l.val < r.val ? -1 : l.val > r.val ? 1 : 0;
    if (l.tag === 'unitVal' && r.tag === 'unitVal') return l.val - r.val;
    if (l.tag === 'money' && r.tag === 'money') return l.cents - r.cents;
    return 0;
  }

  private async evalExpr(expr: Expr, env: RuntimeEnv): Promise<VelaValue> {
    this.stepGuard((expr as { line: number }).line || 0);

    switch (expr.kind) {
      case 'BlockExpr':
        return await this.execBlock(expr, env);

      case 'LiteralExpr':
        if (expr.unit) {
          if (expr.unit === 'money') return { tag: 'money', cents: Math.round(Number(expr.value) * 100), currency: 'usd' };
          return { tag: 'unitVal', val: Number(expr.value), unit: expr.unit };
        }
        if (expr.litType === 'num') return { tag: 'num', val: Number(expr.value) };
        if (expr.litType === 'str') return { tag: 'str', val: String(expr.value) };
        if (expr.litType === 'bool') return { tag: 'bool', val: Boolean(expr.value) };
        if (expr.litType === 'char') return { tag: 'char', val: String(expr.value) };
        if (expr.litType === 'color') return { tag: 'color', val: String(expr.value) };
        return { tag: 'nil' };

      case 'InterpStrExpr': {
        let out = '';
        for (const p of expr.parts) {
          if (p.type === 'text') out += p.text;
          else out += formatVelaValue(await this.evalExpr(p.expr, env));
        }
        return { tag: 'str', val: out };
      }

      case 'IdentExpr': {
        const b = this.lookup(env, expr.name);
        if (b) return b.val;
        throw new Error(`Undefined identifier '${expr.name}' at line ${expr.line}`);
      }

      case 'SelfExpr': {
        const b = this.lookup(env, 'self');
        if (b) return b.val;
        throw new Error(`'self' used outside method at line ${expr.line}`);
      }

      case 'ImplicitDotExpr':
        return { tag: 'str', val: expr.name };

      case 'ListExpr': {
        const items: VelaValue[] = [];
        for (const it of expr.items) items.push(await this.evalExpr(it, env));
        const arcId = this.arc.alloc('list', 'List', Math.max(24, items.length * 16), expr.line);
        return { tag: 'list', items, arcId };
      }

      case 'ListCompExpr': {
        const iterVal = await this.evalExpr(expr.iter, env);
        const out: VelaValue[] = [];
        for (const it of this.toIterable(iterVal)) {
          const scope: RuntimeEnv = { bindings: new Map(), parent: env };
          scope.bindings.set(expr.varName, { val: it, isMut: false });
          if (!expr.cond || isTruthy(await this.evalExpr(expr.cond, scope))) {
            out.push(await this.evalExpr(expr.body, scope));
          }
        }
        const arcId = this.arc.alloc('list_comp', 'List', Math.max(24, out.length * 16), expr.line);
        return { tag: 'list', items: out, arcId };
      }

      case 'TupleExpr': {
        const items: VelaValue[] = [];
        for (const it of expr.items) items.push(await this.evalExpr(it, env));
        return { tag: 'tuple', items };
      }

      case 'MapExpr': {
        const entries = new Map<string, VelaValue>();
        for (const e of expr.entries) {
          const k = formatVelaValue(await this.evalExpr(e.key, env));
          const v = await this.evalExpr(e.value, env);
          entries.set(k, v);
        }
        const arcId = this.arc.alloc('map', 'Map', Math.max(32, entries.size * 24), expr.line);
        return { tag: 'map', entries, arcId };
      }

      case 'StructLitExpr': {
        const def = this.structs.get(expr.name);
        const fields = new Map<string, VelaValue>();
        if (def) {
          for (const f of def.fields) {
            if (f.defaultVal) fields.set(f.name, await this.evalExpr(f.defaultVal, env));
            else fields.set(f.name, { tag: 'nil' });
          }
        }
        const refs: number[] = [];
        for (const f of expr.fields) {
          const fv = await this.evalExpr(f.value, env);
          fields.set(f.name, fv);
          if (fv.tag === 'struct' && fv.arcId) refs.push(fv.arcId);
        }
        const arcId = this.arc.alloc(expr.name, def?.isShared ? 'SharedStruct' : 'Struct', 64, expr.line, refs);
        return { tag: 'struct', typeName: expr.name, fields, isShared: Boolean(def?.isShared), arcId };
      }

      case 'PathExpr': {
        const ns = this.lookup(env, expr.base)?.val;
        if (ns && ns.tag === 'map' && ns.entries.has(expr.member)) {
          return ns.entries.get(expr.member)!;
        }
        if (this.enums.has(expr.base)) {
          return { tag: 'enum', typeName: expr.base, variant: expr.member, payload: [] };
        }
        throw new Error(`Unknown path ${expr.base}::${expr.member} at line ${expr.line}`);
      }

      case 'RangeExpr': {
        const s = await this.evalExpr(expr.start, env);
        const e = await this.evalExpr(expr.end, env);
        const startN = s.tag === 'num' ? Math.floor(s.val) : 0;
        const endN = e.tag === 'num' ? Math.floor(e.val) : 0;
        const items: VelaValue[] = [];
        const limit = expr.inclusive ? endN + 1 : endN;
        for (let i = startN; i < limit && items.length < 10_000; i++) {
          items.push({ tag: 'num', val: i, isInt: true });
        }
        return { tag: 'list', items };
      }

      case 'UnaryExpr': {
        const v = await this.evalExpr(expr.expr, env);
        if (expr.op === '!') return { tag: 'bool', val: !isTruthy(v) };
        if (expr.op === '-' && v.tag === 'num') return { tag: 'num', val: -v.val };
        if (expr.op === '~' && v.tag === 'num') return { tag: 'num', val: ~(v.val | 0) };
        return v;
      }

      case 'BinaryExpr': {
        if (expr.op === '&&') {
          const l = await this.evalExpr(expr.left, env);
          if (!isTruthy(l)) return { tag: 'bool', val: false };
          return { tag: 'bool', val: isTruthy(await this.evalExpr(expr.right, env)) };
        }
        if (expr.op === '||') {
          const l = await this.evalExpr(expr.left, env);
          if (isTruthy(l)) return { tag: 'bool', val: true };
          return { tag: 'bool', val: isTruthy(await this.evalExpr(expr.right, env)) };
        }
        if (expr.op === '??') {
          const l = await this.evalExpr(expr.left, env);
          if (l.tag === 'nil' || (l.tag === 'option' && !l.some)) {
            return await this.evalExpr(expr.right, env);
          }
          if (l.tag === 'option' && l.some && l.val) return l.val;
          return l;
        }
        if (expr.op === '|>') {
          const l = await this.evalExpr(expr.left, env);
          if (expr.right.kind === 'CallExpr') {
            const fnVal = await this.evalExpr(expr.right.callee, env);
            const restArgs: VelaValue[] = [];
            for (const a of expr.right.args) restArgs.push(await this.evalExpr(a.value, env));
            return await this.invokeFn(fnVal, [l, ...restArgs], new Map());
          }
          const fnVal = await this.evalExpr(expr.right, env);
          return await this.invokeFn(fnVal, [l], new Map());
        }
        const l = await this.evalExpr(expr.left, env);
        const r = await this.evalExpr(expr.right, env);
        return this.evalBinary(expr.op, l, r, expr.line);
      }

      case 'CastExpr': {
        return await this.evalExpr(expr.expr, env);
      }

      case 'ClosureExpr': {
        const arcId = this.arc.alloc('closure', 'Closure', 48, expr.line);
        return {
          tag: 'fn',
          name: '<closure>',
          params: expr.params.map((p) => ({ name: p })),
          body: expr.body,
          env,
          isMove: expr.isMove,
        };
      }

      case 'IfExpr': {
        const cond = await this.evalExpr(expr.cond, env);
        if (isTruthy(cond)) return await this.execBlock(expr.thenBranch, env);
        if (expr.elseBranch) return await this.evalExpr(expr.elseBranch, env);
        return { tag: 'nil' };
      }

      case 'MatchExpr': {
        const target = await this.evalExpr(expr.target, env);
        for (const arm of expr.arms) {
          for (const pat of arm.patterns) {
            const bound = await this.matchPattern(pat, target, env);
            if (bound) {
              const armEnv: RuntimeEnv = { bindings: bound, parent: env };
              if (arm.guard && !isTruthy(await this.evalExpr(arm.guard, armEnv))) {
                continue;
              }
              return await this.evalExpr(arm.body, armEnv);
            }
          }
        }
        return { tag: 'nil' };
      }

      case 'TryExpr': {
        try {
          const v = await this.evalExpr(expr.expr, env);
          if (v.tag === 'result' && !v.ok && expr.catchBody) {
            const cEnv: RuntimeEnv = { bindings: new Map(), parent: env };
            if (expr.catchVar) cEnv.bindings.set(expr.catchVar, { val: v.val, isMut: false });
            return await this.execBlock(expr.catchBody, cEnv);
          }
          return v.tag === 'result' && v.ok ? v.val : v;
        } catch (sig) {
          if (sig instanceof FailSignal && expr.catchBody) {
            const cEnv: RuntimeEnv = { bindings: new Map(), parent: env };
            if (expr.catchVar) cEnv.bindings.set(expr.catchVar, { val: sig.val, isMut: false });
            return await this.execBlock(expr.catchBody, cEnv);
          }
          throw sig;
        }
      }

      case 'TryQExpr': {
        const v = await this.evalExpr(expr.expr, env);
        if (v.tag === 'result') {
          if (v.ok) return v.val;
          throw new ReturnSignal(v);
        }
        if (v.tag === 'option') {
          if (v.some && v.val) return v.val;
          throw new ReturnSignal({ tag: 'option', some: false });
        }
        return v;
      }

      case 'AwaitExpr': {
        const v = await this.evalExpr(expr.expr, env);
        if (v.tag === 'task') {
          this.logConcurrency(v.id, v.name, 'await', `Awaiting Task #${v.id}`);
          const res = await v.promise;
          v.status = 'done';
          v.result = res;
          return res;
        }
        return v;
      }

      case 'SpawnExpr': {
        const tid = this.nextTaskId++;
        this.logConcurrency(tid, `spawn#${tid}`, 'spawn', `Spawned concurrent task`);
        const p = this.evalExpr(expr.expr, env);
        return { tag: 'task', id: tid, name: `spawn#${tid}`, promise: p, status: 'running' };
      }

      case 'ComptimeExpr':
      case 'UnsafeExpr':
        return await this.execBlock(expr.body, env);

      case 'AsmExpr':
        this.kernel.execAsm(expr.instructions);
        return { tag: 'nil' };

      case 'IndexExpr': {
        const target = await this.evalExpr(expr.target, env);
        if (expr.optional && (target.tag === 'nil' || (target.tag === 'option' && !target.some))) {
          return { tag: 'option', some: false };
        }
        const idx = await this.evalExpr(expr.index, env);
        if (target.tag === 'list' && idx.tag === 'num') {
          const i = idx.val < 0 ? target.items.length + idx.val : idx.val;
          const item = target.items[Math.floor(i)];
          if (!item) throw new Error(`Index ${idx.val} out of bounds at line ${expr.line}`);
          return item;
        }
        if (target.tag === 'str' && idx.tag === 'num') {
          const i = idx.val < 0 ? target.val.length + idx.val : idx.val;
          const ch = target.val[Math.floor(i)];
          if (ch === undefined) throw new Error(`String index ${idx.val} out of bounds at line ${expr.line}`);
          return { tag: 'str', val: ch };
        }
        if (target.tag === 'map') {
          return target.entries.get(formatVelaValue(idx)) ?? { tag: 'nil' };
        }
        return { tag: 'nil' };
      }

      case 'MemberExpr': {
        const target = await this.evalExpr(expr.target, env);
        if (expr.optional && (target.tag === 'nil' || (target.tag === 'option' && !target.some))) {
          return { tag: 'option', some: false };
        }
        const unwrapped = target.tag === 'option' && target.some && target.val ? target.val : target;
        if (unwrapped.tag === 'map' && unwrapped.entries.has(expr.member)) {
          return unwrapped.entries.get(expr.member)!;
        }
        if (unwrapped.tag === 'struct') {
          if (unwrapped.fields.has(expr.member)) return unwrapped.fields.get(expr.member)!;
          const mFn = this.methods.get(unwrapped.typeName)?.get(expr.member);
          if (mFn) return this.bindMethod(unwrapped, mFn, env);
        }
        if (unwrapped.tag === 'enum') {
          const mFn = this.methods.get(unwrapped.typeName)?.get(expr.member);
          if (mFn) return this.bindMethod(unwrapped, mFn, env);
          if (expr.member === 'message') {
            return {
              tag: 'nativeFn',
              name: 'Error.message',
              call: () => ({ tag: 'str', val: formatVelaValue(unwrapped) }),
            };
          }
        }
        // Builtin properties / methods on Str, List, Tensor, Money, Ptr, Task, Channel
        return this.resolveBuiltinMember(unwrapped, expr.member, expr.optional);
      }

      case 'CallExpr': {
        const callee = await this.evalExpr(expr.callee, env);
        const args: VelaValue[] = [];
        const named = new Map<string, VelaValue>();
        for (const a of expr.args) {
          const val = await this.evalExpr(a.value, env);
          if (a.name) named.set(a.name, val);
          else args.push(val);
        }
        return await this.invokeFn(callee, args, named);
      }

      default:
        return { tag: 'nil' };
    }
  }

  private bindMethod(selfVal: VelaValue, fnStmt: FnStmt, env: RuntimeEnv): VelaValue {
    const mEnv: RuntimeEnv = { bindings: new Map([['self', { val: selfVal, isMut: true }]]), parent: env };
    const filteredParams = fnStmt.params.filter((p) => p.name !== 'self');
    return {
      tag: 'fn',
      name: fnStmt.name,
      params: filteredParams,
      body: fnStmt.body,
      env: mEnv,
      isAsync: fnStmt.isAsync,
      isGen: fnStmt.isGen,
    };
  }

  private async invokeFn(callee: VelaValue, args: VelaValue[], named: Map<string, VelaValue>): Promise<VelaValue> {
    if (callee.tag === 'map' && callee.entries.has('__call')) {
      return await this.invokeFn(callee.entries.get('__call')!, args, named);
    }
    if (callee.tag === 'nativeFn') {
      return await callee.call(args, named);
    }
    if (callee.tag === 'fn') {
      const fnEnv: RuntimeEnv = { bindings: new Map(), parent: callee.env };
      let posIdx = 0;
      for (const p of callee.params) {
        let val: VelaValue | undefined;
        if (named.has(p.name)) {
          val = named.get(p.name);
        } else if (posIdx < args.length) {
          val = args[posIdx++];
        } else if (p.defaultVal) {
          val = await this.evalExpr(p.defaultVal, callee.env);
        } else {
          val = { tag: 'nil' };
        }
        fnEnv.bindings.set(p.name, { val: val!, isMut: Boolean(p.isMut) });
      }

      if (callee.name === 'haltForever') {
        throw new Error('__KERNEL_HALT__');
      }

      const runBody = async (): Promise<VelaValue> => {
        try {
          if (callee.body.kind === 'BlockExpr') {
            return await this.execBlock(callee.body, fnEnv);
          }
          return await this.evalExpr(callee.body, fnEnv);
        } catch (sig) {
          if (sig instanceof ReturnSignal) return sig.val;
          if (sig instanceof FailSignal) return { tag: 'result', ok: false, val: sig.val };
          throw sig;
        }
      };

      if (callee.isAsync) {
        const tid = this.nextTaskId++;
        this.logConcurrency(tid, callee.name, 'spawn', `Started async fn ${callee.name}`);
        const promise = runBody().then((res) => {
          this.logConcurrency(tid, callee.name, 'complete', `Completed async fn ${callee.name}`);
          return res;
        });
        return { tag: 'task', id: tid, name: callee.name, promise, status: 'running' };
      }

      return await runBody();
    }
    throw new Error(`Value '${formatVelaValue(callee)}' is not callable`);
  }

  private async matchPattern(
    pat: MatchPattern,
    target: VelaValue,
    env: RuntimeEnv
  ): Promise<Map<string, { val: VelaValue; isMut: boolean }> | null> {
    const bound = new Map<string, { val: VelaValue; isMut: boolean }>();
    if (pat.kind === 'Wildcard') return bound;
    if (pat.kind === 'Literal') {
      if (pat.value === null && (target.tag === 'nil' || (target.tag === 'option' && !target.some))) return bound;
      if (target.tag === 'num' && target.val === pat.value) return bound;
      if (target.tag === 'str' && target.val === pat.value) return bound;
      if (target.tag === 'bool' && target.val === pat.value) return bound;
      return null;
    }
    if (pat.kind === 'Range') {
      if (target.tag !== 'num') return null;
      const s = await this.evalExpr(pat.start, env);
      const e = await this.evalExpr(pat.end, env);
      const sn = s.tag === 'num' ? s.val : 0;
      const en = e.tag === 'num' ? e.val : 0;
      const ok = pat.inclusive ? target.val >= sn && target.val <= en : target.val >= sn && target.val < en;
      return ok ? bound : null;
    }
    if (pat.kind === 'Ident') {
      bound.set(pat.name, { val: target, isMut: false });
      return bound;
    }
    if (pat.kind === 'Enum') {
      if (pat.variant === 'Some' && target.tag === 'option' && target.some && target.val) {
        if (pat.bindings[0]) bound.set(pat.bindings[0], { val: target.val, isMut: false });
        return bound;
      }
      if (pat.variant === 'Ok' && target.tag === 'result' && target.ok) {
        if (pat.bindings[0]) bound.set(pat.bindings[0], { val: target.val, isMut: false });
        return bound;
      }
      if (pat.variant === 'Err' && target.tag === 'result' && !target.ok) {
        if (pat.bindings[0]) bound.set(pat.bindings[0], { val: target.val, isMut: false });
        return bound;
      }
      if (target.tag === 'enum' && target.variant === pat.variant && (!pat.enumName || target.typeName === pat.enumName)) {
        pat.bindings.forEach((b, i) => {
          if (b !== '_') bound.set(b, { val: target.payload[i] ?? { tag: 'nil' }, isMut: false });
        });
        return bound;
      }
      return null;
    }
    return null;
  }

  private resolveBuiltinMember(target: VelaValue, member: string, optional?: boolean): VelaValue {
    const wrapOpt = (v: VelaValue): VelaValue => (optional ? { tag: 'option', some: true, val: v } : v);

    if (target.tag === 'str') {
      if (member === 'len') return { tag: 'num', val: target.val.length, isInt: true };
      if (member === 'isEmpty') return { tag: 'bool', val: target.val.length === 0 };
      if (member === 'upper') return { tag: 'nativeFn', name: 'Str.upper', call: () => ({ tag: 'str', val: target.val.toUpperCase() }) };
      if (member === 'lower') return { tag: 'nativeFn', name: 'Str.lower', call: () => ({ tag: 'str', val: target.val.toLowerCase() }) };
      if (member === 'trim') return { tag: 'nativeFn', name: 'Str.trim', call: () => ({ tag: 'str', val: target.val.trim() }) };
      if (member === 'split') return { tag: 'nativeFn', name: 'Str.split', call: ([sep]) => ({ tag: 'list', items: target.val.split(formatVelaValue(sep)).map((s) => ({ tag: 'str', val: s })) }) };
      if (member === 'contains') return { tag: 'nativeFn', name: 'Str.contains', call: ([sub]) => ({ tag: 'bool', val: target.val.includes(formatVelaValue(sub)) }) };
      if (member === 'startsWith') return { tag: 'nativeFn', name: 'Str.startsWith', call: ([p]) => ({ tag: 'bool', val: target.val.startsWith(formatVelaValue(p)) }) };
      if (member === 'endsWith') return { tag: 'nativeFn', name: 'Str.endsWith', call: ([p]) => ({ tag: 'bool', val: target.val.endsWith(formatVelaValue(p)) }) };
      if (member === 'toInt') return { tag: 'nativeFn', name: 'Str.toInt', call: () => ({ tag: 'num', val: target.val.charCodeAt(0) || 0, isInt: true }) };
      if (member === 'enumerate') {
        return {
          tag: 'nativeFn',
          name: 'Str.enumerate',
          call: () => ({
            tag: 'list',
            items: target.val.split('').map((ch, idx) => ({
              tag: 'tuple',
              items: [{ tag: 'num', val: idx, isInt: true }, { tag: 'str', val: ch }],
            })),
          }),
        };
      }
    }

    if (target.tag === 'char') {
      if (member === 'toInt') return { tag: 'nativeFn', name: 'Char.toInt', call: () => ({ tag: 'num', val: target.val.charCodeAt(0) || 0, isInt: true }) };
    }

    if (target.tag === 'list') {
      if (member === 'len') return { tag: 'num', val: target.items.length, isInt: true };
      if (member === 'isEmpty') return { tag: 'bool', val: target.items.length === 0 };
      if (member === 'push') {
        return {
          tag: 'nativeFn',
          name: 'List.push',
          call: ([x]) => {
            if (target.arcId) target.arcId = this.arc.cowSplit(target.arcId, 'list', 'List', target.items.length * 16, 0);
            target.items.push(x);
            return { tag: 'nil' };
          },
        };
      }
      if (member === 'map') {
        return {
          tag: 'nativeFn',
          name: 'List.map',
          call: async ([fn]) => {
            const out: VelaValue[] = [];
            for (const x of target.items) out.push(await this.invokeFn(fn, [x], new Map()));
            return { tag: 'list', items: out };
          },
        };
      }
      if (member === 'filter') {
        return {
          tag: 'nativeFn',
          name: 'List.filter',
          call: async ([fn]) => {
            const out: VelaValue[] = [];
            for (const x of target.items) {
              if (isTruthy(await this.invokeFn(fn, [x], new Map()))) out.push(x);
            }
            return { tag: 'list', items: out };
          },
        };
      }
      if (member === 'fold') {
        return {
          tag: 'nativeFn',
          name: 'List.fold',
          call: async ([init, fn]) => {
            let acc = init;
            for (const x of target.items) acc = await this.invokeFn(fn, [acc, x], new Map());
            return acc;
          },
        };
      }
      if (member === 'any') {
        return {
          tag: 'nativeFn',
          name: 'List.any',
          call: async ([fn]) => {
            for (const x of target.items) {
              if (isTruthy(await this.invokeFn(fn, [x], new Map()))) return { tag: 'bool', val: true };
            }
            return { tag: 'bool', val: false };
          },
        };
      }
      if (member === 'find') {
        return {
          tag: 'nativeFn',
          name: 'List.find',
          call: async ([fn]) => {
            for (const x of target.items) {
              if (isTruthy(await this.invokeFn(fn, [x], new Map()))) return { tag: 'option', some: true, val: x };
            }
            return { tag: 'option', some: false };
          },
        };
      }
      if (member === 'take') {
        return {
          tag: 'nativeFn',
          name: 'List.take',
          call: ([n]) => ({ tag: 'list', items: target.items.slice(0, n.tag === 'num' ? n.val : 0) }),
        };
      }
      if (member === 'join') {
        return {
          tag: 'nativeFn',
          name: 'List.join',
          call: ([sep]) => ({ tag: 'str', val: target.items.map(formatVelaValue).join(formatVelaValue(sep)) }),
        };
      }
      if (member === 'enumerate') {
        return {
          tag: 'nativeFn',
          name: 'List.enumerate',
          call: () => ({
            tag: 'list',
            items: target.items.map((x, idx) => ({ tag: 'tuple', items: [{ tag: 'num', val: idx, isInt: true }, x] })),
          }),
        };
      }
    }

    if (target.tag === 'tensor') {
      if (member === 'shape') return { tag: 'list', items: target.shape.map((s) => ({ tag: 'num', val: s, isInt: true })) };
      if (member === 'scalar') return { tag: 'nativeFn', name: 'Tensor.scalar', call: () => ({ tag: 'num', val: target.data[0] ?? 0 }) };
      if (member === 'toList') return { tag: 'nativeFn', name: 'Tensor.toList', call: () => ({ tag: 'list', items: target.data.map((d) => ({ tag: 'num', val: Number(d.toFixed(4)) })) }) };
      if (member === 'argmax') {
        return {
          tag: 'nativeFn',
          name: 'Tensor.argmax',
          call: () => {
            let best = 0;
            for (let i = 1; i < target.data.length; i++) if (target.data[i] > target.data[best]) best = i;
            return { tag: 'tensor', dtype: 'Int', shape: [1], data: [best] };
          },
        };
      }
    }

    if (target.tag === 'result') {
      if (member === 'isOk') return { tag: 'bool', val: target.ok };
      if (member === 'unwrap') return { tag: 'nativeFn', name: 'Result.unwrap', call: () => target.val };
    }

    if (target.tag === 'ptr') {
      if (member === 'add') {
        return {
          tag: 'nativeFn',
          name: 'Ptr.add',
          call: ([offset]) => ({
            tag: 'ptr',
            addr: target.addr + (offset.tag === 'num' ? Math.floor(offset.val) : 0) * 2,
            pointeeType: target.pointeeType,
          }),
        };
      }
      if (member === 'write') {
        return {
          tag: 'nativeFn',
          name: 'Ptr.write',
          call: ([val]) => {
            const v = val.tag === 'num' ? val.val : 0;
            if (target.addr >= 0xb8000 && target.addr < 0xb8fa0) {
              const idx = Math.floor((target.addr - 0xb8000) / 2);
              this.kernel.writeVgaCell(idx, v);
            }
            return { tag: 'nil' };
          },
        };
      }
    }

    if (target.tag === 'channel') {
      if (member === 'send') {
        return {
          tag: 'nativeFn',
          name: 'Channel.send',
          call: ([val]) => {
            this.logConcurrency(0, `chan#${target.id}`, 'send', `Sent ${formatVelaValue(val)} to channel`);
            if (target.waiters.length > 0) {
              const wake = target.waiters.shift()!;
              wake(val);
            } else {
              target.buffer.push(val);
            }
            return { tag: 'nil' };
          },
        };
      }
      if (member === 'recv') {
        return {
          tag: 'nativeFn',
          name: 'Channel.recv',
          call: async () => {
            if (target.buffer.length > 0) {
              const val = target.buffer.shift()!;
              this.logConcurrency(0, `chan#${target.id}`, 'recv', `Received ${formatVelaValue(val)} from channel`);
              return { tag: 'option', some: true, val };
            }
            if (target.closed) return { tag: 'option', some: false };
            return await new Promise<VelaValue>((resolve) => {
              target.waiters.push((val) => {
                this.logConcurrency(0, `chan#${target.id}`, 'recv', `Woke & received ${formatVelaValue(val)}`);
                resolve({ tag: 'option', some: true, val });
              });
            });
          },
        };
      }
      if (member === 'close') {
        return {
          tag: 'nativeFn',
          name: 'Channel.close',
          call: () => {
            target.closed = true;
            return { tag: 'nil' };
          },
        };
      }
    }

    if (target.tag === 'unitVal') {
      if (member === 'value') return wrapOpt({ tag: 'num', val: target.val });
    }
    if (target.tag === 'money') {
      if (member === 'value') return wrapOpt({ tag: 'num', val: target.cents / 100 });
      if (member === 'currency') return wrapOpt({ tag: 'str', val: target.currency });
      if (member === 'roundTo') return { tag: 'nativeFn', name: 'Money.roundTo', call: () => target };
    }
    if (target.tag === 'num') {
      if (member === 'money') {
        return {
          tag: 'nativeFn',
          name: 'num.money',
          call: ([cur]) => ({
            tag: 'money',
            cents: Math.round(target.val * 100),
            currency: cur ? formatVelaValue(cur) : 'usd',
          }),
        };
      }
    }

    return { tag: 'nil' };
  }

  private seedStdlib(env: RuntimeEnv) {
    const bind = (name: string, val: VelaValue) => env.bindings.set(name, { val, isMut: false });
    const fn = (name: string, call: (args: VelaValue[], named?: Map<string, VelaValue>) => Promise<VelaValue> | VelaValue): VelaValue => ({
      tag: 'nativeFn',
      name,
      call,
    });

    bind('unit', { tag: 'nil' });
    bind('print', fn('print', (args) => { this.emitPrint(args.map(formatVelaValue).join(' '), false); return { tag: 'nil' }; }));
    bind('println', fn('println', (args) => { this.emitPrint(args.map(formatVelaValue).join(' '), true); return { tag: 'nil' }; }));
    bind('len', fn('len', ([x]) => {
      if (x.tag === 'str') return { tag: 'num', val: x.val.length, isInt: true };
      if (x.tag === 'list' || x.tag === 'tuple') return { tag: 'num', val: x.items.length, isInt: true };
      if (x.tag === 'map') return { tag: 'num', val: x.entries.size, isInt: true };
      throw new Error(`len() expects string, list, or map (got ${x.tag})`);
    }));
    bind('str', fn('str', ([x]) => ({ tag: 'str', val: formatVelaValue(x) })));
    bind('num', fn('num', ([x]) => {
      if (x.tag === 'num') return x;
      if (x.tag === 'bool') return { tag: 'num', val: x.val ? 1 : 0 };
      const parsed = Number(formatVelaValue(x));
      if (Number.isNaN(parsed)) throw new Error(`Cannot convert '${formatVelaValue(x)}' to num`);
      return { tag: 'num', val: parsed };
    }));
    bind('type', fn('type', ([x]) => ({ tag: 'str', val: x.tag })));
    bind('push', fn('push', ([list, val]) => {
      if (list.tag !== 'list') throw new Error('push() expects list');
      if (list.arcId) list.arcId = this.arc.cowSplit(list.arcId, 'list', 'List', list.items.length * 16, 0);
      list.items.push(val);
      return { tag: 'nil' };
    }));
    bind('at', fn('at', ([list, idx]) => {
      if (list.tag !== 'list' || idx.tag !== 'num') throw new Error('at() expects (list, num)');
      const i = idx.val < 0 ? list.items.length + idx.val : idx.val;
      if (i < 0 || i >= list.items.length) throw new Error(`Index ${idx.val} out of bounds`);
      return list.items[Math.floor(i)];
    }));
    bind('set', fn('set', ([list, idx, val]) => {
      if (list.tag !== 'list' || idx.tag !== 'num') throw new Error('set() expects (list, num, val)');
      const i = idx.val < 0 ? list.items.length + idx.val : idx.val;
      list.items[Math.floor(i)] = val;
      return { tag: 'nil' };
    }));
    bind('range', fn('range', ([n]) => {
      const lim = n.tag === 'num' ? Math.floor(n.val) : 0;
      return { tag: 'list', items: Array.from({ length: Math.max(0, lim) }, (_, i) => ({ tag: 'num', val: i, isInt: true })) };
    }));
    bind('split', fn('split', ([s, sep]) => ({ tag: 'list', items: formatVelaValue(s).split(formatVelaValue(sep)).map((p) => ({ tag: 'str', val: p })) })));
    bind('join', fn('join', ([l, sep]) => ({ tag: 'str', val: l.tag === 'list' ? l.items.map(formatVelaValue).join(formatVelaValue(sep)) : '' })));
    bind('upper', fn('upper', ([s]) => ({ tag: 'str', val: formatVelaValue(s).toUpperCase() })));
    bind('lower', fn('lower', ([s]) => ({ tag: 'str', val: formatVelaValue(s).toLowerCase() })));
    bind('trim', fn('trim', ([s]) => ({ tag: 'str', val: formatVelaValue(s).trim() })));
    bind('replace', fn('replace', ([s, from, to]) => ({ tag: 'str', val: formatVelaValue(s).split(formatVelaValue(from)).join(formatVelaValue(to)) })));
    bind('contains', fn('contains', ([h, n]) => {
      if (h.tag === 'str') return { tag: 'bool', val: h.val.includes(formatVelaValue(n)) };
      if (h.tag === 'list') return { tag: 'bool', val: h.items.some((x) => valuesEqual(x, n)) };
      return { tag: 'bool', val: false };
    }));
    bind('indexOf', fn('indexOf', ([h, n]) => {
      if (h.tag === 'str') return { tag: 'num', val: h.val.indexOf(formatVelaValue(n)), isInt: true };
      if (h.tag === 'list') return { tag: 'num', val: h.items.findIndex((x) => valuesEqual(x, n)), isInt: true };
      return { tag: 'num', val: -1, isInt: true };
    }));
    bind('startsWith', fn('startsWith', ([s, p]) => ({ tag: 'bool', val: formatVelaValue(s).startsWith(formatVelaValue(p)) })));
    bind('endsWith', fn('endsWith', ([s, p]) => ({ tag: 'bool', val: formatVelaValue(s).endsWith(formatVelaValue(p)) })));
    bind('keys', fn('keys', ([m]) => ({ tag: 'list', items: m.tag === 'map' ? Array.from(m.entries.keys()).map((k) => ({ tag: 'str', val: k })) : [] })));
    bind('values', fn('values', ([m]) => ({ tag: 'list', items: m.tag === 'map' ? Array.from(m.entries.values()) : [] })));
    bind('has', fn('has', ([m, k]) => ({ tag: 'bool', val: m.tag === 'map' && m.entries.has(formatVelaValue(k)) })));
    bind('remove', fn('remove', ([m, k]) => { if (m.tag === 'map') m.entries.delete(formatVelaValue(k)); return { tag: 'nil' }; }));
    bind('abs', fn('abs', ([x]) => ({ tag: 'num', val: Math.abs(x.tag === 'num' ? x.val : 0) })));
    bind('sqrt', fn('sqrt', ([x]) => ({ tag: 'num', val: Math.sqrt(x.tag === 'num' ? x.val : 0) })));
    bind('floor', fn('floor', ([x]) => ({ tag: 'num', val: Math.floor(x.tag === 'num' ? x.val : 0) })));
    bind('ceil', fn('ceil', ([x]) => ({ tag: 'num', val: Math.ceil(x.tag === 'num' ? x.val : 0) })));
    bind('assert', fn('assert', ([x]) => { if (!isTruthy(x)) throw new Error('assertion failed'); return { tag: 'nil' }; }));
    bind('assertEq', fn('assertEq', ([a, b]) => { if (!valuesEqual(a, b)) throw new Error(`assertEq failed: ${formatVelaValue(a)} != ${formatVelaValue(b)}`); return { tag: 'nil' }; }));
    bind('error', fn('error', ([m]) => { throw new Error(formatVelaValue(m)); }));
    bind('unreachable', fn('unreachable', () => { throw new Error('entered unreachable code'); }));

    bind('Ok', fn('Ok', ([v]) => ({ tag: 'result', ok: true, val: v })));
    bind('Err', fn('Err', ([v]) => ({ tag: 'result', ok: false, val: v })));
    bind('Some', fn('Some', ([v]) => ({ tag: 'option', some: true, val: v })));

    // Concurrency: TaskGroup & Channel
    bind('TaskGroup', fn('TaskGroup', () => {
      const m = new Map<string, VelaValue>();
      m.set('spawn', fn('TaskGroup.spawn', ([closure]) => {
        const tid = this.nextTaskId++;
        this.logConcurrency(tid, `TaskGroup#${tid}`, 'spawn', `TaskGroup spawned worker #${tid}`);
        const p = Promise.resolve().then(async () => {
          const res = await this.invokeFn(closure, [], new Map());
          this.logConcurrency(tid, `TaskGroup#${tid}`, 'complete', `Worker #${tid} finished`);
          return res;
        });
        return { tag: 'task', id: tid, name: `TaskGroup#${tid}`, promise: p, status: 'running' };
      }));
      return { tag: 'map', entries: m };
    }));
    bind('Channel', fn('Channel', ([cap]) => ({
      tag: 'channel',
      id: this.nextChanId++,
      capacity: cap && cap.tag === 'num' ? cap.val : 16,
      buffer: [],
      waiters: [],
      closed: false,
    })));

    // Standard Modules: time, num, float, json, fs, uuid, math, tensor, nn, train, db, port, cpu, interrupts, Ptr, Char, Duration
    bind('time', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['sleep', fn('time.sleep', async ([d]) => {
          const ms = d && d.tag === 'num' ? Math.min(d.val, 50) : 5;
          await new Promise((r) => setTimeout(r, ms));
          return { tag: 'nil' };
        })],
        ['now', fn('time.now', () => ({ tag: 'num', val: Date.now(), isInt: true }))],
      ]),
    });
    bind('Duration', {
      tag: 'map',
      entries: new Map([['fromMillis', fn('Duration.fromMillis', ([ms]) => ms)]]),
    });
    bind('num', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['__call', fn('num', ([x]) => {
          if (x.tag === 'num') return x;
          if (x.tag === 'bool') return { tag: 'num', val: x.val ? 1 : 0 };
          const parsed = Number(formatVelaValue(x));
          if (Number.isNaN(parsed)) throw new Error(`Cannot convert '${formatVelaValue(x)}' to num`);
          return { tag: 'num', val: parsed };
        })],
        ['format', fn('num.format', ([v], named) => {
          const p = named?.get('precision');
          const prec = p && p.tag === 'num' ? p.val : 2;
          return { tag: 'str', val: v.tag === 'num' ? v.val.toFixed(prec) : formatVelaValue(v) };
        })],
      ]),
    });
    bind('float', {
      tag: 'map',
      entries: new Map([['format', fn('float.format', ([v]) => ({ tag: 'str', val: `$${v.tag === 'num' ? v.val.toFixed(2) : '0.00'}` }))]]),
    });
    bind('json', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['encode', fn('json.encode', ([v]) => ({ tag: 'str', val: JSON.stringify(this.toJs(v)) }))],
        ['parse', fn('json.parse', ([s]) => ({ tag: 'result', ok: true, val: this.fromJs(JSON.parse(formatVelaValue(s))) }))],
      ]),
    });
    bind('fs', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['writeStr', fn('fs.writeStr', ([p, c]) => { this.vfs.set(formatVelaValue(p), formatVelaValue(c)); return { tag: 'result', ok: true, val: { tag: 'nil' } }; })],
        ['readStr', fn('fs.readStr', ([p]) => {
          const k = formatVelaValue(p);
          return this.vfs.has(k)
            ? { tag: 'result', ok: true, val: { tag: 'str', val: this.vfs.get(k)! } }
            : { tag: 'result', ok: false, val: { tag: 'str', val: `ENOENT: ${k}` } };
        })],
        ['exists', fn('fs.exists', ([p]) => ({ tag: 'result', ok: true, val: { tag: 'bool', val: this.vfs.has(formatVelaValue(p)) } }))],
      ]),
    });
    bind('uuid', {
      tag: 'map',
      entries: new Map([['v4', fn('uuid.v4', () => ({ tag: 'str', val: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | 0).toString(16)) }))]]),
    });
    bind('math', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['pi', { tag: 'num', val: Math.PI }],
        ['sin', fn('math.sin', ([x]) => ({ tag: 'num', val: Math.sin(x.tag === 'num' ? x.val : 0) }))],
        ['cos', fn('math.cos', ([x]) => ({ tag: 'num', val: Math.cos(x.tag === 'num' ? x.val : 0) }))],
        ['exp', fn('math.exp', ([x]) => ({ tag: 'num', val: Math.exp(x.tag === 'num' ? x.val : 0) }))],
      ]),
    });

    // AI / ML modules
    bind('tensor', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['zeros', fn('tensor.zeros', ([shape]) => {
          const dims = shape.tag === 'list' ? shape.items.map((x) => (x.tag === 'num' ? x.val : 1)) : [1];
          const t = this.ml.zeros(dims);
          return { tag: 'tensor', dtype: 'Float32', shape: t.shape, data: t.data };
        })],
        ['ones', fn('tensor.ones', ([shape]) => {
          const dims = shape.tag === 'list' ? shape.items.map((x) => (x.tag === 'num' ? x.val : 1)) : [1];
          const t = this.ml.ones(dims);
          return { tag: 'tensor', dtype: 'Float32', shape: t.shape, data: t.data };
        })],
        ['randn', fn('tensor.randn', ([shape]) => {
          const dims = shape.tag === 'list' ? shape.items.map((x) => (x.tag === 'num' ? x.val : 1)) : [1];
          const t = this.ml.randn(dims);
          return { tag: 'tensor', dtype: 'Float32', shape: t.shape, data: t.data };
        })],
        ['of', fn('tensor.of', ([data]) => {
          if (data.tag === 'list' && data.items[0]?.tag === 'list') {
            const rows = data.items.length;
            const cols = data.items[0].items.length;
            const flat: number[] = [];
            for (const r of data.items) if (r.tag === 'list') for (const c of r.items) flat.push(c.tag === 'num' ? c.val : 0);
            return { tag: 'tensor', dtype: 'Float32', shape: [rows, cols], data: flat };
          }
          const flat = data.tag === 'list' ? data.items.map((x) => (x.tag === 'num' ? x.val : 0)) : [0];
          return { tag: 'tensor', dtype: 'Float32', shape: [flat.length], data: flat };
        })],
        ['device', fn('tensor.device', ([d]) => ({ tag: 'option', some: true, val: d ?? { tag: 'str', val: 'cpu' } }))],
      ]),
    });
    bind('nn', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['relu', fn('nn.relu', ([t]) => t.tag === 'tensor' ? { tag: 'tensor', dtype: t.dtype, shape: t.shape, data: this.ml.relu({ shape: t.shape, data: t.data }).data } : t)],
        ['sigmoid', fn('nn.sigmoid', ([t]) => t.tag === 'tensor' ? { tag: 'tensor', dtype: t.dtype, shape: t.shape, data: this.ml.sigmoid({ shape: t.shape, data: t.data }).data } : t)],
        ['softmax', fn('nn.softmax', ([t]) => t.tag === 'tensor' ? { tag: 'tensor', dtype: t.dtype, shape: t.shape, data: this.ml.softmax({ shape: t.shape, data: t.data }).data } : t)],
        ['crossEntropy', fn('nn.crossEntropy', ([logits, labels]) => {
          if (logits.tag !== 'tensor') return { tag: 'num', val: 0 };
          const ys = labels.tag === 'list' ? labels.items.map((x) => (x.tag === 'num' ? x.val : 0)) : [0];
          return { tag: 'num', val: this.ml.crossEntropy({ shape: logits.shape, data: logits.data }, ys) };
        })],
      ]),
    });
    bind('train', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['mlpXor', fn('train.mlpXor', ([epochsArg, lrArg]) => {
          const epochs = epochsArg && epochsArg.tag === 'num' ? Math.min(epochsArg.val, 120) : 25;
          const lr = lrArg && lrArg.tag === 'num' ? lrArg.val : 0.35;
          this.ml.setSeed(7);
          this.ml.recordLayer('fc1', '[?, 2]', '[?, 8]', 2 * 8 + 8);
          this.ml.recordLayer('fc2', '[?, 8]', '[?, 2]', 8 * 2 + 2);
          const w1 = this.ml.randn([2, 8], 0.7).data;
          const b1 = this.ml.zeros([8]).data;
          const w2 = this.ml.randn([8, 2], 0.7).data;
          const b2 = this.ml.zeros([2]).data;
          const xs = [[0, 0], [0, 1], [1, 0], [1, 1]];
          const ys = [0, 1, 1, 0];
          let lastLoss = 1;
          let lastAcc = 0;
          for (let e = 1; e <= epochs; e++) {
            const step = this.ml.runAutodiffStep(w1, b1, w2, b2, 2, 8, 2, xs, ys, lr);
            lastLoss = step.loss;
            lastAcc = step.accuracy;
            this.ml.recordEpoch(e, step.loss, step.accuracy);
          }
          return {
            tag: 'map',
            entries: new Map<string, VelaValue>([
              ['loss', { tag: 'num', val: Number(lastLoss.toFixed(4)) }],
              ['accuracy', { tag: 'num', val: Number(lastAcc.toFixed(4)) }],
            ]),
          };
        })],
        ['gradScalar', fn('train.gradScalar', async ([closure, x]) => {
          const xv = x.tag === 'num' ? x.val : 0;
          const eps = 1e-4;
          const fPlus = await this.invokeFn(closure, [{ tag: 'num', val: xv + eps }], new Map());
          const fMinus = await this.invokeFn(closure, [{ tag: 'num', val: xv - eps }], new Map());
          const gp = fPlus.tag === 'num' ? fPlus.val : 0;
          const gm = fMinus.tag === 'num' ? fMinus.val : 0;
          return { tag: 'num', val: Number(((gp - gm) / (2 * eps)).toFixed(5)) };
        })],
      ]),
    });

    // Database module
    bind('db', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['open', fn('db.open', ([name]) => ({ tag: 'db', name: formatVelaValue(name) }))],
        ['exec', fn('db.exec', ([sql, params]) => {
          const pArr = params && params.tag === 'list' ? params.items.map((x) => this.toJs(x)) : [];
          const rows = this.db.exec(formatVelaValue(sql), pArr);
          return { tag: 'result', ok: true, val: this.fromJs(rows) };
        })],
        ['query', fn('db.query', ([sql, params]) => {
          const pArr = params && params.tag === 'list' ? params.items.map((x) => this.toJs(x)) : [];
          const rows = this.db.exec(formatVelaValue(sql), pArr);
          return { tag: 'result', ok: true, val: this.fromJs(rows) };
        })],
      ]),
    });

    // Kernel / Systems modules
    bind('port', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['out8', fn('port.out8', ([p, v]) => { this.kernel.portOut8(p.tag === 'num' ? p.val : 0, v.tag === 'num' ? v.val : 0); return { tag: 'nil' }; })],
        ['in8', fn('port.in8', ([p]) => ({ tag: 'num', val: this.kernel.portIn8(p.tag === 'num' ? p.val : 0), isInt: true }))],
      ]),
    });
    bind('cpu', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['pause', fn('cpu.pause', () => ({ tag: 'nil' }))],
        ['ioWait', fn('cpu.ioWait', () => ({ tag: 'nil' }))],
        ['halt', fn('cpu.halt', () => { throw new Error('__KERNEL_HALT__'); })],
      ]),
    });
    bind('interrupts', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['enable', fn('interrupts.enable', () => { this.kernel.fireInterrupt('0x20'); return { tag: 'nil' }; })],
      ]),
    });
    bind('Ptr', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['fromAddr', fn('Ptr.fromAddr', ([addr]) => ({ tag: 'ptr', addr: addr.tag === 'num' ? addr.val : 0, pointeeType: 'UInt8' }))],
      ]),
    });
    bind('Char', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['fromInt', fn('Char.fromInt', ([n]) => {
          const code = n.tag === 'num' ? Math.floor(n.val) : 0;
          return code >= 0 && code <= 0x10ffff
            ? { tag: 'option', some: true, val: { tag: 'char', val: String.fromCharCode(code) } }
            : { tag: 'option', some: false };
        })],
      ]),
    });
    bind('console', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['clear', fn('console.clear', () => { this.kernel.vgaClear(); return { tag: 'nil' }; })],
        ['puts', fn('console.puts', ([s]) => { this.kernel.vgaWriteText(formatVelaValue(s)); return { tag: 'nil' }; })],
      ]),
    });

    // OS / Kernel RamFS & Image Builder Tools
    bind('os', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['ramfsWrite', fn('os.ramfsWrite', ([p, content]) => {
          this.kernel.ramfsWrite(formatVelaValue(p), formatVelaValue(content));
          return { tag: 'result', ok: true, val: { tag: 'nil' } };
        })],
        ['ramfsRead', fn('os.ramfsRead', ([p]) => {
          const data = this.kernel.ramfsRead(formatVelaValue(p));
          return data !== undefined
            ? { tag: 'option', some: true, val: { tag: 'str', val: data } }
            : { tag: 'option', some: false };
        })],
        ['ramfsLs', fn('os.ramfsLs', () => ({
          tag: 'list',
          items: Array.from(this.kernel.ramfs.keys()).map((k) => ({ tag: 'str', val: k })),
        }))],
        ['bootInfo', fn('os.bootInfo', () => ({
          tag: 'map',
          entries: new Map<string, VelaValue>([
            ['arch', { tag: 'str', val: 'x86_64-unknown-none' }],
            ['bootloader', { tag: 'str', val: 'Multiboot2' }],
            ['heapBase', { tag: 'str', val: `0x${this.kernel.heapBase.toString(16)}` }],
            ['ramfsFiles', { tag: 'num', val: this.kernel.ramfs.size, isInt: true }],
          ]),
        }))],
      ]),
    });

    // 3D Model & Graphics Tools
    bind('gfx3d', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['partCount', fn('gfx3d.partCount', () => ({ tag: 'num', val: this.scene3dFull?.objects.length ?? 0, isInt: true }))],
        ['parts', fn('gfx3d.parts', () => ({
          tag: 'list',
          items: (this.scene3dFull?.objects ?? []).map((o) => ({ tag: 'str', val: `${o.name} (${o.geometry})` })),
        }))],
        ['sceneName', fn('gfx3d.sceneName', () => ({ tag: 'str', val: this.scene3dFull?.name ?? 'none' }))],
      ]),
    });

    // 2D/3D Game Engine Kinematics & Collision Tools
    bind('game', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['body', fn('game.body', ([name, x, y, vx, vy, r]) => ({
          tag: 'map',
          entries: new Map<string, VelaValue>([
            ['name', name ?? { tag: 'str', val: 'entity' }],
            ['x', x ?? { tag: 'num', val: 0 }],
            ['y', y ?? { tag: 'num', val: 0 }],
            ['vx', vx ?? { tag: 'num', val: 0 }],
            ['vy', vy ?? { tag: 'num', val: 0 }],
            ['r', r ?? { tag: 'num', val: 1 }],
          ]),
        }))],
        ['step', fn('game.step', ([bodies, dtArg]) => {
          const dt = dtArg && dtArg.tag === 'num' ? dtArg.val : 0.016;
          if (bodies.tag !== 'list') return bodies;
          for (const b of bodies.items) {
            if (b.tag !== 'map') continue;
            const x = b.entries.get('x');
            const y = b.entries.get('y');
            const vx = b.entries.get('vx');
            const vy = b.entries.get('vy');
            if (x?.tag === 'num' && vx?.tag === 'num') b.entries.set('x', { tag: 'num', val: Number((x.val + vx.val * dt).toFixed(4)) });
            if (y?.tag === 'num' && vy?.tag === 'num') b.entries.set('y', { tag: 'num', val: Number((y.val + vy.val * dt).toFixed(4)) });
          }
          return bodies;
        })],
        ['collides', fn('game.collides', ([a, b]) => {
          if (a.tag !== 'map' || b.tag !== 'map') return { tag: 'bool', val: false };
          const ax = a.entries.get('x')?.tag === 'num' ? (a.entries.get('x') as { tag: 'num'; val: number }).val : 0;
          const ay = a.entries.get('y')?.tag === 'num' ? (a.entries.get('y') as { tag: 'num'; val: number }).val : 0;
          const ar = a.entries.get('r')?.tag === 'num' ? (a.entries.get('r') as { tag: 'num'; val: number }).val : 0;
          const bx = b.entries.get('x')?.tag === 'num' ? (b.entries.get('x') as { tag: 'num'; val: number }).val : 0;
          const by = b.entries.get('y')?.tag === 'num' ? (b.entries.get('y') as { tag: 'num'; val: number }).val : 0;
          const br = b.entries.get('r')?.tag === 'num' ? (b.entries.get('r') as { tag: 'num'; val: number }).val : 0;
          const dx = ax - bx;
          const dy = ay - by;
          return { tag: 'bool', val: Math.hypot(dx, dy) <= ar + br };
        })],
      ]),
    });

    // HTTP & Web Route Testing Tools
    bind('http', {
      tag: 'map',
      entries: new Map<string, VelaValue>([
        ['routes', fn('http.routes', () => ({
          tag: 'list',
          items: this.db.routes.map((r) => ({ tag: 'str', val: `${r.method} ${r.path} -> ${r.handler}` })),
        }))],
        ['route', fn('http.route', ([method, path, handler]) => {
          this.db.routes.push({
            method: formatVelaValue(method).toUpperCase(),
            path: formatVelaValue(path),
            handler: formatVelaValue(handler),
          });
          return { tag: 'nil' };
        })],
        ['dispatch', fn('http.dispatch', ([method, path]) => {
          const m = formatVelaValue(method).toUpperCase();
          const p = formatVelaValue(path);
          const found = this.db.routes.find((r) => r.method === m && r.path === p);
          return found
            ? { tag: 'option', some: true, val: { tag: 'str', val: `200 OK (${found.handler})` } }
            : { tag: 'option', some: false };
        })],
      ]),
    });
  }

  private toJs(v: VelaValue): unknown {
    switch (v.tag) {
      case 'nil': return null;
      case 'bool':
      case 'num':
      case 'str':
      case 'char':
      case 'color': return v.val;
      case 'list':
      case 'tuple': return v.items.map((x) => this.toJs(x));
      case 'map': {
        const obj: Record<string, unknown> = {};
        for (const [k, val] of v.entries.entries()) obj[k] = this.toJs(val);
        return obj;
      }
      case 'struct': {
        const obj: Record<string, unknown> = {};
        for (const [k, val] of v.fields.entries()) obj[k] = this.toJs(val);
        return obj;
      }
      default: return formatVelaValue(v);
    }
  }

  private fromJs(val: unknown): VelaValue {
    if (val === null || val === undefined) return { tag: 'nil' };
    if (typeof val === 'boolean') return { tag: 'bool', val };
    if (typeof val === 'number') return { tag: 'num', val };
    if (typeof val === 'string') return { tag: 'str', val };
    if (Array.isArray(val)) return { tag: 'list', items: val.map((x) => this.fromJs(x)) };
    if (typeof val === 'object') {
      const entries = new Map<string, VelaValue>();
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        entries.set(k, this.fromJs(v));
      }
      return { tag: 'map', entries };
    }
    return { tag: 'str', val: String(val) };
  }
}
