import { S3LikeBackend } from './s3-like.ts';

export interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

export function createMinioBackend(cfg: MinioConfig): S3LikeBackend {
  return new S3LikeBackend({
    id: 'minio',
    bucket: cfg.bucket,
    region: cfg.region,
    accessKeyId: cfg.accessKey,
    secretAccessKey: cfg.secretKey,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    omitStorageClass: true,
  });
}
