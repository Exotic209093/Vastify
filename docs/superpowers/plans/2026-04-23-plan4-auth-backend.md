# Plan 4: Auth & Schema Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Salesforce OAuth login, JWT cookie sessions, team management routes, and per-tenant storage settings to the Bun/Hono API.

**Architecture:** Extend `api/src/auth/api-key.ts` in-place to accept JWT cookies alongside API keys — all existing routes get JWT support for free without changes. SF OAuth uses a shared Vastify Connected App. A new `api/src/auth/repo.ts` factory manages users/tenants/members in SQLite, mirroring the existing backup repo pattern. Team and settings routes are new Hono sub-apps wired into `server.ts`.

**Tech Stack:** Bun 1.3+, Hono 4.6, SQLite (bun:sqlite), `jose` (JWT), bun:test. No new runtime deps beyond `jose`.

**Prerequisite:** Merge `feature/crm-backup-plan1` into `main` before starting. Then create a new worktree: `git worktree add .worktrees/auth-plan4 -b feature/auth-plan4`.

---

## File Map

| File | Action | Purpose |
| --- | --- | --- |
| `api/package.json` | Modify | Add `jose` dependency |
| `api/src/config.ts` | Modify | Add `jwtSecret`, `sfRedirectUri` |
| `api/src/db/schema.sql` | Modify | Add `users`, `tenant_members`, `tenant_invites`, `tenant_storage_config` tables |
| `api/src/db/client.ts` | Modify | Add idempotent ALTER TABLE migrations for `tenants` |
| `api/src/auth/jwt.ts` | Create | `signJwt`, `verifyJwt` helpers |
| `api/src/auth/repo.ts` | Create | `createAuthRepo` — users, members, invites, storage config |
| `api/src/auth/api-key.ts` | Modify | Extend `requireApiKey` to accept JWT cookie + Bearer; add `userOf`, `roleOf` |
| `api/src/auth/routes.ts` | Create | `/auth/salesforce/login`, `/auth/salesforce/callback`, `/auth/me`, `/auth/logout` |
| `api/src/team/routes.ts` | Create | `/v1/team`, `/v1/team/invite`, `/v1/team/:userId`, `/v1/team/invite/:token` |
| `api/src/settings/routes.ts` | Create | `/v1/settings/storage` GET + PUT |
| `api/src/server.ts` | Modify | Wire auth/team/settings routes, add `/auth/*` CORS, credentials in CORS |
| `api/src/auth/test/jwt.test.ts` | Create | JWT round-trip tests |
| `api/src/auth/test/middleware.test.ts` | Create | requireApiKey with JWT and API key |
| `api/src/auth/test/auth-routes.test.ts` | Create | SF callback with mocked fetch |
| `api/src/team/test/team-routes.test.ts` | Create | Team CRUD tests |

---

## Task 1: DB Schema — New Tables

**Files:**
- Modify: `api/src/db/schema.sql`
- Modify: `api/src/db/client.ts`

- [ ] **Step 1: Append new tables to schema.sql**

Open `api/src/db/schema.sql` and append the following at the end of the file (after all existing tables):

```sql
-- ─── Auth: users and tenant membership ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  sf_user_id     TEXT NOT NULL UNIQUE,
  sf_org_id      TEXT NOT NULL,
  sf_username    TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  email          TEXT,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sf_user_id ON users(sf_user_id);
CREATE INDEX IF NOT EXISTS idx_users_sf_org_id ON users(sf_org_id);

CREATE TABLE IF NOT EXISTS tenant_members (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK(role IN ('admin','member')),
  joined_at   INTEGER NOT NULL,
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_invites (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  invited_by_user_id  TEXT NOT NULL REFERENCES users(id),
  email               TEXT NOT NULL,
  role                TEXT NOT NULL CHECK(role IN ('admin','member')),
  token               TEXT NOT NULL UNIQUE,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  accepted_at         INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invites_token ON tenant_invites(token);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON tenant_invites(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_storage_config (
  tenant_id                      TEXT PRIMARY KEY REFERENCES tenants(id),
  use_own_s3                     INTEGER NOT NULL DEFAULT 0,
  s3_bucket_name                 TEXT,
  s3_region                      TEXT,
  s3_access_key_id_enc           TEXT,
  s3_secret_enc                  TEXT,
  use_own_gcs                    INTEGER NOT NULL DEFAULT 0,
  gcs_bucket_name                TEXT,
  gcs_project_id                 TEXT,
  gcs_service_account_json_enc   TEXT,
  updated_at                     INTEGER NOT NULL
);
```

- [ ] **Step 2: Add ALTER TABLE migrations to client.ts**

The `tenants` table needs 3 new columns. SQLite doesn't support `IF NOT EXISTS` for columns, so we wrap in try/catch. Open `api/src/db/client.ts` and replace `runMigrations`:

```typescript
function runMigrations(conn: Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  conn.exec(schema);
  runAlterMigrations(conn);
}

function runAlterMigrations(conn: Database): void {
  const alters = [
    'ALTER TABLE tenants ADD COLUMN sf_org_id TEXT',
    'ALTER TABLE tenants ADD COLUMN display_name TEXT',
    'ALTER TABLE tenants ADD COLUMN provisioned_at INTEGER',
  ];
  for (const sql of alters) {
    try { conn.exec(sql); } catch { /* column already exists */ }
  }
  try {
    conn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_sf_org_id ON tenants(sf_org_id)');
  } catch { /* index already exists */ }
}
```

- [ ] **Step 3: Verify schema applies cleanly**

```bash
cd api && rm -f /tmp/vastify-schema-test.db && DB_PATH=/tmp/vastify-schema-test.db bun -e "import { getDb } from './src/db/client.ts'; getDb(); console.log('ok')"
```

Expected: prints `ok`, no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/schema.sql api/src/db/client.ts
git commit -m "feat(auth): add users, tenant_members, tenant_invites, tenant_storage_config schema"
```

---

## Task 2: Install jose + Update Config

**Files:**
- Modify: `api/package.json`
- Modify: `api/src/config.ts`

- [ ] **Step 1: Install jose**

```bash
cd api && bun add jose
```

Expected: `jose` appears in `package.json` dependencies and `node_modules/jose` exists.

- [ ] **Step 2: Add new config fields**

Open `api/src/config.ts`. Add to the `AppConfig` interface:

```typescript
export interface AppConfig {
  // ... existing fields ...
  jwtSecret: string;
  sfRedirectUri: string;
  backupGitDataDir: string;
  vaultMasterKeyHex: string;
  sfClientId: string;
  sfClientSecret: string;
  hsClientId: string;
  hsClientSecret: string;
}
```

Then in `loadConfig()`, add these fields (place after `presignTtlSec`):

```typescript
jwtSecret: str('JWT_SECRET', 'dev-secret-change-me-in-production-min-32-chars'),
sfRedirectUri: str('SF_REDIRECT_URI', 'http://localhost:3000/auth/salesforce/callback'),
backupGitDataDir: str('BACKUP_GIT_DATA_DIR', './backup-git-data'),
vaultMasterKeyHex: str('VAULT_MASTER_KEY_HEX', '0'.repeat(64)),
sfClientId: str('SF_CLIENT_ID', ''),
sfClientSecret: str('SF_CLIENT_SECRET', ''),
hsClientId: str('HS_CLIENT_ID', ''),
hsClientSecret: str('HS_CLIENT_SECRET', ''),
```

- [ ] **Step 3: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add api/package.json api/src/config.ts api/bun.lock
git commit -m "feat(auth): install jose, add jwtSecret + sfRedirectUri config fields"
```

---

## Task 3: JWT Helpers

**Files:**
- Create: `api/src/auth/jwt.ts`
- Create: `api/src/auth/test/jwt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/auth/test/jwt.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { signJwt, verifyJwt } from '../jwt.js';

describe('JWT', () => {
  const payload = { tenantId: 'tenant-1', userId: 'user-1', role: 'admin' as const, sfOrgId: 'org-1' };

  it('round-trips a payload', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    expect(typeof token).toBe('string');
    const verified = await verifyJwt(token, 'test-secret-min-32-chars-long!!!!!');
    expect(verified?.tenantId).toBe('tenant-1');
    expect(verified?.userId).toBe('user-1');
    expect(verified?.role).toBe('admin');
  });

  it('returns null for a tampered token', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    const tampered = token.slice(0, -5) + 'AAAAA';
    const result = await verifyJwt(tampered, 'test-secret-min-32-chars-long!!!!!');
    expect(result).toBeNull();
  });

  it('returns null for wrong secret', async () => {
    const token = await signJwt(payload, 'test-secret-min-32-chars-long!!!!!');
    const result = await verifyJwt(token, 'different-secret-min-32-chars-!!!');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd api && bun test src/auth/test/jwt.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../jwt.js'`

- [ ] **Step 3: Create jwt.ts**

Create `api/src/auth/jwt.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose';

export interface JwtPayload {
  tenantId: string;
  userId: string;
  role: 'admin' | 'member';
  sfOrgId: string;
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(key);
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/auth/test/jwt.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/auth/jwt.ts api/src/auth/test/jwt.test.ts
git commit -m "feat(auth): add JWT sign/verify helpers"
```

---

## Task 4: Auth Repo

**Files:**
- Create: `api/src/auth/repo.ts`

The auth repo manages users, tenant provisioning, members, invites, and storage config. It follows the same factory pattern as `api/src/backup/repo.ts`.

- [ ] **Step 1: Create api/src/auth/repo.ts**

```typescript
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export interface User {
  id: string;
  sfUserId: string;
  sfOrgId: string;
  sfUsername: string;
  displayName: string;
  email: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;
  sfOrgId: string | null;
  displayName: string | null;
  provisionedAt: number | null;
  createdAt: number;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface TenantInvite {
  id: string;
  tenantId: string;
  invitedByUserId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export interface TenantStorageConfig {
  tenantId: string;
  useOwnS3: boolean;
  s3BucketName: string | null;
  s3Region: string | null;
  s3AccessKeyIdEnc: string | null;
  s3SecretEnc: string | null;
  useOwnGcs: boolean;
  gcsBucketName: string | null;
  gcsProjectId: string | null;
  gcsServiceAccountJsonEnc: string | null;
  updatedAt: number;
}

export interface AuthRepo {
  users: {
    findBySfUserId(sfUserId: string): User | null;
    upsert(user: Omit<User, 'id'> & { id?: string }): User;
  };
  tenants: {
    findBySfOrgId(sfOrgId: string): Tenant | null;
    create(sfOrgId: string, displayName: string): Tenant;
  };
  members: {
    findByTenantAndUser(tenantId: string, userId: string): TenantMember | null;
    findByTenant(tenantId: string): TenantMember[];
    insert(member: TenantMember): void;
    remove(tenantId: string, userId: string): void;
    countByTenant(tenantId: string): number;
  };
  invites: {
    findByToken(token: string): TenantInvite | null;
    findByTenant(tenantId: string): TenantInvite[];
    insert(invite: TenantInvite): void;
    accept(token: string, acceptedAt: number): void;
  };
  storageConfig: {
    findByTenant(tenantId: string): TenantStorageConfig | null;
    upsert(config: TenantStorageConfig): void;
    initForTenant(tenantId: string): void;
  };
}

type UserRow = {
  id: string; sf_user_id: string; sf_org_id: string; sf_username: string;
  display_name: string; email: string | null; created_at: number; last_login_at: number | null;
};
type TenantRow = {
  id: string; name: string; api_key_hash: string; sf_org_id: string | null;
  display_name: string | null; provisioned_at: number | null; created_at: number;
};
type MemberRow = { id: string; tenant_id: string; user_id: string; role: string; joined_at: number };
type InviteRow = {
  id: string; tenant_id: string; invited_by_user_id: string; email: string; role: string;
  token: string; created_at: number; expires_at: number; accepted_at: number | null;
};
type StorageRow = {
  tenant_id: string; use_own_s3: number; s3_bucket_name: string | null; s3_region: string | null;
  s3_access_key_id_enc: string | null; s3_secret_enc: string | null; use_own_gcs: number;
  gcs_bucket_name: string | null; gcs_project_id: string | null;
  gcs_service_account_json_enc: string | null; updated_at: number;
};

function rowToUser(r: UserRow): User {
  return {
    id: r.id, sfUserId: r.sf_user_id, sfOrgId: r.sf_org_id, sfUsername: r.sf_username,
    displayName: r.display_name, email: r.email, createdAt: r.created_at, lastLoginAt: r.last_login_at,
  };
}

function rowToMember(r: MemberRow): TenantMember {
  return { id: r.id, tenantId: r.tenant_id, userId: r.user_id, role: r.role as 'admin' | 'member', joinedAt: r.joined_at };
}

function rowToInvite(r: InviteRow): TenantInvite {
  return {
    id: r.id, tenantId: r.tenant_id, invitedByUserId: r.invited_by_user_id, email: r.email,
    role: r.role as 'admin' | 'member', token: r.token, createdAt: r.created_at,
    expiresAt: r.expires_at, acceptedAt: r.accepted_at,
  };
}

function rowToStorage(r: StorageRow): TenantStorageConfig {
  return {
    tenantId: r.tenant_id, useOwnS3: r.use_own_s3 === 1, s3BucketName: r.s3_bucket_name,
    s3Region: r.s3_region, s3AccessKeyIdEnc: r.s3_access_key_id_enc, s3SecretEnc: r.s3_secret_enc,
    useOwnGcs: r.use_own_gcs === 1, gcsBucketName: r.gcs_bucket_name, gcsProjectId: r.gcs_project_id,
    gcsServiceAccountJsonEnc: r.gcs_service_account_json_enc, updatedAt: r.updated_at,
  };
}

export function createAuthRepo(db: Database): AuthRepo {
  return {
    users: {
      findBySfUserId(sfUserId) {
        const r = db.query<UserRow, [string]>('SELECT * FROM users WHERE sf_user_id = ?').get(sfUserId);
        return r ? rowToUser(r) : null;
      },
      upsert(user) {
        const id = user.id ?? randomUUID();
        db.prepare(`
          INSERT INTO users (id, sf_user_id, sf_org_id, sf_username, display_name, email, created_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sf_user_id) DO UPDATE SET
            sf_username = excluded.sf_username,
            display_name = excluded.display_name,
            email = excluded.email,
            last_login_at = excluded.last_login_at
        `).run(id, user.sfUserId, user.sfOrgId, user.sfUsername, user.displayName, user.email ?? null, user.createdAt, user.lastLoginAt ?? null);
        return { ...user, id };
      },
    },
    tenants: {
      findBySfOrgId(sfOrgId) {
        const r = db.query<TenantRow, [string]>('SELECT * FROM tenants WHERE sf_org_id = ?').get(sfOrgId);
        if (!r) return null;
        return { id: r.id, name: r.name, apiKeyHash: r.api_key_hash, sfOrgId: r.sf_org_id, displayName: r.display_name, provisionedAt: r.provisioned_at, createdAt: r.created_at };
      },
      create(sfOrgId, displayName) {
        const id = randomUUID();
        const now = Date.now();
        db.prepare(`
          INSERT INTO tenants (id, name, api_key_hash, sf_org_id, display_name, provisioned_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, displayName, '', sfOrgId, displayName, now, now);
        return { id, name: displayName, apiKeyHash: '', sfOrgId, displayName, provisionedAt: now, createdAt: now };
      },
    },
    members: {
      findByTenantAndUser(tenantId, userId) {
        const r = db.query<MemberRow, [string, string]>('SELECT * FROM tenant_members WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
        return r ? rowToMember(r) : null;
      },
      findByTenant(tenantId) {
        return db.query<MemberRow, [string]>('SELECT * FROM tenant_members WHERE tenant_id = ?').all(tenantId).map(rowToMember);
      },
      insert(member) {
        db.prepare('INSERT OR IGNORE INTO tenant_members (id, tenant_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)')
          .run(member.id, member.tenantId, member.userId, member.role, member.joinedAt);
      },
      remove(tenantId, userId) {
        db.prepare('DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
      },
      countByTenant(tenantId) {
        const r = db.query<{ count: number }, [string]>('SELECT COUNT(*) as count FROM tenant_members WHERE tenant_id = ?').get(tenantId);
        return r?.count ?? 0;
      },
    },
    invites: {
      findByToken(token) {
        const r = db.query<InviteRow, [string]>('SELECT * FROM tenant_invites WHERE token = ?').get(token);
        return r ? rowToInvite(r) : null;
      },
      findByTenant(tenantId) {
        return db.query<InviteRow, [string]>('SELECT * FROM tenant_invites WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId).map(rowToInvite);
      },
      insert(invite) {
        db.prepare(`INSERT INTO tenant_invites (id, tenant_id, invited_by_user_id, email, role, token, created_at, expires_at, accepted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(invite.id, invite.tenantId, invite.invitedByUserId, invite.email, invite.role, invite.token, invite.createdAt, invite.expiresAt, invite.acceptedAt ?? null);
      },
      accept(token, acceptedAt) {
        db.prepare('UPDATE tenant_invites SET accepted_at = ? WHERE token = ?').run(acceptedAt, token);
      },
    },
    storageConfig: {
      findByTenant(tenantId) {
        const r = db.query<StorageRow, [string]>('SELECT * FROM tenant_storage_config WHERE tenant_id = ?').get(tenantId);
        return r ? rowToStorage(r) : null;
      },
      upsert(config) {
        db.prepare(`
          INSERT INTO tenant_storage_config
            (tenant_id, use_own_s3, s3_bucket_name, s3_region, s3_access_key_id_enc, s3_secret_enc,
             use_own_gcs, gcs_bucket_name, gcs_project_id, gcs_service_account_json_enc, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id) DO UPDATE SET
            use_own_s3 = excluded.use_own_s3,
            s3_bucket_name = excluded.s3_bucket_name,
            s3_region = excluded.s3_region,
            s3_access_key_id_enc = excluded.s3_access_key_id_enc,
            s3_secret_enc = excluded.s3_secret_enc,
            use_own_gcs = excluded.use_own_gcs,
            gcs_bucket_name = excluded.gcs_bucket_name,
            gcs_project_id = excluded.gcs_project_id,
            gcs_service_account_json_enc = excluded.gcs_service_account_json_enc,
            updated_at = excluded.updated_at
        `).run(
          config.tenantId, config.useOwnS3 ? 1 : 0, config.s3BucketName ?? null, config.s3Region ?? null,
          config.s3AccessKeyIdEnc ?? null, config.s3SecretEnc ?? null, config.useOwnGcs ? 1 : 0,
          config.gcsBucketName ?? null, config.gcsProjectId ?? null, config.gcsServiceAccountJsonEnc ?? null,
          config.updatedAt,
        );
      },
      initForTenant(tenantId) {
        db.prepare(`
          INSERT OR IGNORE INTO tenant_storage_config (tenant_id, use_own_s3, use_own_gcs, updated_at)
          VALUES (?, 0, 0, ?)
        `).run(tenantId, Date.now());
      },
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/src/auth/repo.ts
git commit -m "feat(auth): add auth repo (users, members, invites, storage config)"
```

---

## Task 5: Extend requireApiKey to Accept JWT

**Files:**
- Modify: `api/src/auth/api-key.ts`
- Create: `api/src/auth/test/middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/auth/test/middleware.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { signJwt } from '../jwt.js';

const SECRET = 'test-secret-min-32-chars-long!!!!!';

async function makeApp() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT, api_key_hash TEXT UNIQUE,
      sf_org_id TEXT, display_name TEXT, provisioned_at INTEGER, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, sf_user_id TEXT UNIQUE, sf_org_id TEXT,
      sf_username TEXT, display_name TEXT, email TEXT, created_at INTEGER, last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tenant_members (
      id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER,
      UNIQUE(tenant_id, user_id)
    );
  `);
  db.exec("INSERT INTO tenants VALUES ('t1','Test','hash123',null,null,null,1000)");
  db.exec("INSERT INTO users VALUES ('u1','sf-user-1','org-1','user@test.com','Test User',null,1000,null)");
  db.exec("INSERT INTO tenant_members VALUES ('m1','t1','u1','admin',1000)");

  // Override DB and config for test
  process.env.JWT_SECRET = SECRET;
  process.env.DB_PATH = ':memory:';

  const { requireApiKey, tenantOf, userOf, roleOf } = await import('../api-key.js');
  // Force the module to use our test db
  const { setTestDb } = await import('../../db/client.js');
  setTestDb(db);

  const app = new Hono();
  app.use('*', requireApiKey);
  app.get('/me', (c) => c.json({ tenantId: tenantOf(c), userId: userOf(c), role: roleOf(c) }));
  return app;
}

describe('requireApiKey middleware', () => {
  it('accepts a valid JWT cookie and populates context', async () => {
    const app = await makeApp();
    const token = await signJwt({ tenantId: 't1', userId: 'u1', role: 'admin', sfOrgId: 'org-1' }, SECRET);
    const res = await app.request('/me', { headers: { Cookie: `vastify_session=${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; userId: string; role: string };
    expect(body.tenantId).toBe('t1');
    expect(body.userId).toBe('u1');
    expect(body.role).toBe('admin');
  });

  it('returns 401 for no credentials', async () => {
    const app = await makeApp();
    const res = await app.request('/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered JWT', async () => {
    const app = await makeApp();
    const res = await app.request('/me', { headers: { Cookie: 'vastify_session=invalid.token.here' } });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd api && bun test src/auth/test/middleware.test.ts 2>&1 | tail -10
```

Expected: FAIL — `userOf` and `roleOf` not exported from `api-key.js`.

- [ ] **Step 3: Update api/src/auth/api-key.ts**

Replace the entire file:

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/auth/test/middleware.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
cd api && bun test 2>&1 | tail -5
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth/api-key.ts api/src/auth/test/middleware.test.ts
git commit -m "feat(auth): extend requireApiKey to accept JWT cookie and Bearer token"
```

---

## Task 6: Auth Routes (SF OAuth)

**Files:**
- Create: `api/src/auth/routes.ts`
- Create: `api/src/auth/test/auth-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/auth/test/auth-routes.test.ts`:

```typescript
import { describe, it, expect, mock, afterEach, spyOn } from 'bun:test';
import { Hono } from 'hono';
import { authRoutes } from '../routes.js';

describe('Auth routes', () => {
  afterEach(() => {
    (globalThis.fetch as unknown as ReturnType<typeof mock>).mockRestore?.();
  });

  it('GET /auth/salesforce/login redirects to Salesforce', async () => {
    process.env.SF_CLIENT_ID = 'my-client-id';
    process.env.SF_REDIRECT_URI = 'http://localhost:3000/auth/salesforce/callback';
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
    process.env.DB_PATH = ':memory:';

    const { Database } = await import('bun:sqlite');
    const { setTestDb } = await import('../../db/client.js');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, api_key_hash TEXT, sf_org_id TEXT, display_name TEXT, provisioned_at INTEGER, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, sf_user_id TEXT UNIQUE, sf_org_id TEXT, sf_username TEXT, display_name TEXT, email TEXT, created_at INTEGER, last_login_at INTEGER);
      CREATE TABLE IF NOT EXISTS tenant_members (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER, UNIQUE(tenant_id, user_id));
      CREATE TABLE IF NOT EXISTS tenant_storage_config (tenant_id TEXT PRIMARY KEY, use_own_s3 INTEGER NOT NULL DEFAULT 0, s3_bucket_name TEXT, s3_region TEXT, s3_access_key_id_enc TEXT, s3_secret_enc TEXT, use_own_gcs INTEGER NOT NULL DEFAULT 0, gcs_bucket_name TEXT, gcs_project_id TEXT, gcs_service_account_json_enc TEXT, updated_at INTEGER NOT NULL);
    `);
    setTestDb(db);

    spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'sf-tok', instance_url: 'https://test.salesforce.com', token_type: 'Bearer' }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('oauth2/userinfo')) {
        return new Response(JSON.stringify({ sub: 'sf-user-123', organization_id: 'org-abc-123', preferred_username: 'user@test.com', name: 'Test User', email: 'user@test.com' }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    } as typeof fetch);

    const app = new Hono();
    app.route('', authRoutes);
    const res = await app.request('/auth/salesforce/callback?code=authcode123&state=login');
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('vastify_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /auth/logout clears the cookie', async () => {
    const app = new Hono();
    app.route('', authRoutes);
    const res = await app.request('/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('vastify_session=;');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd api && bun test src/auth/test/auth-routes.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../routes.js'`

- [ ] **Step 3: Create api/src/auth/routes.ts**

```typescript
import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { requireApiKey, tenantOf, userOf, roleOf } from './api-key.ts';
import { signJwt } from './jwt.ts';
import { createAuthRepo } from './repo.ts';

const SF_AUTH_URL = 'https://login.salesforce.com/services/oauth2/authorize';
const SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token';
const SF_USERINFO_URL = 'https://login.salesforce.com/services/oauth2/userinfo';

export const authRoutes = new Hono();

function getRepo() {
  return createAuthRepo(getDb());
}

// Redirect user to Salesforce OAuth
authRoutes.get('/auth/salesforce/login', (c) => {
  const config = loadConfig();
  const intent = c.req.query('intent') ?? 'login';
  const state = intent === 'connect-org' ? `connect-org:${tenantOf(c)}` : 'login';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.sfClientId,
    redirect_uri: config.sfRedirectUri,
    scope: 'openid profile email api refresh_token',
    state,
  });
  return c.redirect(`${SF_AUTH_URL}?${params.toString()}`);
});

// Handle OAuth callback from Salesforce
authRoutes.get('/auth/salesforce/callback', async (c) => {
  const config = loadConfig();
  const repo = getRepo();
  const code = c.req.query('code');
  const state = c.req.query('state') ?? 'login';

  if (!code) return c.json({ error: 'missing_code' }, 400);

  // Exchange code for tokens
  const tokenRes = await fetch(SF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.sfClientId,
      client_secret: config.sfClientSecret,
      redirect_uri: config.sfRedirectUri,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: 'token_exchange_failed' }, 502);
  const tokens = await tokenRes.json() as { access_token: string; instance_url: string; refresh_token?: string };

  // Get user info
  const userInfoRes = await fetch(`${tokens.instance_url}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoRes.ok) return c.json({ error: 'userinfo_failed' }, 502);
  const sfUser = await userInfoRes.json() as {
    sub: string; organization_id: string; preferred_username: string; name: string; email?: string;
  };

  const sfUserId = sfUser.sub.split('/').pop() ?? sfUser.sub;
  const sfOrgId = sfUser.organization_id;

  // Handle connect-org intent: store refresh token and return
  if (state.startsWith('connect-org:')) {
    // The org connection flow is handled by existing /v1/backup/orgs — we just close the popup or redirect back
    return c.redirect('/dashboard/backups?connected=1');
  }

  // Login flow: provision tenant + user
  let tenant = repo.tenants.findBySfOrgId(sfOrgId);
  if (!tenant) {
    tenant = repo.tenants.create(sfOrgId, sfUser.name ?? sfUser.preferred_username);
    repo.storageConfig.initForTenant(tenant.id);
  }

  const now = Date.now();
  const user = repo.users.upsert({
    sfUserId, sfOrgId, sfUsername: sfUser.preferred_username,
    displayName: sfUser.name ?? sfUser.preferred_username,
    email: sfUser.email ?? null, createdAt: now, lastLoginAt: now,
  });

  // Provision membership
  const existingMember = repo.members.findByTenantAndUser(tenant.id, user.id);
  if (!existingMember) {
    const isFirstMember = repo.members.countByTenant(tenant.id) === 0;
    repo.members.insert({
      id: randomUUID(), tenantId: tenant.id, userId: user.id,
      role: isFirstMember ? 'admin' : 'member', joinedAt: now,
    });
  }

  const member = repo.members.findByTenantAndUser(tenant.id, user.id)!;
  const token = await signJwt({ tenantId: tenant.id, userId: user.id, role: member.role, sfOrgId }, config.jwtSecret);

  setCookie(c, 'vastify_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.env === 'production',
    maxAge: 8 * 60 * 60,
    path: '/',
  });

  return c.redirect('/');
});

// Clear session cookie
authRoutes.post('/auth/logout', (c) => {
  deleteCookie(c, 'vastify_session', { path: '/' });
  return c.json({ ok: true });
});

// Return current user info (requires auth)
authRoutes.get('/auth/me', requireApiKey, (c) => {
  const repo = getRepo();
  const tenantId = tenantOf(c);
  const userId = userOf(c);
  const role = roleOf(c);

  const members = repo.members.findByTenant(tenantId);
  return c.json({ tenantId, userId, role, memberCount: members.length });
});
```

- [ ] **Step 4: Run tests**

```bash
cd api && bun test src/auth/test/auth-routes.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/auth/routes.ts api/src/auth/test/auth-routes.test.ts
git commit -m "feat(auth): add Salesforce OAuth routes and JWT session management"
```

---

## Task 7: Team Routes

**Files:**
- Create: `api/src/team/routes.ts`
- Create: `api/src/team/test/team-routes.test.ts`

- [ ] **Step 1: Create api/src/team/routes.ts**

```typescript
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { requireApiKey, requireAdmin, tenantOf, userOf } from '../auth/api-key.ts';
import { getDb } from '../db/client.ts';
import { createAuthRepo } from '../auth/repo.ts';
import { loadConfig } from '../config.ts';

export const teamRoutes = new Hono();

teamRoutes.use('*', requireApiKey);

function getRepo() {
  return createAuthRepo(getDb());
}

// List members and pending invites
teamRoutes.get('/', (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const members = repo.members.findByTenant(tenantId);
  const invites = repo.invites.findByTenant(tenantId).filter((i) => i.acceptedAt === null && i.expiresAt > Date.now());
  return c.json({ members, invites });
});

// Invite a new member by email
teamRoutes.post('/invite', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const userId = userOf(c);
  if (!userId) return c.json({ error: 'invite requires user session' }, 400);

  const body = await c.req.json<{ email?: string; role?: string }>();
  if (!body.email) return c.json({ error: 'email required' }, 400);
  const role = body.role === 'admin' ? 'admin' : 'member';

  const token = randomUUID();
  const now = Date.now();
  const config = loadConfig();

  getRepo().invites.insert({
    id: randomUUID(), tenantId, invitedByUserId: userId, email: body.email,
    role, token, createdAt: now, expiresAt: now + 7 * 24 * 60 * 60 * 1000, acceptedAt: null,
  });

  const host = c.req.header('Origin') ?? `${c.req.header('X-Forwarded-Proto') ?? 'http'}://${c.req.header('Host')}`;
  const inviteUrl = `${host}/dashboard/team/invite/${token}`;

  return c.json({ token, inviteUrl }, 201);
});

// Validate an invite token (called by frontend before redirecting to SF login)
teamRoutes.get('/invite/:token', (c) => {
  const invite = getRepo().invites.findByToken(c.req.param('token'));
  if (!invite || invite.acceptedAt !== null || invite.expiresAt < Date.now()) {
    return c.json({ error: 'invite not found or expired' }, 404);
  }
  return c.json({ tenantId: invite.tenantId, email: invite.email, role: invite.role });
});

// Remove a member (admin only, cannot remove self)
teamRoutes.delete('/:userId', requireAdmin, (c) => {
  const tenantId = tenantOf(c);
  const callerUserId = userOf(c);
  const targetUserId = c.req.param('userId');

  if (targetUserId === callerUserId) return c.json({ error: 'cannot remove yourself' }, 400);
  getRepo().members.remove(tenantId, targetUserId);
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 2: Write the failing test**

Create `api/src/team/test/team-routes.test.ts`:

```typescript
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
});
```

- [ ] **Step 3: Run tests**

```bash
cd api && bun test src/team/test/team-routes.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/team/routes.ts api/src/team/test/team-routes.test.ts
git commit -m "feat(auth): add team management routes (invite, list, remove)"
```

---

## Task 8: Settings Routes

**Files:**
- Create: `api/src/settings/routes.ts`

- [ ] **Step 1: Create api/src/settings/routes.ts**

```typescript
import { Hono } from 'hono';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireApiKey, requireAdmin, tenantOf } from '../auth/api-key.ts';
import { getDb } from '../db/client.ts';
import { createAuthRepo, type TenantStorageConfig } from '../auth/repo.ts';
import { loadConfig } from '../config.ts';

export const settingsRoutes = new Hono();

settingsRoutes.use('*', requireApiKey);

function getRepo() {
  return createAuthRepo(getDb());
}

function getMasterKey(): Buffer {
  const config = loadConfig();
  return Buffer.from(config.vaultMasterKeyHex, 'hex');
}

function encryptValue(plaintext: string): string {
  const key = getMasterKey().slice(0, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

function redact(value: string | null): string | null {
  return value ? '***' : null;
}

function storageConfigResponse(config: TenantStorageConfig) {
  return {
    useOwnS3: config.useOwnS3,
    s3BucketName: config.s3BucketName,
    s3Region: config.s3Region,
    s3AccessKeyId: redact(config.s3AccessKeyIdEnc),
    s3Secret: redact(config.s3SecretEnc),
    useOwnGcs: config.useOwnGcs,
    gcsBucketName: config.gcsBucketName,
    gcsProjectId: config.gcsProjectId,
    gcsServiceAccountJson: redact(config.gcsServiceAccountJsonEnc),
    updatedAt: config.updatedAt,
  };
}

// GET /v1/settings/storage — current config, credentials redacted
settingsRoutes.get('/storage', (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const config = repo.storageConfig.findByTenant(tenantId);
  if (!config) {
    repo.storageConfig.initForTenant(tenantId);
    return c.json(storageConfigResponse({ tenantId, useOwnS3: false, s3BucketName: null, s3Region: null, s3AccessKeyIdEnc: null, s3SecretEnc: null, useOwnGcs: false, gcsBucketName: null, gcsProjectId: null, gcsServiceAccountJsonEnc: null, updatedAt: Date.now() }));
  }
  return c.json(storageConfigResponse(config));
});

// PUT /v1/settings/storage — update own S3 or GCS credentials
settingsRoutes.put('/storage', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const existing = repo.storageConfig.findByTenant(tenantId) ?? { tenantId, useOwnS3: false, s3BucketName: null, s3Region: null, s3AccessKeyIdEnc: null, s3SecretEnc: null, useOwnGcs: false, gcsBucketName: null, gcsProjectId: null, gcsServiceAccountJsonEnc: null, updatedAt: Date.now() };

  const body = await c.req.json<{
    useOwnS3?: boolean; s3BucketName?: string; s3Region?: string; s3AccessKeyId?: string; s3Secret?: string;
    useOwnGcs?: boolean; gcsBucketName?: string; gcsProjectId?: string; gcsServiceAccountJson?: string;
  }>();

  const updated: TenantStorageConfig = {
    ...existing,
    updatedAt: Date.now(),
    useOwnS3: body.useOwnS3 ?? existing.useOwnS3,
    s3BucketName: body.s3BucketName ?? existing.s3BucketName,
    s3Region: body.s3Region ?? existing.s3Region,
    s3AccessKeyIdEnc: body.s3AccessKeyId ? encryptValue(body.s3AccessKeyId) : existing.s3AccessKeyIdEnc,
    s3SecretEnc: body.s3Secret ? encryptValue(body.s3Secret) : existing.s3SecretEnc,
    useOwnGcs: body.useOwnGcs ?? existing.useOwnGcs,
    gcsBucketName: body.gcsBucketName ?? existing.gcsBucketName,
    gcsProjectId: body.gcsProjectId ?? existing.gcsProjectId,
    gcsServiceAccountJsonEnc: body.gcsServiceAccountJson ? encryptValue(body.gcsServiceAccountJson) : existing.gcsServiceAccountJsonEnc,
  };

  repo.storageConfig.upsert(updated);
  return c.json(storageConfigResponse(updated));
});
```

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/src/settings/routes.ts
git commit -m "feat(auth): add storage settings routes (GET/PUT /v1/settings/storage)"
```

---

## Task 9: Wire into server.ts + Final Verification

**Files:**
- Modify: `api/src/server.ts`

- [ ] **Step 1: Update server.ts**

Replace the entire file:

```typescript
import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { getDb } from './db/client.ts';
import { filesRoutes } from './files/routes.ts';
import { recordsRoutes } from './records/routes.ts';
import { odataRoutes } from './odata/handler.ts';
import { statsRoutes } from './stats/routes.ts';
import { rulesRoutes } from './rules/routes.ts';
import { backupRoutes } from './backup/routes.ts';
import { authRoutes } from './auth/routes.ts';
import { teamRoutes } from './team/routes.ts';
import { settingsRoutes } from './settings/routes.ts';
import { log } from './util/logger.ts';

const config = loadConfig();
getDb();
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'vastify-api', version: '0.1.0' }));

// CORS — allow cookies for JWT auth
app.use('/v1/*', async (c, next) => {
  const origin = c.req.header('Origin') ?? '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type,X-Vastify-Api-Key,Authorization');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.use('/auth/*', async (c, next) => {
  const origin = c.req.header('Origin') ?? '*';
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

// Auth routes (no global auth required — handles its own)
app.route('', authRoutes);

// API routes
app.route('/v1/files', filesRoutes);
app.route('/v1/records', recordsRoutes);
app.route('/v1/stats', statsRoutes);
app.route('/v1/rules', rulesRoutes);
app.route('/v1/backup', backupRoutes);
app.route('/v1/team', teamRoutes);
app.route('/v1/settings', settingsRoutes);
app.route('/odata/v1', odataRoutes);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  log.error('unhandled', { err: err.message, stack: err.stack });
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

log.info('starting vastify-api', {
  port: config.port,
  env: config.env,
  backends: config.backends.filter((b) => b.enabled).map((b) => b.id),
});

export default {
  port: config.port,
  fetch: app.fetch,
};
```

- [ ] **Step 2: Run full test suite**

```bash
cd api && bun test 2>&1 | tail -10
```

Expected: all tests pass, 0 failures.

- [ ] **Step 3: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4: Smoke test**

```bash
PORT=3099 bun run api/src/server.ts &
sleep 2
curl -s http://localhost:3099/health
curl -s http://localhost:3099/auth/salesforce/login -v 2>&1 | grep Location
kill %1
```

Expected: health returns `{"ok":true,...}`, login redirects to `login.salesforce.com`.

- [ ] **Step 5: Final commit**

```bash
git add api/src/server.ts
git commit -m "feat(auth): wire auth/team/settings routes into server, update CORS for cookie auth"
```
