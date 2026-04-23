import { describe, it, expect, spyOn, mock, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { authRoutes } from '../routes.js';
import { Database } from 'bun:sqlite';
import { setTestDb } from '../../db/client.js';

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, api_key_hash TEXT, sf_org_id TEXT, display_name TEXT, provisioned_at INTEGER, created_at INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_sf_org_id ON tenants(sf_org_id);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, sf_user_id TEXT UNIQUE, sf_org_id TEXT, sf_username TEXT, display_name TEXT, email TEXT, created_at INTEGER, last_login_at INTEGER);
    CREATE TABLE IF NOT EXISTS tenant_members (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER, UNIQUE(tenant_id, user_id));
    CREATE TABLE IF NOT EXISTS tenant_storage_config (tenant_id TEXT PRIMARY KEY, use_own_s3 INTEGER NOT NULL DEFAULT 0, s3_bucket_name TEXT, s3_region TEXT, s3_access_key_id_enc TEXT, s3_secret_enc TEXT, use_own_gcs INTEGER NOT NULL DEFAULT 0, gcs_bucket_name TEXT, gcs_project_id TEXT, gcs_service_account_json_enc TEXT, updated_at INTEGER NOT NULL);
  `);
  setTestDb(db);
  return db;
}

describe('Auth routes', () => {
  afterEach(() => {
    (globalThis.fetch as ReturnType<typeof spyOn>).mockRestore?.();
  });

  it('GET /auth/salesforce/login redirects to Salesforce', async () => {
    process.env.SF_CLIENT_ID = 'my-client-id';
    process.env.SF_REDIRECT_URI = 'http://localhost:3000/auth/salesforce/callback';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-long!!!!!';
    setupDb();
    const app = new Hono();
    app.route('', authRoutes);
    const res = await app.request('/auth/salesforce/login');
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('login.salesforce.com');
    expect(location).toContain('my-client-id');
  });

  it('GET /auth/salesforce/callback issues JWT cookie on success', async () => {
    process.env.SF_CLIENT_ID = 'cid';
    process.env.SF_CLIENT_SECRET = 'csec';
    process.env.SF_REDIRECT_URI = 'http://localhost:3000/auth/salesforce/callback';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-long!!!!!';
    setupDb();

    const fetchMock = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2/token')) {
        return new Response(JSON.stringify({
          access_token: 'sf-tok',
          instance_url: 'https://test.salesforce.com',
          token_type: 'Bearer',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('oauth2/userinfo')) {
        return new Response(JSON.stringify({
          sub: 'https://test.salesforce.com/id/org-abc/sf-user-123',
          organization_id: 'org-abc-123',
          preferred_username: 'user@test.com',
          name: 'Test User',
          email: 'user@test.com',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const app = new Hono();
    app.route('', authRoutes);
    const res = await app.request('/auth/salesforce/callback?code=authcode123&state=login');
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('vastify_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /auth/logout clears the cookie', async () => {
    setupDb();
    const app = new Hono();
    app.route('', authRoutes);
    const res = await app.request('/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('vastify_session=;');
  });
});
