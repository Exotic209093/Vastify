import type { ComparisonOp, FilterExpr, FilterLiteral, ODataOrderBy, ODataQuery } from './types.ts';

/** ─── Tokenizer ──────────────────────────────────────────────────────────── */

type Token =
  | { t: 'ident'; v: string }
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'datetime'; v: number }
  | { t: 'op'; v: ComparisonOp }
  | { t: 'and' }
  | { t: 'or' }
  | { t: 'not' }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'eof' };

const KEYWORDS: Record<string, Token> = {
  and: { t: 'and' },
  or: { t: 'or' },
  not: { t: 'not' },
  eq: { t: 'op', v: 'eq' },
  ne: { t: 'op', v: 'ne' },
  gt: { t: 'op', v: 'gt' },
  lt: { t: 'op', v: 'lt' },
  ge: { t: 'op', v: 'ge' },
  le: { t: 'op', v: 'le' },
  true: { t: 'bool', v: true },
  false: { t: 'bool', v: false },
  null: { t: 'null' },
};

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ t: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ t: 'rparen' });
      i++;
      continue;
    }
    if (c === "'") {
      let s = '';
      i++;
      while (i < n) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += input[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    if (c >= '0' && c <= '9') {
      const start = i;
      while (
        i < n &&
        (input[i] === '-' ||
          input[i] === ':' ||
          input[i] === 'T' ||
          input[i] === 'Z' ||
          input[i] === '+' ||
          input[i] === '.' ||
          (input[i] >= '0' && input[i] <= '9'))
      )
        i++;
      const raw = input.slice(start, i);
      if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const ms = Date.parse(raw);
        out.push({ t: 'datetime', v: Number.isNaN(ms) ? 0 : ms });
      } else {
        out.push({ t: 'num', v: Number(raw) });
      }
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_./]/.test(input[i])) i++;
      const word = input.slice(start, i);
      const kw = KEYWORDS[word.toLowerCase()];
      out.push(kw ?? { t: 'ident', v: word });
      continue;
    }
    throw new Error(`unexpected character at ${i}: ${c}`);
  }
  out.push({ t: 'eof' });
  return out;
}

/** ─── Parser (recursive-descent) ─────────────────────────────────────────── */

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private expect(t: Token['t']): Token {
    const tok = this.next();
    if (tok.t !== t) throw new Error(`expected ${t}, got ${tok.t}`);
    return tok;
  }

  parseFilter(): FilterExpr {
    const e = this.parseOr();
    if (this.peek().t !== 'eof') throw new Error(`trailing tokens at ${this.pos}`);
    return e;
  }

  private parseOr(): FilterExpr {
    let left = this.parseAnd();
    while (this.peek().t === 'or') {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): FilterExpr {
    let left = this.parseNot();
    while (this.peek().t === 'and') {
      this.next();
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseNot(): FilterExpr {
    if (this.peek().t === 'not') {
      this.next();
      return { kind: 'not', expr: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FilterExpr {
    const tok = this.peek();
    if (tok.t === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen');
      return { kind: 'paren', expr: inner };
    }
    if (tok.t === 'ident') {
      const field = (this.next() as { v: string }).v;
      const opTok = this.next();
      if (opTok.t !== 'op') throw new Error(`expected comparison op after ${field}`);
      const litTok = this.next();
      const value = literalOf(litTok);
      return { kind: 'cmp', op: opTok.v, field, value };
    }
    throw new Error(`unexpected token ${tok.t}`);
  }
}

function literalOf(tok: Token): FilterLiteral {
  switch (tok.t) {
    case 'str':
      return { kind: 'string', value: tok.v };
    case 'num':
      return { kind: 'number', value: tok.v };
    case 'bool':
      return { kind: 'bool', value: tok.v };
    case 'null':
      return { kind: 'null' };
    case 'datetime':
      return { kind: 'datetime', value: tok.v };
    default:
      throw new Error(`expected literal, got ${tok.t}`);
  }
}

export function parseFilter(input: string): FilterExpr {
  const tokens = tokenize(input);
  return new Parser(tokens).parseFilter();
}

/** ─── $orderby ────────────────────────────────────────────────────────────── */

export function parseOrderBy(input: string): ODataOrderBy[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((clause) => {
      const parts = clause.split(/\s+/);
      const field = parts[0];
      const dir = (parts[1] ?? 'asc').toLowerCase();
      if (dir !== 'asc' && dir !== 'desc') throw new Error(`invalid order direction: ${dir}`);
      return { field, direction: dir };
    });
}

/** ─── Full query parse from URLSearchParams ─────────────────────────────── */

export function parseODataQuery(params: URLSearchParams): ODataQuery {
  const q: ODataQuery = {};
  const filter = params.get('$filter');
  if (filter) q.filter = parseFilter(filter);
  const orderBy = params.get('$orderby');
  if (orderBy) q.orderBy = parseOrderBy(orderBy);
  const top = params.get('$top');
  if (top) {
    const n = parseInt(top, 10);
    if (Number.isNaN(n) || n < 0) throw new Error('$top must be a non-negative integer');
    q.top = n;
  }
  const skip = params.get('$skip');
  if (skip) {
    const n = parseInt(skip, 10);
    if (Number.isNaN(n) || n < 0) throw new Error('$skip must be a non-negative integer');
    q.skip = n;
  }
  const select = params.get('$select');
  if (select) q.select = select.split(',').map((s) => s.trim()).filter(Boolean);
  const count = params.get('$count');
  if (count) q.count = count.toLowerCase() === 'true';
  return q;
}
