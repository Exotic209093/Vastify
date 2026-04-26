import { Hono } from 'hono';
import { requireApiKey, tenantOf } from '../auth/api-key.ts';
import { uploadFile, getFile, refreshPresignedUrl, listFiles, deleteFile } from './service.ts';
import { log } from '../util/logger.ts';

export const filesRoutes = new Hono();

filesRoutes.use('*', requireApiKey);

// 100 MB binary cap. Base64 inflates by ~4/3, so the encoded string ceiling is ~133 MB.
// Reject before atob() to avoid allocating the full payload on bogus requests.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BASE64 = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3);

// POST /v1/files/upload
// Body: { originalName, contentType?, dataBase64, sfContentVersionId? }
filesRoutes.post('/upload', async (c) => {
  const tenantId = tenantOf(c);
  const body = (await c.req.json()) as {
    originalName: string;
    contentType?: string;
    dataBase64: string;
    sfContentVersionId?: string;
  };
  if (!body.originalName || !body.dataBase64) {
    return c.json({ error: 'missing_fields', required: ['originalName', 'dataBase64'] }, 400);
  }
  if (body.dataBase64.length > MAX_UPLOAD_BASE64) {
    return c.json({ error: 'payload_too_large', maxBytes: MAX_UPLOAD_BYTES }, 413);
  }
  const data = Uint8Array.from(atob(body.dataBase64), (ch) => ch.charCodeAt(0));
  try {
    const res = await uploadFile({
      tenantId,
      originalName: body.originalName,
      contentType: body.contentType,
      data,
      sfContentVersionId: body.sfContentVersionId,
    });
    return c.json(res, 201);
  } catch (e) {
    log.error('upload failed', { err: (e as Error).message });
    return c.json({ error: 'upload_failed', message: (e as Error).message }, 502);
  }
});

// GET /v1/files/:id
filesRoutes.get('/:id', (c) => {
  const tenantId = tenantOf(c);
  const row = getFile(tenantId, c.req.param('id'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

// GET /v1/files/:id/refresh
filesRoutes.get('/:id/refresh', async (c) => {
  const tenantId = tenantOf(c);
  const r = await refreshPresignedUrl(tenantId, c.req.param('id'));
  if (!r) return c.json({ error: 'not_found' }, 404);
  return c.json(r);
});

// GET /v1/files?limit=&offset=
filesRoutes.get('/', (c) => {
  const tenantId = tenantOf(c);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
  return c.json({ files: listFiles(tenantId, limit, offset) });
});

// DELETE /v1/files/:id
filesRoutes.delete('/:id', async (c) => {
  const tenantId = tenantOf(c);
  const ok = await deleteFile(tenantId, c.req.param('id'));
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});
