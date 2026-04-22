import { S3LikeBackend } from './s3-like.ts';

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3Backend(cfg: S3Config): S3LikeBackend {
  return new S3LikeBackend({
    id: 's3',
    bucket: cfg.bucket,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });
}
