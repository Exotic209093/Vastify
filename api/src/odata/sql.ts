import type { FilterExpr, FilterLiteral, ODataQuery } from './types.ts';

/**
 * Maps OData field names (PascalCase, as exposed in $metadata) → records_index columns.
 * Unmapped fields raise — we surface 501 to the caller.
 */
export const INTERACTION_FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  Timestamp: 'timestamp',
  Channel: 'channel',
  Type: 'type',
  AccountId: 'account_id',
  ContactId: 'contact_id',
  Subject: 'subject',
  IsArchived: 'is_archived',
});

export class UnindexedFieldError extends Error {
  constructor(public readonly field: string) {
    super(`field '${field}' is not indexed and cannot be used in $filter or $orderby`);
    this.name = 'UnindexedFieldError';
  }
}

function mapField(name: string, fieldMap: Readonly<Record<string, string>>): string {
  const col = fieldMap[name];
  if (!col) throw new UnindexedFieldError(name);
  return col;
}

function literalToSql(v: FilterLiteral): { sql: string; params: unknown[] } {
  switch (v.kind) {
    case 'string':
      return { sql: '?', params: [v.value] };
    case 'number':
      return { sql: '?', params: [v.value] };
    case 'bool':
      return { sql: '?', params: [v.value ? 1 : 0] };
    case 'null':
      return { sql: 'NULL', params: [] };
    case 'datetime':
      return { sql: '?', params: [v.value] };
  }
}

const SQL_OP: Record<string, string> = {
  eq: '=',
  ne: '!=',
  gt: '>',
  lt: '<',
  ge: '>=',
  le: '<=',
};

export interface SqlFragment {
  where: string;
  params: unknown[];
}

export function filterToSql(
  expr: FilterExpr,
  fieldMap: Readonly<Record<string, string>>,
): SqlFragment {
  switch (expr.kind) {
    case 'cmp': {
      const col = mapField(expr.field, fieldMap);
      const lit = literalToSql(expr.value);
      // Handle NULL comparisons the SQL-correct way.
      if (expr.value.kind === 'null') {
        if (expr.op === 'eq') return { where: `${col} IS NULL`, params: [] };
        if (expr.op === 'ne') return { where: `${col} IS NOT NULL`, params: [] };
      }
      const sqlOp = SQL_OP[expr.op];
      if (!sqlOp) throw new Error(`unsupported op ${expr.op}`);
      return { where: `${col} ${sqlOp} ${lit.sql}`, params: lit.params };
    }
    case 'and': {
      const l = filterToSql(expr.left, fieldMap);
      const r = filterToSql(expr.right, fieldMap);
      return { where: `(${l.where}) AND (${r.where})`, params: [...l.params, ...r.params] };
    }
    case 'or': {
      const l = filterToSql(expr.left, fieldMap);
      const r = filterToSql(expr.right, fieldMap);
      return { where: `(${l.where}) OR (${r.where})`, params: [...l.params, ...r.params] };
    }
    case 'not': {
      const inner = filterToSql(expr.expr, fieldMap);
      return { where: `NOT (${inner.where})`, params: inner.params };
    }
    case 'paren':
      return filterToSql(expr.expr, fieldMap);
  }
}

export interface BuildQueryOptions {
  tenantId: string;
  entity: string; // 'Interaction' or 'ArchivedInteraction'
  query: ODataQuery;
  fieldMap: Readonly<Record<string, string>>;
  /** Additional mandatory filter column=value (e.g., is_archived=1 for the Archived entity). */
  extraWhere?: { sql: string; params: unknown[] };
  defaultTop?: number;
  maxTop?: number;
}

export interface BuildQueryResult {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export function buildIndexQuery(opts: BuildQueryOptions): BuildQueryResult {
  const { tenantId, entity, query, fieldMap, extraWhere } = opts;
  const maxTop = opts.maxTop ?? 500;
  const defaultTop = opts.defaultTop ?? 100;

  const clauses: string[] = ['tenant_id = ?', 'entity = ?'];
  const params: unknown[] = [tenantId, entity];

  if (extraWhere) {
    clauses.push(`(${extraWhere.sql})`);
    params.push(...extraWhere.params);
  }

  if (query.filter) {
    const f = filterToSql(query.filter, fieldMap);
    clauses.push(`(${f.where})`);
    params.push(...f.params);
  }

  const where = clauses.join(' AND ');

  const orderBy =
    query.orderBy && query.orderBy.length > 0
      ? 'ORDER BY ' +
        query.orderBy
          .map((o) => `${mapField(o.field, fieldMap)} ${o.direction.toUpperCase()}`)
          .join(', ')
      : 'ORDER BY timestamp DESC';

  const top = Math.min(query.top ?? defaultTop, maxTop);
  const skip = query.skip ?? 0;

  const sql = `SELECT pk, object_key, backend_id FROM records_index WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as n FROM records_index WHERE ${where}`;

  return {
    sql,
    params: [...params, top, skip],
    countSql,
    countParams: params,
  };
}
