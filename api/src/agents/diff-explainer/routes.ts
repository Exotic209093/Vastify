import { Hono } from 'hono';
import { z } from 'zod';
import { requireApiKey, tenantOf } from '../../auth/api-key.js';
import { getDb } from '../../db/client.js';
import { getBackends } from '../../object/registry.js';
import { createBackupRepo } from '../../backup/repo.js';
import { DiffPlanStore } from '../../backup/diff-plan-store.js';
import { log } from '../../util/logger.js';
import { explainDiff } from './explainer.js';
import type { DiffPlanDocument } from '../../backup/diff-types.js';
import type { ObjectBackend } from '../../object/backend.js';

// ── Lazy singletons ────────────────────────────────────────────────────────────

let _repo: ReturnType<typeof createBackupRepo> | undefined;
let _diffPlanStore: DiffPlanStore | undefined;

function getRepo() {
  if (!_repo) _repo = createBackupRepo(getDb());
  return _repo;
}

function getBackend(): ObjectBackend {
  const backends = getBackends();
  const backend = backends.values().next().value as ObjectBackend | undefined;
  if (!backend) throw new Error('No storage backend configured');
  return backend;
}

function getDiffPlanStore() {
  if (!_diffPlanStore) _diffPlanStore = new DiffPlanStore(getBackend());
  return _diffPlanStore;
}

// ── Request schema ─────────────────────────────────────────────────────────────

/**
 * Two modes:
 *  1. planId — look up a pre-built DiffPlan from DB + object storage
 *  2. rawChanges — inline DiffPlanDocument for cases where the caller already
 *     has the data (e.g. freshly built in-memory plan not yet persisted)
 */
const ExplainDiffRequestSchema = z.union([
  z.object({
    planId: z.string().min(1),
    rawChanges: z.undefined().optional(),
  }),
  z.object({
    planId: z.undefined().optional(),
    rawChanges: z.object({
      id: z.string(),
      snapshotId: z.string(),
      tenantId: z.string(),
      targetOrgId: z.string(),
      targetStateHash: z.string(),
      builtAt: z.number(),
      objectOrder: z.array(z.string()),
      changes: z.array(z.object({
        op: z.enum(['insert', 'update', 'skip-delete']),
        objectName: z.string(),
        sourceRecord: z.record(z.string(), z.unknown()),
        targetId: z.string().nullable(),
      })),
      counts: z.object({
        insert: z.number(),
        update: z.number(),
        skipDelete: z.number(),
      }),
    }),
  }),
]);

// ── Router ─────────────────────────────────────────────────────────────────────

export const diffExplainerRoutes = new Hono();

diffExplainerRoutes.use('*', requireApiKey);

diffExplainerRoutes.post('/explain-diff', async (c) => {
  const tenantId = tenantOf(c);

  // Parse + validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = ExplainDiffRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.issues }, 400);
  }

  const { planId, rawChanges } = parsed.data;

  let diffPlan: DiffPlanDocument;
  let snapshotId: string;
  let targetOrgId: string;

  if (rawChanges) {
    // Inline path — verify tenant ownership
    if (rawChanges.tenantId !== tenantId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    diffPlan = rawChanges as DiffPlanDocument;
    snapshotId = rawChanges.snapshotId;
    targetOrgId = rawChanges.targetOrgId;
  } else {
    // DB lookup path
    const repo = getRepo();
    const planRecord = repo.diffPlans.findById(planId!);
    if (!planRecord) {
      return c.json({ error: 'not_found', resource: 'diff_plan' }, 404);
    }
    if (planRecord.tenantId !== tenantId) {
      return c.json({ error: 'forbidden' }, 403);
    }

    try {
      diffPlan = await getDiffPlanStore().load(planRecord.storageKey);
    } catch (err) {
      log.error('explainDiff: failed to load diff plan from storage', {
        planId: planRecord.id,
        storageKey: planRecord.storageKey,
        err: String(err),
      });
      return c.json({ error: 'storage_error', detail: 'Could not retrieve diff plan data' }, 500);
    }

    snapshotId = planRecord.snapshotId;
    targetOrgId = planRecord.targetOrgId;
  }

  // Fetch snapshot + target org for context
  const repo = getRepo();

  const snapshot = repo.snapshots.findById(snapshotId);
  if (!snapshot) {
    return c.json({ error: 'not_found', resource: 'snapshot' }, 404);
  }
  if (snapshot.tenantId !== tenantId) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const org = repo.connectedOrgs.findById(targetOrgId);
  if (!org) {
    return c.json({ error: 'not_found', resource: 'connected_org' }, 404);
  }
  if (org.tenantId !== tenantId) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Call Claude
  try {
    const explanation = await explainDiff(diffPlan, snapshot, {
      displayName: org.displayName,
      instanceUrl: org.instanceUrl,
      isSandbox: org.isSandbox,
      crmType: org.crmType,
    });

    return c.json({ explanation });
  } catch (err) {
    log.error('explainDiff: Claude call failed', { planId: diffPlan.id, err: String(err) });
    return c.json({ error: 'ai_error', detail: 'Failed to generate explanation' }, 502);
  }
});
