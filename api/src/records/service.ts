import { v4 as uuid } from 'uuid';
import { getDb } from '../db/client.ts';
import { getBackend } from '../object/registry.ts';
import { tenantKey, type BackendId } from '../object/backend.ts';
import { decide } from '../routing/engine.ts';
import { listRules } from '../routing/rules.ts';
import { recordEvent } from '../events.ts';
import { buildIndexQuery, INTERACTION_FIELD_MAP, UnindexedFieldError } from '../odata/sql.ts';
import type { ODataQuery } from '../odata/types.ts';

export type EntityName = 'Interaction' | 'ArchivedInteraction';

export interface InteractionRecord {
  Id: string;
  Timestamp?: number;           // epoch ms — OData surface is DateTimeOffset string; we normalise both ways
  Channel?: string;
  Type?: string;
  AccountId?: string;
  ContactId?: string;
  Subject?: string;
  Payload?: string;
  IsArchived?: boolean;
  [k: string]: unknown;
}

function ageDaysFromTimestamp(ts: number | undefined): number | undefined {
  if (!ts) return undefined;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
}

function normaliseTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function toOData(rec: InteractionRecord): InteractionRecord {
  const out: InteractionRecord = { ...rec };
  if (typeof out.Timestamp === 'number') {
    out.Timestamp = new Date(out.Timestamp).toISOString() as unknown as number;
  }
  return out;
}

export interface CreateRecordInput {
  tenantId: string;
  entity: EntityName;
  record: InteractionRecord;
  /** When inserting an archived record, force IsArchived=true and bypass routing decision's default. */
  isArchive?: boolean;
}

export async function createRecord(input: CreateRecordInput): Promise<InteractionRecord> {
  const pk = input.record.Id?.toString() || uuid();
  const isArchived = input.isArchive ?? input.entity === 'ArchivedInteraction' ? 1 : 0;
  const timestamp = normaliseTimestamp(input.record.Timestamp) ?? Date.now();

  const rules = listRules(input.tenantId);
  const decision = decide(
    {
      tenantId: input.tenantId,
      kind: 'record',
      ageDays: ageDaysFromTimestamp(timestamp),
      entity: input.entity,
    },
    rules,
  );

  const storedRecord: InteractionRecord = {
    ...input.record,
    Id: pk,
    Timestamp: timestamp,
    IsArchived: isArchived === 1,
  };
  const json = JSON.stringify(storedRecord);
  const bytes = new TextEncoder().encode(json);

  const backend = getBackend(decision.backendId);
  const objectKey = tenantKey(input.tenantId, 'records', input.entity, `${pk}.json`);
  await backend.put(objectKey, bytes, {
    contentType: 'application/json',
    storageClass: decision.storageClass,
  });

  getDb()
    .query(
      `INSERT OR REPLACE INTO records_index
       (tenant_id, entity, pk, backend_id, storage_class, object_key,
        timestamp, channel, type, account_id, contact_id, subject, is_archived, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.tenantId,
      input.entity,
      pk,
      decision.backendId,
      decision.storageClass,
      objectKey,
      timestamp,
      (input.record.Channel as string) ?? null,
      (input.record.Type as string) ?? null,
      (input.record.AccountId as string) ?? null,
      (input.record.ContactId as string) ?? null,
      (input.record.Subject as string) ?? null,
      isArchived,
      Date.now(),
    );

  recordEvent(input.tenantId, input.isArchive ? 'record.archived' : 'record.created', {
    entity: input.entity,
    pk,
    backendId: decision.backendId,
    storageClass: decision.storageClass,
    sizeBytes: bytes.byteLength,
  });

  return toOData(storedRecord);
}

export async function getRecord(
  tenantId: string,
  entity: EntityName,
  pk: string,
): Promise<InteractionRecord | null> {
  const row = getDb()
    .query(
      'SELECT backend_id, object_key FROM records_index WHERE tenant_id = ? AND entity = ? AND pk = ?',
    )
    .get(tenantId, entity, pk) as { backend_id: string; object_key: string } | null;
  if (!row) return null;
  const backend = getBackend(row.backend_id as BackendId);
  const bytes = await backend.get(row.object_key);
  const rec = JSON.parse(new TextDecoder().decode(bytes)) as InteractionRecord;
  return toOData(rec);
}

export async function updateRecord(
  tenantId: string,
  entity: EntityName,
  pk: string,
  patch: Partial<InteractionRecord>,
): Promise<InteractionRecord | null> {
  const current = await getRecord(tenantId, entity, pk);
  if (!current) return null;
  const row = getDb()
    .query(
      'SELECT backend_id, object_key, storage_class FROM records_index WHERE tenant_id = ? AND entity = ? AND pk = ?',
    )
    .get(tenantId, entity, pk) as { backend_id: string; object_key: string; storage_class: string };

  // rehydrate raw numeric timestamp for storage
  const rawTimestamp = normaliseTimestamp(current.Timestamp) ?? Date.now();
  const merged: InteractionRecord = {
    ...current,
    Timestamp: rawTimestamp,
    ...patch,
    Id: pk,
  };
  if (patch.Timestamp !== undefined) {
    merged.Timestamp = normaliseTimestamp(patch.Timestamp) ?? rawTimestamp;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(merged));

  const backend = getBackend(row.backend_id as BackendId);
  await backend.put(row.object_key, bytes, {
    contentType: 'application/json',
    storageClass: row.storage_class as never,
  });

  getDb()
    .query(
      `UPDATE records_index SET
         timestamp = ?, channel = ?, type = ?, account_id = ?, contact_id = ?, subject = ?, is_archived = ?
       WHERE tenant_id = ? AND entity = ? AND pk = ?`,
    )
    .run(
      merged.Timestamp as number,
      (merged.Channel as string) ?? null,
      (merged.Type as string) ?? null,
      (merged.AccountId as string) ?? null,
      (merged.ContactId as string) ?? null,
      (merged.Subject as string) ?? null,
      merged.IsArchived ? 1 : 0,
      tenantId,
      entity,
      pk,
    );

  recordEvent(tenantId, 'record.updated', { entity, pk });
  return toOData(merged);
}

export async function deleteRecord(tenantId: string, entity: EntityName, pk: string): Promise<boolean> {
  const row = getDb()
    .query(
      'SELECT backend_id, object_key FROM records_index WHERE tenant_id = ? AND entity = ? AND pk = ?',
    )
    .get(tenantId, entity, pk) as { backend_id: string; object_key: string } | null;
  if (!row) return false;
  const backend = getBackend(row.backend_id as BackendId);
  await backend.delete(row.object_key);
  getDb()
    .query('DELETE FROM records_index WHERE tenant_id = ? AND entity = ? AND pk = ?')
    .run(tenantId, entity, pk);
  recordEvent(tenantId, 'record.deleted', { entity, pk });
  return true;
}

export interface QueryResult {
  total: number;
  rows: InteractionRecord[];
}

export async function queryRecords(
  tenantId: string,
  entity: EntityName,
  q: ODataQuery,
): Promise<QueryResult> {
  const extraWhere =
    entity === 'ArchivedInteraction'
      ? { sql: 'is_archived = ?', params: [1] as unknown[] }
      : undefined;

  const built = buildIndexQuery({
    tenantId,
    entity,
    query: q,
    fieldMap: INTERACTION_FIELD_MAP,
    extraWhere,
    defaultTop: 100,
    maxTop: 500,
  });

  const db = getDb();
  const idx = db.query(built.sql).all(...(built.params as never[])) as Array<{
    pk: string;
    object_key: string;
    backend_id: string;
  }>;

  const fetched = await Promise.all(
    idx.map(async (row) => {
      try {
        const backend = getBackend(row.backend_id as BackendId);
        const bytes = await backend.get(row.object_key);
        return toOData(JSON.parse(new TextDecoder().decode(bytes)) as InteractionRecord);
      } catch {
        return { Id: row.pk, _error: 'missing_in_backend' } as unknown as InteractionRecord;
      }
    }),
  );

  const count = db.query(built.countSql).get(...(built.countParams as never[])) as { n: number };
  return { total: count.n, rows: fetched };
}

export function countRecords(tenantId: string, entity: EntityName, onlyArchived = false): number {
  const row = getDb()
    .query(
      `SELECT COUNT(*) as n FROM records_index WHERE tenant_id = ? AND entity = ?${
        onlyArchived ? ' AND is_archived = 1' : ''
      }`,
    )
    .get(tenantId, entity) as { n: number };
  return row.n;
}

export { UnindexedFieldError };
