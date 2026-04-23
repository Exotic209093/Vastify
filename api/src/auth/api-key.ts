import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getDb } from '../db/client.ts';
import { hashApiKey } from '../db/hash.ts';
import { verifyJwt } from './jwt.ts';
import { loadConfig } from '../config.ts';

export const TENANT_CTX_KEY = 'tenantId';
export const USER_CTX_KEY = 'userId';
export const ROLE_CTX_KEY = 'userRole';

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const config = loadConfig();

  // 1. Try JWT cookie
  const cookie = getCookie(c, 'vastify_session');
  if (cookie) {
    const payload = await verifyJwt(cookie, config.jwtSecret);
    if (payload) {
      c.set(TENANT_CTX_KEY, payload.tenantId);
      c.set(USER_CTX_KEY, payload.userId);
      c.set(ROLE_CTX_KEY, payload.role);
      return next();
    }
  }

  // 2. Try Authorization Bearer
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/, '');
  if (bearer) {
    const payload = await verifyJwt(bearer, config.jwtSecret);
    if (payload) {
      c.set(TENANT_CTX_KEY, payload.tenantId);
      c.set(USER_CTX_KEY, payload.userId);
      c.set(ROLE_CTX_KEY, payload.role);
      return next();
    }
  }

  // 3. Fall back to API key header
  const key = c.req.header('X-Vastify-Api-Key') ?? c.req.header('x-vastify-api-key');
  if (key) {
    const hash = await hashApiKey(key);
    const row = getDb().query<{ id: string }, [string]>('SELECT id FROM tenants WHERE api_key_hash = ?').get(hash);
    if (row) {
      c.set(TENANT_CTX_KEY, row.id);
      c.set(USER_CTX_KEY, null);
      c.set(ROLE_CTX_KEY, 'admin');
      return next();
    }
  }

  return c.json({ error: 'unauthorized' }, 401);
}

export function tenantOf(c: Context): string {
  const t = c.get(TENANT_CTX_KEY) as string | undefined;
  if (!t) throw new Error('tenantId missing from context — requireApiKey must run first');
  return t;
}

export function userOf(c: Context): string | null {
  return (c.get(USER_CTX_KEY) as string | null | undefined) ?? null;
}

export function roleOf(c: Context): 'admin' | 'member' {
  return (c.get(ROLE_CTX_KEY) as 'admin' | 'member' | undefined) ?? 'member';
}

export function requireAdmin(c: Context, next: Next): Response | void | Promise<Response | void> {
  if (roleOf(c) !== 'admin') return c.json({ error: 'admin_required' }, 403);
  return next();
}
