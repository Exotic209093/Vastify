import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { teamRoutes } from '../routes.js';
import { setTestDb } from '../../db/client.js';
import { signJwt } from '../../auth/jwt.js';

const SECRET = 'test-secret-min-32-chars-long!!!!!';

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, api_key_hash TEXT, sf_org_id TEXT, display_name TEXT, provisioned_at INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, sf_user_id TEXT UNIQUE, sf_org_id TEXT, sf_username TEXT, display_name TEXT, email TEXT, created_at INTEGER, last_login_at INTEGER);
    CREATE TABLE IF NOT EXISTS tenant_members (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER, UNIQUE(tenant_id, user_id));
    CREATE TABLE IF NOT EXISTS tenant_invites (id TEXT PRIMARY KEY, tenant_id TEXT, invited_by_user_id TEXT, email TEXT, role TEXT, token TEXT UNIQUE, created_at INTEGER, expires_at INTEGER, accepted_at INTEGER);
    INSERT INTO tenants VALUES ('t1','Test','',null,null,null,1000);
    INSERT INTO users VALUES ('u1','sf-u1','org-1','admin@test.com','Admin',null,1000,null);
    INSERT INTO tenant_members VALUES ('m1','t1','u1','admin',1000);
  `);
  setTestDb(db);
  return db;
}

async function makeAdminJwt() {
  process.env.JWT_SECRET = SECRET;
  return signJwt({ tenantId: 't1', userId: 'u1', role: 'admin', sfOrgId: 'org-1' }, SECRET);
}

describe('Team routes', () => {
  it('GET / lists members', async () => {
    setupDb();
    const token = await makeAdminJwt();
    const app = new Hono().route('/', teamRoutes);
    const res = await app.request('/', { headers: { Cookie: `vastify_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { members: unknown[] };
    expect(body.members).toHaveLength(1);
  });

  it('POST /invite creates an invite', async () => {
    setupDb();
    const token = await makeAdminJwt();
    const app = new Hono().route('/', teamRoutes);
    const res = await app.request('/invite', {
      method: 'POST',
      headers: { Cookie: `vastify_session=${token}`, 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { token: string };
    expect(body.token).toBeTruthy();
  });

  it('DELETE /:userId removes member', async () => {
    const db = setupDb();
    db.exec("INSERT INTO users VALUES ('u2','sf-u2','org-1','member@test.com','Member',null,1000,null)");
    db.exec("INSERT INTO tenant_members VALUES ('m2','t1','u2','member',1000)");
    const token = await makeAdminJwt();
    const app = new Hono().route('/', teamRoutes);
    const res = await app.request('/u2', { method: 'DELETE', headers: { Cookie: `vastify_session=${token}` } });
    expect(res.status).toBe(204);
  });

  it('DELETE /:userId cannot remove self', async () => {
    setupDb();
    const token = await makeAdminJwt();
    const app = new Hono().route('/', teamRoutes);
    const res = await app.request('/u1', { method: 'DELETE', headers: { Cookie: `vastify_session=${token}` } });
    expect(res.status).toBe(400);
  });
});
