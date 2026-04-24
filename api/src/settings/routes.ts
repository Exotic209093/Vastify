import { Hono } from 'hono';
import { createCipheriv, randomBytes, randomUUID, type CipherGCM } from 'node:crypto';
import { requireApiKey, requireAdmin, tenantOf } from '../auth/api-key.ts';
import { getDb } from '../db/client.ts';
import { createAuthRepo, type TenantStorageConfig } from '../auth/repo.ts';
import { loadConfig } from '../config.ts';
import { hashApiKey } from '../db/hash.ts';

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
  const cipher = createCipheriv('aes-256-gcm', key, iv) as CipherGCM;
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

const emptyConfig = (tenantId: string): TenantStorageConfig => ({
  tenantId, useOwnS3: false, s3BucketName: null, s3Region: null,
  s3AccessKeyIdEnc: null, s3SecretEnc: null, useOwnGcs: false,
  gcsBucketName: null, gcsProjectId: null, gcsServiceAccountJsonEnc: null,
  updatedAt: Date.now(),
});

// GET /v1/settings/storage — current config, credentials redacted (admin only)
settingsRoutes.get('/storage', requireAdmin, (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const config = repo.storageConfig.findByTenant(tenantId);
  if (!config) {
    repo.storageConfig.initForTenant(tenantId);
    return c.json(storageConfigResponse(emptyConfig(tenantId)));
  }
  return c.json(storageConfigResponse(config));
});

// PUT /v1/settings/storage — update own S3 or GCS credentials
settingsRoutes.put('/storage', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const repo = getRepo();
  const existing = repo.storageConfig.findByTenant(tenantId) ?? emptyConfig(tenantId);

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

// POST /v1/settings/api-key — regenerate API key, returns plaintext once (admin only)
settingsRoutes.post('/api-key', requireAdmin, async (c) => {
  const tenantId = tenantOf(c);
  const newKey = `vastify_${randomUUID().replace(/-/g, '')}`;
  const hash = await hashApiKey(newKey);
  getDb().prepare('UPDATE tenants SET api_key_hash = ? WHERE id = ?').run(hash, tenantId);
  return c.json({ apiKey: newKey }, 201);
});
