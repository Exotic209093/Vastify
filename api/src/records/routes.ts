import { Hono } from 'hono';
import { requireApiKey, tenantOf } from '../auth/api-key.ts';
import {
  createRecord,
  countRecords,
  type EntityName,
  type InteractionRecord,
} from './service.ts';
import { getDb } from '../db/client.ts';
import { log } from '../util/logger.ts';

export const recordsRoutes = new Hono();

recordsRoutes.use('*', requireApiKey);

// POST /v1/records/archive
// Body: { records: InteractionRecord[] }  (batched; each gets IsArchived=true)
recordsRoutes.post('/archive', async (c) => {
  const tenantId = tenantOf(c);
  const body = (await c.req.json()) as { records: InteractionRecord[] };
  if (!Array.isArray(body.records)) return c.json({ error: 'missing_records_array' }, 400);
  const inserted: string[] = [];
  for (const r of body.records) {
    try {
      const out = await createRecord({
        tenantId,
        entity: 'ArchivedInteraction',
        record: { ...r, IsArchived: true },
        isArchive: true,
      });
      inserted.push(out.Id);
    } catch (e) {
      log.error('archive record failed', { err: (e as Error).message, pk: r.Id });
    }
  }
  return c.json({ inserted: inserted.length, ids: inserted });
});

// GET /v1/records/stats
recordsRoutes.get('/stats', (c) => {
  const tenantId = tenantOf(c);
  return c.json({
    interaction: countRecords(tenantId, 'Interaction'),
    archivedInteraction: countRecords(tenantId, 'ArchivedInteraction'),
  });
});

// GET /v1/records/:entity  → list the SQLite index (dashboard view, faster than the OData path)
recordsRoutes.get('/:entity', (c) => {
  const tenantId = tenantOf(c);
  const entity = c.req.param('entity') as EntityName;
  if (entity !== 'Interaction' && entity !== 'ArchivedInteraction') {
    return c.json({ error: 'unknown_entity' }, 404);
  }
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const rows = getDb()
    .query(
      `SELECT pk, backend_id, storage_class, object_key, timestamp, channel, type,
              account_id, contact_id, subject, is_archived, created_at
         FROM records_index
        WHERE tenant_id = ? AND entity = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(tenantId, entity, limit, offset);
  return c.json({ rows });
});
