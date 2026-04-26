import { Storage, type Bucket } from '@google-cloud/storage';
import type {
  BackendId,
  ObjectBackend,
  ObjectSummary,
  PutOptions,
  PutResult,
  StorageClass,
} from './backend.ts';

export interface GcsConfig {
  bucket: string;
  projectId?: string;
  credentialsPath?: string;
}

/** GCS uses the canonical names as-is, so mapping is a pass-through. */
function toGcsStorageClass(c: StorageClass): string {
  return c;
}

export class GcsBackend implements ObjectBackend {
  readonly id: BackendId = 'gcs';
  private readonly bucket: Bucket;

  constructor(cfg: GcsConfig) {
    // On hosts like Railway we can't ship a key file; accept the service-account JSON
    // inline via GOOGLE_APPLICATION_CREDENTIALS_JSON and prefer it over a file path.
    const inlineJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const credentials = inlineJson ? JSON.parse(inlineJson) : undefined;
    const storage = new Storage({
      projectId: cfg.projectId || undefined,
      ...(credentials
        ? { credentials }
        : { keyFilename: cfg.credentialsPath || undefined }),
    });
    this.bucket = storage.bucket(cfg.bucket);
  }

  async put(key: string, body: Uint8Array, opts?: PutOptions): Promise<PutResult> {
    const storageClass = opts?.storageClass ?? 'STANDARD';
    const file = this.bucket.file(key);
    await file.save(Buffer.from(body), {
      resumable: false,
      contentType: opts?.contentType,
      metadata: { contentType: opts?.contentType, storageClass: toGcsStorageClass(storageClass) },
    });
    // GCS requires setStorageClass as a separate call if we want a non-default class.
    if (storageClass !== 'STANDARD') {
      await file.setStorageClass(toGcsStorageClass(storageClass));
    }
    return { backendId: this.id, objectKey: key, storageClass, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const [buf] = await this.bucket.file(key).download();
    return new Uint8Array(buf);
  }

  async presignGet(key: string, ttlSec: number): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSec * 1000,
    });
    return url;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }

  async setStorageClass(key: string, storageClass: StorageClass): Promise<void> {
    await this.bucket.file(key).setStorageClass(toGcsStorageClass(storageClass));
  }

  async *list(prefix: string): AsyncIterable<ObjectSummary> {
    const [files] = await this.bucket.getFiles({ prefix });
    for (const f of files) {
      const m = f.metadata;
      yield {
        key: f.name,
        sizeBytes: typeof m.size === 'string' ? parseInt(m.size, 10) : (m.size ?? 0),
        lastModified: m.updated ? new Date(m.updated) : new Date(0),
        storageClass: (m.storageClass as StorageClass) ?? undefined,
      };
    }
  }
}

export function createGcsBackend(cfg: GcsConfig): GcsBackend {
  return new GcsBackend(cfg);
}
