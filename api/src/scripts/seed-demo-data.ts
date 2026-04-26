/**
 * Seeds the middleware directly with demo data — files, records, rules, backup orgs,
 * snapshots, and a diff plan — so the dashboard looks impressive on camera.
 *
 * Run: bun run seed:demo
 * Safe to re-run: uses INSERT OR IGNORE / DELETE-then-INSERT patterns.
 *
 * NOTE: Files are inserted directly into the DB metadata table with realistic
 * enterprise-scale size_bytes (org exports, video archives). The actual object-
 * store keys are synthetic — no MinIO upload required — so the seeder works
 * even when object backends are offline. The visual sizes are intentionally
 * large (enterprise orgs routinely store TB+ in Salesforce Content) and drive
 * the cost-savings ticker to the ~$11,840/mo target stated in the demo script.
 */

import { getDb } from '../db/client.ts';
import { loadConfig } from '../config.ts';
import { hashApiKey } from '../db/hash.ts';
import { log } from '../util/logger.ts';
import { getBackends } from '../object/registry.ts';
import type { DiffPlanDocument, DiffChange } from '../backup/diff-types.ts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Epoch ms, `daysAgo` days in the past, with random sub-day jitter. */
function ts(daysAgo: number): number {
  const jitter = Math.random() * 24 * 3600 * 1000;
  return Date.now() - daysAgo * 24 * 3600 * 1000 - jitter;
}

function MB(n: number): number {
  return Math.round(n * 1024 * 1024);
}
function GB(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

// ─── Demo fixture data ────────────────────────────────────────────────────────

const BACKENDS = ['minio', 'gcs', 's3', 'azure'] as const;
type BackendId = (typeof BACKENDS)[number];

const STORAGE_CLASSES = ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'] as const;
type StorageClass = (typeof STORAGE_CLASSES)[number];

interface FileSeed {
  name: string;
  mime: string;
  sizeBytes: number;
  backend: BackendId;
  storageClass: StorageClass;
  daysAgo: number;
}

// 80 files across 6+ MIME types, 4 backends, hot/warm/cold tiers.
// Sizes are enterprise-scale: large org exports and video archives drive
// the $11,840/mo avoided-Salesforce-storage figure.
const FILES: FileSeed[] = [
  // ── Org data exports (GCS Coldline — largest cost driver) ────────────────
  { name: 'FullOrgExport_2026Q1.zip',         mime: 'application/zip',         sizeBytes: GB(490),  backend: 'gcs',   storageClass: 'COLDLINE', daysAgo: 28 },
  { name: 'FullOrgExport_2025Q4.zip',         mime: 'application/zip',         sizeBytes: GB(475),  backend: 'gcs',   storageClass: 'COLDLINE', daysAgo: 120 },
  { name: 'FullOrgExport_2025Q3.zip',         mime: 'application/zip',         sizeBytes: GB(460),  backend: 's3',    storageClass: 'COLDLINE', daysAgo: 210 },
  { name: 'SalesforceBackup_2026-01.tar.gz',  mime: 'application/gzip',        sizeBytes: GB(55),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 85 },
  { name: 'SalesforceBackup_2025-12.tar.gz',  mime: 'application/gzip',        sizeBytes: GB(52),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 115 },
  { name: 'SalesforceBackup_2025-11.tar.gz',  mime: 'application/gzip',        sizeBytes: GB(49),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 145 },
  { name: 'SalesforceBackup_2025-10.tar.gz',  mime: 'application/gzip',        sizeBytes: GB(47),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 175 },
  { name: 'SalesforceBackup_2025-09.tar.gz',  mime: 'application/gzip',        sizeBytes: GB(45),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 205 },
  // ── Training + enablement videos (S3 / Azure) ────────────────────────────
  { name: 'SalesEnablement_Q1_Full.mp4',      mime: 'video/mp4',               sizeBytes: GB(92),   backend: 'azure', storageClass: 'NEARLINE', daysAgo: 15 },
  { name: 'ProductDemo_Vastify_v3.mp4',       mime: 'video/mp4',               sizeBytes: GB(88),   backend: 'azure', storageClass: 'NEARLINE', daysAgo: 22 },
  { name: 'CustomerSuccessWebinar_Mar26.mp4', mime: 'video/mp4',               sizeBytes: GB(75),   backend: 's3',    storageClass: 'NEARLINE', daysAgo: 40 },
  { name: 'OnboardingVideo_AcmeCorp.mp4',     mime: 'video/mp4',               sizeBytes: GB(68),   backend: 'azure', storageClass: 'COLDLINE', daysAgo: 60 },
  { name: 'demo_video_acme.mp4',              mime: 'video/mp4',               sizeBytes: GB(55),   backend: 's3',    storageClass: 'COLDLINE', daysAgo: 78 },
  { name: 'TrainingRecording_Nov2025.mp4',    mime: 'video/mp4',               sizeBytes: GB(48),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 150 },
  { name: 'AllHandsMeeting_2025Q3.mp4',       mime: 'video/mp4',               sizeBytes: GB(42),   backend: 'azure', storageClass: 'ARCHIVE',  daysAgo: 200 },
  // ── CAD / design files ───────────────────────────────────────────────────
  { name: 'ProductSpec_HW_Rev7.dwg',          mime: 'application/acad',        sizeBytes: GB(12),   backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 5 },
  { name: 'EnclosureDesign_v4.step',          mime: 'model/step',              sizeBytes: GB(8),    backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 12 },
  { name: 'CircuitBoard_Gerber_v2.zip',       mime: 'application/zip',         sizeBytes: GB(4),    backend: 'gcs',   storageClass: 'NEARLINE', daysAgo: 45 },
  // ── Analytics / BI exports ───────────────────────────────────────────────
  { name: 'Q1_2026_FullPipeline_Export.csv',  mime: 'text/csv',                sizeBytes: MB(340),  backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 3 },
  { name: 'AccountHealthScores_Mar26.parquet',mime: 'application/octet-stream',sizeBytes: MB(220),  backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 7 },
  { name: 'ChurnPrediction_2025Q4.csv',       mime: 'text/csv',                sizeBytes: MB(185),  backend: 's3',    storageClass: 'NEARLINE', daysAgo: 95 },
  { name: 'NPS_Responses_All_2025.xlsx',      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: MB(110), backend: 'minio', storageClass: 'STANDARD', daysAgo: 20 },
  { name: 'OpportunityForecast_Q2.xlsx',      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: MB(78),  backend: 'minio', storageClass: 'STANDARD', daysAgo: 10 },
  { name: 'SupportTickets_Export_2025.csv',   mime: 'text/csv',                sizeBytes: MB(145),  backend: 'minio', storageClass: 'NEARLINE', daysAgo: 55 },
  // ── PDFs — contracts, proposals, SOWs ────────────────────────────────────
  { name: 'MasterServiceAgreement_AcmeCorp.pdf',mime: 'application/pdf',       sizeBytes: MB(14),   backend: 'minio', storageClass: 'STANDARD', daysAgo: 2 },
  { name: 'Quote_2026Q1_GlobalTech.pdf',      mime: 'application/pdf',         sizeBytes: MB(11),   backend: 'minio', storageClass: 'STANDARD', daysAgo: 4 },
  { name: 'ContractV3_signed_NovaChem.pdf',   mime: 'application/pdf',         sizeBytes: MB(9),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 8 },
  { name: 'SOW_Implementation_BluePeak.pdf',  mime: 'application/pdf',         sizeBytes: MB(7),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 14 },
  { name: 'RenewalProposal_AcmeCorp_2026.pdf',mime: 'application/pdf',         sizeBytes: MB(16),   backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 6 },
  { name: 'Proposal_CloudMigration_v2.pdf',   mime: 'application/pdf',         sizeBytes: MB(13),   backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 18 },
  { name: 'DPA_DataProcessing_StarLabs.pdf',  mime: 'application/pdf',         sizeBytes: MB(5),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 25 },
  { name: 'NDA_Executed_VertexSys.pdf',       mime: 'application/pdf',         sizeBytes: MB(3),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 33 },
  { name: 'InvoiceBundle_Mar2026.pdf',        mime: 'application/pdf',         sizeBytes: MB(8),    backend: 's3',    storageClass: 'NEARLINE', daysAgo: 30 },
  { name: 'SLA_Amendment_Tier2.pdf',          mime: 'application/pdf',         sizeBytes: MB(4),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 42 },
  { name: 'OrderForm_Q4_2025_v2.pdf',         mime: 'application/pdf',         sizeBytes: MB(6),    backend: 'minio', storageClass: 'COLDLINE', daysAgo: 100 },
  { name: 'AuditReport_SOC2_2025.pdf',        mime: 'application/pdf',         sizeBytes: MB(18),   backend: 's3',    storageClass: 'COLDLINE', daysAgo: 110 },
  { name: 'ContractArchive_2024.pdf',         mime: 'application/pdf',         sizeBytes: MB(15),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 180 },
  { name: 'LegalHold_Batch_2023.pdf',         mime: 'application/pdf',         sizeBytes: MB(12),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 280 },
  // ── Images ───────────────────────────────────────────────────────────────
  { name: 'support_screenshot_456.png',       mime: 'image/png',               sizeBytes: MB(2),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 1 },
  { name: 'support_screenshot_457.png',       mime: 'image/png',               sizeBytes: MB(1),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 1 },
  { name: 'product_banner_AcmeCorp.jpg',      mime: 'image/jpeg',              sizeBytes: MB(4),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 9 },
  { name: 'logo_GlobalTech_2x.png',           mime: 'image/png',               sizeBytes: MB(1),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 11 },
  { name: 'office_photo_team_2025.jpg',       mime: 'image/jpeg',              sizeBytes: MB(7),    backend: 'minio', storageClass: 'NEARLINE', daysAgo: 90 },
  { name: 'EventBooth_SalesforceDX.jpg',      mime: 'image/jpeg',              sizeBytes: MB(5),    backend: 'minio', storageClass: 'NEARLINE', daysAgo: 50 },
  { name: 'ProductScreenshot_v4.png',         mime: 'image/png',               sizeBytes: MB(3),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 17 },
  { name: 'DiagramArchitecture_CRM.png',      mime: 'image/png',               sizeBytes: MB(2),    backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 27 },
  // ── Audio (call recordings) ───────────────────────────────────────────────
  { name: 'CallRecording_AcmeCorp_Mar26.m4a', mime: 'audio/mp4',              sizeBytes: MB(48),   backend: 'azure', storageClass: 'COLDLINE', daysAgo: 35 },
  { name: 'CallRecording_NovaChem_Feb26.m4a', mime: 'audio/mp4',              sizeBytes: MB(36),   backend: 'azure', storageClass: 'COLDLINE', daysAgo: 65 },
  { name: 'CallRecording_BluePeak_Jan26.m4a', mime: 'audio/mp4',              sizeBytes: MB(41),   backend: 'azure', storageClass: 'ARCHIVE',  daysAgo: 95 },
  { name: 'CallRecording_StarLabs_Dec25.m4a', mime: 'audio/mp4',              sizeBytes: MB(29),   backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 130 },
  // ── Emails / EML archives ────────────────────────────────────────────────
  { name: 'EmailArchive_AcmeCorp_2025.mbox',  mime: 'application/mbox',       sizeBytes: MB(310),  backend: 'gcs',   storageClass: 'COLDLINE', daysAgo: 70 },
  { name: 'EmailArchive_AllAccounts_Q4.mbox', mime: 'application/mbox',       sizeBytes: MB(480),  backend: 'gcs',   storageClass: 'COLDLINE', daysAgo: 120 },
  // ── Word / Google Docs exports ────────────────────────────────────────────
  { name: 'RunbookPlaybook_CustomerSuccess.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: MB(9), backend: 'minio', storageClass: 'STANDARD', daysAgo: 13 },
  { name: 'SalesPitch_Enterprise_v5.pptx',    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: MB(18), backend: 'minio', storageClass: 'STANDARD', daysAgo: 16 },
  { name: 'QBR_AcmeCorp_Q1_2026.pptx',       mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: MB(14), backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 26 },
  { name: 'ImplementationGuide_v3.docx',      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: MB(6), backend: 'minio', storageClass: 'STANDARD', daysAgo: 38 },
  // ── Misc / miscellaneous ─────────────────────────────────────────────────
  { name: 'CRMDataDump_Accounts.json',        mime: 'application/json',        sizeBytes: MB(165),  backend: 'gcs',   storageClass: 'NEARLINE', daysAgo: 44 },
  { name: 'ContactEnrichment_Batch_Mar.json', mime: 'application/json',        sizeBytes: MB(88),   backend: 's3',    storageClass: 'STANDARD', daysAgo: 8 },
  { name: 'WebhookLog_2026Q1.ndjson',         mime: 'application/x-ndjson',    sizeBytes: MB(55),   backend: 'minio', storageClass: 'NEARLINE', daysAgo: 32 },
  { name: 'ActivityLog_2025_Full.ndjson',     mime: 'application/x-ndjson',    sizeBytes: MB(240),  backend: 's3',    storageClass: 'COLDLINE', daysAgo: 105 },
  { name: 'IntegrationLog_HubSpot_Feb.txt',   mime: 'text/plain',              sizeBytes: MB(22),   backend: 'minio', storageClass: 'STANDARD', daysAgo: 54 },
  { name: 'FieldHistoryExport_2025.csv',      mime: 'text/csv',                sizeBytes: MB(190),  backend: 'gcs',   storageClass: 'COLDLINE', daysAgo: 88 },
  { name: 'CustomObjectData_Interactions.csv',mime: 'text/csv',                sizeBytes: MB(127),  backend: 'gcs',   storageClass: 'NEARLINE', daysAgo: 62 },
  { name: 'MigrationBundle_v2.zip',           mime: 'application/zip',         sizeBytes: MB(430),  backend: 's3',    storageClass: 'NEARLINE', daysAgo: 48 },
  { name: 'ProfilePhotos_AllUsers.zip',       mime: 'application/zip',         sizeBytes: MB(95),   backend: 'minio', storageClass: 'NEARLINE', daysAgo: 72 },
  { name: 'ContentVersion_Archive_2024.zip',  mime: 'application/zip',         sizeBytes: MB(670),  backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 270 },
  { name: 'DataRetention_Purge_2023.zip',     mime: 'application/zip',         sizeBytes: MB(540),  backend: 's3',    storageClass: 'ARCHIVE',  daysAgo: 365 },
  { name: 'SurveyResults_NPS_2025Q4.xlsx',    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: MB(42), backend: 'minio', storageClass: 'STANDARD', daysAgo: 108 },
  { name: 'PriceBook_Enterprise_2026.xlsx',   mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: MB(11), backend: 'minio', storageClass: 'STANDARD', daysAgo: 19 },
  { name: 'TerritoryMap_EMEA_v2.pdf',         mime: 'application/pdf',         sizeBytes: MB(8),    backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 23 },
  { name: 'CompetitiveLandscape_2026.pdf',    mime: 'application/pdf',         sizeBytes: MB(10),   backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 29 },
  { name: 'SecurityQuestionnaire_VertexSys.pdf',mime: 'application/pdf',       sizeBytes: MB(6),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 37 },
  { name: 'PenetrationTestReport_2025.pdf',   mime: 'application/pdf',         sizeBytes: MB(17),   backend: 's3',    storageClass: 'COLDLINE', daysAgo: 93 },
  { name: 'ERD_DataModel_v3.png',             mime: 'image/png',               sizeBytes: MB(3),    backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 46 },
  { name: 'Wireframes_NewPortal_v2.fig',      mime: 'application/octet-stream',sizeBytes: MB(25),   backend: 'gcs',   storageClass: 'STANDARD', daysAgo: 52 },
  { name: 'DatabaseDump_Sandbox_Apr26.sql.gz',mime: 'application/gzip',        sizeBytes: MB(380),  backend: 's3',    storageClass: 'NEARLINE', daysAgo: 21 },
  { name: 'MonthlyReport_Mar2026.pdf',        mime: 'application/pdf',         sizeBytes: MB(7),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 24 },
  { name: 'support_screenshot_101.png',       mime: 'image/png',               sizeBytes: MB(1),    backend: 'minio', storageClass: 'STANDARD', daysAgo: 2 },
  { name: 'CustomerStoriesVideo_2026.mp4',    mime: 'video/mp4',               sizeBytes: GB(22),   backend: 'azure', storageClass: 'NEARLINE', daysAgo: 57 },
  { name: 'SalesKickoff_2026_Recording.mp4',  mime: 'video/mp4',               sizeBytes: GB(35),   backend: 'azure', storageClass: 'COLDLINE', daysAgo: 118 },
];

// ─── Record subjects ──────────────────────────────────────────────────────────

const CHANNELS = ['email', 'phone', 'chat', 'web', 'in-app'] as const;
const TYPES = ['support', 'sales', 'escalation', 'onboarding', 'renewal'] as const;

const ACCOUNT_IDS = [
  '001Dx000001AcmeCp', '001Dx000002NovaCh', '001Dx000003BluePk',
  '001Dx000004StarLb', '001Dx000005VertxS', '001Dx000006GlblTk',
  '001Dx000007CloudM', '001Dx000008PeakIO',
];

const CONTACT_IDS = [
  '003Dx000001JSmith', '003Dx000002MJones', '003Dx000003AWilsn',
  '003Dx000004SBrown', '003Dx000005DChang', '003Dx000006LGarci',
  '003Dx000007HKumar', '003Dx000008TYamdt',
];

const SUPPORT_SUBJECTS = [
  'API rate limit hit on batch sync',
  'Custom field mapping not persisting after deploy',
  'SSO login loop — redirects back to /login',
  'Bulk import failing on records > 50k rows',
  'Report on archived interactions returning 0 results',
  'Webhook delivery delays — averaging 4 min lag',
  'Permission set not propagating to new users',
  'Data export job stuck at 12% for 3 hours',
  'Dashboard tiles showing stale data after cache clear',
  'File preview broken for .docx over 10 MB',
  'Integration log shows duplicate events for same record',
  'Scheduled backup failed — storage quota exceeded',
  'OData filter on Account__c returns error 400',
  'Custom object trigger firing twice on update',
  'Email-to-case thread matching wrong account',
  'Contact merge losing secondary email addresses',
  'Territory assignment not reflecting org hierarchy change',
  'Sandbox refresh wiped connected-org credentials',
  'Security scanner flagging legacy API endpoint',
  'Mobile app push notifications delayed by > 30 min',
];

const SALES_SUBJECTS = [
  'Renewal quote follow-up — Q2 2026',
  'Expansion opportunity — 200 seat upsell',
  'Discovery call confirmed for Apr 28',
  'Proposal sent — awaiting legal review',
  'Competitive bake-off: Vastify vs incumbent',
  'Executive sponsor intro requested',
  'POC kick-off — 30-day timeline agreed',
  'Pricing approval needed for >$250k ACV',
  'Contract redlines returned — 3 open items',
  'Q1 QBR completed — renewal intent strong',
  'Champion left company — re-engage new stakeholder',
  'Multi-year deal discussion initiated',
  'Partnership referral from integration partner',
  'Freemium to paid upgrade — self-serve intent',
  'ROI analysis delivered to CFO',
  'Security questionnaire submitted',
  'Board-level presentation requested',
  'Net-new logo — inbound from SalesforceDX booth',
];

const ESCALATION_SUBJECTS = [
  'P0 escalation — production data sync halted',
  'VP escalation — missed SLA on 3 consecutive incidents',
  'Legal hold flagged — data export required within 24h',
  'Compliance audit request — 30-day data retention report',
  'Executive escalation: AcmeCorp threatening churn',
  'Security incident — unauthorized API key usage detected',
  'Data breach concern — investigating anomalous query volume',
  'Regulator inquiry — GDPR data subject request overdue',
];

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Seed full demo content: tenant, rules, 80 files, 650 records, 5 snapshots,
 * a diff plan with 47 changes (and the diff body in object storage so the AI
 * Diff Explainer works).
 *
 * Idempotent — wipes the tenant's files / records / rules / snapshots / diff
 * plans and re-inserts the canonical demo set. Safe to call on every server
 * boot in a demo deployment.
 *
 * Gate the call on `VASTIFY_DEMO_PUBLIC_ODATA === 'true'` (see server.ts boot)
 * so it never clobbers a real tenant in non-demo deploys.
 */
export async function seedDemoFixtures(): Promise<void> {
  const config = loadConfig();
  const db = getDb();
  const tenantId = config.demoTenantId;

  // 1 ── Ensure tenant exists ─────────────────────────────────────────────────
  const apiKeyHash = await hashApiKey(config.demoTenantApiKey);
  const tenantExists = db.query('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  if (!tenantExists) {
    db.query('INSERT INTO tenants (id, name, api_key_hash, created_at) VALUES (?, ?, ?, ?)').run(
      tenantId, 'Demo Tenant', apiKeyHash, Date.now(),
    );
    log.info('created demo tenant', { id: tenantId });
  } else {
    db.query('UPDATE tenants SET api_key_hash = ? WHERE id = ?').run(apiKeyHash, tenantId);
  }

  // 2 ── Routing rules ────────────────────────────────────────────────────────
  // Delete existing and re-insert the full desired set (idempotent via delete).
  db.query('DELETE FROM rules WHERE tenant_id = ?').run(tenantId);

  const allRules = [
    // Priority 10 — images: hot MinIO standard
    { priority: 10, match: { kind: 'file', mimeRegex: '^image/' },
      target: { backendId: 'minio', storageClass: 'STANDARD' }, enabled: 1 },
    // Priority 20 — large files > 10 MB: MinIO coldline
    { priority: 20, match: { kind: 'file', sizeBytesMin: 10 * 1024 * 1024 },
      target: { backendId: 'minio', storageClass: 'COLDLINE' }, enabled: 1 },
    // Priority 30 — PDFs > 10 MB older than 90 days: GCS Coldline (nuanced rule)
    { priority: 30, match: { kind: 'file', mimeRegex: '^application/pdf', sizeBytesMin: 10 * 1024 * 1024, ageDaysMin: 90 },
      target: { backendId: 'gcs', storageClass: 'COLDLINE' }, enabled: 1 },
    // Priority 40 — demo/training videos: S3 Glacier (nuanced rule)
    { priority: 40, match: { kind: 'file', mimeRegex: '^video/' },
      target: { backendId: 's3', storageClass: 'ARCHIVE' }, enabled: 1 },
    // Priority 50 — any file: MinIO standard catch-all
    { priority: 50, match: { kind: 'file' },
      target: { backendId: 'minio', storageClass: 'STANDARD' }, enabled: 1 },
    // Priority 60 — records older than 90 days: archived to MinIO
    { priority: 60, match: { kind: 'record', ageDaysMin: 90 },
      target: { backendId: 'minio', storageClass: 'ARCHIVE' }, enabled: 1 },
    // Priority 70 — escalation records: Azure warm tier for fast retrieval
    { priority: 70, match: { kind: 'record', type: 'escalation' },
      target: { backendId: 'azure', storageClass: 'NEARLINE' }, enabled: 1 },
    // Priority 80 — live records catch-all: MinIO standard
    { priority: 80, match: { kind: 'record' },
      target: { backendId: 'minio', storageClass: 'STANDARD' }, enabled: 1 },
  ];

  const insertRule = db.prepare(
    'INSERT INTO rules (id, tenant_id, priority, match_json, target_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const r of allRules) {
      insertRule.run(uuid(), tenantId, r.priority, JSON.stringify(r.match), JSON.stringify(r.target), r.enabled, Date.now());
    }
  })();
  log.info('seeded rules', { count: allRules.length });

  // 3 ── Files (direct DB insert — no object backend upload) ─────────────────
  // Delete and re-insert so we always get a clean set.
  db.query('DELETE FROM files WHERE tenant_id = ?').run(tenantId);

  const insertFile = db.prepare(
    `INSERT INTO files (id, tenant_id, sf_content_version_id, original_name, backend_id,
       storage_class, object_key, size_bytes, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let totalFileBytes = 0;
  db.transaction(() => {
    for (const f of FILES) {
      const id = uuid();
      const createdAt = ts(f.daysAgo);
      const objectKey = `tenants/${tenantId}/files/${id}`;
      const sfCvId = `068Dx${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
      insertFile.run(id, tenantId, sfCvId, f.name, f.backend, f.storageClass, objectKey, f.sizeBytes, f.mime, createdAt);
      totalFileBytes += f.sizeBytes;
    }
  })();
  log.info('seeded files', { count: FILES.length, totalGB: (totalFileBytes / GB(1)).toFixed(2) });

  // 4 ── Records — archived (500) + live (150) ────────────────────────────────
  // Clear existing records_index for this tenant and re-seed.
  db.query('DELETE FROM records_index WHERE tenant_id = ?').run(tenantId);

  const insertRecord = db.prepare(
    `INSERT OR IGNORE INTO records_index
       (tenant_id, entity, pk, backend_id, storage_class, object_key,
        timestamp, channel, type, account_id, contact_id, subject, is_archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const ARCHIVED_COUNT = 500;
  const LIVE_COUNT = 150;

  // Subject pools by type
  function subjectFor(type: string): string {
    if (type === 'sales') return pick(SALES_SUBJECTS);
    if (type === 'escalation') return pick(ESCALATION_SUBJECTS);
    return pick(SUPPORT_SUBJECTS);
  }

  db.transaction(() => {
    // Archived interactions — spread over last 2 years
    for (let i = 0; i < ARCHIVED_COUNT; i++) {
      const pk = uuid();
      const channel = pick([...CHANNELS]);
      const type = pick([...TYPES]);
      const subject = subjectFor(type);
      const daysBack = 90 + Math.floor(Math.random() * 640); // 90 days to ~2 years ago
      const timestamp = ts(daysBack);
      const backend = 'minio';
      const storageClass = 'ARCHIVE';
      const objectKey = `tenants/${tenantId}/records/ArchivedInteraction/${pk}.json`;
      insertRecord.run(
        tenantId, 'ArchivedInteraction', pk, backend, storageClass, objectKey,
        timestamp, channel, type, pick(ACCOUNT_IDS), pick(CONTACT_IDS), subject, 1, Date.now(),
      );
    }

    // Live interactions — spread over last 30 days
    for (let i = 0; i < LIVE_COUNT; i++) {
      const pk = uuid();
      const channel = pick([...CHANNELS]);
      const type = pick([...TYPES]);
      const subject = subjectFor(type);
      const timestamp = ts(Math.random() * 30);
      const backend = 'minio';
      const storageClass = 'STANDARD';
      const objectKey = `tenants/${tenantId}/records/Interaction/${pk}.json`;
      insertRecord.run(
        tenantId, 'Interaction', pk, backend, storageClass, objectKey,
        timestamp, channel, type, pick(ACCOUNT_IDS), pick(CONTACT_IDS), subject, 0, Date.now(),
      );
    }
  })();
  log.info('seeded records', { archived: ARCHIVED_COUNT, live: LIVE_COUNT });

  // 5 ── Backup: connected orgs ───────────────────────────────────────────────
  // Use a stable ID so re-runs don't duplicate.
  const SF_ORG_ID = 'demo-sf-org-00000001';
  const SF_ORG_EXT = '00Dx0000000AcmeSF';
  const SF_SCOPE_ID = 'demo-sf-scope-00000001';

  // Delete in FK order: restore_jobs → diff_plans → snapshots → scopes → orgs
  db.query('DELETE FROM restore_jobs WHERE tenant_id = ?').run(tenantId);
  db.query('DELETE FROM diff_plans WHERE tenant_id = ?').run(tenantId);
  db.query('DELETE FROM backup_snapshots WHERE tenant_id = ?').run(tenantId);
  db.query('DELETE FROM backup_scopes WHERE tenant_id = ?').run(tenantId);
  db.query('DELETE FROM connected_orgs WHERE tenant_id = ?').run(tenantId);

  db.query(`
    INSERT INTO connected_orgs
      (id, tenant_id, crm_type, display_name, instance_url, external_org_id,
       is_sandbox, oauth_refresh_token_enc, oauth_access_token_cache,
       access_token_expires_at, git_remote_url, connected_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    SF_ORG_ID, tenantId, 'salesforce',
    'AcmeCorp Production (Salesforce)',
    'https://acmecorp.my.salesforce.com',
    SF_ORG_EXT,
    0,
    'demo_encrypted_refresh_token_placeholder',
    'demo_access_token_cache_placeholder',
    Date.now() + 7200_000,
    null,
    ts(35),
    ts(0.1),
  );

  // 6 ── Backup: scope ────────────────────────────────────────────────────────
  db.query(`
    INSERT INTO backup_scopes
      (id, tenant_id, connected_org_id, name, root_object, max_depth,
       include_files, include_metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(SF_SCOPE_ID, tenantId, SF_ORG_ID, 'Full Account Graph', 'Account', 3, 1, 1, ts(34));

  // 7 ── Backup: snapshots (5 over past 30 days) ─────────────────────────────
  // Snapshot IDs — stable so diff_plan FK won't break on re-run
  const SNAP_IDS = [
    'demo-snap-00000001',
    'demo-snap-00000002',
    'demo-snap-00000003',
    'demo-snap-00000004',
    'demo-snap-00000005',
  ];

  const snapshots = [
    // oldest → newest; latest is snap[4]
    { id: SNAP_IDS[0], daysAgo: 28, records: 18_420, files: 312,  meta: 1_850, sizeBytes: GB(2.1),  sha: 'a1b2c3d' },
    { id: SNAP_IDS[1], daysAgo: 21, records: 19_105, files: 328,  meta: 1_902, sizeBytes: GB(2.3),  sha: 'e4f5a6b' },
    { id: SNAP_IDS[2], daysAgo: 14, records: 20_883, files: 341,  meta: 1_964, sizeBytes: GB(2.5),  sha: 'c7d8e9f' },
    { id: SNAP_IDS[3], daysAgo: 7,  records: 21_450, files: 355,  meta: 2_011, sizeBytes: GB(2.7),  sha: '1a2b3c4' },
    { id: SNAP_IDS[4], daysAgo: 1,  records: 22_148, files: 362,  meta: 2_044, sizeBytes: GB(2.8),  sha: '5d6e7f8' },
  ];

  const insertSnap = db.prepare(`
    INSERT INTO backup_snapshots
      (id, tenant_id, connected_org_id, backup_scope_id, status,
       archive_storage_key, archive_backend_id, git_commit_sha,
       record_count, file_count, metadata_item_count, size_bytes,
       started_at, completed_at, error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  db.transaction(() => {
    for (const s of snapshots) {
      const startedAt = ts(s.daysAgo);
      const completedAt = startedAt + 8 * 60 * 1000 + Math.random() * 4 * 60 * 1000; // 8–12 min run
      const archiveKey = `tenants/${tenantId}/snapshots/${s.id}/archive.zip`;
      insertSnap.run(
        s.id, tenantId, SF_ORG_ID, SF_SCOPE_ID, 'complete',
        archiveKey, 'minio', s.sha,
        s.records, s.files, s.meta, s.sizeBytes,
        startedAt, completedAt, null,
      );
    }
  })();
  log.info('seeded snapshots', { count: snapshots.length });

  // 8 ── Diff plan on the latest snapshot ────────────────────────────────────
  // 47 total changes: 12 inserts + 3 updates + 32 skip-deletes.
  // The key "skip" example is a Closed-Won opportunity that must not be re-opened.
  const DIFF_PLAN_ID = 'demo-diff-plan-00000001';
  const latestSnapId = SNAP_IDS[4];

  const summaryCounts = JSON.stringify({ insert: 12, update: 3, skipDelete: 32 });

  db.query(`
    INSERT INTO diff_plans
      (id, tenant_id, snapshot_id, target_org_id, storage_key, backend_id,
       target_state_hash, summary_counts, built_at, expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    DIFF_PLAN_ID, tenantId, latestSnapId, SF_ORG_ID,
    `tenants/${tenantId}/diff-plans/${DIFF_PLAN_ID}.json`,
    'minio',
    'sha256:3f9a2c1b8e7d4f6a0c5b2e9d1a3f7c4b',
    summaryCounts,
    ts(0.05),
    null,
  );

  log.info('seeded diff plan', { insert: 12, update: 3, skipDelete: 32 });

  // 8b ── Diff plan body to object storage (so AI Diff Explainer can read it) ─
  // The DB row above only stores metadata — the actual change list lives in
  // object storage at storage_key. The Diff Explainer route reads it from
  // there. If MinIO/storage is unreachable, log a warning and continue —
  // the Setup Agent demo still works without the diff body.
  const diffBodyKey = `tenants/${tenantId}/diff-plans/${DIFF_PLAN_ID}.json`;
  const changes: DiffChange[] = buildDemoDiffChanges();
  const diffDoc: DiffPlanDocument = {
    id: DIFF_PLAN_ID,
    snapshotId: latestSnapId,
    tenantId,
    targetOrgId: SF_ORG_ID,
    targetStateHash: 'sha256:3f9a2c1b8e7d4f6a0c5b2e9d1a3f7c4b',
    builtAt: ts(0.05),
    objectOrder: ['Contact', 'Account', 'Opportunity'],
    changes,
    counts: { insert: 12, update: 3, skipDelete: 32 },
  };
  const diffBytes = new TextEncoder().encode(JSON.stringify(diffDoc));
  try {
    const backends = getBackends();
    const minio = backends.get('minio');
    if (!minio) throw new Error('MinIO backend not registered');
    await minio.put(diffBodyKey, diffBytes, {
      storageClass: 'STANDARD',
      contentType: 'application/json',
    });
    log.info('seeded diff plan body to object storage', { key: diffBodyKey, bytes: diffBytes.length });
  } catch (err) {
    log.warn('could not write diff plan body to object storage — Diff Explainer demo will fail until MinIO is reachable and seed is re-run', {
      err: (err as Error).message,
    });
  }

  // 9 ── Savings snapshot (historical) ───────────────────────────────────────
  // Not read by the live ticker (which uses files/records live), but useful for
  // trend displays and confirms the target savings figure.
  const sfFileBytesAvoided = totalFileBytes;
  const sfDataBytesAvoided = (ARCHIVED_COUNT + LIVE_COUNT) * 400; // AVG_RECORD_BYTES=400
  // Compute apparent net savings using same formula as stats/service.ts
  const BYTES_PER_GB_F = 1_000_000_000;
  const SF_FILE_PER_GB = 5;
  const usdAvoided = (sfFileBytesAvoided / BYTES_PER_GB_F) * SF_FILE_PER_GB;
  const backendByCls = { minio_STANDARD: 0, gcs_COLDLINE: 0, s3_ARCHIVE: 0, azure_NEARLINE: 0 };

  db.query(`
    INSERT INTO savings_snapshots
      (tenant_id, at, sf_data_bytes_avoided, sf_file_bytes_avoided,
       backend_bytes_by_class_json, usd_saved_monthly_estimate)
    VALUES (?,?,?,?,?,?)
  `).run(
    tenantId, Date.now(),
    sfDataBytesAvoided, sfFileBytesAvoided,
    JSON.stringify(backendByCls),
    usdAvoided,
  );

  // 10 ── Summary ─────────────────────────────────────────────────────────────
  const totalFilesCount = FILES.length;
  const totalRecords = ARCHIVED_COUNT + LIVE_COUNT;
  const totalRules = allRules.length;
  const totalSnaps = snapshots.length;
  const totalFileGB = totalFileBytes / BYTES_PER_GB_F;
  const apparentSavings = totalFileGB * SF_FILE_PER_GB;

  log.info(
    `Seeded ${totalFilesCount} files, ${totalRecords} records, ` +
    `${totalRules} rules, ${totalSnaps} snapshots, ` +
    `$${apparentSavings.toFixed(2)}/mo apparent savings`,
  );

  console.log(
    `\nSeeded ${totalFilesCount} files (${totalFileGB.toFixed(1)} GB), ` +
    `${ARCHIVED_COUNT} archived + ${LIVE_COUNT} live records, ` +
    `${totalRules} rules, ${totalSnaps} snapshots, ` +
    `diff plan (12 insert / 3 update / 32 skip-delete), ` +
    `$${apparentSavings.toFixed(2)}/mo apparent savings\n`,
  );
}

/**
 * Builds 47 realistic-shaped DiffChange entries that map cleanly to the demo
 * script's narrative:
 *   • 12 Contact INSERTS — deleted in error during a bad import. Restore safe.
 *   • 3  Account UPDATES — edited in the live org since snapshot. Manual merge.
 *   • 1  Opportunity SKIP-DELETE — closed-won deal; do not re-open.
 *   • 31 Case SKIP-DELETES — closed cases; do not re-open.
 * Total skipDelete: 32 — matches the summary_counts in the DB row above.
 */
function buildDemoDiffChanges(): DiffChange[] {
  const out: DiffChange[] = [];

  // 12 Contact inserts (deleted in error)
  const firstNames = ['Sarah', 'James', 'Priya', 'Marcus', 'Aiko', 'Diego', 'Eve', 'Tom', 'Lina', 'Omar', 'Rachel', 'Wei'];
  const lastNames = ['Patel', 'O\'Brien', 'Nguyen', 'Singh', 'Tanaka', 'Reyes', 'Cohen', 'Walker', 'Khoury', 'Ali', 'Davis', 'Chen'];
  for (let i = 0; i < 12; i++) {
    out.push({
      op: 'insert',
      objectName: 'Contact',
      sourceRecord: {
        Id: `003DEMO${String(i + 1).padStart(13, '0')}`,
        FirstName: firstNames[i],
        LastName: lastNames[i],
        Email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase().replace(/[^a-z]/g, '')}@acmecorp.example`,
        Title: pick(['Senior Engineer', 'Director of Sales', 'Product Manager', 'CTO', 'Account Executive']),
        AccountId: `001DEMO${String((i % 8) + 1).padStart(13, '0')}`,
      },
      targetId: null,
    });
  }

  // 3 Account updates (edited since snapshot)
  for (let i = 0; i < 3; i++) {
    const id = `001DEMO${String(i + 1).padStart(13, '0')}`;
    out.push({
      op: 'update',
      objectName: 'Account',
      sourceRecord: {
        Id: id,
        Name: pick(['Acme Industries', 'Globex Corp', 'Initech LLC']),
        Phone: '+1-415-555-' + String(1000 + i).padStart(4, '0'),
        AnnualRevenue: 5_000_000 + i * 1_000_000,
        LastModifiedDate: new Date(Date.now() - 86_400_000 * 3).toISOString(),
      },
      targetId: id,
    });
  }

  // 1 Opportunity skip-delete (closed-won; should NOT be restored)
  out.push({
    op: 'skip-delete',
    objectName: 'Opportunity',
    sourceRecord: {
      Id: '006DEMO0000000000001',
      Name: 'Acme Industries — Enterprise Plan Q4',
      StageName: 'Closed Won',
      Amount: 240_000,
      CloseDate: new Date(Date.now() - 86_400_000 * 14).toISOString().split('T')[0],
      AccountId: '001DEMO0000000000001',
    },
    targetId: '006DEMO0000000000001',
  });

  // 31 Case skip-deletes (closed cases; should NOT be restored)
  for (let i = 0; i < 31; i++) {
    const id = `500DEMO${String(i + 1).padStart(13, '0')}`;
    out.push({
      op: 'skip-delete',
      objectName: 'Case',
      sourceRecord: {
        Id: id,
        Subject: pick([
          'Login issue resolved',
          'Quote approved',
          'Refund processed',
          'Bug fixed in v2.4',
          'Account migrated to new tier',
        ]),
        Status: 'Closed',
        Priority: pick(['High', 'Medium', 'Low']),
        ClosedDate: new Date(Date.now() - 86_400_000 * (10 + i)).toISOString(),
      },
      targetId: id,
    });
  }

  return out;
}

// CLI entry: `bun run api/src/scripts/seed-demo-data.ts`
if (import.meta.main) {
  seedDemoFixtures().catch((e: Error) => {
    log.error('demo seed failed', { err: e.message, stack: e.stack });
    process.exit(1);
  });
}
