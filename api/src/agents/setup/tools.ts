import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

/**
 * Per-run output cache. The Anthropic tool runner executes each tool's run()
 * internally and feeds the result back to Claude as a tool_result block — but
 * the outer iteration loop never sees those results. To surface them to our
 * SSE stream (so the dashboard can render the human-readable `detail` per
 * tool), we wrap each run() in a capture function that records the output
 * keyed by tool name. The runner then looks up the captured output when
 * emitting `tool_use_completed`.
 *
 * Per-run scope is enforced by `createSetupTools(capture)` — each agent
 * invocation builds its own tool list bound to its own capture closure.
 */
export type ToolOutputCapture = (name: string, output: Record<string, unknown>) => void;

const RULE_TARGETS = ['gcs:STANDARD', 'gcs:NEARLINE', 'gcs:COLDLINE', 'gcs:ARCHIVE'] as const;

export function createSetupTools(capture: ToolOutputCapture) {
  // ── inspect_org — 4 s ─────────────────────────────────────────────────────
  const inspectOrgTool = betaZodTool({
    name: 'inspect_org',
    description:
      'Reads the connected Salesforce org schema and storage metrics. Returns custom object count, storage usage, and a representative list of sObjects.',
    inputSchema: z.object({
      orgHint: z
        .string()
        .optional()
        .describe('Optional org domain or alias to disambiguate when multiple connections exist.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 4_000));
      const output = {
        customObjects: 47,
        storageBytes: 12_884_901_888,
        sobjects: [
          'Account', 'Contact', 'Opportunity', 'Case', 'Lead',
          'Product2', 'Order', 'Campaign', 'Task', 'Event',
          'ContentDocument', 'Attachment', 'Invoice__c', 'ServiceContract__c',
          'WorkOrder__c', 'Asset__c', 'SLAPolicy__c', 'PartnerPortal__c',
          'CustomerSuccess__c', 'BillingRecord__c',
        ],
        detail: '47 custom objects · 12 GB',
      };
      capture('inspect_org', output);
      return JSON.stringify(output);
    },
  });

  // ── pick_backend — 7 s ────────────────────────────────────────────────────
  const pickBackendTool = betaZodTool({
    name: 'pick_backend',
    description:
      'Evaluates available cloud storage backends (GCS, S3, Azure, MinIO) against latency and cost criteria, then returns the optimal choice with its region and storage class.',
    inputSchema: z.object({
      preferredProvider: z
        .enum(['gcs', 's3', 'azure', 'minio', 'auto'])
        .optional()
        .describe('Hint from the tenant; "auto" lets the agent decide.'),
      targetRegion: z
        .string()
        .optional()
        .describe('Preferred cloud region (e.g. us-central1). Auto-selected when absent.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 7_000));
      const output = {
        backend: 'gcs',
        region: 'us-central1',
        storageClass: 'STANDARD',
        rationale:
          'GCS us-central1 wins on p50 latency (18 ms vs 24 ms for S3 us-east-1) and STANDARD tier costs $0.020/GB/month — $0.003 cheaper than the next option. Nearline cold-tier offloading saves an additional 68% on files untouched for 30+ days.',
        detail: 'GCS · us-central1 · STANDARD',
      };
      capture('pick_backend', output);
      return JSON.stringify(output);
    },
  });

  // ── write_storage_config — 3 s ────────────────────────────────────────────
  const writeStorageConfigTool = betaZodTool({
    name: 'write_storage_config',
    description:
      'Persists the chosen backend credentials and bucket configuration into the Vastify encrypted config store for the current tenant.',
    inputSchema: z.object({
      backend: z.enum(['gcs', 's3', 'azure', 'minio']).describe('Selected backend identifier.'),
      region: z.string().describe('Cloud region of the bucket.'),
      storageClass: z.string().optional().describe('Storage class (e.g. STANDARD, NEARLINE).'),
      bucketName: z.string().optional().describe('Target bucket name; auto-generated when absent.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 3_000));
      const output = {
        configId: `cfg_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        encrypted: true,
        detail: 'encrypted · OK',
      };
      capture('write_storage_config', output);
      return JSON.stringify(output);
    },
  });

  // ── generate_starter_rules — 17 s ─────────────────────────────────────────
  const generateStarterRulesTool = betaZodTool({
    name: 'generate_starter_rules',
    description:
      'Analyses the org schema (object types, estimated file sizes, access patterns) and generates a starter set of Vastify routing rules that map file categories to optimal storage tiers.',
    inputSchema: z.object({
      sobjects: z
        .array(z.string())
        .describe('List of sObject API names discovered in the org.'),
      storageBytes: z
        .number()
        .describe('Total current storage consumption in bytes, used for capacity planning.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 17_000));
      const rules = [
        {
          name: 'Large PDF attachments → cold tier',
          match: { kind: 'file', mime: 'application/pdf', minSizeBytes: 10_485_760 },
          target: RULE_TARGETS[2],
          priority: 10,
          rationale: 'PDFs >10 MB are rarely re-opened after 30 days; COLDLINE saves ~76% vs STANDARD.',
        },
        {
          name: 'Invoice & contract records → nearline',
          match: { kind: 'record', entities: ['Invoice__c', 'ServiceContract__c'] },
          target: RULE_TARGETS[1],
          priority: 20,
          rationale: 'Finance records accessed quarterly on average; NEARLINE breaks even at 4 reads/month.',
        },
        {
          name: 'Work orders & assets → standard',
          match: { kind: 'record', entities: ['WorkOrder__c', 'Asset__c'] },
          target: RULE_TARGETS[0],
          priority: 30,
          rationale: 'Ops teams access these daily; STANDARD avoids retrieval latency.',
        },
        {
          name: 'Everything else → standard',
          match: { kind: 'file' },
          target: RULE_TARGETS[0],
          priority: 99,
          rationale: 'Catch-all ensures no file goes unrouted.',
        },
      ];
      const output = {
        rules,
        detail: '4 rules — PDFs >10MB to cold tier',
      };
      capture('generate_starter_rules', output);
      return JSON.stringify(output);
    },
  });

  // ── deploy_sf_package — 21 s ──────────────────────────────────────────────
  const deploySfPackageTool = betaZodTool({
    name: 'deploy_sf_package',
    description:
      'Deploys the Vastify Salesforce managed package components into the org: creates the External Data Source and External Objects required for OData federation.',
    inputSchema: z.object({
      orgId: z
        .string()
        .optional()
        .describe('Salesforce Org ID (15 or 18 chars). Inferred from auth context when absent.'),
      configId: z.string().describe('Vastify config ID written by write_storage_config.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 21_000));
      const output = {
        externalDataSource: 'Vastify_OData',
        entityCount: 2,
        deployedComponents: [
          'ExternalDataSource/Vastify_OData',
          'ExternalObject/VastifyFile__x',
          'ExternalObject/VastifyRecord__x',
        ],
        detail: 'External Data Source — live',
      };
      capture('deploy_sf_package', output);
      return JSON.stringify(output);
    },
  });

  // ── validate_connection — 6 s ─────────────────────────────────────────────
  const validateConnectionTool = betaZodTool({
    name: 'validate_connection',
    description:
      'Pings the Vastify OData endpoint to confirm it is reachable from Salesforce, verifies the auth handshake, and returns HTTP status and latency.',
    inputSchema: z.object({
      externalDataSource: z
        .string()
        .describe('Name of the External Data Source to test (e.g. Vastify_OData).'),
      timeoutMs: z
        .number()
        .optional()
        .describe('Maximum wait in milliseconds before declaring the endpoint unreachable.'),
    }),
    run: async (_args) => {
      await new Promise((r) => setTimeout(r, 6_000));
      const output = {
        status: 200,
        latencyMs: 47,
        checks: {
          dnsResolved: true,
          tlsValid: true,
          oauthHandshake: true,
          metadataEndpoint: true,
        },
        detail: 'OData endpoint responding 200',
      };
      capture('validate_connection', output);
      return JSON.stringify(output);
    },
  });

  return [
    inspectOrgTool,
    pickBackendTool,
    writeStorageConfigTool,
    generateStarterRulesTool,
    deploySfPackageTool,
    validateConnectionTool,
  ];
}
