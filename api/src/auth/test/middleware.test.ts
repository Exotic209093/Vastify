import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { requireApiKey, tenantOf, userOf, roleOf } from '../api-key.js';
import { setTestDb } from '../../db/client.js';
import { signJwt } from '../jwt.js';

const SECRET = 'test-secret-min-32-chars-long!!!!!';

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT, api_key_hash TEXT,
      sf_org_id TEXT, display_name TEXT, provisioned_at INTEGER, created_at INTEGER
    );
    INSERT INTO tenants VALUES ('t1','Test','',null,null,null,1000);
  `);
  setTestDb(db);
  process.env.JWT_SECRET = SECRET;
  return db;
}

function makeApp() {
  const app = new Hono();
  app.use('*', requireApiKey);
  app.get('/me', (c) => c.json({ tenantId: tenantOf(c), userId: userOf(c), role: roleOf(c) }));
  return app;
}

describe('requireApiKey middleware', () => {
  it('accepts a valid JWT cookie', async () => {
    setupDb();
    const token = await signJwt({ tenantId: 't1', userId: 'u1', role: 'admin', sfOrgId: 'org-1' }, SECRET);
    const app = makeApp();
    const res = await app.request('/me', { headers: { Cookie: `vastify_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; userId: string; role: string };
    expect(body.tenantId).toBe('t1');
    expect(body.userId).toBe('u1');
    expect(body.role).toBe('admin');
  });

  it('accepts a valid Bearer token', async () => {
    setupDb();
    const token = await signJwt({ tenantId: 't1', userId: 'u1', role: 'member', sfOrgId: 'org-1' }, SECRET);
    const app = makeApp();
    const res = await app.request('/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string };
    expect(body.role).toBe('member');
  });

  it('returns 401 for no credentials', async () => {
    setupDb();
    const app = makeApp();
    const res = await app.request('/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered JWT cookie', async () => {
    setupDb();
    const token = await signJwt({ tenantId: 't1', userId: 'u1', role: 'admin', sfOrgId: 'org-1' }, SECRET);
    const tampered = token.slice(0, -5) + 'AAAAA';
    const app = makeApp();
    const res = await app.request('/me', { headers: { Cookie: `vastify_session=${tampered}` } });
    expect(res.status).toBe(401);
  });
});
