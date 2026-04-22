import { v4 as uuid } from 'uuid';
import { getDb } from '../db/client.ts';
import { getBackend } from '../object/registry.ts';
import { tenantKey } from '../object/backend.ts';
import { decide } from '../routing/engine.ts';
import { listRules } from '../routing/rules.ts';
import { recordEvent } from '../events.ts';
import { loadConfig } from '../config.ts';

export interface UploadInput {
  tenantId: string;
  originalName: string;
  contentType?: string;
  data: Uint8Array;
  sfContentVersionId?: string;
}

export interface UploadResult {
  id: string;
  backendId: string;
  storageClass: string;
  objectKey: string;
  sizeBytes: number;
  presignedUrl: string;
  presignedExpiresAt: number;
}

export interface FileRow {
  id: string;
  tenant_id: string;
  sf_content_version_id: string | null;
  original_name: string | null;
  backend_id: string;
  storage_class: string;
  object_key: string;
  size_bytes: number;
  mime_type: string | null;
  created_at: number;
}

export async function uploadFile(input: UploadInput): Promise<UploadResult> {
  const id = uuid();
  const config = loadConfig();
  const rules = listRules(input.tenantId);
  const decision = decide(
    { tenantId: input.tenantId, kind: 'file', sizeBytes: input.data.byteLength, mime: input.contentType },
    rules,
  );
  const backend = getBackend(decision.backendId);
  const objectKey = tenantKey(input.tenantId, 'files', id);
  await backend.put(objectKey, input.data, {
    contentType: input.contentType,
    storageClass: decision.storageClass,
  });

  getDb()
    .query(
      `INSERT INTO files (id, tenant_id, sf_content_version_id, original_name, backend_id,
         storage_class, object_key, size_bytes, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.tenantId,
      input.sfContentVersionId ?? null,
      input.originalName,
      decision.backendId,
      decision.storageClass,
      objectKey,
      input.data.byteLength,
      input.contentType ?? null,
      Date.now(),
    );

  const presignedUrl = await backend.presignGet(objectKey, config.presignTtlSec);
  const presignedExpiresAt = Date.now() + config.presignTtlSec * 1000;

  recordEvent(input.tenantId, 'file.uploaded', {
    id,
    backendId: decision.backendId,
    storageClass: decision.storageClass,
    sizeBytes: input.data.byteLength,
    ruleId: decision.ruleId,
  });

  return {
    id,
    backendId: decision.backendId,
    storageClass: decision.storageClass,
    objectKey,
    sizeBytes: input.data.byteLength,
    presignedUrl,
    presignedExpiresAt,
  };
}

export function getFile(tenantId: string, id: string): FileRow | null {
  return (getDb()
    .query('SELECT * FROM files WHERE id = ? AND tenant_id = ?')
    .get(id, tenantId) as FileRow | null);
}

export async function refreshPresignedUrl(
  tenantId: string,
  id: string,
): Promise<{ presignedUrl: string; presignedExpiresAt: number } | null> {
  const row = getFile(tenantId, id);
  if (!row) return null;
  const config = loadConfig();
  const backend = getBackend(row.backend_id as Parameters<typeof getBackend>[0]);
  const presignedUrl = await backend.presignGet(row.object_key, config.presignTtlSec);
  const presignedExpiresAt = Date.now() + config.presignTtlSec * 1000;
  recordEvent(tenantId, 'file.url.refreshed', { id });
  return { presignedUrl, presignedExpiresAt };
}

export function listFiles(tenantId: string, limit = 100, offset = 0): FileRow[] {
  return getDb()
    .query('SELECT * FROM files WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(tenantId, limit, offset) as FileRow[];
}

export async function deleteFile(tenantId: string, id: string): Promise<boolean> {
  const row = getFile(tenantId, id);
  if (!row) return false;
  const backend = getBackend(row.backend_id as Parameters<typeof getBackend>[0]);
  await backend.delete(row.object_key);
  getDb().query('DELETE FROM files WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  recordEvent(tenantId, 'file.deleted', { id });
  return true;
}
