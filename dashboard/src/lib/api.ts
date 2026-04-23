const DEFAULT_API_KEY = 'vastify_demo_key_change_me';
const DEFAULT_API_BASE = 'http://localhost:3099';

export function getApiKey(): string {
  return (
    localStorage.getItem('vastify.apiKey') ??
    (import.meta.env.VITE_VASTIFY_API_KEY as string | undefined) ??
    DEFAULT_API_KEY
  );
}

export function getApiBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? DEFAULT_API_BASE;
}

export function setApiKey(key: string): void {
  localStorage.setItem('vastify.apiKey', key);
}

interface FetchOpts extends RequestInit {
  json?: unknown;
}

export async function api<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set('X-Vastify-Api-Key', getApiKey());
  const init: RequestInit = { ...opts, headers };
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(opts.json);
    init.method ??= 'POST';
  }
  const url = path.startsWith('http') ? path : `${getApiBase()}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/* ─── Typed endpoint shapes ────────────────────────────────────────────── */

export interface TierBreakdown {
  backendId: string;
  storageClass: string;
  bytes: number;
  count: number;
  usdPerMonth: number;
}
export interface TenantStats {
  tenantId: string;
  files: {
    count: number;
    totalBytes: number;
    byTier: TierBreakdown[];
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
  };
  records: {
    countLive: number;
    countArchived: number;
    totalBytes: number;
    byTier: TierBreakdown[];
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
  };
  totals: {
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
    usdNetSavedPerMonth: number;
  };
  recentEvents: Array<{ kind: string; at: number; payload: unknown }>;
}

export interface FileRow {
  id: string;
  tenant_id: string;
  original_name: string | null;
  backend_id: string;
  storage_class: string;
  object_key: string;
  size_bytes: number;
  mime_type: string | null;
  created_at: number;
}

export interface RecordRow {
  pk: string;
  backend_id: string;
  storage_class: string;
  object_key: string;
  timestamp: number | null;
  channel: string | null;
  type: string | null;
  account_id: string | null;
  contact_id: string | null;
  subject: string | null;
  is_archived: number;
  created_at: number;
}

export interface RoutingRule {
  id: string;
  tenantId: string;
  priority: number;
  match: {
    kind: 'file' | 'record';
    sizeBytesMax?: number;
    sizeBytesMin?: number;
    ageDaysMin?: number;
    ageDaysMax?: number;
    mimeRegex?: string;
    entity?: string;
  };
  target: { backendId: string; storageClass: string };
  enabled: boolean;
}

/**
 * API helper that authenticates via the vastify_session HttpOnly cookie.
 * Use for all new pages. Existing pages keep using api() with API key.
 */
export async function authApi<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers as HeadersInit | undefined);
  const init: RequestInit = { ...opts, headers, credentials: 'include' };
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(opts.json);
    init.method ??= 'POST';
  }
  const res = await fetch(path, { ...init });
  if (res.status === 401) {
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
