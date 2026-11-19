/**
 * A tiny, safe expression language for form templates. Templates are shared
 * plain files, so we never eval() them. Supported:
 *
 *   numbers, identifiers with dots (receipts.total, inputs.rent, balance.end)
 *   + - * / %   == != < <= > >=   && || !   cond ? a : b   ( )
 *   functions: max min abs round floor ceil dollars if
 *
 * Money values are integer cents. dollars(25) is 2500.
 */
export type Value = number | string | boolean | null;

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export class ExprError extends Error {}

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'eof'; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      toks.push({ k: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      toks.push({ k: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new ExprError(`Unterminated string at ${i}`);
      toks.push({ k: 'str', v: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      toks.push({ k: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/%()<>!?:,'.includes(ch)) {
      toks.push({ k: 'op', v: ch, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character "${ch}" at position ${i}`);
  }
  toks.push({ k: 'eof', v: '', pos: src.length });
  return toks;
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

export const FUNCTIONS = ['max', 'min', 'abs', 'round', 'floor', 'ceil', 'dollars', 'if'] as const;

export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v) throw new ExprError(`Expected "${v}" at position ${t.pos} in "${src}"`);
  };

  function primary(): Node {
    const t = next();
    if (t.k === 'num') return { t: 'num', v: Number(t.v) };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') return { t: 'num', v: t.v === 'true' ? 1 : 0 };
      if (peek().v === '(') {
        next();
        if (!(FUNCTIONS as readonly string[]).includes(t.v))
          throw new ExprError(`Unknown function "${t.v}"`);
        const args: Node[] = [];
        if (peek().v !== ')') {
          do args.push(ternary());
          while (peek().v === ',' && next());
        }
        expect(')');
        return { t: 'call', fn: t.v, args };
      }
      return { t: 'id', name: t.v };
    }
    if (t.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    if (t.v === '-' || t.v === '!' || t.v === '+') return { t: 'un', op: t.v, a: primary() };
    throw new ExprError(
      `Unexpected "${t.v || 'end of expression'}" at position ${t.pos} in "${src}"`,
    );
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const op = peek();
      const prec = op.k === 'op' ? PRECEDENCE[op.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      next();
      const right = binary(prec + 1);
      left = { t: 'bin', op: op.v, a: left, b: right };
    }
  }

  function ternary(): Node {
    const c = binary(1);
    if (peek().v === '?') {
      next();
      const a = ternary();
      expect(':');
      const b = ternary();
      return { t: 'tern', c, a, b };
    }
    return c;
  }

  const node = ternary();
  if (peek().k !== 'eof')
    throw new ExprError(`Unexpected "${peek().v}" at position ${peek().pos} in "${src}"`);
  return node;
}

export function identifiers(node: Node, out: Set<string> = new Set()): Set<string> {
  switch (node.t) {
    case 'id':
      out.add(node.name);
      break;
    case 'un':
      identifiers(node.a, out);
      break;
    case 'bin':
      identifiers(node.a, out);
      identifiers(node.b, out);
      break;
    case 'tern':
      identifiers(node.c, out);
      identifiers(node.a, out);
      identifiers(node.b, out);
      break;
    case 'call':
      node.args.forEach((a) => identifiers(a, out));
      break;
  }
  return out;
}

function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: Value): boolean {
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'no' && v !== 'false';
  return Boolean(v);
}

export function evaluate(node: Node, resolve: (name: string) => Value): Value {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'id':
      return resolve(node.name);
    case 'un': {
      const a = evaluate(node.a, resolve);
      if (node.op === '!') return !truthy(a);
      return node.op === '-' ? -num(a) : num(a);
    }
    case 'tern':
      return truthy(evaluate(node.c, resolve))
        ? evaluate(node.a, resolve)
        : evaluate(node.b, resolve);
    case 'call': {
      if (node.fn === 'if') {
        if (node.args.length !== 3) throw new ExprError('if() takes three arguments');
        return truthy(evaluate(node.args[0], resolve))
          ? evaluate(node.args[1], resolve)
          : evaluate(node.args[2], resolve);
      }
      const args = node.args.map((a) => num(evaluate(a, resolve)));
      switch (node.fn) {
        case 'max':
          return Math.max(...args);
        case 'min':
          return Math.min(...args);
        case 'abs':
          return Math.abs(args[0] ?? 0);
        case 'round':
          return Math.round(args[0] ?? 0);
        case 'floor':
          return Math.floor(args[0] ?? 0);
        case 'ceil':
          return Math.ceil(args[0] ?? 0);
        case 'dollars':
          return Math.round((args[0] ?? 0) * 100);
      }
      throw new ExprError(`Unknown function ${node.fn}`);
    }
    case 'bin': {
      if (node.op === '&&')
        return truthy(evaluate(node.a, resolve)) && truthy(evaluate(node.b, resolve));
      if (node.op === '||')
        return truthy(evaluate(node.a, resolve)) || truthy(evaluate(node.b, resolve));
      const av = evaluate(node.a, resolve);
      const bv = evaluate(node.b, resolve);
      if (node.op === '==' || node.op === '!=') {
        const eq =
          typeof av === 'string' || typeof bv === 'string'
            ? String(av ?? '') === String(bv ?? '')
            : num(av) === num(bv);
        return node.op === '==' ? eq : !eq;
      }
      const a = num(av);
      const b = num(bv);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? 0 : a / b;
        case '%':
          return b === 0 ? 0 : a % b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '>=':
          return a >= b;
      }
      throw new ExprError(`Unknown operator ${node.op}`);
    }
  }
}

export function evalExpr(src: string, resolve: (name: string) => Value): Value {
  return evaluate(parseExpr(src), resolve);
}
