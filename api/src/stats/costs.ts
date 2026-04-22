// Published storage-pricing constants used for the "savings" narrative on the dashboard.
// Salesforce storage costs per the Winter '25 price book (additional capacity tier).
// Cloud costs per each provider's public pricing page, US region defaults.
// Numbers are USD per GB per month.

export const SF_DATA_USD_PER_GB_MONTH = 250;
export const SF_FILE_USD_PER_GB_MONTH = 5;

export interface ClassCosts {
  STANDARD: number;
  NEARLINE: number;
  COLDLINE: number;
  ARCHIVE: number;
}

// GCS us-central1 pricing.
const GCS_COSTS: ClassCosts = {
  STANDARD: 0.02,
  NEARLINE: 0.01,
  COLDLINE: 0.004,
  ARCHIVE: 0.0012,
};

// S3 us-east-1 pricing (mapped: STANDARD, Standard-IA, Glacier IR, Deep Archive).
const S3_COSTS: ClassCosts = {
  STANDARD: 0.023,
  NEARLINE: 0.0125,
  COLDLINE: 0.004,
  ARCHIVE: 0.00099,
};

// Azure Hot / Cool / Cold / Archive (LRS).
const AZURE_COSTS: ClassCosts = {
  STANDARD: 0.0184,
  NEARLINE: 0.01,
  COLDLINE: 0.0045,
  ARCHIVE: 0.00099,
};

// MinIO runs on your own hardware, so no USD/GB figure applies; treat as 0 for the demo.
const MINIO_COSTS: ClassCosts = {
  STANDARD: 0,
  NEARLINE: 0,
  COLDLINE: 0,
  ARCHIVE: 0,
};

export const BACKEND_COSTS: Record<string, ClassCosts> = {
  gcs: GCS_COSTS,
  s3: S3_COSTS,
  azure: AZURE_COSTS,
  minio: MINIO_COSTS,
};

export function costPerGbMonth(backendId: string, storageClass: keyof ClassCosts): number {
  return BACKEND_COSTS[backendId]?.[storageClass] ?? 0;
}

export const BYTES_PER_GB = 1_000_000_000;
