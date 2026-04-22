type BackendConfig =
  | { id: 'minio'; enabled: boolean; endpoint: string; accessKey: string; secretKey: string; bucket: string; region: string }
  | { id: 'gcs'; enabled: boolean; bucket: string; projectId: string; credentialsPath: string }
  | { id: 's3'; enabled: boolean; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }
  | { id: 'azure'; enabled: boolean; account: string; key: string; container: string };

export interface AppConfig {
  port: number;
  env: 'development' | 'production' | 'test';
  logLevel: string;
  dbPath: string;
  presignTtlSec: number;
  demoTenantId: string;
  demoTenantApiKey: string;
  backends: BackendConfig[];
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

function str(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

export function loadConfig(): AppConfig {
  return {
    port: int('PORT', 3000),
    env: (str('NODE_ENV', 'development') as AppConfig['env']),
    logLevel: str('LOG_LEVEL', 'info'),
    dbPath: str('DB_PATH', './vastify.db'),
    presignTtlSec: int('PRESIGN_TTL_SEC', 86400),
    demoTenantId: str('DEMO_TENANT_ID', 'demo'),
    demoTenantApiKey: str('DEMO_TENANT_API_KEY', 'vastify_demo_key_change_me'),
    backends: [
      {
        id: 'minio',
        enabled: bool('MINIO_ENABLED', true),
        endpoint: str('MINIO_ENDPOINT', 'http://localhost:9000'),
        accessKey: str('MINIO_ACCESS_KEY', 'vastify'),
        secretKey: str('MINIO_SECRET_KEY', 'vastifydev'),
        bucket: str('MINIO_BUCKET', 'vastify-demo'),
        region: str('MINIO_REGION', 'us-east-1'),
      },
      {
        id: 'gcs',
        enabled: bool('GCS_ENABLED', false),
        bucket: str('GCS_BUCKET', 'vastify-demo'),
        projectId: str('GCS_PROJECT_ID', ''),
        credentialsPath: str('GOOGLE_APPLICATION_CREDENTIALS', ''),
      },
      {
        id: 's3',
        enabled: bool('S3_ENABLED', false),
        bucket: str('S3_BUCKET', 'vastify-demo'),
        region: str('S3_REGION', 'us-east-1'),
        accessKeyId: str('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: str('AWS_SECRET_ACCESS_KEY', ''),
      },
      {
        id: 'azure',
        enabled: bool('AZURE_ENABLED', false),
        account: str('AZURE_STORAGE_ACCOUNT', ''),
        key: str('AZURE_STORAGE_KEY', ''),
        container: str('AZURE_CONTAINER', 'vastify-demo'),
      },
    ],
  };
}
