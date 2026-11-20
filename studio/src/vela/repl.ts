import { lexVela } from './lexer';
import { parseVela } from './parser';
import { formatVelaValue, VelaRuntime } from './runtime';
import { RuntimeEnv } from './types';

export interface ReplEntry {
  id: number;
  input: string;
  stdout: string[];
  result?: string;
  error?: string;
}

export class VelaReplSession {
  private runtime: VelaRuntime;
  private env: RuntimeEnv;
  private nextId = 1;

  constructor() {
    this.runtime = new VelaRuntime();
    this.env = this.runtime.createReplEnv();
  }

  public reset() {
    this.runtime = new VelaRuntime();
    this.env = this.runtime.createReplEnv();
  }

  public listBindings(): { name: string; preview: string }[] {
    const out: { name: string; preview: string }[] = [];
    for (const [k, b] of this.env.bindings.entries()) {
      // Hide built-in functions/modules unless user shadowed or inspected
      if (b.val.tag === 'nativeFn' || (b.val.tag === 'map' && !b.isMut && ['time', 'Duration', 'num', 'float', 'json', 'fs', 'uuid', 'math', 'tensor', 'nn', 'train', 'db', 'port', 'cpu', 'interrupts', 'Ptr', 'Char', 'console', 'os', 'gfx3d', 'game', 'http'].includes(k))) {
        continue;
      }
      out.push({ name: k, preview: formatVelaValue(b.val) });
    }
    return out;
  }

  public async evalLine(rawInput: string): Promise<ReplEntry> {
    const input = rawInput.trim();
    const id = this.nextId++;

    if (!input) {
      return { id, input: rawInput, stdout: [] };
    }

    if (input === ':help') {
      return {
        id,
        input,
        stdout: [
          'Vela Interactive REPL Commands:',
          '  :type <expr>   Inspect runtime value type',
          '  :env           Show active session bindings',
          '  :clear         Reset session state',
          '  :help          Show this help message',
        ],
      };
    }

    if (input === ':clear') {
      this.reset();
      return { id, input, stdout: ['Session reset.'] };
    }

    if (input === ':env') {
      const bindings = this.listBindings();
      return {
        id,
        input,
        stdout:
          bindings.length > 0
            ? bindings.map((b) => `  ${b.name} = ${b.preview}`)
            : ['(no user bindings yet)'],
      };
    }

    if (input.startsWith(':type ')) {
      const exprSrc = input.slice(6).trim();
      const { tokens, diagnostics: ld } = lexVela(exprSrc);
      const { ast, diagnostics: pd } = parseVela(tokens);
      const errs = [...ld, ...pd].filter((d) => d.severity === 'error');
      if (errs.length > 0) {
        return { id, input, stdout: [], error: errs[0].message };
      }
      const res = await this.runtime.executeReplAst(ast, this.env);
      if (res.error) return { id, input, stdout: res.stdout, error: res.error };
      const tag = res.value ? res.value.tag : 'nil';
      const cap = tag.charAt(0).toUpperCase() + tag.slice(1);
      return { id, input, stdout: res.stdout, result: `Type: ${cap}` };
    }

    const { tokens, diagnostics: lexDiags } = lexVela(input);
    const { ast, diagnostics: parseDiags } = parseVela(tokens);
    const errors = [...lexDiags, ...parseDiags].filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return {
        id,
        input,
        stdout: [],
        error: `${errors[0].code} line ${errors[0].line}: ${errors[0].message}`,
      };
    }

    const res = await this.runtime.executeReplAst(ast, this.env);
    const resultStr =
      res.value && res.value.tag !== 'nil' ? formatVelaValue(res.value) : undefined;
    return {
      id,
      input,
      stdout: res.stdout,
      result: resultStr,
      error: res.error,
    };
  }
}
