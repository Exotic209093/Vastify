export type BackendId = 's3' | 'gcs' | 'azure' | 'minio';

/** Canonical storage classes (GCS names). Each backend maps these to its native names. */
export type StorageClass = 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE';

export interface PutOptions {
  contentType?: string;
  storageClass?: StorageClass;
}

export interface PutResult {
  backendId: BackendId;
  objectKey: string;
  storageClass: StorageClass;
  sizeBytes: number;
}

export interface ObjectSummary {
  key: string;
  sizeBytes: number;
  lastModified: Date;
  storageClass?: StorageClass;
}

export interface ObjectBackend {
  readonly id: BackendId;

  /** Put an object. Key is passed as-is (already includes the `tenants/{id}/...` prefix). */
  put(key: string, body: Uint8Array, opts?: PutOptions): Promise<PutResult>;

  /** Get an object's bytes. */
  get(key: string): Promise<Uint8Array>;

  /** Produce a short-lived URL that anyone with the URL can GET directly from the backend. */
  presignGet(key: string, ttlSec: number): Promise<string>;

  /** Delete an object. No-op if it doesn't exist. */
  delete(key: string): Promise<void>;

  /** Change an existing object's storage class (tier). */
  setStorageClass(key: string, storageClass: StorageClass): Promise<void>;

  /** Iterate object summaries under a prefix. */
  list(prefix: string): AsyncIterable<ObjectSummary>;
}

export function tenantKey(tenantId: string, ...parts: string[]): string {
  return ['tenants', tenantId, ...parts].join('/');
}
