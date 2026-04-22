import { getDb } from './db/client.ts';

export type EventKind =
  | 'file.uploaded'
  | 'file.url.refreshed'
  | 'file.deleted'
  | 'record.created'
  | 'record.updated'
  | 'record.deleted'
  | 'record.archived'
  | 'rule.created'
  | 'rule.updated'
  | 'rule.deleted';

type EventListener = (ev: { tenantId: string; kind: EventKind; payload: unknown; at: number }) => void;

const listeners = new Set<EventListener>();

export function recordEvent(tenantId: string, kind: EventKind, payload: unknown): void {
  const at = Date.now();
  getDb()
    .query('INSERT INTO events (tenant_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)')
    .run(tenantId, kind, JSON.stringify(payload), at);
  for (const l of listeners) {
    try {
      l({ tenantId, kind, payload, at });
    } catch {
      // swallow listener errors so one bad SSE subscriber can't break the event path
    }
  }
}

export function subscribeEvents(l: EventListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
