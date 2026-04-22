import { getDb } from '../db/client.ts';
import type { StorageClass } from '../object/backend.ts';
import {
  BACKEND_COSTS,
  BYTES_PER_GB,
  SF_DATA_USD_PER_GB_MONTH,
  SF_FILE_USD_PER_GB_MONTH,
  costPerGbMonth,
} from './costs.ts';

export interface TierBreakdown {
  backendId: string;
  storageClass: StorageClass;
  bytes: number;
  count: number;
  usdPerMonth: number;
}

export interface TenantStats {
  tenantId: string;
  files: {
    count: number;
    totalBytes: number;
    byTier: TierBreakdown[];
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
  };
  records: {
    countLive: number;
    countArchived: number;
    totalBytes: number; // approx — uses record_index row count × estimated avg size when we don't know bytes
    byTier: TierBreakdown[];
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
  };
  totals: {
    usdPerMonthOnBackend: number;
    usdAvoidedVsSalesforce: number;
    usdNetSavedPerMonth: number;
  };
  recentEvents: Array<{ kind: string; at: number; payload: unknown }>;
}

/** Average bytes per record used when we lack per-record size (records are stored as JSON, ~400 bytes typical). */
const AVG_RECORD_BYTES = 400;

export function computeStats(tenantId: string): TenantStats {
  const db = getDb();

  // ─── Files aggregation ────────────────────────────────────────────────
  const fileRows = db
    .query(
      `SELECT backend_id, storage_class, COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as bytes
         FROM files
        WHERE tenant_id = ?
        GROUP BY backend_id, storage_class`,
    )
    .all(tenantId) as Array<{ backend_id: string; storage_class: string; cnt: number; bytes: number }>;

  const fileByTier: TierBreakdown[] = fileRows.map((r) => {
    const usd = (r.bytes / BYTES_PER_GB) * costPerGbMonth(r.backend_id, r.storage_class as StorageClass);
    return {
      backendId: r.backend_id,
      storageClass: r.storage_class as StorageClass,
      bytes: r.bytes,
      count: r.cnt,
      usdPerMonth: usd,
    };
  });

  const fileCount = fileByTier.reduce((s, r) => s + r.count, 0);
  const fileBytes = fileByTier.reduce((s, r) => s + r.bytes, 0);
  const fileBackendCost = fileByTier.reduce((s, r) => s + r.usdPerMonth, 0);
  const fileAvoided = (fileBytes / BYTES_PER_GB) * SF_FILE_USD_PER_GB_MONTH;

  // ─── Records aggregation ──────────────────────────────────────────────
  const recordRows = db
    .query(
      `SELECT backend_id, storage_class, entity, is_archived, COUNT(*) as cnt
         FROM records_index
        WHERE tenant_id = ?
        GROUP BY backend_id, storage_class, entity, is_archived`,
    )
    .all(tenantId) as Array<{
    backend_id: string;
    storage_class: string;
    entity: string;
    is_archived: number;
    cnt: number;
  }>;

  const recordByTierMap = new Map<string, TierBreakdown>();
  let countLive = 0;
  let countArchived = 0;
  for (const r of recordRows) {
    const approxBytes = r.cnt * AVG_RECORD_BYTES;
    const usd = (approxBytes / BYTES_PER_GB) * costPerGbMonth(r.backend_id, r.storage_class as StorageClass);
    const key = `${r.backend_id}:${r.storage_class}`;
    const existing = recordByTierMap.get(key);
    if (existing) {
      existing.bytes += approxBytes;
      existing.count += r.cnt;
      existing.usdPerMonth += usd;
    } else {
      recordByTierMap.set(key, {
        backendId: r.backend_id,
        storageClass: r.storage_class as StorageClass,
        bytes: approxBytes,
        count: r.cnt,
        usdPerMonth: usd,
      });
    }
    if (r.is_archived === 1) countArchived += r.cnt;
    else countLive += r.cnt;
  }

  const recordByTier = Array.from(recordByTierMap.values());
  const recordBytes = recordByTier.reduce((s, r) => s + r.bytes, 0);
  const recordBackendCost = recordByTier.reduce((s, r) => s + r.usdPerMonth, 0);
  const recordAvoided = (recordBytes / BYTES_PER_GB) * SF_DATA_USD_PER_GB_MONTH;

  // ─── Recent events ────────────────────────────────────────────────────
  const events = db
    .query(
      `SELECT kind, payload_json, created_at
         FROM events
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 20`,
    )
    .all(tenantId) as Array<{ kind: string; payload_json: string; created_at: number }>;

  const recentEvents = events.map((e) => ({
    kind: e.kind,
    at: e.created_at,
    payload: JSON.parse(e.payload_json) as unknown,
  }));

  // ─── Totals ───────────────────────────────────────────────────────────
  const totalBackendCost = fileBackendCost + recordBackendCost;
  const totalAvoided = fileAvoided + recordAvoided;

  return {
    tenantId,
    files: {
      count: fileCount,
      totalBytes: fileBytes,
      byTier: fileByTier,
      usdPerMonthOnBackend: fileBackendCost,
      usdAvoidedVsSalesforce: fileAvoided,
    },
    records: {
      countLive,
      countArchived,
      totalBytes: recordBytes,
      byTier: recordByTier,
      usdPerMonthOnBackend: recordBackendCost,
      usdAvoidedVsSalesforce: recordAvoided,
    },
    totals: {
      usdPerMonthOnBackend: totalBackendCost,
      usdAvoidedVsSalesforce: totalAvoided,
      usdNetSavedPerMonth: totalAvoided - totalBackendCost,
    },
    recentEvents,
  };
}

export { BACKEND_COSTS };
