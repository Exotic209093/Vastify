import { v4 as uuid } from 'uuid';
import { getDb } from '../db/client.ts';
import type { RoutingRule, RuleMatch, RuleTarget } from './types.ts';

interface RuleRow {
  id: string;
  tenant_id: string;
  priority: number;
  match_json: string;
  target_json: string;
  enabled: number;
}

function rowToRule(r: RuleRow): RoutingRule {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    priority: r.priority,
    match: JSON.parse(r.match_json) as RuleMatch,
    target: JSON.parse(r.target_json) as RuleTarget,
    enabled: r.enabled === 1,
  };
}

export function listRules(tenantId: string): RoutingRule[] {
  const rows = getDb()
    .query('SELECT * FROM rules WHERE tenant_id = ? ORDER BY priority ASC')
    .all(tenantId) as RuleRow[];
  return rows.map(rowToRule);
}

export interface RuleInput {
  priority: number;
  match: RuleMatch;
  target: RuleTarget;
  enabled?: boolean;
}

export function createRule(tenantId: string, input: RuleInput): RoutingRule {
  const id = uuid();
  const now = Date.now();
  getDb()
    .query(
      'INSERT INTO rules (id, tenant_id, priority, match_json, target_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      tenantId,
      input.priority,
      JSON.stringify(input.match),
      JSON.stringify(input.target),
      input.enabled === false ? 0 : 1,
      now,
    );
  return {
    id,
    tenantId,
    priority: input.priority,
    match: input.match,
    target: input.target,
    enabled: input.enabled !== false,
  };
}

export function updateRule(tenantId: string, id: string, input: RuleInput): RoutingRule | null {
  const db = getDb();
  const res = db
    .query(
      'UPDATE rules SET priority = ?, match_json = ?, target_json = ?, enabled = ? WHERE id = ? AND tenant_id = ?',
    )
    .run(
      input.priority,
      JSON.stringify(input.match),
      JSON.stringify(input.target),
      input.enabled === false ? 0 : 1,
      id,
      tenantId,
    );
  if (res.changes === 0) return null;
  return {
    id,
    tenantId,
    priority: input.priority,
    match: input.match,
    target: input.target,
    enabled: input.enabled !== false,
  };
}

export function deleteRule(tenantId: string, id: string): boolean {
  const res = getDb().query('DELETE FROM rules WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  return res.changes > 0;
}

export function replaceAllRules(tenantId: string, inputs: RuleInput[]): RoutingRule[] {
  const db = getDb();
  return db.transaction(() => {
    db.query('DELETE FROM rules WHERE tenant_id = ?').run(tenantId);
    return inputs.map((i) => createRule(tenantId, i));
  })();
}
