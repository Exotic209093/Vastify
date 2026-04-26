import { v4 as uuid } from 'uuid';
import { getDb } from '../db/client.ts';
import { hashApiKey } from '../db/hash.ts';
import { loadConfig } from '../config.ts';
import { log } from '../util/logger.ts';

/**
 * Seed the demo tenant + default rules. Idempotent:
 * - Inserts the tenant row if missing, otherwise refreshes its api_key_hash
 *   to match the current DEMO_TENANT_API_KEY env (lets you rotate the key
 *   without manually fixing the DB).
 * - Only inserts default rules if the tenant has none.
 *
 * Safe to call on every server boot in demo deployments where DB persistence
 * is ephemeral. In non-demo deployments, gate the call on
 * `VASTIFY_DEMO_PUBLIC_ODATA === 'true'` (see server.ts startup) so we don't
 * accidentally clobber a real tenant's api_key_hash.
 */
export async function seedDemoData(): Promise<void> {
  const config = loadConfig();
  const db = getDb();
  const now = Date.now();

  const existing = db.query('SELECT id FROM tenants WHERE id = ?').get(config.demoTenantId);
  const apiKeyHash = await hashApiKey(config.demoTenantApiKey);

  if (!existing) {
    db.query('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)').run(
      config.demoTenantId,
      'Demo Tenant',
      apiKeyHash,
      now,
    );
    log.info('seeded demo tenant', { id: config.demoTenantId });
  } else {
    db.query('UPDATE tenants SET api_key_hash = ? WHERE id = ?').run(apiKeyHash, config.demoTenantId);
    log.info('tenant already exists — refreshed api key hash', { id: config.demoTenantId });
  }

  const rules = [
    {
      priority: 10,
      match: { kind: 'file', mimeRegex: '^image/' },
      target: { backendId: 'minio', storageClass: 'STANDARD' },
    },
    {
      priority: 20,
      match: { kind: 'file', sizeBytesMin: 10 * 1024 * 1024 },
      target: { backendId: 'minio', storageClass: 'COLDLINE' },
    },
    {
      priority: 30,
      match: { kind: 'file' },
      target: { backendId: 'minio', storageClass: 'STANDARD' },
    },
    {
      priority: 40,
      match: { kind: 'record', ageDaysMin: 90 },
      target: { backendId: 'minio', storageClass: 'ARCHIVE' },
    },
    {
      priority: 50,
      match: { kind: 'record' },
      target: { backendId: 'minio', storageClass: 'STANDARD' },
    },
  ];

  const existingRules = db
    .query('SELECT COUNT(*) as c FROM rules WHERE tenant_id = ?')
    .get(config.demoTenantId) as { c: number };

  if (existingRules.c === 0) {
    const insert = db.prepare(
      'INSERT INTO rules (id, tenant_id, priority, match_json, target_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    );
    db.transaction(() => {
      for (const r of rules) {
        insert.run(uuid(), config.demoTenantId, r.priority, JSON.stringify(r.match), JSON.stringify(r.target), now);
      }
    })();
    log.info('seeded default rules', { count: rules.length });
  } else {
    log.info('rules already present — skipping seed', { count: existingRules.c });
  }

  log.info('seed complete');
}

// Allow `bun run api/src/scripts/seed.ts` for manual seeding outside the server.
if (import.meta.main) {
  seedDemoData().catch((e: Error) => {
    log.error('seed failed', { err: e.message, stack: e.stack });
    process.exit(1);
  });
}
