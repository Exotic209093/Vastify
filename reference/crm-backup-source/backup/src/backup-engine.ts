import type { BackupRepo } from '@infinity-docs/persistence';
import type { ConnectedOrg } from '@infinity-docs/shared';
import type { Logger } from 'pino';
import type { CRMAdapter } from './crm/types.js';
import type { CredentialVault } from './credential-vault.js';
import type { GitSync } from './git-sync.js';
import { SalesforceAdapter } from './crm/salesforce-adapter.js';
import { HubSpotAdapter } from './crm/hubspot-adapter.js';
import { walkSchema } from './schema-walker.js';
import { captureSnapshot, type SnapshotCaptureOptions } from './snapshot-capture.js';

export interface BackupEngineOptions {
  repo: BackupRepo;
  vault: CredentialVault;
  gitSync: GitSync;
  snapshotCapture: SnapshotCaptureOptions;
  log: Logger;
  /** Injectable adapter factory — used in tests to swap in mocks */
  adapterFactory?: (org: ConnectedOrg, accessToken: string) => CRMAdapter;
}

export class BackupEngine {
  constructor(private opts: BackupEngineOptions) {}

  private createAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
    return this.opts.adapterFactory?.(org, accessToken) ?? createCrmAdapter(org, accessToken);
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
      const adapter = this.createAdapter(org, accessToken);
      const graph = await walkSchema(adapter, scope.rootObject, scope.maxDepth);

      const result = await captureSnapshot(
        adapter, scope, graph, snapshotId, snap.tenantId, this.opts.snapshotCapture,
      );

      let gitCommitSha: string | null = null;
      try {
        const gitResult = await this.opts.gitSync.commitSnapshot(
          snap.tenantId, org, snapshotId, scope.name, graph,
        );
        gitCommitSha = gitResult.commitSha;
      } catch (err) {
        this.opts.log.warn({ err, snapshotId }, 'git sync failed — snapshot still saved');
      }

      this.opts.repo.snapshots.updateStatus(snapshotId, 'complete', {
        archiveStorageKey: result.archiveStorageKey,
        archiveStorageAdapter: 'local',
        recordCount: result.recordCount,
        fileCount: result.fileCount,
        metadataItemCount: result.metadataItemCount,
        sizeBytes: result.sizeBytes,
        completedAt: Date.now(),
        ...(gitCommitSha !== null && { gitCommitSha }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log.error({ err, snapshotId }, 'snapshot engine failed');
      this.opts.repo.snapshots.updateStatus(snapshotId, 'failed', {
        completedAt: Date.now(),
        error: message,
      });
      throw err;
    }
  }
}

export function createCrmAdapter(org: ConnectedOrg, accessToken: string): CRMAdapter {
  if (org.crmType === 'salesforce') {
    return new SalesforceAdapter(org.instanceUrl, () => Promise.resolve(accessToken));
  }
  if (org.crmType === 'hubspot') {
    return new HubSpotAdapter(() => Promise.resolve(accessToken));
  }
  const _exhaustive: never = org.crmType;
  throw new Error(`Unsupported CRM type: ${_exhaustive}`);
}
