# Plan 6: Dashboard Settings, Team & Static Serving

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Settings page (storage config + API key management), Team page (member list + invite flow), wire the React build output into Hono as static files, and deliver a single `bun start` command that serves the complete product.

**Architecture:** Settings and Team pages call the `/v1/settings` and `/v1/team` routes built in Plan 4. The Vite build target is changed to `api/public/` so `bun start` in the `api/` folder serves both API and React SPA. Hono uses `serveStatic` from `hono/bun` for the static files with a catch-all `index.html` fallback for client-side routing.

**Tech Stack:** Hono `serveStatic` (built into `hono/bun`), Vite 6, React 18, TanStack Query v5, Tailwind CSS. No new dependencies.

**Prerequisite:** Plans 4 and 5 complete (auth routes, team/settings backend, Auth layer in dashboard, placeholder Settings/Team pages exist at `dashboard/src/pages/Settings.tsx` and `dashboard/src/pages/Team.tsx`).

---

## File Map

| File | Action | Purpose |
| --- | --- | --- |
| `dashboard/vite.config.ts` | Modify | Change `build.outDir` to `'../api/public'` |
| `dashboard/src/pages/Settings.tsx` | Replace | Full settings page: storage config + API key card |
| `dashboard/src/pages/Team.tsx` | Replace | Full team page: member list + invite form + remove |
| `api/src/server.ts` | Modify | Add `serveStatic` for `api/public/`, catch-all SPA fallback |
| `api/.gitignore` or root `.gitignore` | Modify | Add `api/public/` (build artifact) |

---

## Task 1: Update Vite Build Output

**Files:**
- Modify: `dashboard/vite.config.ts`

- [ ] **Step 1: Update vite.config.ts build output**

Open `dashboard/vite.config.ts`. Change the `build` block:

```typescript
build: {
  outDir: '../api/public',
  emptyOutDir: true,
  sourcemap: true,
},
```

The full file after the change:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/odata': {
        target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: '../api/public',
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

- [ ] **Step 2: Add api/public/ to .gitignore**

Open the root `.gitignore` (or `api/.gitignore` if it exists) and add:

```
api/public/
```

- [ ] **Step 3: Test the build**

```bash
cd dashboard && bun run build 2>&1 | tail -10
```

Expected: Build completes with no errors. Output files appear at `api/public/index.html`.

```bash
ls api/public/
```

Expected: `index.html`, `assets/` directory.

- [ ] **Step 4: Commit**

```bash
git add dashboard/vite.config.ts .gitignore
git commit -m "feat(static): update Vite build output to api/public for unified serving"
```

---

## Task 2: Wire Static Serving into Hono

**Files:**
- Modify: `api/src/server.ts`

Hono's `serveStatic` from `hono/bun` serves files from a directory relative to the current working directory. The catch-all sends `index.html` for any path not matched by API routes, enabling React Router's client-side navigation.

- [ ] **Step 1: Update api/src/server.ts**

Open `api/src/server.ts`. Add the static serving imports and routes. The relevant addition goes **after** all `/v1/*` and `/auth/*` routes, and **before** `app.notFound`:

```typescript
import { serveStatic } from 'hono/bun';
```

Add these lines after all route registrations and before `app.notFound`:

```typescript
// Serve the React SPA build — must come after all API routes
app.use('/*', serveStatic({ root: './public' }));

// SPA fallback: any unmatched route serves index.html for client-side routing
app.get('/*', serveStatic({ path: './public/index.html' }));
```

The complete updated `api/src/server.ts`:

```typescript
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
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

// Auth routes
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

// Static files — React SPA build output
app.use('/*', serveStatic({ root: './public' }));
app.get('/*', serveStatic({ path: './public/index.html' }));

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

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Smoke test static serving**

First build the dashboard:

```bash
cd dashboard && bun run build
```

Then start the server and hit the root:

```bash
cd api && PORT=3099 bun run src/server.ts &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/
curl -s -o /dev/null -w "\n%{http_code}" http://localhost:3099/dashboard/backups
kill %1
```

Expected: both return `200` (serving `index.html`).

- [ ] **Step 4: Commit**

```bash
git add api/src/server.ts
git commit -m "feat(static): wire serveStatic + SPA fallback into Hono for unified serving"
```

---

## Task 3: Settings Page

**Files:**
- Replace: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Replace dashboard/src/pages/Settings.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { authApi } from '../lib/api';

interface StorageConfig {
  useOwnS3: boolean;
  s3BucketName: string | null;
  s3Region: string | null;
  s3AccessKeyId: string | null;
  s3Secret: string | null;
  useOwnGcs: boolean;
  gcsBucketName: string | null;
  gcsProjectId: string | null;
  gcsServiceAccountJson: string | null;
  updatedAt: number;
}

function MaskedInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? ''}
          className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 pr-9 text-sm"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function StorageSection() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery<StorageConfig>({
    queryKey: ['storage-config'],
    queryFn: () => authApi('/v1/settings/storage'),
  });

  const [s3BucketName, setS3BucketName] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  const [s3Secret, setS3Secret] = useState('');
  const [useOwnS3, setUseOwnS3] = useState(false);

  const [gcsBucketName, setGcsBucketName] = useState('');
  const [gcsProjectId, setGcsProjectId] = useState('');
  const [gcsServiceAccountJson, setGcsServiceAccountJson] = useState('');
  const [useOwnGcs, setUseOwnGcs] = useState(false);

  const [initialized, setInitialized] = useState(false);
  if (config && !initialized) {
    setS3BucketName(config.s3BucketName ?? '');
    setS3Region(config.s3Region ?? '');
    setUseOwnS3(config.useOwnS3);
    setGcsBucketName(config.gcsBucketName ?? '');
    setGcsProjectId(config.gcsProjectId ?? '');
    setUseOwnGcs(config.useOwnGcs);
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: () => authApi('/v1/settings/storage', {
      method: 'PUT',
      json: {
        useOwnS3,
        ...(useOwnS3 && { s3BucketName, s3Region, ...(s3AccessKeyId && { s3AccessKeyId }), ...(s3Secret && { s3Secret }) }),
        useOwnGcs,
        ...(useOwnGcs && { gcsBucketName, gcsProjectId, ...(gcsServiceAccountJson && { gcsServiceAccountJson }) }),
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-config'] }),
  });

  if (isLoading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <Card>
      <CardHeader title="Object Storage" subtitle="Backup archives and diff plans are stored here" />
      <CardBody className="space-y-6">
        {/* S3 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Amazon S3</span>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={useOwnS3} onChange={(e) => setUseOwnS3(e.target.checked)} className="rounded" />
              Use my own bucket
            </label>
            {!useOwnS3 && <span className="text-xs bg-emerald-900/40 text-emerald-300 rounded px-2 py-0.5">Vastify-provisioned</span>}
          </div>
          {useOwnS3 && (
            <div className="grid grid-cols-2 gap-3 pl-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Bucket Name</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={s3BucketName} onChange={(e) => setS3BucketName(e.target.value)} placeholder="my-vastify-bucket" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Region</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" />
              </div>
              <MaskedInput label="Access Key ID" value={s3AccessKeyId} onChange={setS3AccessKeyId} placeholder={config?.s3AccessKeyId === '***' ? '(saved — leave blank to keep)' : ''} />
              <MaskedInput label="Secret Access Key" value={s3Secret} onChange={setS3Secret} placeholder={config?.s3Secret === '***' ? '(saved — leave blank to keep)' : ''} />
            </div>
          )}
        </section>

        {/* GCS */}
        <section className="space-y-3 border-t border-slate-800 pt-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Google Cloud Storage</span>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={useOwnGcs} onChange={(e) => setUseOwnGcs(e.target.checked)} className="rounded" />
              Use my own bucket
            </label>
            {!useOwnGcs && <span className="text-xs bg-emerald-900/40 text-emerald-300 rounded px-2 py-0.5">Vastify-provisioned</span>}
          </div>
          {useOwnGcs && (
            <div className="grid grid-cols-2 gap-3 pl-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Bucket Name</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={gcsBucketName} onChange={(e) => setGcsBucketName(e.target.value)} placeholder="my-vastify-bucket" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Project ID</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={gcsProjectId} onChange={(e) => setGcsProjectId(e.target.value)} placeholder="my-gcp-project" />
              </div>
              <div className="col-span-2">
                <MaskedInput label="Service Account JSON" value={gcsServiceAccountJson} onChange={setGcsServiceAccountJson} placeholder={config?.gcsServiceAccountJson === '***' ? '(saved — leave blank to keep)' : '{"type":"service_account",...}'} />
              </div>
            </div>
          )}
        </section>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm disabled:opacity-50"
        >
          <Save size={14} />
          {save.isPending ? 'Saving…' : 'Save Storage Config'}
        </button>

        {save.isSuccess && <p className="text-xs text-emerald-400">Saved successfully.</p>}
        {save.isError && <p className="text-xs text-red-400">Failed to save: {(save.error as Error).message}</p>}
      </CardBody>
    </Card>
  );
}

function ApiKeySection() {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = useMutation({
    mutationFn: () => authApi<{ apiKey: string }>('/v1/settings/api-key', { method: 'POST' }),
    onSuccess: (res) => setNewKey(res.apiKey),
  });

  async function copy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader title="API Key" subtitle="Used for programmatic access and integrations" />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-400">
          API keys are stored hashed and cannot be retrieved. Regenerate to get a new key — the old key is immediately invalidated.
        </p>

        {newKey ? (
          <div className="rounded-md border border-emerald-800 bg-emerald-900/20 p-4 space-y-2">
            <p className="text-xs text-emerald-300 font-medium">New API key — copy it now, it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-slate-950 rounded px-3 py-2 text-emerald-200 overflow-auto">{newKey}</code>
              <button onClick={copy} className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-sm text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate API Key'}
          </button>
        )}
      </CardBody>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage storage backends and API access.</p>
      </header>
      <StorageSection />
      <ApiKeySection />
    </div>
  );
}
```

> **Note:** The "Regenerate API Key" button calls `POST /v1/settings/api-key`. Add this route to `api/src/settings/routes.ts`:

Open `api/src/settings/routes.ts` and append before the closing line:

```typescript
import { randomUUID } from 'node:crypto';
import { hashApiKey } from '../db/hash.ts';

// POST /v1/settings/api-key — regenerate API key (returns plaintext once, stores hash)
settingsRoutes.post('/api-key', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const newKey = `vastify_${randomUUID().replace(/-/g, '')}`;
  const hash = await hashApiKey(newKey);
  getDb().prepare('UPDATE tenants SET api_key_hash = ? WHERE id = ?').run(hash, tenantId);
  return c.json({ apiKey: newKey }, 201);
});
```

- [ ] **Step 2: Typecheck**

```bash
cd api && bun run typecheck 2>&1 | tail -5
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx api/src/settings/routes.ts
git commit -m "feat(dashboard): full Settings page (storage config + API key regeneration)"
```

---

## Task 4: Team Page

**Files:**
- Replace: `dashboard/src/pages/Team.tsx`

- [ ] **Step 1: Replace dashboard/src/pages/Team.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Link, Clock } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expiresAt: number;
  createdAt: number;
}

function relTime(ms: number) {
  const diff = Date.now() - ms;
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

export default function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<{ members: Member[]; invites: Invite[] }>({
    queryKey: ['team'],
    queryFn: () => authApi('/v1/team'),
  });

  const invite = useMutation({
    mutationFn: () => authApi<{ token: string; inviteUrl: string }>('/v1/team/invite', { json: { email, role } }),
    onSuccess: (res) => {
      setInviteUrl(res.inviteUrl);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['team'] });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => authApi(`/v1/team/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-slate-400 mt-1">Manage who has access to your Vastify workspace.</p>
      </header>

      {/* Members */}
      <Card>
        <CardHeader title="Members" subtitle={`${members.length} member${members.length !== 1 ? 's' : ''}`} />
        <CardBody className="p-0">
          {isLoading ? (
            <div className="px-6 py-4 text-sm text-slate-500">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">User ID</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-slate-800/50">
                    <td className="px-6 py-3 font-mono text-xs text-slate-300">{m.userId}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.role === 'admin' ? 'bg-brand-600/20 text-brand-300' : 'bg-slate-700 text-slate-300'}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400">{relTime(m.joinedAt)}</td>
                    <td className="px-6 py-3 text-right">
                      {m.userId !== user?.userId && (
                        <button
                          onClick={() => remove.mutate(m.userId)}
                          disabled={remove.isPending}
                          className="text-slate-500 hover:text-red-400 transition disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card>
          <CardHeader title="Pending Invites" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-800/50">
                    <td className="px-6 py-3 text-xs text-slate-300">{inv.email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${inv.role === 'admin' ? 'bg-brand-600/20 text-brand-300' : 'bg-slate-700 text-slate-300'}`}>
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/dashboard/team/invite/${inv.token}`;
                          await navigator.clipboard.writeText(url);
                        }}
                        className="text-slate-500 hover:text-brand-400 transition"
                        title="Copy invite link"
                      >
                        <Link size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Invite form */}
      <Card>
        <CardHeader title="Invite Member" subtitle="Send an invite link to a Salesforce user" />
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                className="rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => invite.mutate()}
            disabled={!email || invite.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm disabled:opacity-50"
          >
            <UserPlus size={14} />
            {invite.isPending ? 'Sending…' : 'Create Invite Link'}
          </button>

          {invite.isError && (
            <p className="text-xs text-red-400">Failed: {(invite.error as Error).message}</p>
          )}

          {inviteUrl && (
            <div className="rounded-md border border-brand-800/50 bg-brand-900/20 p-4 space-y-2">
              <p className="text-xs text-brand-300 font-medium">Invite link created — share this with {email}:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-slate-950 rounded px-3 py-2 text-brand-200 overflow-auto break-all">{inviteUrl}</code>
                <button onClick={copy} className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Team.tsx
git commit -m "feat(dashboard): full Team page (member list, pending invites, invite form)"
```

---

## Task 5: Full Integration Test + Final Commit

- [ ] **Step 1: Build dashboard**

```bash
cd dashboard && bun run build 2>&1 | tail -5
```

Expected: Build succeeds, `api/public/index.html` exists.

- [ ] **Step 2: Run API test suite**

```bash
cd api && bun test 2>&1 | tail -10
```

Expected: all tests pass, 0 failures.

- [ ] **Step 3: Typecheck both**

```bash
cd api && bun run typecheck 2>&1 | tail -3
cd dashboard && bun run typecheck 2>&1 | tail -3
```

Expected: both exit 0.

- [ ] **Step 4: Full end-to-end smoke test**

```bash
cd api && PORT=3099 bun run src/server.ts &
sleep 2

# Health
curl -s http://localhost:3099/health

# SPA root
curl -s -o /dev/null -w "SPA root: %{http_code}\n" http://localhost:3099/

# SPA deep link
curl -s -o /dev/null -w "SPA deep: %{http_code}\n" http://localhost:3099/dashboard/backups

# Auth redirect
curl -s -o /dev/null -w "Auth redirect: %{http_code}\n" -L http://localhost:3099/auth/salesforce/login

# API (no auth)
curl -s http://localhost:3099/v1/backup/orgs

kill %1
```

Expected:
- `{"ok":true,"service":"vastify-api","version":"0.1.0"}`
- `SPA root: 200`
- `SPA deep: 200`
- `Auth redirect: 302` (redirects to salesforce.com)
- `/v1/backup/orgs` returns `{"error":"unauthorized"}` (correct — cookie auth required)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): Plan 6 complete — Settings, Team pages, unified static serving from Bun"
```

---

## Running the Complete Product

After all 3 plans (4, 5, 6) are complete:

**Development:**
```bash
# Terminal 1 — API with hot reload
cd api && bun run dev

# Terminal 2 — Dashboard with hot reload + proxy
cd dashboard && bun run dev
# Open http://localhost:5173
```

**Production (single process):**
```bash
cd dashboard && bun run build
cd api && bun run start
# Open http://localhost:3000
```

**Required env vars for production:**
```env
JWT_SECRET=<min-32-char-random-string>
SF_CLIENT_ID=<your-salesforce-connected-app-client-id>
SF_CLIENT_SECRET=<your-salesforce-connected-app-client-secret>
SF_REDIRECT_URI=https://yourdomain.com/auth/salesforce/callback
VAULT_MASTER_KEY_HEX=<64-hex-chars>
DB_PATH=/data/vastify.db
PORT=3000
```
