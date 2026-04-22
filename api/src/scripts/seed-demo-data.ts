/**
 * Seeds the middleware directly with sample files + records, bypassing Salesforce.
 * Used so the dashboard has visible content for screenshots / demo warm-up.
 *
 * Run: bun src/scripts/seed-demo-data.ts
 * Env: MINIO_ENABLED=true (or another backend configured)
 */
import { v4 as uuid } from 'uuid';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { hashApiKey } from '../db/hash.ts';
import { uploadFile } from '../files/service.ts';
import { createRecord } from '../records/service.ts';
import { log } from '../util/logger.ts';

const CHANNELS = ['email', 'sms', 'call', 'chat', 'web'];
const TYPES = ['inbound', 'outbound', 'notification', 'system'];
const SUBJECTS = [
  'Welcome to the demo',
  'Quarterly check-in',
  'Renewal reminder',
  'Ticket #1234 resolved',
  'Meeting scheduled',
  'Contract signed',
  'Product enquiry',
  'Invoice paid',
  'Support follow-up',
  'Payment reminder',
];

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

async function ensureTenant(tenantId: string, apiKey: string): Promise<void> {
  const db = getDb();
  const hash = await hashApiKey(apiKey);
  const row = db.query('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  if (row) return;
  db.query('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)').run(
    tenantId,
    'Demo Tenant',
    hash,
    Date.now(),
  );
}

async function main() {
  const config = loadConfig();
  await ensureTenant(config.demoTenantId, config.demoTenantApiKey);

  log.info('seeding sample files…');
  const fileContents = [
    { name: 'contract.pdf', type: 'application/pdf', size: 1.2 * 1024 * 1024 },
    { name: 'logo.png', type: 'image/png', size: 180 * 1024 },
    { name: 'proposal.pdf', type: 'application/pdf', size: 3.8 * 1024 * 1024 },
    { name: 'onboarding-guide.pdf', type: 'application/pdf', size: 12 * 1024 * 1024 },
    { name: 'logs.csv', type: 'text/csv', size: 45 * 1024 },
  ];
  for (const f of fileContents) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.floor(f.size)));
    await uploadFile({
      tenantId: config.demoTenantId,
      originalName: f.name,
      contentType: f.type,
      data: bytes,
    });
  }

  log.info('seeding live interactions…');
  const liveCount = 40;
  for (let i = 0; i < liveCount; i++) {
    const ts = Date.now() - Math.floor(Math.random() * 30 * 24 * 3600 * 1000);
    await createRecord({
      tenantId: config.demoTenantId,
      entity: 'Interaction',
      record: {
        Id: uuid(),
        Timestamp: ts,
        Channel: pick(CHANNELS),
        Type: pick(TYPES),
        Subject: pick(SUBJECTS),
        Payload: `Auto-generated demo interaction #${i + 1}.`,
      },
    });
  }

  log.info('seeding archived interactions…');
  const archivedCount = 200;
  for (let i = 0; i < archivedCount; i++) {
    const ts = Date.now() - (90 + Math.floor(Math.random() * 365)) * 24 * 3600 * 1000;
    await createRecord({
      tenantId: config.demoTenantId,
      entity: 'ArchivedInteraction',
      record: {
        Id: uuid(),
        Timestamp: ts,
        Channel: pick(CHANNELS),
        Type: pick(TYPES),
        Subject: pick(SUBJECTS),
        Payload: `Archived demo interaction #${i + 1}.`,
        IsArchived: true,
      },
      isArchive: true,
    });
  }

  log.info('demo seed complete', {
    files: fileContents.length,
    live: liveCount,
    archived: archivedCount,
  });
}

main().catch((e) => {
  log.error('demo seed failed', { err: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
