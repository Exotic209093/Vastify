# Plan 5: Dashboard Auth + Backup Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Salesforce OAuth login to the React dashboard, protect all routes with an auth context, and build the Backups list and Snapshot detail pages (diff + restore UI).

**Architecture:** `AuthContext` fetches `/auth/me` on mount and stores `{ user, tenantId, role }`. `ProtectedRoute` redirects unauthenticated users to `/login`. All API calls switch from `X-Vastify-Api-Key` header to `credentials: 'include'` (sends `HttpOnly` cookie automatically). New pages live under `/dashboard/backups`. The existing nav gets two new items: Backups and a logout button.

**Tech Stack:** React 18, React Router v6, TanStack Query v5, Tailwind CSS, Lucide React icons. All already installed.

**Prerequisite:** Plan 4 complete and merged (auth backend, JWT cookie, `/auth/me` route, `/v1/backup/*` routes exist).

---

## File Map

| File | Action | Purpose |
| --- | --- | --- |
| `dashboard/src/lib/api.ts` | Modify | Add `authApi()` helper that uses `credentials: 'include'` instead of API key header |
| `dashboard/src/lib/auth.ts` | Create | Types: `AuthUser`, `AuthTenant`; `fetchMe()` function |
| `dashboard/src/context/AuthContext.tsx` | Create | `AuthContext`, `AuthProvider`, `useAuth` hook |
| `dashboard/src/components/ProtectedRoute.tsx` | Create | Redirect to `/login` if not authenticated |
| `dashboard/src/pages/Login.tsx` | Create | Login page with "Login with Salesforce" button |
| `dashboard/src/App.tsx` | Modify | Add `AuthProvider`, `/login` route, protect existing routes, add Backups nav item + logout |
| `dashboard/src/lib/backup-api.ts` | Create | Typed API functions for backup endpoints |
| `dashboard/src/pages/Backups.tsx` | Create | Connected orgs list + snapshot table + "Run Backup" modal |
| `dashboard/src/pages/SnapshotDetail.tsx` | Create | Snapshot metadata, diff builder, restore trigger + status polling |

---

## Task 1: Update API Helper for Cookie Auth

**Files:**
- Modify: `dashboard/src/lib/api.ts`

The current `api()` function sends `X-Vastify-Api-Key` header from localStorage. We need a second helper that sends `credentials: 'include'` (the cookie) instead. Keep the existing `api()` for backward compat during development; the new `authApi()` is used by all new pages.

- [ ] **Step 1: Add authApi to dashboard/src/lib/api.ts**

Open `dashboard/src/lib/api.ts` and append after the existing `api()` function:

```typescript
/**
 * API helper that authenticates via the vastify_session HttpOnly cookie.
 * Use this for all new pages. Existing pages continue to use api() with API key.
 */
export async function authApi<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  const init: RequestInit = { ...opts, headers, credentials: 'include' };
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(opts.json);
    init.method ??= 'POST';
  }
  const res = await fetch(path.startsWith('http') ? path : path, { ...init });
  if (res.status === 401) {
    // Session expired — redirect to login
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
```

Also update the proxy config in `dashboard/vite.config.ts` — add `/auth` to the proxied paths so SF OAuth redirects work in dev:

Open `dashboard/vite.config.ts` and update the `server.proxy` block:

```typescript
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
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/api.ts dashboard/vite.config.ts
git commit -m "feat(dashboard): add authApi helper with cookie credentials, proxy /auth path in dev"
```

---

## Task 2: Auth Types + AuthContext

**Files:**
- Create: `dashboard/src/lib/auth.ts`
- Create: `dashboard/src/context/AuthContext.tsx`
- Create: `dashboard/src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Create dashboard/src/lib/auth.ts**

```typescript
import { authApi } from './api';

export interface AuthUser {
  tenantId: string;
  userId: string | null;
  role: 'admin' | 'member';
  memberCount: number;
}

export async function fetchMe(): Promise<AuthUser> {
  return authApi<AuthUser>('/auth/me');
}
```

- [ ] **Step 2: Create dashboard/src/context/AuthContext.tsx**

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '../lib/auth';
import { fetchMe } from '../lib/auth';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  refetch: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchMe()
      .then((u) => { setUser(u); setError(null); })
      .catch(() => { setUser(null); setError(null); /* not logged in */ })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, refetch: load }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

- [ ] **Step 3: Create dashboard/src/components/ProtectedRoute.tsx**

```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

export function ProtectedRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/auth.ts dashboard/src/context/AuthContext.tsx dashboard/src/components/ProtectedRoute.tsx
git commit -m "feat(dashboard): add AuthContext, ProtectedRoute, fetchMe helper"
```

---

## Task 3: Login Page

**Files:**
- Create: `dashboard/src/pages/Login.tsx`

- [ ] **Step 1: Create dashboard/src/pages/Login.tsx**

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm space-y-8 px-6">
        <div className="text-center">
          <div className="text-2xl font-semibold tracking-tight text-white">Vastify</div>
          <div className="text-sm text-slate-400 mt-1">CRM Storage & Backup</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-white">Sign in</h2>
            <p className="text-sm text-slate-400 mt-1">
              Use your Salesforce account to access Vastify.
            </p>
          </div>

          <a
            href="/auth/salesforce/login"
            className="flex items-center justify-center gap-3 w-full rounded-lg bg-[#00A1E0] hover:bg-[#0090c8] text-white font-medium py-3 px-4 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.7 7.4C10.3 6.2 11.5 5.4 12.9 5.4c1.8 0 3.3 1.2 3.8 2.9.6-.3 1.2-.4 1.9-.4 2.4 0 4.4 2 4.4 4.4s-2 4.4-4.4 4.4H7.1C5 16.7 3.3 15 3.3 12.9c0-1.9 1.3-3.4 3-3.8-.1-.3-.1-.6-.1-.9 0-2 1.6-3.6 3.6-3.6.3 0 .6 0 .9.1V7.4z"/>
            </svg>
            Continue with Salesforce
          </a>

          <p className="text-xs text-slate-500 text-center">
            Your Salesforce org becomes your Vastify workspace.
            First user is automatically the admin.
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Login.tsx
git commit -m "feat(dashboard): add Login page with Salesforce OAuth button"
```

---

## Task 4: Update App.tsx — Auth Layer + New Routes

**Files:**
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Replace dashboard/src/App.tsx**

```tsx
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Files, Database, Sliders, KeyRound,
  HardDrive, Settings, Users, LogOut,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Overview from './pages/Overview';
import FilesPage from './pages/Files';
import RecordsPage from './pages/Records';
import RulesPage from './pages/Rules';
import TenantsPage from './pages/Tenants';
import Login from './pages/Login';
import Backups from './pages/Backups';
import SnapshotDetail from './pages/SnapshotDetail';
import Settings from './pages/Settings';
import Team from './pages/Team';

const mainNav = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/files', label: 'Files', icon: Files },
  { to: '/dashboard/records', label: 'Records', icon: Database },
  { to: '/dashboard/rules', label: 'Rules', icon: Sliders },
  { to: '/dashboard/backups', label: 'Backups', icon: HardDrive },
];

const adminNav = [
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
  { to: '/dashboard/team', label: 'Team', icon: Users },
];

function Layout() {
  const { user } = useAuth();

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/50 p-5 flex flex-col">
        <div className="mb-8">
          <div className="text-lg font-semibold tracking-tight">Vastify</div>
          <div className="text-xs text-slate-400">CRM Storage</div>
        </div>
        <nav className="space-y-1 flex-1">
          {mainNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-50 border border-brand-600/30'
                    : 'text-slate-300 hover:bg-slate-800/60'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <>
              <div className="pt-4 pb-1 px-3 text-xs uppercase tracking-wider text-slate-500">Admin</div>
              {adminNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-brand-600/20 text-brand-50 border border-brand-600/30'
                        : 'text-slate-300 hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {user && (
          <div className="border-t border-slate-800 pt-4 mt-4">
            <div className="text-xs text-slate-400 px-3 mb-2 truncate">{user.userId ?? 'API key'}</div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 transition"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Overview />} />
          <Route path="/dashboard/files" element={<FilesPage />} />
          <Route path="/dashboard/records" element={<RecordsPage />} />
          <Route path="/dashboard/rules" element={<RulesPage />} />
          <Route path="/dashboard/tenants" element={<TenantsPage />} />
          <Route path="/dashboard/backups" element={<Backups />} />
          <Route path="/dashboard/backups/:snapshotId" element={<SnapshotDetail />} />
          <Route path="/dashboard/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
          <Route path="/dashboard/team" element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Create placeholder pages for Settings and Team** (so TypeScript doesn't error — full pages come in Plan 6)

Create `dashboard/src/pages/Settings.tsx`:

```tsx
export default function Settings() {
  return <div className="p-8"><h1 className="text-2xl font-semibold">Settings</h1><p className="text-slate-400 mt-2">Coming in Plan 6.</p></div>;
}
```

Create `dashboard/src/pages/Team.tsx`:

```tsx
export default function Team() {
  return <div className="p-8"><h1 className="text-2xl font-semibold">Team</h1><p className="text-slate-400 mt-2">Coming in Plan 6.</p></div>;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0. If `Backups` or `SnapshotDetail` imports fail, create placeholder versions of those files too (same pattern as Settings/Team above) and fix them in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/pages/Settings.tsx dashboard/src/pages/Team.tsx
git commit -m "feat(dashboard): wire AuthProvider, ProtectedRoute, new nav items into App"
```

---

## Task 5: Backup API Types

**Files:**
- Create: `dashboard/src/lib/backup-api.ts`

- [ ] **Step 1: Create dashboard/src/lib/backup-api.ts**

```typescript
import { authApi } from './api';

export interface ConnectedOrg {
  id: string;
  tenantId: string;
  crmType: 'salesforce' | 'hubspot';
  displayName: string;
  instanceUrl: string;
  externalOrgId: string;
  isSandbox: boolean;
  gitRemoteUrl: string | null;
  connectedAt: number;
  lastUsedAt: number | null;
}

export interface BackupScope {
  id: string;
  connectedOrgId: string;
  name: string;
  rootObject: string;
  maxDepth: number;
  includeFiles: boolean;
  includeMetadata: boolean;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  tenantId: string;
  connectedOrgId: string;
  backupScopeId: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  archiveStorageKey: string | null;
  archiveBackendId: string | null;
  gitCommitSha: string | null;
  recordCount: number | null;
  fileCount: number | null;
  metadataItemCount: number | null;
  sizeBytes: number | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface DiffPlan {
  id: string;
  tenantId: string;
  snapshotId: string;
  targetOrgId: string;
  storageKey: string;
  backendId: string;
  targetStateHash: string;
  summaryCounts: string;
  builtAt: number;
  expiresAt: number | null;
}

export interface RestoreJob {
  id: string;
  tenantId: string;
  snapshotId: string;
  targetOrgId: string;
  mode: 'dry-run' | 'execute';
  status: 'pending' | 'running' | 'complete' | 'partial' | 'failed';
  diffPlanStorageKey: string | null;
  appliedChangesSummary: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

// Connected Orgs
export const listOrgs = () => authApi<{ orgs: ConnectedOrg[] }>('/v1/backup/orgs').then((r) => r.orgs);

// Backup Scopes
export const listScopes = (connectedOrgId: string) =>
  authApi<{ scopes: BackupScope[] }>(`/v1/backup/scopes?connectedOrgId=${connectedOrgId}`).then((r) => r.scopes);

export const createScope = (body: Pick<BackupScope, 'connectedOrgId' | 'name' | 'rootObject' | 'maxDepth' | 'includeFiles' | 'includeMetadata'>) =>
  authApi<{ scopeId: string }>('/v1/backup/scopes', { json: body });

// Snapshots
export const listSnapshots = () => authApi<{ snapshots: Snapshot[] }>('/v1/backup/snapshots').then((r) => r.snapshots);
export const getSnapshot = (id: string) => authApi<Snapshot>(`/v1/backup/snapshots/${id}`);
export const triggerSnapshot = (connectedOrgId: string, scopeId: string) =>
  authApi<{ snapshotId: string }>('/v1/backup/snapshots', { json: { connectedOrgId, scopeId } });

// Diff
export const buildDiff = (snapshotId: string, targetOrgId: string) =>
  authApi<{ diffPlanId: string }>(`/v1/backup/snapshots/${snapshotId}/diff`, { json: { targetOrgId } });
export const getDiffPlan = (diffPlanId: string) => authApi<DiffPlan>(`/v1/backup/diff-plans/${diffPlanId}`);

// Restore
export const triggerRestore = (snapshotId: string, body: { targetOrgId: string; diffPlanId: string; mode: 'dry-run' | 'execute'; confirm?: boolean }) =>
  authApi<{ jobId: string }>(`/v1/backup/snapshots/${snapshotId}/restore`, { json: body });
export const getRestoreJob = (jobId: string) => authApi<RestoreJob>(`/v1/backup/restores/${jobId}`);
export const listRestoreJobs = () => authApi<{ jobs: RestoreJob[] }>('/v1/backup/restores').then((r) => r.jobs);
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/backup-api.ts
git commit -m "feat(dashboard): add typed backup API client (orgs, scopes, snapshots, diff, restore)"
```

---

## Task 6: Backups Page

**Files:**
- Create: `dashboard/src/pages/Backups.tsx`

- [ ] **Step 1: Create dashboard/src/pages/Backups.tsx**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ExternalLink, HardDrive } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { listOrgs, listSnapshots, listScopes, createScope, triggerSnapshot } from '../lib/backup-api';
import type { ConnectedOrg, Snapshot } from '../lib/backup-api';
import { relativeTime, bytes } from '../lib/format';

function statusBadge(status: Snapshot['status']) {
  const styles: Record<Snapshot['status'], string> = {
    pending: 'bg-slate-700 text-slate-300',
    running: 'bg-blue-900/50 text-blue-300',
    complete: 'bg-emerald-900/50 text-emerald-300',
    failed: 'bg-red-900/50 text-red-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function RunBackupModal({ org, onClose }: { org: ConnectedOrg; onClose: () => void }) {
  const qc = useQueryClient();
  const [rootObject, setRootObject] = useState('Account');
  const [maxDepth, setMaxDepth] = useState(2);

  const { data: scopes } = useQuery({ queryKey: ['scopes', org.id], queryFn: () => listScopes(org.id) });

  const createAndRun = useMutation({
    mutationFn: async () => {
      const { scopeId } = await createScope({
        connectedOrgId: org.id, name: `${rootObject} backup`, rootObject, maxDepth,
        includeFiles: false, includeMetadata: true,
      });
      return triggerSnapshot(org.id, scopeId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Run Backup — {org.displayName}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Root Object</label>
            <input
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              value={rootObject}
              onChange={(e) => setRootObject(e.target.value)}
              placeholder="Account"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Depth</label>
            <input
              type="number"
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              value={maxDepth}
              min={1} max={5}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={() => createAndRun.mutate()}
            disabled={createAndRun.isPending}
            className="px-4 py-2 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {createAndRun.isPending ? 'Starting…' : 'Run Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Backups() {
  const [selectedOrg, setSelectedOrg] = useState<ConnectedOrg | null>(null);

  const { data: orgs = [], isLoading: orgsLoading } = useQuery({ queryKey: ['orgs'], queryFn: listOrgs });
  const { data: snapshots = [], isLoading: snapsLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: listSnapshots,
    refetchInterval: (query) => {
      const snaps = query.state.data ?? [];
      return snaps.some((s) => s.status === 'pending' || s.status === 'running') ? 3000 : false;
    },
  });

  function connectOrg() {
    window.location.href = '/auth/salesforce/login?intent=connect-org';
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="text-sm text-slate-400">Manage CRM connections and snapshot history.</p>
        </div>
        <button
          onClick={connectOrg}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm"
        >
          <Plus size={16} />
          Connect Org
        </button>
      </header>

      {/* Connected Orgs */}
      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Connected Orgs</h2>
        {orgsLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : orgs.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-8">
                <HardDrive size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-slate-400 text-sm">No orgs connected yet.</p>
                <button onClick={connectOrg} className="mt-4 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm">
                  Connect your first Salesforce org
                </button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map((org) => (
              <Card key={org.id} className="cursor-pointer hover:border-brand-600/40 transition-colors">
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{org.displayName}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{org.crmType} · {org.externalOrgId}</div>
                      {org.isSandbox && <span className="text-xs bg-yellow-900/40 text-yellow-300 rounded px-1.5 py-0.5 mt-1 inline-block">Sandbox</span>}
                    </div>
                    <a href={org.instanceUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-300">
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setSelectedOrg(org)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                    >
                      <RefreshCw size={12} />
                      Run Backup
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Snapshots table */}
      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Snapshots</h2>
        <Card>
          {snapsLoading ? (
            <CardBody><div className="text-sm text-slate-500">Loading…</div></CardBody>
          ) : snapshots.length === 0 ? (
            <CardBody><div className="text-sm text-slate-500">No snapshots yet — run a backup above.</div></CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Records</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Size</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Started</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Git SHA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snap) => (
                    <tr key={snap.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-3">{statusBadge(snap.status)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{snap.recordCount?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{snap.sizeBytes != null ? bytes(snap.sizeBytes) : '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{relativeTime(snap.startedAt)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{snap.gitCommitSha?.slice(0, 7) ?? '—'}</td>
                      <td className="px-4 py-3">
                        {snap.status === 'complete' && (
                          <Link to={`/dashboard/backups/${snap.id}`} className="text-xs text-brand-400 hover:text-brand-300">
                            View →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {selectedOrg && <RunBackupModal org={selectedOrg} onClose={() => setSelectedOrg(null)} />}
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
git add dashboard/src/pages/Backups.tsx
git commit -m "feat(dashboard): add Backups page (orgs list, snapshots table, run backup modal)"
```

---

## Task 7: Snapshot Detail Page

**Files:**
- Create: `dashboard/src/pages/SnapshotDetail.tsx`

- [ ] **Step 1: Create dashboard/src/pages/SnapshotDetail.tsx**

```tsx
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitCommit, Archive, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { getSnapshot, listOrgs, buildDiff, getDiffPlan, triggerRestore, getRestoreJob } from '../lib/backup-api';
import type { RestoreJob, DiffPlan } from '../lib/backup-api';
import { relativeTime, bytes } from '../lib/format';

function RestorePanel({ snapshotId, diffPlan, orgs }: { snapshotId: string; diffPlan: DiffPlan; orgs: { id: string; displayName: string }[] }) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmExecute, setConfirmExecute] = useState(false);

  const { data: job } = useQuery({
    queryKey: ['restore-job', jobId],
    queryFn: () => getRestoreJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const j = query.state.data;
      return j && (j.status === 'pending' || j.status === 'running') ? 3000 : false;
    },
  });

  const restore = useMutation({
    mutationFn: (mode: 'dry-run' | 'execute') =>
      triggerRestore(snapshotId, {
        targetOrgId: diffPlan.targetOrgId,
        diffPlanId: diffPlan.id,
        mode,
        confirm: mode === 'execute' ? true : undefined,
      }),
    onSuccess: (res) => setJobId(res.jobId),
  });

  const counts = (() => {
    try { return JSON.parse(diffPlan.summaryCounts) as { insert: number; update: number; skipDelete: number }; }
    catch { return null; }
  })();

  return (
    <Card>
      <CardHeader title="Restore" subtitle="Apply this snapshot to a target org" />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          {counts && (
            <>
              <div className="rounded-md bg-emerald-900/30 border border-emerald-800/50 p-3">
                <div className="text-2xl font-mono font-semibold text-emerald-300">{counts.insert}</div>
                <div className="text-xs text-slate-400 mt-1">Insert</div>
              </div>
              <div className="rounded-md bg-blue-900/30 border border-blue-800/50 p-3">
                <div className="text-2xl font-mono font-semibold text-blue-300">{counts.update}</div>
                <div className="text-xs text-slate-400 mt-1">Update</div>
              </div>
              <div className="rounded-md bg-slate-800/50 border border-slate-700/50 p-3">
                <div className="text-2xl font-mono font-semibold text-slate-300">{counts.skipDelete}</div>
                <div className="text-xs text-slate-400 mt-1">Skip Delete</div>
              </div>
            </>
          )}
        </div>

        {!jobId && (
          <div className="flex gap-3">
            <button
              onClick={() => restore.mutate('dry-run')}
              disabled={restore.isPending}
              className="px-4 py-2 text-sm rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 disabled:opacity-50"
            >
              {restore.isPending ? 'Starting…' : 'Dry Run'}
            </button>
            <button
              onClick={() => setConfirmExecute(true)}
              disabled={restore.isPending}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            >
              Execute Restore
            </button>
          </div>
        )}

        {confirmExecute && !jobId && (
          <div className="rounded-md border border-red-800 bg-red-900/20 p-4 space-y-3">
            <p className="text-sm text-red-200">This will write changes to the target org. Are you sure?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmExecute(false)} className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-300">Cancel</button>
              <button onClick={() => { restore.mutate('execute'); setConfirmExecute(false); }} className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white">
                Yes, Execute
              </button>
            </div>
          </div>
        )}

        {job && (
          <div className="rounded-md border border-slate-700 p-4">
            <div className="flex items-center gap-2 text-sm">
              {(job.status === 'pending' || job.status === 'running') && <RefreshCw size={14} className="animate-spin text-blue-400" />}
              <span className="font-medium capitalize">{job.status}</span>
              <span className="text-slate-400 text-xs">({job.mode})</span>
            </div>
            {job.appliedChangesSummary && (
              <pre className="mt-2 text-xs text-slate-400 bg-slate-950 rounded p-2 overflow-auto">
                {JSON.stringify(JSON.parse(job.appliedChangesSummary), null, 2)}
              </pre>
            )}
            {job.error && <p className="mt-2 text-xs text-red-400">{job.error}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function SnapshotDetail() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const [targetOrgId, setTargetOrgId] = useState('');
  const [diffPlanId, setDiffPlanId] = useState<string | null>(null);

  const { data: snap, isLoading } = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => getSnapshot(snapshotId!),
    refetchInterval: (query) => {
      const s = query.state.data;
      return s && (s.status === 'pending' || s.status === 'running') ? 3000 : false;
    },
    enabled: !!snapshotId,
  });

  const { data: orgs = [] } = useQuery({ queryKey: ['orgs'], queryFn: () =>
    fetch('/v1/backup/orgs', { credentials: 'include' }).then((r) => r.json()).then((r: { orgs: { id: string; displayName: string }[] }) => r.orgs),
  });

  const { data: diffPlan } = useQuery({
    queryKey: ['diff-plan', diffPlanId],
    queryFn: () => getDiffPlan(diffPlanId!),
    enabled: !!diffPlanId,
  });

  const buildDiffMutation = useMutation({
    mutationFn: () => buildDiff(snapshotId!, targetOrgId),
    onSuccess: (res) => setDiffPlanId(res.diffPlanId),
  });

  if (isLoading || !snap) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Link to="/dashboard/backups" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft size={14} />
        Backups
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshot</h1>
        <p className="font-mono text-xs text-slate-500 mt-1">{snap.id}</p>
      </header>

      {/* Metadata */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: snap.status },
          { label: 'Records', value: snap.recordCount?.toLocaleString() ?? '—' },
          { label: 'Size', value: snap.sizeBytes != null ? bytes(snap.sizeBytes) : '—' },
          { label: 'Started', value: relativeTime(snap.startedAt) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardBody>
              <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
              <div className="font-mono text-sm mt-1">{value}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {snap.gitCommitSha && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <GitCommit size={14} />
          Git commit: <span className="font-mono text-slate-300">{snap.gitCommitSha}</span>
        </div>
      )}

      {snap.status === 'failed' && snap.error && (
        <Card className="border-red-900/50">
          <CardBody><p className="text-sm text-red-400">{snap.error}</p></CardBody>
        </Card>
      )}

      {/* Diff builder */}
      {snap.status === 'complete' && (
        <Card>
          <CardHeader title="Build Diff" subtitle="Compare this snapshot against a live org" />
          <CardBody className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Org</label>
              <select
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
                value={targetOrgId}
                onChange={(e) => setTargetOrgId(e.target.value)}
              >
                <option value="">Select target org…</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.displayName}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => buildDiffMutation.mutate()}
              disabled={!targetOrgId || buildDiffMutation.isPending}
              className="px-4 py-2 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
            >
              {buildDiffMutation.isPending ? 'Building…' : 'Build Diff'}
            </button>
          </CardBody>
        </Card>
      )}

      {/* Restore panel (shown after diff is built) */}
      {diffPlan && snap.status === 'complete' && (
        <RestorePanel snapshotId={snap.id} diffPlan={diffPlan} orgs={orgs} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && bun run typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 3: Build check**

```bash
cd dashboard && bun run build 2>&1 | tail -10
```

Expected: build succeeds, no errors.

- [ ] **Step 4: Final commit**

```bash
git add dashboard/src/pages/Backups.tsx dashboard/src/pages/SnapshotDetail.tsx
git commit -m "feat(dashboard): add Backups and SnapshotDetail pages with diff/restore UI"
```
