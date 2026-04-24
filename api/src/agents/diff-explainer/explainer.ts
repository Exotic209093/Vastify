import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getAnthropic, modelId } from '../shared/client.js';
import { log } from '../../util/logger.js';
import type { DiffPlanDocument, DiffChange } from '../../backup/diff-types.js';
import type { Snapshot } from '../../backup/types.js';

// ── Output schema ──────────────────────────────────────────────────────────────

const EntityExplanationSchema = z.object({
  objectName: z.string(),
  verdict: z.enum(['safe', 'review', 'skip']),
  reasoning: z.string(),
  insertCount: z.number().int().nonnegative(),
  updateCount: z.number().int().nonnegative(),
  skipDeleteCount: z.number().int().nonnegative(),
});

const DiffExplanationSchema = z.object({
  summary: z.string(),
  overallVerdict: z.enum(['safe', 'review', 'skip']),
  entities: z.array(EntityExplanationSchema),
  warnings: z.array(z.string()),
});

export type EntityExplanation = z.infer<typeof EntityExplanationSchema>;
export type DiffExplanation = z.infer<typeof DiffExplanationSchema>;

// ── Supporting types ───────────────────────────────────────────────────────────

export interface OrgInfo {
  displayName: string;
  instanceUrl: string;
  isSandbox: boolean;
  crmType: string;
}

// ── Diff summarisation helpers ─────────────────────────────────────────────────

const MAX_CHANGES_PER_ENTITY = 50;

interface EntitySummary {
  objectName: string;
  insertCount: number;
  updateCount: number;
  skipDeleteCount: number;
  sampleInserts: CrmRecordSample[];
  sampleUpdates: CrmRecordSample[];
  sampleSkipDeletes: CrmRecordSample[];
  truncated: boolean;
}

interface CrmRecordSample {
  id: string | null;
  fields: Record<string, unknown>;
}

function sampleRecord(change: DiffChange): CrmRecordSample {
  const { Id, ...rest } = change.sourceRecord as Record<string, unknown>;
  return {
    id: (change.targetId ?? (Id as string | null) ?? null),
    fields: Object.fromEntries(Object.entries(rest).slice(0, 8)),
  };
}

function summariseChanges(changes: DiffChange[]): EntitySummary[] {
  const byObject = new Map<string, DiffChange[]>();
  for (const c of changes) {
    const list = byObject.get(c.objectName);
    if (list) list.push(c);
    else byObject.set(c.objectName, [c]);
  }

  const summaries: EntitySummary[] = [];
  for (const [objectName, entityChanges] of byObject) {
    const inserts = entityChanges.filter((c) => c.op === 'insert');
    const updates = entityChanges.filter((c) => c.op === 'update');
    const skipDeletes = entityChanges.filter((c) => c.op === 'skip-delete');

    const truncated =
      inserts.length > MAX_CHANGES_PER_ENTITY ||
      updates.length > MAX_CHANGES_PER_ENTITY ||
      skipDeletes.length > MAX_CHANGES_PER_ENTITY;

    summaries.push({
      objectName,
      insertCount: inserts.length,
      updateCount: updates.length,
      skipDeleteCount: skipDeletes.length,
      sampleInserts: inserts.slice(0, MAX_CHANGES_PER_ENTITY).map(sampleRecord),
      sampleUpdates: updates.slice(0, MAX_CHANGES_PER_ENTITY).map(sampleRecord),
      sampleSkipDeletes: skipDeletes.slice(0, MAX_CHANGES_PER_ENTITY).map(sampleRecord),
      truncated,
    });
  }

  return summaries;
}

// ── Prompt construction ────────────────────────────────────────────────────────

function buildUserPrompt(
  diffPlan: DiffPlanDocument,
  snapshot: Snapshot,
  orgInfo: OrgInfo,
  summaries: EntitySummary[],
): string {
  const snapshotDate = new Date(snapshot.startedAt).toISOString();
  const totalChanges = diffPlan.counts.insert + diffPlan.counts.update + diffPlan.counts.skipDelete;

  return [
    `## Restore Context`,
    ``,
    `**Target org:** ${orgInfo.displayName} (${orgInfo.instanceUrl})`,
    `**Org type:** ${orgInfo.isSandbox ? 'Sandbox' : 'Production'} ${orgInfo.crmType}`,
    `**Snapshot taken:** ${snapshotDate}`,
    `**Diff plan ID:** ${diffPlan.id}`,
    ``,
    `## Change Totals`,
    ``,
    `| Operation | Count |`,
    `|-----------|-------|`,
    `| INSERT (restore deleted records) | ${diffPlan.counts.insert} |`,
    `| UPDATE (overwrite changed records) | ${diffPlan.counts.update} |`,
    `| SKIP-DELETE (new records in target, not restored) | ${diffPlan.counts.skipDelete} |`,
    `| **Total** | **${totalChanges}** |`,
    ``,
    `## Per-Entity Breakdown`,
    ``,
    ...summaries.flatMap((s) => [
      `### ${s.objectName}${s.truncated ? ' *(sample — full diff truncated)*' : ''}`,
      `- Inserts: ${s.insertCount}, Updates: ${s.updateCount}, Skip-deletes: ${s.skipDeleteCount}`,
      ...(s.sampleInserts.length
        ? [`- Sample inserts (id → fields): ${JSON.stringify(s.sampleInserts.slice(0, 5))}`]
        : []),
      ...(s.sampleUpdates.length
        ? [`- Sample updates (id → fields): ${JSON.stringify(s.sampleUpdates.slice(0, 5))}`]
        : []),
      ...(s.sampleSkipDeletes.length
        ? [`- Sample skip-deletes (new target records kept): ${s.sampleSkipDeletes.slice(0, 5).map((r) => r.id).join(', ')}`]
        : []),
      ``,
    ]),
    `## Task`,
    ``,
    `For each entity listed above, provide:`,
    `1. **verdict** — one of: safe / review / skip`,
    `   - safe: routine data changes, low risk`,
    `   - review: significant volume, business-critical objects, or potential data loss`,
    `   - skip: high risk — e.g. mass-deleting records, auth/permission objects, or irreversible changes`,
    `2. **reasoning** — 1–3 plain-English sentences a non-technical admin can understand`,
    `3. **insertCount / updateCount / skipDeleteCount** — echo the numbers provided`,
    ``,
    `Also provide an **overallVerdict** (worst of all entity verdicts) and a 2–4 sentence **summary** of the entire restore operation.`,
    ``,
    `Add **warnings** for any entities where the verdict is review or skip, explaining why.`,
  ].join('\n');
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function explainDiff(
  diffPlan: DiffPlanDocument,
  snapshot: Snapshot,
  orgInfo: OrgInfo,
): Promise<DiffExplanation> {
  const summaries = summariseChanges(diffPlan.changes);
  const userPrompt = buildUserPrompt(diffPlan, snapshot, orgInfo, summaries);

  log.info('explainDiff: calling Claude', {
    planId: diffPlan.id,
    totalChanges: diffPlan.changes.length,
    entities: summaries.length,
    model: modelId(),
  });

  const client = getAnthropic();

  const response = await client.messages.parse({
    model: modelId(),
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: zodOutputFormat(DiffExplanationSchema),
    },
    system: [
      {
        type: 'text',
        text: [
          'You are a Salesforce CRM data expert and a trusted advisor helping admins safely restore CRM data from backups.',
          '',
          'You are given a diff plan — the set of changes that would be applied if a snapshot restore were executed.',
          'Your role is to classify each group of changes by risk level and explain the impact in plain English.',
          '',
          'Operation semantics:',
          '- INSERT: records present in the snapshot but missing from the live org (likely deleted accidentally — restoring them re-creates them)',
          '- UPDATE: records present in both — the snapshot values would overwrite the current live values',
          '- SKIP-DELETE: records present in the live org but not in the snapshot — these are NEW records created after the snapshot was taken; they will NOT be deleted',
          '',
          'Verdict guidelines:',
          '- safe: low-volume changes, non-critical objects (e.g. Notes, Tasks, custom objects with no downstream effects)',
          '- review: medium volume, business-critical objects (Account, Contact, Opportunity, Lead, Case), or any UPDATE that could overwrite important recent data',
          '- skip: high risk — Profile, PermissionSet, User, or any auth/security object; mass UPDATE (>1000 records) on critical objects; any change that looks irreversible without a second backup',
          '',
          'Be concise. Admins are busy. Do not repeat the numbers unless necessary for clarity.',
        ].join('\n'),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (!response.parsed_output) {
    throw new Error('Claude returned no structured output for diff explanation');
  }
  const parsed = response.parsed_output;

  log.info('explainDiff: received explanation', {
    planId: diffPlan.id,
    overallVerdict: parsed.overallVerdict,
    entityCount: parsed.entities.length,
    warningCount: parsed.warnings.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return parsed;
}
