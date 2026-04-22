import type { Context, Next } from 'hono';
import { getDb } from '../db/client.ts';
import { hashApiKey } from '../db/hash.ts';

export const TENANT_CTX_KEY = 'tenantId';

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = c.req.header('X-Vastify-Api-Key') ?? c.req.header('x-vastify-api-key');
  if (!key) return c.json({ error: 'missing_api_key' }, 401);
  const hash = await hashApiKey(key);
  const row = getDb().query('SELECT id FROM tenants WHERE api_key_hash = ?').get(hash) as
    | { id: string }
    | null;
  if (!row) return c.json({ error: 'invalid_api_key' }, 401);
  c.set(TENANT_CTX_KEY, row.id);
  await next();
}

export function tenantOf(c: Context): string {
  const t = c.get(TENANT_CTX_KEY) as string | undefined;
  if (!t) throw new Error('tenantId missing from context — requireApiKey must run first');
  return t;
}
