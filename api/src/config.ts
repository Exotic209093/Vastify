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
  backupGitDataDir: string;
  vaultMasterKeyHex: string;
  sfClientId: string;
  sfClientSecret: string;
  hsClientId: string;
  hsClientSecret: string;
  jwtSecret: string;
  sfRedirectUri: string;
  anthropicApiKey: string;
  anthropicModel: string;
  /** Origins allowed to make credentialed cross-origin requests to /v1/* and /auth/*. */
  allowedOrigins: string[];
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
    backupGitDataDir: str('BACKUP_GIT_DATA_DIR', './.vastify/git'),
    vaultMasterKeyHex: str('VAULT_MASTER_KEY', '0'.repeat(64)),
    sfClientId: str('SF_CLIENT_ID', ''),
    sfClientSecret: str('SF_CLIENT_SECRET', ''),
    hsClientId: str('HS_CLIENT_ID', ''),
    hsClientSecret: str('HS_CLIENT_SECRET', ''),
    jwtSecret: str('JWT_SECRET', 'dev-secret-change-me-in-production-min-32-chars'),
    sfRedirectUri: str('SF_REDIRECT_URI', 'http://localhost:3000/auth/salesforce/callback'),
    anthropicApiKey: str('ANTHROPIC_API_KEY', ''),
    anthropicModel: str('ANTHROPIC_MODEL', 'claude-opus-4-7'),
    allowedOrigins: str('ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:3099')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
