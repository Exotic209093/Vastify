import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { RemoteWithoutRefs } from 'simple-git';
import type { ConnectedOrg } from '@infinity-docs/shared';
import type { SchemaGraph } from './schema-walker.js';

export interface GitSyncOptions {
  gitDataDir: string;
}

export interface GitCommitResult {
  commitSha: string;
}

export class GitSync {
  constructor(private opts: GitSyncOptions) {}

  private readonly initPromises = new Map<string, Promise<void>>();

  private repoPath(tenantId: string): string {
    return join(this.opts.gitDataDir, tenantId);
  }

  private branchName(org: ConnectedOrg): string {
    return `${org.crmType}-${org.externalOrgId}`;
  }

  private ensureRepo(repoPath: string, git: SimpleGit): Promise<void> {
    let p = this.initPromises.get(repoPath);
    if (!p) {
      p = this.doInit(repoPath, git);
      this.initPromises.set(repoPath, p);
    }
    return p;
  }

  private async doInit(repoPath: string, git: SimpleGit): Promise<void> {
    if (!existsSync(join(repoPath, '.git'))) {
      await git.init();
      await git.addConfig('user.email', 'backup-bot@infinity-docs.local');
      await git.addConfig('user.name', 'Infinity Docs Backup Bot');
      writeFileSync(join(repoPath, '.gitkeep'), '');
      await git.add('.gitkeep');
      await git.commit('chore: init backup repo');
    } else {
      await git.addConfig('user.email', 'backup-bot@infinity-docs.local');
      await git.addConfig('user.name', 'Infinity Docs Backup Bot');
    }
  }

  async commitSnapshot(
    tenantId: string,
    org: ConnectedOrg,
    snapshotId: string,
    scopeName: string,
    graph: SchemaGraph,
  ): Promise<GitCommitResult> {
    const repoPath = this.repoPath(tenantId);
    mkdirSync(repoPath, { recursive: true });

    const git = simpleGit(repoPath);
    await this.ensureRepo(repoPath, git);

    const branch = this.branchName(org);
    const branches = await git.branchLocal();
    if (branches.all.includes(branch)) {
      await git.checkout(branch);
    } else {
      await git.checkoutLocalBranch(branch);
    }

    // Write metadata files
    const objectsDir = join(repoPath, 'metadata', 'objects');
    mkdirSync(objectsDir, { recursive: true });
    for (const [objectName, node] of graph.nodes) {
      writeFileSync(
        join(objectsDir, `${objectName}.json`),
        JSON.stringify({ objectName, fields: node.fields }, null, 2),
      );
    }

    // Write manifest
    writeFileSync(
      join(repoPath, 'manifest.json'),
      JSON.stringify({ snapshotId, scopeName, capturedAt: new Date().toISOString() }, null, 2),
    );

    await git.add('.');
    const status = await git.status();
    if (status.staged.length === 0) {
      const log = await git.log(['--max-count=1']);
      return { commitSha: log.latest?.hash ?? '' };
    }
    const commitResult = await git.commit(
      `snapshot ${snapshotId} — ${scopeName} — ${graph.nodes.size} metadata items`,
    );

    // Best-effort remote push — failure is non-fatal
    if (org.gitRemoteUrl) {
      try {
        const remotes = await git.getRemotes();
        if (!remotes.find((r: RemoteWithoutRefs) => r.name === 'origin')) {
          await git.addRemote('origin', org.gitRemoteUrl);
        }
        await git.push('origin', branch);
      } catch {
        // push failures are surfaced by callers via their own logging
      }
    }

    return { commitSha: commitResult.commit };
  }
}
