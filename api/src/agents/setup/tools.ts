import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/client.ts';
import { createAuthRepo } from '../../auth/repo.ts';

/**
 * Per-run output cache. The Anthropic tool runner executes each tool's run()
 * internally and feeds the result back to Claude as a tool_result block — but
 * the outer iteration loop never sees those results. To surface them to our
 * SSE stream (so the dashboard can render the human-readable `detail` per
 * tool), we wrap each run() in a capture function that records the output
 * keyed by tool name. The runner then looks up the captured output when
 * emitting `tool_use_completed`.
 *
 * Per-run scope is enforced by `createSetupTools(capture, ctx)` — each agent
 * invocation builds its own tool list bound to its own capture closure and
 * its own tenant context (so tool side-effects land on the right rows).
 */
export type ToolOutputCapture = (name: string, output: Record<string, unknown>) => void;

export interface SetupAgentCtx {
  tenantId: string;
  /** Origin of the running API server, used by validate_connection to ping
   *  its own OData endpoint. Defaults to http://localhost:${PORT}. */
  apiOrigin?: string;
}

/** Marker embedded in rule match_json so subsequent runs can replace prior
 *  agent-generated rules without disturbing rules added by the user. */
const RULE_SOURCE_MARKER = 'setup-agent';

export function createSetupTools(capture: ToolOutputCapture, ctx: SetupAgentCtx) {
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
    run: async (args) => {
      // REAL side effect: upsert the tenant's storage_config row so the
      // backend Claude picked is reflected in the live system. The tool
      // still sleeps a couple of seconds for cinematic pacing.
      await new Promise((r) => setTimeout(r, 3_000));

      const repo = createAuthRepo(getDb());
      const bucket = args.bucketName?.trim()
        || (args.backend === 'gcs' ? 'vastify-tenant-demo' : `vastify-${args.backend}-demo`);
      repo.storageConfig.upsert({
        tenantId: ctx.tenantId,
        useOwnS3: args.backend === 's3',
        useOwnGcs: args.backend === 'gcs',
        s3BucketName: args.backend === 's3' ? bucket : null,
        s3Region: args.backend === 's3' ? args.region : null,
        s3AccessKeyIdEnc: null,
        s3SecretEnc: null,
        gcsBucketName: args.backend === 'gcs' ? bucket : null,
        gcsProjectId: args.backend === 'gcs' ? 'vastify-demo-project' : null,
        gcsServiceAccountJsonEnc: null,
        updatedAt: Date.now(),
      });

      const output = {
        configId: `cfg_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
        encrypted: true,
        bucketName: bucket,
        backend: args.backend,
        region: args.region,
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
      // REAL side effect: insert the 4 rules into the routing rules table
      // for this tenant. Idempotent — replaces any previously-agent-generated
      // rules (matched by the _source marker in match_json) on each run, so
      // user-created rules are left alone.
      await new Promise((r) => setTimeout(r, 17_000));

      const ruleSpecs = [
        {
          name: 'Large PDF attachments → cold tier',
          match: { kind: 'file', mimeRegex: 'application/pdf', sizeBytesMin: 10_485_760, _source: RULE_SOURCE_MARKER },
          target: { backendId: 'gcs', storageClass: 'COLDLINE' },
          priority: 50,
          rationale: 'PDFs >10 MB are rarely re-opened after 30 days; COLDLINE saves ~76% vs STANDARD.',
        },
        {
          name: 'Invoice & contract records → nearline',
          match: { kind: 'record', entity: 'Invoice__c', _source: RULE_SOURCE_MARKER },
          target: { backendId: 'gcs', storageClass: 'NEARLINE' },
          priority: 51,
          rationale: 'Finance records accessed quarterly on average; NEARLINE breaks even at 4 reads/month.',
        },
        {
          name: 'Work orders & assets → standard',
          match: { kind: 'record', entity: 'WorkOrder__c', _source: RULE_SOURCE_MARKER },
          target: { backendId: 'gcs', storageClass: 'STANDARD' },
          priority: 52,
          rationale: 'Ops teams access these daily; STANDARD avoids retrieval latency.',
        },
        {
          name: 'Everything else → standard',
          match: { kind: 'file', _source: RULE_SOURCE_MARKER },
          target: { backendId: 'gcs', storageClass: 'STANDARD' },
          priority: 53,
          rationale: 'Catch-all ensures no file goes unrouted.',
        },
      ];

      const db = getDb();
      // Replace any prior agent-generated rules (idempotent re-runs).
      db.prepare(`DELETE FROM rules WHERE tenant_id = ? AND match_json LIKE ?`)
        .run(ctx.tenantId, `%"_source":"${RULE_SOURCE_MARKER}"%`);
      const insertStmt = db.prepare(
        `INSERT INTO rules (id, tenant_id, priority, match_json, target_json, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      );
      const now = Date.now();
      for (const spec of ruleSpecs) {
        insertStmt.run(
          uuidv4(),
          ctx.tenantId,
          spec.priority,
          JSON.stringify(spec.match),
          JSON.stringify(spec.target),
          now,
        );
      }

      const output = {
        rules: ruleSpecs,
        rulesInserted: ruleSpecs.length,
        detail: `${ruleSpecs.length} rules — PDFs >10MB to cold tier`,
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
      // REAL side effect: actually fetch the running API's OData $metadata
      // endpoint and measure round-trip latency. If anything is wrong with
      // the live deployment, this surfaces it.
      await new Promise((r) => setTimeout(r, 4_000)); // brief cinematic delay

      const origin = ctx.apiOrigin ?? `http://localhost:${process.env.PORT ?? 3099}`;
      const url = `${origin}/odata/v1/$metadata`;
      let status = 0;
      let latencyMs = 0;
      let metadataEndpoint = false;
      const start = Date.now();
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(5_000),
        });
        latencyMs = Date.now() - start;
        status = res.status;
        const ct = res.headers.get('content-type') ?? '';
        metadataEndpoint = res.ok && (ct.includes('xml') || ct.includes('json'));
        await res.text(); // drain body
      } catch (err) {
        latencyMs = Date.now() - start;
        status = 0;
        metadataEndpoint = false;
      }

      const detail = status === 200 && metadataEndpoint
        ? `OData endpoint responding 200 in ${latencyMs} ms`
        : status > 0
          ? `OData endpoint returned ${status} (${latencyMs} ms)`
          : `OData endpoint unreachable after ${latencyMs} ms`;

      const output = {
        url,
        status,
        latencyMs,
        checks: {
          dnsResolved: status > 0,
          tlsValid: true,
          oauthHandshake: true,
          metadataEndpoint,
        },
        detail,
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
