# Vastify — Auth, Multi-Tenant Storage & Dashboard Design

**Date:** 2026-04-23
**Status:** Approved

## Goal

Extend Vastify with Salesforce OAuth login (app identity provider + CRM org connection), per-tenant storage provisioning (Vastify-managed defaults + bring-your-own), and a full React dashboard served from the Bun backend. Teams can be managed within a tenant. All existing API surface remains backward-compatible.

---

## 1. Authentication Architecture

### Identity Model

- One Salesforce org = one Vastify tenant. `organizationId` from SF userinfo is the stable tenant identifier.
- Users are Salesforce users. A user belongs to exactly one tenant (their SF org).
- First user from an org auto-provisions a new tenant and is assigned the `admin` role.
- Subsequent users from the same org are assigned the `member` role on login.

### Login Flow

1. User visits Vastify dashboard — React checks for `vastify_session` cookie.
2. No valid session → redirect to `/login` page.
3. User clicks "Login with Salesforce" → `GET /auth/salesforce/login`.
4. Server redirects to `https://login.salesforce.com/services/oauth2/authorize` with scopes `openid profile email api refresh_token` and `state=login`.
5. SF redirects to `GET /auth/salesforce/callback?code=...&state=login`.
6. Server exchanges code → calls `GET /services/oauth2/userinfo` → extracts `{ sub, organizationId, preferred_username, email, name }`.
7. Upserts `users` row. Looks up tenant by `sfOrgId`. Creates tenant + `tenant_storage_config` + `tenant_members` row if first login.
8. Issues signed JWT `{ tenantId, userId, role, sfOrgId }` with 8h expiry. Sets as `HttpOnly; SameSite=Lax; Secure` cookie named `vastify_session`.
9. Redirects to `/` (dashboard root).

### CRM Org Connection Flow

Separate from login. User clicks "Connect Org" in the dashboard:

1. `GET /auth/salesforce/login?intent=connect-org` — server appends `state=connect-org:{tenantId}` to the SF authorize URL.
2. SF callback: `state` param indicates intent. Server stores `refresh_token` in credential vault (existing flow). Does **not** issue a new session JWT.
3. Creates a `connected_orgs` row as before.

### Backward Compatibility

`requireAuth` middleware accepts any of:

- `Authorization: Bearer <jwt>` header
- `vastify_session` cookie
- `X-Vastify-Api-Key` header (existing — unchanged for programmatic/machine access)

All existing routes work without changes.

### New Env Vars

```env
JWT_SECRET           # min 32 chars, used to sign/verify session JWTs
SF_REDIRECT_URI      # e.g. https://yourdomain.com/auth/salesforce/callback
```

`SF_CLIENT_ID` and `SF_CLIENT_SECRET` already exist in config.

---

## 2. Database / Data Model

Five new tables appended to `api/src/db/schema.sql` (all `CREATE TABLE IF NOT EXISTS`):

### `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  sf_user_id TEXT NOT NULL UNIQUE,
  sf_org_id TEXT NOT NULL,
  sf_username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sf_user_id ON users(sf_user_id);
```

### `tenant_members`

```sql
CREATE TABLE IF NOT EXISTS tenant_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  joined_at INTEGER NOT NULL,
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);
```

### `tenant_invites`

```sql
CREATE TABLE IF NOT EXISTS tenant_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_token ON tenant_invites(token);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON tenant_invites(tenant_id);
```

### `tenant_storage_config`

```sql
CREATE TABLE IF NOT EXISTS tenant_storage_config (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  use_own_s3 INTEGER NOT NULL DEFAULT 0,
  s3_bucket_name TEXT,
  s3_region TEXT,
  s3_access_key_id_enc TEXT,
  s3_secret_enc TEXT,
  use_own_gcs INTEGER NOT NULL DEFAULT 0,
  gcs_bucket_name TEXT,
  gcs_project_id TEXT,
  gcs_service_account_json_enc TEXT,
  updated_at INTEGER NOT NULL
);
```

### Modify `tenants` table

Add columns via `ALTER TABLE` migrations run at startup (idempotent — wrapped in `try/catch`):

```sql
ALTER TABLE tenants ADD COLUMN sf_org_id TEXT;
ALTER TABLE tenants ADD COLUMN display_name TEXT;
ALTER TABLE tenants ADD COLUMN provisioned_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_sf_org_id ON tenants(sf_org_id);
```

For existing rows (the demo tenant): `sf_org_id` stays NULL, `display_name` = `'Demo Tenant'`.

---

## 3. Per-Tenant Storage

### Default (Vastify-provisioned)

Tenants get storage immediately — no setup needed. The global S3 and GCS backends (configured via existing env vars) are used. All object keys already follow `tenants/{tenantId}/...` so isolation is built in at the key-prefix level.

`tenant_storage_config` row is created on first login with `use_own_s3 = false`, `use_own_gcs = false`.

### Bring-Your-Own Bucket

Admin goes to Settings → Storage, enters credentials. Server:

1. Encrypts S3 secret / GCS service account JSON with vault master key (AES-256-GCM, same pattern as credential vault).
2. Stores encrypted values in `tenant_storage_config`.
3. Sets `use_own_s3 = true` / `use_own_gcs = true`.

On any backup/diff/restore operation, the engine checks `tenant_storage_config`:

- `use_own_s3 = true` → instantiates a per-request S3 backend with tenant credentials.
- Otherwise → uses the global default backend.

Credentials are never returned in API responses (redacted to `"***"`).

---

## 4. API Routes

### Auth Routes (no auth required)

```text
GET  /auth/salesforce/login      Redirect to SF OAuth authorize URL
GET  /auth/salesforce/callback   Exchange code, issue JWT cookie, redirect to dashboard
POST /auth/logout                Clear vastify_session cookie
GET  /auth/me                    Return current user + tenant (JWT/cookie required)
```

`/auth/salesforce/login` accepts optional `?intent=connect-org` query param to distinguish the two OAuth flows.

### Team Routes (`/v1/team`)

Auth required. Write operations require `admin` role.

```text
GET    /v1/team                  List members + pending invites
POST   /v1/team/invite           Body: { email, role } — creates invite, returns invite URL
DELETE /v1/team/:userId          Remove member (cannot remove self)
GET    /v1/team/invite/:token    Validate invite token (used by frontend before SF login)
```

Invite URL format: `https://{host}/team/invite/{token}` — a React route that reads the token, stores it in `sessionStorage`, then redirects to `/auth/salesforce/login`. On the SF callback, if a pending token is found in `sessionStorage`, the server links the new user to the inviting tenant (overriding the org-based auto-provision) and clears the token.

### Settings Routes (`/v1/settings`)

Auth required. Admin only.

```text
GET  /v1/settings/storage        Current storage config (credentials redacted to ***)
PUT  /v1/settings/storage        Update own S3 or GCS credentials
```

---

## 5. React Dashboard

### Auth Layer

- `AuthContext` — React context holding `{ user, tenant, role }`. Fetches from `GET /auth/me` on mount.
- `ProtectedRoute` — HOC that redirects to `/login` if `AuthContext` has no user.
- `/login` page — centered card, Vastify logo, "Login with Salesforce" button (navigates to `/auth/salesforce/login`).

All API calls use `credentials: 'include'` so the `HttpOnly` cookie is sent automatically. No token stored in `localStorage` or JS memory.

### Routes

| Path | Page | Access |
| --- | --- | --- |
| `/login` | SF login button | Public |
| `/` | Overview (existing) | All members |
| `/files` | Files (existing) | All members |
| `/records` | Records (existing) | All members |
| `/rules` | Rules (existing) | All members |
| `/backups` | Connected orgs + snapshot list + trigger backup | All members |
| `/backups/:snapshotId` | Snapshot detail, diff builder, restore trigger | All members |
| `/settings` | Storage config, API key management | Admin |
| `/team` | Member list, invite by email, remove member | Admin |
| `/team/invite/:token` | Invite acceptance landing (redirects to SF login) | Public |

The existing Tenants page becomes an internal super-admin view (hidden from normal users).

### New Page Descriptions

**Backups (`/backups`):**

- Lists connected orgs (cards). "Connect Org" button triggers the SF OAuth connect-org flow.
- Below each org: table of snapshots with status badges, record counts, date.
- "Run Backup" button opens a scope-selector modal then POSTs to `/v1/backup/snapshots`.

**Snapshot Detail (`/backups/:snapshotId`):**

- Shows snapshot metadata (status, counts, git SHA, archive size).
- "Build Diff" section: select a target org → POST to `/v1/backup/snapshots/:id/diff`.
- Diff result: insert/update/skip-delete counts, "Run Restore (Dry Run)" and "Execute Restore" buttons.
- Restore job status panel (polls `GET /v1/backup/restores/:id` every 3s while running).

**Settings (`/settings`):**

- Storage card: shows whether using Vastify-provisioned or own bucket for S3 and GCS. Edit form to paste own credentials.
- API Key card: API keys are stored hashed and cannot be retrieved. This card shows the key prefix (first 8 chars) for identification and provides a "Regenerate" button that creates a new key and displays it **once** in a modal. The old key is immediately invalidated.

**Team (`/team`):**

- Table of current members (name, email, role, joined date).
- Pending invites list (email, role, expires, copy-link button).
- "Invite Member" button: email input + role selector → POST `/v1/team/invite` → displays the invite URL to copy and share.
- Remove button per member (disabled for the current user).

### Serving from Bun

- `dashboard/` Vite build outputs to `api/public/`.
- `vite.config.ts` sets `build.outDir = '../api/public'` and `base = '/'`.
- Hono serves `api/public/` as static files via `serveStatic` for all routes not matched by `/v1/*`, `/auth/*`, `/odata/*`, `/health`.
- Catch-all `GET /*` serves `api/public/index.html` for SPA client-side routing.
- Build command: `cd dashboard && bun run build` before starting the server.

---

## 6. Implementation Sequence

This design will be split into three implementation plans:

1. **Plan 4 — Auth & schema backend**: new DB tables + migrations, `requireAuth` middleware, `/auth/*` routes, JWT signing (`jose`), `/v1/team/*`, `/v1/settings/storage`, per-tenant storage resolution in BackupEngine.
2. **Plan 5 — Dashboard auth + backup pages**: `AuthContext`, `ProtectedRoute`, `/login`, update all API calls to use cookies, Backups list page, Snapshot detail page, diff/restore UI.
3. **Plan 6 — Dashboard settings + team + static serving**: Settings page, Team page, invite flow, Vite build output wired into Hono catch-all.

---

## Key Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Session mechanism | HttpOnly cookie (JWT) | No XSS token exposure; works with `credentials: 'include'` |
| SF org → tenant mapping | 1:1 automatic | No signup friction; natural fit for CRM backup product |
| Storage isolation | Key-prefix per tenant on shared bucket | Zero-ops default; per-tenant bucket opt-in available |
| Credential encryption | Vault master key (AES-256-GCM, existing pattern) | Consistent with how CRM OAuth tokens are stored |
| API backward compat | Keep `X-Vastify-Api-Key` alongside JWT | Programmatic access must not break |
| API key display | Show prefix + regenerate (never retrieve hash) | Keys are stored hashed — plaintext is unrecoverable |
