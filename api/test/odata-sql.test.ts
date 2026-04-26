import { describe, test, expect } from 'bun:test';
import {
  filterToSql,
  buildIndexQuery,
  INTERACTION_FIELD_MAP,
  UnindexedFieldError,
} from '../src/odata/sql.ts';
import { parseFilter, parseODataQuery } from '../src/odata/parser.ts';
import type { ODataQuery } from '../src/odata/types.ts';

const FM = INTERACTION_FIELD_MAP;
const T = 'tenant-1';

describe('filterToSql', () => {
  test('eq on string maps to ? placeholder', () => {
    const ast = parseFilter("Channel eq 'email'");
    const { where, params } = filterToSql(ast, FM);
    expect(where).toBe('channel = ?');
    expect(params).toEqual(['email']);
  });

  test('ne on number', () => {
    const ast = parseFilter('Timestamp ne 0');
    const { where, params } = filterToSql(ast, FM);
    expect(where).toBe('timestamp != ?');
    expect(params).toEqual([0]);
  });

  test('bool literal becomes 1/0', () => {
    const t = filterToSql(parseFilter('IsArchived eq true'), FM);
    const f = filterToSql(parseFilter('IsArchived eq false'), FM);
    expect(t.params).toEqual([1]);
    expect(f.params).toEqual([0]);
  });

  test('null comparison uses IS NULL / IS NOT NULL (not =)', () => {
    const eq = filterToSql(parseFilter('AccountId eq null'), FM);
    const ne = filterToSql(parseFilter('AccountId ne null'), FM);
    expect(eq.where).toBe('account_id IS NULL');
    expect(eq.params).toEqual([]);
    expect(ne.where).toBe('account_id IS NOT NULL');
    expect(ne.params).toEqual([]);
  });

  test('and combines with parens around each side', () => {
    const ast = parseFilter("Channel eq 'email' and Type eq 'support'");
    const { where, params } = filterToSql(ast, FM);
    expect(where).toBe('(channel = ?) AND (type = ?)');
    expect(params).toEqual(['email', 'support']);
  });

  test('or combines with parens around each side', () => {
    const ast = parseFilter("Channel eq 'email' or Channel eq 'sms'");
    const { where, params } = filterToSql(ast, FM);
    expect(where).toBe('(channel = ?) OR (channel = ?)');
    expect(params).toEqual(['email', 'sms']);
  });

  test('not negates with NOT (...) wrapper', () => {
    const ast = parseFilter("not (Channel eq 'email')");
    const { where, params } = filterToSql(ast, FM);
    expect(where).toBe('NOT (channel = ?)');
    expect(params).toEqual(['email']);
  });

  test('ge / le / gt / lt all map correctly', () => {
    expect(filterToSql(parseFilter('Timestamp ge 100'), FM).where).toBe('timestamp >= ?');
    expect(filterToSql(parseFilter('Timestamp le 100'), FM).where).toBe('timestamp <= ?');
    expect(filterToSql(parseFilter('Timestamp gt 100'), FM).where).toBe('timestamp > ?');
    expect(filterToSql(parseFilter('Timestamp lt 100'), FM).where).toBe('timestamp < ?');
  });

  test('unindexed field raises UnindexedFieldError', () => {
    const ast = parseFilter("Payload eq 'whatever'");
    expect(() => filterToSql(ast, FM)).toThrow(UnindexedFieldError);
    try {
      filterToSql(ast, FM);
    } catch (e) {
      expect((e as UnindexedFieldError).field).toBe('Payload');
    }
  });

  test('parameter order matches AST traversal order in compound filter', () => {
    const ast = parseFilter(
      "(Channel eq 'email' or Channel eq 'sms') and Type eq 'support'",
    );
    const { params } = filterToSql(ast, FM);
    expect(params).toEqual(['email', 'sms', 'support']);
  });
});

describe('buildIndexQuery', () => {
  function build(query: ODataQuery, opts: { entity?: string; extraWhere?: { sql: string; params: unknown[] } } = {}) {
    return buildIndexQuery({
      tenantId: T,
      entity: opts.entity ?? 'Interaction',
      query,
      fieldMap: FM,
      extraWhere: opts.extraWhere,
    });
  }

  test('always scopes by tenant_id and entity', () => {
    const r = build({});
    expect(r.sql).toContain('tenant_id = ?');
    expect(r.sql).toContain('entity = ?');
    expect(r.params.slice(0, 2)).toEqual([T, 'Interaction']);
  });

  test('default ORDER BY timestamp DESC when no $orderby supplied', () => {
    const r = build({});
    expect(r.sql).toContain('ORDER BY timestamp DESC');
  });

  test('explicit $orderby maps fields and direction', () => {
    const q = parseODataQuery(new URLSearchParams('$orderby=Timestamp asc, Channel desc'));
    const r = build(q);
    expect(r.sql).toContain('ORDER BY timestamp ASC, channel DESC');
  });

  test('default top is 100, capped to maxTop=500', () => {
    const r = build({});
    // Expect the LIMIT param right before OFFSET
    const limitParam = r.params[r.params.length - 2];
    const offsetParam = r.params[r.params.length - 1];
    expect(limitParam).toBe(100);
    expect(offsetParam).toBe(0);
  });

  test('$top is capped to maxTop', () => {
    const r = build({ top: 10_000 });
    const limitParam = r.params[r.params.length - 2];
    expect(limitParam).toBe(500);
  });

  test('$skip is forwarded as OFFSET', () => {
    const r = build({ top: 50, skip: 200 });
    const offsetParam = r.params[r.params.length - 1];
    expect(offsetParam).toBe(200);
  });

  test('extraWhere is appended with its own params after base scope', () => {
    const r = build(
      {},
      { extraWhere: { sql: 'is_archived = ?', params: [1] } },
    );
    expect(r.sql).toMatch(/tenant_id = \? AND entity = \? AND \(is_archived = \?\)/);
    expect(r.params.slice(0, 3)).toEqual([T, 'Interaction', 1]);
  });

  test('filter params land after tenant/entity/extraWhere', () => {
    const q = parseODataQuery(new URLSearchParams("$filter=Channel eq 'email'"));
    const r = build(q, { extraWhere: { sql: 'is_archived = ?', params: [1] } });
    // tenant, entity, extraWhere(1), filter('email'), top, offset
    expect(r.params).toEqual([T, 'Interaction', 1, 'email', 100, 0]);
  });

  test('countSql excludes paging params', () => {
    const q = parseODataQuery(new URLSearchParams("$filter=Channel eq 'email'&$top=10&$skip=20"));
    const r = build(q);
    expect(r.countSql).toContain('SELECT COUNT(*) as n');
    expect(r.countSql).not.toContain('LIMIT');
    expect(r.countSql).not.toContain('OFFSET');
    // tenant, entity, filter — no top/skip
    expect(r.countParams).toEqual([T, 'Interaction', 'email']);
  });

  test('produces a deterministic SELECT shape', () => {
    const r = build({});
    expect(r.sql).toMatch(/^SELECT pk, object_key, backend_id FROM records_index WHERE /);
    expect(r.sql).toMatch(/LIMIT \? OFFSET \?$/);
  });
});
