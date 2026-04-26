import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  BackendId,
  ObjectBackend,
  ObjectSummary,
  PutOptions,
  PutResult,
  StorageClass,
} from './backend.ts';

/** Maps our canonical storage classes to S3 / MinIO storage class names. */
function toS3StorageClass(c: StorageClass | undefined): string | undefined {
  if (!c) return undefined;
  switch (c) {
    case 'STANDARD':
      return 'STANDARD';
    case 'NEARLINE':
      return 'STANDARD_IA';
    case 'COLDLINE':
      return 'GLACIER_IR';
    case 'ARCHIVE':
      return 'DEEP_ARCHIVE';
  }
}

function fromS3StorageClass(c: string | undefined): StorageClass | undefined {
  switch (c) {
    case 'STANDARD':
      return 'STANDARD';
    case 'STANDARD_IA':
    case 'ONEZONE_IA':
      return 'NEARLINE';
    case 'GLACIER':
    case 'GLACIER_IR':
      return 'COLDLINE';
    case 'DEEP_ARCHIVE':
      return 'ARCHIVE';
    default:
      return undefined;
  }
}

export interface S3LikeConfig {
  id: BackendId;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;       // set for MinIO or any S3-compat
  forcePathStyle?: boolean; // true for MinIO
  /**
   * Don't send StorageClass on PUT. MinIO's default config only accepts STANDARD; any other
   * value returns an InvalidStorageClass error. We still track the intended class in SQLite.
   */
  omitStorageClass?: boolean;
}

export class S3LikeBackend implements ObjectBackend {
  readonly id: BackendId;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly omitStorageClass: boolean;

  constructor(cfg: S3LikeConfig) {
    this.id = cfg.id;
    this.bucket = cfg.bucket;
    this.omitStorageClass = cfg.omitStorageClass ?? false;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  /**
   * Make sure the configured bucket exists. No-op if it already does.
   * Only meaningful for MinIO / dev S3-compat hosts where we control the bucket lifecycle.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const status = e?.$metadata?.httpStatusCode;
      if (status !== 404 && e?.name !== 'NotFound' && e?.name !== 'NoSuchBucket') {
        throw err;
      }
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
  }

  async put(key: string, body: Uint8Array, opts?: PutOptions): Promise<PutResult> {
    const storageClass = opts?.storageClass ?? 'STANDARD';
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.contentType,
        StorageClass: this.omitStorageClass ? undefined : (toS3StorageClass(storageClass) as never),
      }),
    );
    return { backendId: this.id, objectKey: key, storageClass, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body;
    if (!body) throw new Error(`empty body for ${key}`);
    const bytes = await body.transformToByteArray();
    return bytes;
  }

  async presignGet(key: string, ttlSec: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSec });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async setStorageClass(key: string, storageClass: StorageClass): Promise<void> {
    if (this.omitStorageClass) return; // MinIO tier is always STANDARD; no-op.
    // S3 requires a server-side copy to change storage class.
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${encodeURIComponent(key)}`,
        StorageClass: toS3StorageClass(storageClass) as never,
        MetadataDirective: 'COPY',
      }),
    );
  }

  async *list(prefix: string): AsyncIterable<ObjectSummary> {
    let token: string | undefined;
    do {
      const res: any = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        yield {
          key: obj.Key!,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(0),
          storageClass: fromS3StorageClass(obj.StorageClass),
        };
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }

  /** Test helper — throws if the object doesn't exist. */
  async head(key: string): Promise<{ sizeBytes: number; storageClass?: StorageClass }> {
    const r: any = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return { sizeBytes: r.ContentLength ?? 0, storageClass: fromS3StorageClass(r.StorageClass) };
  }
}
