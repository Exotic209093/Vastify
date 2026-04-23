import type { BackupRepo } from './repo.js';
import type { ConnectedOrg } from './types.js';
import type { CRMAdapter } from './crm/types.js';
import type { CredentialVault } from './credential-vault.js';
import type { GitSync } from './git-sync.js';
import type { ObjectBackend } from '../object/backend.js';
import { SalesforceAdapter } from './crm/salesforce-adapter.js';
import { HubSpotAdapter } from './crm/hubspot-adapter.js';
import { walkSchema } from './schema-walker.js';
import { captureSnapshot } from './snapshot-capture.js';

export interface BackupEngineOptions {
  repo: BackupRepo;
  vault: CredentialVault;
  gitSync: GitSync;
  backend: ObjectBackend;
  adapterFactory?: (org: ConnectedOrg, accessToken: string) => CRMAdapter;
}

export function createCrmAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
  if (org.crmType === 'salesforce') {
    return new SalesforceAdapter(org.instanceUrl, () => Promise.resolve(accessToken));
  }
  return new HubSpotAdapter(() => Promise.resolve(accessToken));
}

export class BackupEngine {
  constructor(private opts: BackupEngineOptions) {}

  private makeAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
    return this.opts.adapterFactory
      ? this.opts.adapterFactory(org, accessToken)
      : createCrmAdapter(org, accessToken);
  }

  async run(snapshotId: string): Promise<void> {
    const snap = this.opts.repo.snapshots.findById(snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

    const scope = this.opts.repo.backupScopes.findById(snap.backupScopeId);
    if (!scope) throw new Error(`BackupScope not found: ${snap.backupScopeId}`);

    const org = this.opts.repo.connectedOrgs.findById(snap.connectedOrgId);
    if (!org) throw new Error(`ConnectedOrg not found: ${snap.connectedOrgId}`);

    this.opts.repo.snapshots.updateStatus(snapshotId, 'running');

    try {
      const accessToken = await this.opts.vault.getAccessToken(snap.tenantId, snap.connectedOrgId);
      const adapter = this.makeAdapter(org, accessToken);
      const graph = await walkSchema(adapter, scope.rootObject, scope.maxDepth);
      const captureResult = await captureSnapshot(
        adapter, scope, graph, snapshotId, snap.tenantId, this.opts.backend,
      );

      let gitCommitSha: string | null = null;
      try {
        const gitResult = await this.opts.gitSync.commitSnapshot(
          snap.tenantId, org, snapshotId, scope.name, graph,
        );
        gitCommitSha = gitResult.commitSha;
      } catch {
        // git sync failure is non-fatal — snapshot is still saved
      }

      this.opts.repo.snapshots.updateStatus(snapshotId, 'complete', {
        archiveStorageKey: captureResult.archiveStorageKey,
        archiveBackendId: captureResult.archiveBackendId,
        recordCount: captureResult.recordCount,
        fileCount: captureResult.fileCount,
        metadataItemCount: captureResult.metadataItemCount,
        sizeBytes: captureResult.sizeBytes,
        completedAt: Date.now(),
        ...(gitCommitSha !== null && { gitCommitSha }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.repo.snapshots.updateStatus(snapshotId, 'failed', {
        completedAt: Date.now(),
        error: message,
      });
      throw err;
    }
  }
}
