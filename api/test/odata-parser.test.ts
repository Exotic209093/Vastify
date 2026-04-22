import { describe, test, expect } from 'bun:test';
import { parseFilter, parseOrderBy, parseODataQuery } from '../src/odata/parser.ts';

describe('OData $filter parser', () => {
  test('simple eq on string', () => {
    const e = parseFilter("Channel eq 'email'");
    expect(e).toEqual({
      kind: 'cmp',
      op: 'eq',
      field: 'Channel',
      value: { kind: 'string', value: 'email' },
    });
  });

  test('string literal with escaped single quote', () => {
    const e = parseFilter("Subject eq 'O''Brien'");
    expect(e).toEqual({
      kind: 'cmp',
      op: 'eq',
      field: 'Subject',
      value: { kind: 'string', value: "O'Brien" },
    });
  });

  test('numeric comparison', () => {
    const e = parseFilter('Size gt 100');
    expect(e).toEqual({
      kind: 'cmp',
      op: 'gt',
      field: 'Size',
      value: { kind: 'number', value: 100 },
    });
  });

  test('datetime literal parses to epoch ms', () => {
    const e = parseFilter('Timestamp gt 2026-01-01T00:00:00Z') as Extract<
      ReturnType<typeof parseFilter>,
      { kind: 'cmp' }
    >;
    expect(e.kind).toBe('cmp');
    expect(e.op).toBe('gt');
    expect(e.field).toBe('Timestamp');
    expect(e.value.kind).toBe('datetime');
    if (e.value.kind === 'datetime') {
      expect(e.value.value).toBe(Date.parse('2026-01-01T00:00:00Z'));
    }
  });

  test('bool literal', () => {
    const e = parseFilter('IsArchived eq true');
    expect(e).toEqual({
      kind: 'cmp',
      op: 'eq',
      field: 'IsArchived',
      value: { kind: 'bool', value: true },
    });
  });

  test('null literal', () => {
    const e = parseFilter('Subject eq null');
    expect(e).toEqual({
      kind: 'cmp',
      op: 'eq',
      field: 'Subject',
      value: { kind: 'null' },
    });
  });

  test('and composition', () => {
    const e = parseFilter("Channel eq 'email' and Timestamp gt 2026-01-01");
    expect(e.kind).toBe('and');
  });

  test('or composition', () => {
    const e = parseFilter("Channel eq 'email' or Channel eq 'sms'");
    expect(e.kind).toBe('or');
  });

  test('and binds tighter than or', () => {
    const e = parseFilter("A eq 1 or B eq 2 and C eq 3");
    expect(e.kind).toBe('or');
    if (e.kind === 'or') expect(e.right.kind).toBe('and');
  });

  test('parentheses override precedence', () => {
    const e = parseFilter("(A eq 1 or B eq 2) and C eq 3");
    expect(e.kind).toBe('and');
    if (e.kind === 'and') expect(e.left.kind).toBe('paren');
  });

  test('not prefix operator', () => {
    const e = parseFilter("not (Channel eq 'email')");
    expect(e.kind).toBe('not');
  });

  test('invalid trailing tokens throw', () => {
    expect(() => parseFilter("A eq 1 B eq 2")).toThrow();
  });
});

describe('OData $orderby parser', () => {
  test('single field defaults to asc', () => {
    expect(parseOrderBy('Timestamp')).toEqual([{ field: 'Timestamp', direction: 'asc' }]);
  });
  test('explicit desc', () => {
    expect(parseOrderBy('Timestamp desc')).toEqual([{ field: 'Timestamp', direction: 'desc' }]);
  });
  test('multiple fields comma separated', () => {
    expect(parseOrderBy('Channel asc, Timestamp desc')).toEqual([
      { field: 'Channel', direction: 'asc' },
      { field: 'Timestamp', direction: 'desc' },
    ]);
  });
});

describe('parseODataQuery (URLSearchParams)', () => {
  test('parses the combined query shape', () => {
    const p = new URLSearchParams({
      $filter: "Channel eq 'email'",
      $orderby: 'Timestamp desc',
      $top: '25',
      $skip: '0',
      $select: 'Timestamp,Channel,Subject',
    });
    const q = parseODataQuery(p);
    expect(q.top).toBe(25);
    expect(q.skip).toBe(0);
    expect(q.select).toEqual(['Timestamp', 'Channel', 'Subject']);
    expect(q.orderBy).toEqual([{ field: 'Timestamp', direction: 'desc' }]);
    expect(q.filter?.kind).toBe('cmp');
  });

  test('$top must be non-negative integer', () => {
    expect(() => parseODataQuery(new URLSearchParams({ $top: '-1' }))).toThrow();
    expect(() => parseODataQuery(new URLSearchParams({ $top: 'abc' }))).toThrow();
  });
});
