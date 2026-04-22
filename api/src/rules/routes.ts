import { Hono } from 'hono';
import { requireApiKey, tenantOf } from '../auth/api-key.ts';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  replaceAllRules,
  type RuleInput,
} from '../routing/rules.ts';
import { decide, explainDecision } from '../routing/engine.ts';
import { recordEvent } from '../events.ts';

export const rulesRoutes = new Hono();

rulesRoutes.use('*', requireApiKey);

rulesRoutes.get('/', (c) => c.json({ rules: listRules(tenantOf(c)) }));

rulesRoutes.post('/', async (c) => {
  const tenantId = tenantOf(c);
  const body = (await c.req.json()) as RuleInput;
  const rule = createRule(tenantId, body);
  recordEvent(tenantId, 'rule.created', { id: rule.id, priority: rule.priority });
  return c.json(rule, 201);
});

rulesRoutes.put('/:id', async (c) => {
  const tenantId = tenantOf(c);
  const id = c.req.param('id');
  const body = (await c.req.json()) as RuleInput;
  const rule = updateRule(tenantId, id, body);
  if (!rule) return c.json({ error: 'not_found' }, 404);
  recordEvent(tenantId, 'rule.updated', { id });
  return c.json(rule);
});

rulesRoutes.delete('/:id', (c) => {
  const tenantId = tenantOf(c);
  const id = c.req.param('id');
  const ok = deleteRule(tenantId, id);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  recordEvent(tenantId, 'rule.deleted', { id });
  return c.json({ ok: true });
});

// PUT /v1/rules (bulk replace) — drag-to-reorder UI uses this
rulesRoutes.put('/', async (c) => {
  const tenantId = tenantOf(c);
  const body = (await c.req.json()) as { rules: RuleInput[] };
  const rules = replaceAllRules(tenantId, body.rules);
  recordEvent(tenantId, 'rule.updated', { bulk: true, count: rules.length });
  return c.json({ rules });
});

// POST /v1/rules/preview — "what would happen for a file of X MB / mime Y?"
rulesRoutes.post('/preview', async (c) => {
  const tenantId = tenantOf(c);
  const body = (await c.req.json()) as {
    kind: 'file' | 'record';
    sizeBytes?: number;
    ageDays?: number;
    mime?: string;
    entity?: string;
  };
  const rules = listRules(tenantId);
  const explained = explainDecision({ tenantId, ...body }, rules);
  const fallback = decide({ tenantId, ...body }, []);
  return c.json({ ...explained, fallback });
});
