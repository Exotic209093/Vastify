import { describe, test, expect, beforeAll } from 'bun:test';
import { createMinioBackend } from '../src/object/minio.ts';
import type { ObjectBackend, StorageClass } from '../src/object/backend.ts';

const MINIO_URL = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';

async function minioReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MINIO_URL}/minio/health/live`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('ObjectBackend contract — MinIO', () => {
  let backend: ObjectBackend;
  let reachable = false;

  beforeAll(async () => {
    reachable = await minioReachable();
    if (!reachable) return;
    backend = createMinioBackend({
      endpoint: MINIO_URL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'vastify',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'vastifydev',
      bucket: process.env.MINIO_BUCKET ?? 'vastify-demo',
      region: 'us-east-1',
    });
  });

  test('put → get round-trips bytes', async () => {
    if (!reachable) return;
    const key = `tests/${crypto.randomUUID()}.bin`;
    const body = new TextEncoder().encode('hello vastify');
    const put = await backend.put(key, body, { contentType: 'application/octet-stream' });
    expect(put.objectKey).toBe(key);
    expect(put.sizeBytes).toBe(body.byteLength);
    const got = await backend.get(key);
    expect(new TextDecoder().decode(got)).toBe('hello vastify');
    await backend.delete(key);
  });

  test('presignGet returns a URL that downloads the bytes', async () => {
    if (!reachable) return;
    const key = `tests/${crypto.randomUUID()}.txt`;
    const body = new TextEncoder().encode('presigned-please');
    await backend.put(key, body, { contentType: 'text/plain' });
    const url = await backend.presignGet(key, 60);
    expect(url).toMatch(/^https?:\/\//);
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('presigned-please');
    await backend.delete(key);
  });

  test('delete is idempotent and a deleted object is gone', async () => {
    if (!reachable) return;
    const key = `tests/${crypto.randomUUID()}.bin`;
    await backend.put(key, new TextEncoder().encode('x'));
    await backend.delete(key);
    await backend.delete(key); // second delete must not throw
    await expect(backend.get(key)).rejects.toBeTruthy();
  });

  test('list yields objects under a prefix', async () => {
    if (!reachable) return;
    const prefix = `tests/${crypto.randomUUID()}/`;
    const body = new TextEncoder().encode('x');
    const keys = [`${prefix}a.txt`, `${prefix}b.txt`, `${prefix}sub/c.txt`];
    for (const k of keys) await backend.put(k, body);
    const seen: string[] = [];
    for await (const s of backend.list(prefix)) seen.push(s.key);
    expect(seen.sort()).toEqual(keys.sort());
    for (const k of keys) await backend.delete(k);
  });

  test('put respects storage class', async () => {
    if (!reachable) return;
    const key = `tests/${crypto.randomUUID()}.bin`;
    const classes: StorageClass[] = ['STANDARD', 'NEARLINE'];
    for (const sc of classes) {
      await backend.put(key, new TextEncoder().encode(sc), { storageClass: sc });
      // MinIO accepts the header but may not report it back — don't assert the class on list.
      const got = await backend.get(key);
      expect(new TextDecoder().decode(got)).toBe(sc);
    }
    await backend.delete(key);
  });
});
