import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BackupRepo } from '@infinity-docs/persistence';
import type { BackupEngine } from '@infinity-docs/backup';
import type { Snapshot } from '@infinity-docs/shared';

export interface BackupSnapshotRouteDeps {
  repo: BackupRepo;
  engine: BackupEngine;
}

interface TriggerBody {
  tenantId?: string;
  connectedOrgId?: string;
  scopeId?: string;
}

export function registerBackupSnapshotRoutes(
  app: FastifyInstance,
  deps: BackupSnapshotRouteDeps,
): void {
  // List snapshots for a tenant (optionally filtered by connectedOrgId)
  app.get(
    '/admin/api/backup/snapshots',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const q = req.query as { tenantId?: string; limit?: string };
      if (!q.tenantId) return reply.code(400).send({ error: 'tenantId required' });
      const limit = q.limit ? Number.parseInt(q.limit, 10) : 50;
      const snapshots = deps.repo.snapshots.findByTenant(
        q.tenantId,
        Number.isFinite(limit) ? limit : 50,
      );
      return { snapshots };
    },
  );

  // Get a single snapshot by ID
  app.get<{ Params: { id: string } }>(
    '/admin/api/backup/snapshots/:id',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const snap = deps.repo.snapshots.findById(req.params.id);
      if (!snap) return reply.code(404).send({ error: 'not found' });
      return snap;
    },
  );

  // Trigger a new snapshot (returns 202, runs async)
  app.post(
    '/admin/api/backup/snapshots',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const body = (req.body ?? {}) as TriggerBody;
      const { tenantId, connectedOrgId, scopeId } = body;

      if (!tenantId || !connectedOrgId || !scopeId) {
        return reply.code(400).send({ error: 'tenantId, connectedOrgId, scopeId required' });
      }

      const org = deps.repo.connectedOrgs.findById(connectedOrgId);
      if (!org) return reply.code(404).send({ error: 'connectedOrg not found' });

      const scope = deps.repo.backupScopes.findById(scopeId);
      if (!scope) return reply.code(404).send({ error: 'scope not found' });

      const snapshotId = randomUUID();
      const now = Date.now();

      const snap: Snapshot = {
        id: snapshotId,
        tenantId,
        connectedOrgId,
        backupScopeId: scopeId,
        status: 'pending',
        archiveStorageKey: null,
        archiveStorageAdapter: null,
        gitCommitSha: null,
        recordCount: null,
        fileCount: null,
        metadataItemCount: null,
        sizeBytes: null,
        startedAt: now,
        completedAt: null,
        error: null,
      };

      deps.repo.snapshots.insert(snap);

      // Fire and forget — caller polls GET /admin/api/backup/snapshots/:id for status
      setImmediate(() => {
        deps.engine.run(snapshotId).catch((err: unknown) => {
          req.log.error({ err, snapshotId }, 'BackupEngine.run error');
        });
      });

      return reply.code(202).send({ snapshotId });
    },
  );
}
