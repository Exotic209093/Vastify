import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  type ContainerClient,
} from '@azure/storage-blob';
import type {
  BackendId,
  ObjectBackend,
  ObjectSummary,
  PutOptions,
  PutResult,
  StorageClass,
} from './backend.ts';

export interface AzureConfig {
  account: string;
  key: string;
  container: string;
}

/** Canonical → Azure access tier. */
function toAzureTier(c: StorageClass | undefined): 'Hot' | 'Cool' | 'Cold' | 'Archive' | undefined {
  if (!c) return undefined;
  switch (c) {
    case 'STANDARD':
      return 'Hot';
    case 'NEARLINE':
      return 'Cool';
    case 'COLDLINE':
      return 'Cold';
    case 'ARCHIVE':
      return 'Archive';
  }
}

function fromAzureTier(t: string | undefined): StorageClass | undefined {
  switch (t) {
    case 'Hot':
      return 'STANDARD';
    case 'Cool':
      return 'NEARLINE';
    case 'Cold':
      return 'COLDLINE';
    case 'Archive':
      return 'ARCHIVE';
    default:
      return undefined;
  }
}

export class AzureBackend implements ObjectBackend {
  readonly id: BackendId = 'azure';
  private readonly container: ContainerClient;
  private readonly credential: StorageSharedKeyCredential;
  private readonly account: string;
  private readonly containerName: string;

  constructor(cfg: AzureConfig) {
    this.account = cfg.account;
    this.containerName = cfg.container;
    this.credential = new StorageSharedKeyCredential(cfg.account, cfg.key);
    const svc = new BlobServiceClient(`https://${cfg.account}.blob.core.windows.net`, this.credential);
    this.container = svc.getContainerClient(cfg.container);
  }

  async put(key: string, body: Uint8Array, opts?: PutOptions): Promise<PutResult> {
    const storageClass = opts?.storageClass ?? 'STANDARD';
    const block = this.container.getBlockBlobClient(key);
    await block.uploadData(Buffer.from(body), {
      blobHTTPHeaders: { blobContentType: opts?.contentType },
      tier: toAzureTier(storageClass),
    });
    return { backendId: this.id, objectKey: key, storageClass, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const buf = await this.container.getBlockBlobClient(key).downloadToBuffer();
    return new Uint8Array(buf);
  }

  async presignGet(key: string, ttlSec: number): Promise<string> {
    const expiresOn = new Date(Date.now() + ttlSec * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        expiresOn,
      },
      this.credential,
    ).toString();
    return `https://${this.account}.blob.core.windows.net/${this.containerName}/${encodeURIComponent(key)}?${sas}`;
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async setStorageClass(key: string, storageClass: StorageClass): Promise<void> {
    const tier = toAzureTier(storageClass);
    if (!tier) return;
    await this.container.getBlockBlobClient(key).setAccessTier(tier);
  }

  async *list(prefix: string): AsyncIterable<ObjectSummary> {
    for await (const b of this.container.listBlobsFlat({ prefix })) {
      yield {
        key: b.name,
        sizeBytes: b.properties.contentLength ?? 0,
        lastModified: b.properties.lastModified ?? new Date(0),
        storageClass: fromAzureTier(b.properties.accessTier),
      };
    }
  }
}

export function createAzureBackend(cfg: AzureConfig): AzureBackend {
  return new AzureBackend(cfg);
}
