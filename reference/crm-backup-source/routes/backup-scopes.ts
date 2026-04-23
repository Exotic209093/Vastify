import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BackupRepo } from '@infinity-docs/persistence';
import type { BackupScope } from '@infinity-docs/shared';

export interface BackupScopeRouteDeps {
  repo: BackupRepo;
}

interface CreateScopeBody {
  tenantId?: string;
  connectedOrgId?: string;
  name?: string;
  rootObject?: string;
  maxDepth?: number;
  includeFiles?: boolean;
  includeMetadata?: boolean;
}

export function registerBackupScopeRoutes(app: FastifyInstance, deps: BackupScopeRouteDeps): void {
  // List scopes for a connected org
  app.get(
    '/admin/api/backup/scopes',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const q = req.query as { connectedOrgId?: string };
      if (!q.connectedOrgId) return reply.code(400).send({ error: 'connectedOrgId required' });
      return { scopes: deps.repo.backupScopes.findByOrg(q.connectedOrgId) };
    },
  );

  // Create a new scope
  app.post(
    '/admin/api/backup/scopes',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const body = (req.body ?? {}) as CreateScopeBody;
      const { tenantId, connectedOrgId, name, rootObject } = body;

      if (!tenantId || !connectedOrgId || !name || !rootObject) {
        return reply.code(400).send({ error: 'tenantId, connectedOrgId, name, rootObject required' });
      }

      const org = deps.repo.connectedOrgs.findById(connectedOrgId);
      if (!org) return reply.code(404).send({ error: 'connectedOrg not found' });

      const scope: BackupScope = {
        id: randomUUID(),
        tenantId,
        connectedOrgId,
        name,
        rootObject,
        maxDepth: typeof body.maxDepth === 'number' ? body.maxDepth : 3,
        includeFiles: body.includeFiles ?? true,
        includeMetadata: body.includeMetadata ?? true,
        createdAt: Date.now(),
      };

      deps.repo.backupScopes.insert(scope);
      return reply.code(201).send({ scopeId: scope.id });
    },
  );

  // Delete a scope
  app.delete<{ Params: { id: string } }>(
    '/admin/api/backup/scopes/:id',
    { preHandler: [app.requireAdmin] },
    async (req, reply) => {
      const scope = deps.repo.backupScopes.findById(req.params.id);
      if (!scope) return reply.code(404).send({ error: 'not found' });
      deps.repo.backupScopes.delete(req.params.id);
      return reply.code(204).send();
    },
  );
}
