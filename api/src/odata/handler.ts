import { Hono, type Context, type Next } from 'hono';
import { requireApiKey, tenantOf, TENANT_CTX_KEY } from '../auth/api-key.ts';
import { parseODataQuery } from './parser.ts';
import { renderMetadataXml, renderServiceDoc } from './metadata.ts';
import { UnindexedFieldError } from './sql.ts';
import {
  createRecord,
  deleteRecord,
  getRecord,
  queryRecords,
  updateRecord,
  type EntityName,
  type InteractionRecord,
} from '../records/service.ts';
import { loadConfig } from '../config.ts';
import { log } from '../util/logger.ts';

export const odataRoutes = new Hono();

const ALLOWED_ENTITIES: EntityName[] = ['Interaction', 'ArchivedInteraction'];

function isAllowedEntity(name: string): name is EntityName {
  return (ALLOWED_ENTITIES as string[]).includes(name);
}

function baseUrl(c: Context): string {
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
  const proto = c.req.header('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}/odata/v1`;
}

/** Public endpoints (no auth): service doc + $metadata. Salesforce fetches these during external-data-source validation. */
odataRoutes.get('/', (c) =>
  c.body(renderServiceDoc(baseUrl(c)), 200, { 'Content-Type': 'application/json;odata.metadata=minimal' }),
);

odataRoutes.get('/$metadata', (c) =>
  c.body(renderMetadataXml(), 200, { 'Content-Type': 'application/xml' }),
);

/**
 * Auth middleware for OData entity routes.
 * In demo mode (VASTIFY_DEMO_PUBLIC_ODATA=true) we fall back to the demo tenant when no API
 * key header is present — this lets Salesforce Connect work without per-user named credentials.
 * In production set the env var to false and Salesforce Connect must use a Named Credential.
 */
async function odataAuth(c: Context, next: Next): Promise<Response | void> {
  const hasKey = c.req.header('X-Vastify-Api-Key') ?? c.req.header('x-vastify-api-key');
  if (hasKey) return requireApiKey(c, next);
  if (process.env.VASTIFY_DEMO_PUBLIC_ODATA === 'true') {
    c.set(TENANT_CTX_KEY, loadConfig().demoTenantId);
    await next();
    return;
  }
  return c.json({ error: 'missing_api_key' }, 401);
}

odataRoutes.use('/:entity', odataAuth);
odataRoutes.use('/:entity/*', odataAuth);

/** Parse `/Interaction(<key>)` style — returns [entity, key?]. */
function parseEntityPath(raw: string): { entity: string; key?: string } {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(['"]?([^'")]+)['"]?\))?$/.exec(raw);
  if (!m) return { entity: raw };
  return { entity: m[1], key: m[2] };
}

odataRoutes.get('/:entityPath{.+}', async (c) => {
  const tenantId = tenantOf(c);
  const { entity, key } = parseEntityPath(c.req.param('entityPath'));
  if (!isAllowedEntity(entity)) return c.json({ error: 'unknown_entity', entity }, 404);

  try {
    if (key) {
      const row = await getRecord(tenantId, entity, key);
      if (!row) return c.json({ error: 'not_found' }, 404);
      return c.json({ '@odata.context': `${baseUrl(c)}/$metadata#${entity}/$entity`, ...row });
    }
    const url = new URL(c.req.url);
    const q = parseODataQuery(url.searchParams);
    const result = await queryRecords(tenantId, entity, q);
    const body: Record<string, unknown> = {
      '@odata.context': `${baseUrl(c)}/$metadata#${entity}`,
      value: result.rows,
    };
    if (q.count) body['@odata.count'] = result.total;
    return c.json(body);
  } catch (e) {
    if (e instanceof UnindexedFieldError) {
      return c.json(
        { error: 'not_implemented', detail: `field '${e.field}' is not indexed for filtering` },
        501,
      );
    }
    log.error('odata read failed', { err: (e as Error).message });
    return c.json({ error: 'bad_request', message: (e as Error).message }, 400);
  }
});

odataRoutes.post('/:entity', async (c) => {
  const tenantId = tenantOf(c);
  const entity = c.req.param('entity');
  if (!isAllowedEntity(entity)) return c.json({ error: 'unknown_entity', entity }, 404);
  if (entity === 'ArchivedInteraction') return c.json({ error: 'read_only' }, 405);
  try {
    const body = (await c.req.json()) as Partial<InteractionRecord>;
    const created = await createRecord({
      tenantId,
      entity,
      record: body as InteractionRecord,
    });
    const url = `${baseUrl(c)}/${entity}('${created.Id}')`;
    return c.body(
      JSON.stringify({ '@odata.context': `${baseUrl(c)}/$metadata#${entity}/$entity`, ...created }),
      201,
      { 'Content-Type': 'application/json;odata.metadata=minimal', Location: url },
    );
  } catch (e) {
    log.error('odata create failed', { err: (e as Error).message });
    return c.json({ error: 'bad_request', message: (e as Error).message }, 400);
  }
});

odataRoutes.on(['PATCH', 'PUT'], '/:entityPath{.+}', async (c) => {
  const tenantId = tenantOf(c);
  const { entity, key } = parseEntityPath(c.req.param('entityPath'));
  if (!isAllowedEntity(entity)) return c.json({ error: 'unknown_entity', entity }, 404);
  if (entity === 'ArchivedInteraction') return c.json({ error: 'read_only' }, 405);
  if (!key) return c.json({ error: 'missing_key' }, 400);
  const patch = (await c.req.json()) as Partial<InteractionRecord>;
  const updated = await updateRecord(tenantId, entity, key, patch);
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

odataRoutes.delete('/:entityPath{.+}', async (c) => {
  const tenantId = tenantOf(c);
  const { entity, key } = parseEntityPath(c.req.param('entityPath'));
  if (!isAllowedEntity(entity)) return c.json({ error: 'unknown_entity', entity }, 404);
  if (entity === 'ArchivedInteraction') return c.json({ error: 'read_only' }, 405);
  if (!key) return c.json({ error: 'missing_key' }, 400);
  const ok = await deleteRecord(tenantId, entity, key);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});
