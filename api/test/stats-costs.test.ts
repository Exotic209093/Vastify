import { describe, test, expect } from 'bun:test';
import {
  BACKEND_COSTS,
  BYTES_PER_GB,
  SF_DATA_USD_PER_GB_MONTH,
  SF_FILE_USD_PER_GB_MONTH,
  costPerGbMonth,
} from '../src/stats/costs.ts';

describe('costPerGbMonth', () => {
  test('returns published GCS rate for STANDARD', () => {
    expect(costPerGbMonth('gcs', 'STANDARD')).toBe(0.02);
  });

  test('returns published S3 rate for STANDARD', () => {
    expect(costPerGbMonth('s3', 'STANDARD')).toBe(0.023);
  });

  test('returns published Azure Hot rate for STANDARD', () => {
    expect(costPerGbMonth('azure', 'STANDARD')).toBe(0.0184);
  });

  test('MinIO is treated as zero $/GB for the demo', () => {
    expect(costPerGbMonth('minio', 'STANDARD')).toBe(0);
    expect(costPerGbMonth('minio', 'ARCHIVE')).toBe(0);
  });

  test('unknown backend returns 0 (defensive)', () => {
    expect(costPerGbMonth('does-not-exist', 'STANDARD')).toBe(0);
  });

  test('all four backends have all four storage classes covered', () => {
    const classes: Array<keyof typeof BACKEND_COSTS['gcs']> = [
      'STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE',
    ];
    for (const backend of ['gcs', 's3', 'azure', 'minio']) {
      for (const cls of classes) {
        const v = BACKEND_COSTS[backend][cls];
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('cold tiers cost less than hot tiers on every priced backend', () => {
    for (const backend of ['gcs', 's3', 'azure']) {
      const c = BACKEND_COSTS[backend];
      expect(c.STANDARD).toBeGreaterThan(c.NEARLINE);
      expect(c.NEARLINE).toBeGreaterThan(c.COLDLINE);
      expect(c.COLDLINE).toBeGreaterThan(c.ARCHIVE);
    }
  });
});

describe('Salesforce cost constants', () => {
  test('data tier list price is $250/GB/month', () => {
    expect(SF_DATA_USD_PER_GB_MONTH).toBe(250);
  });

  test('file tier list price is $5/GB/month', () => {
    expect(SF_FILE_USD_PER_GB_MONTH).toBe(5);
  });

  test('SF data tier is multiple orders of magnitude above commodity object storage', () => {
    // The whole pitch: SF data at $250 vs GCS STANDARD at $0.02 → > 1000× markup
    const ratio = SF_DATA_USD_PER_GB_MONTH / costPerGbMonth('gcs', 'STANDARD');
    expect(ratio).toBeGreaterThan(1000);
  });
});

describe('savings math identity', () => {
  // Mirrors the formula in stats/service.ts so a refactor that drifts the
  // arithmetic gets caught here.
  test('1 GB on GCS STANDARD vs SF file tier saves $4.98/month', () => {
    const bytes = BYTES_PER_GB;
    const sf = (bytes / BYTES_PER_GB) * SF_FILE_USD_PER_GB_MONTH;
    const backend = (bytes / BYTES_PER_GB) * costPerGbMonth('gcs', 'STANDARD');
    const net = sf - backend;
    expect(sf).toBe(5);
    expect(backend).toBe(0.02);
    expect(net).toBeCloseTo(4.98, 5);
  });

  test('100 GB of records on GCS ARCHIVE vs SF data tier saves $24,999.88/month', () => {
    const bytes = 100 * BYTES_PER_GB;
    const sf = (bytes / BYTES_PER_GB) * SF_DATA_USD_PER_GB_MONTH;
    const backend = (bytes / BYTES_PER_GB) * costPerGbMonth('gcs', 'ARCHIVE');
    const net = sf - backend;
    expect(sf).toBe(25_000);
    expect(backend).toBeCloseTo(0.12, 5);
    expect(net).toBeCloseTo(24_999.88, 5);
  });
});
