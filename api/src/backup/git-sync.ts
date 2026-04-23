import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { ConnectedOrg } from './types.js';
import type { SchemaGraph } from './schema-walker.js';

export interface GitSyncOptions {
  gitDataDir: string;
}

export interface GitCommitResult {
  commitSha: string;
}

export class GitSync {
  constructor(private opts: GitSyncOptions) {}

  private repoPath(tenantId: string): string {
    return join(this.opts.gitDataDir, tenantId);
  }

  private branchName(org: ConnectedOrg): string {
    return `${org.crmType}-${org.externalOrgId}`;
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
    await git.addConfig('user.email', 'backup-bot@vastify.local');
    await git.addConfig('user.name', 'Vastify Backup Bot');

    if (!existsSync(join(repoPath, '.git'))) {
      await git.init();
      writeFileSync(join(repoPath, '.gitkeep'), '');
      await git.add('.gitkeep');
      await git.commit('chore: init backup metadata repo');
    }

    const branch = this.branchName(org);
    const branches = await git.branchLocal();
    if (branches.all.includes(branch)) {
      await git.checkout(branch);
    } else {
      await git.checkoutLocalBranch(branch);
    }

    const objectsDir = join(repoPath, 'metadata', 'objects');
    mkdirSync(objectsDir, { recursive: true });
    for (const [objectName, node] of graph.nodes) {
      writeFileSync(
        join(objectsDir, `${objectName}.json`),
        JSON.stringify({ objectName, fields: node.fields }, null, 2),
      );
    }

    writeFileSync(
      join(repoPath, 'manifest.json'),
      JSON.stringify({ snapshotId, scopeName, capturedAt: new Date().toISOString() }, null, 2),
    );

    await git.add('.');
    const commitResult = await git.commit(
      `snapshot ${snapshotId} — ${scopeName} — ${graph.nodes.size} objects`,
    );

    // Best-effort remote push
    if (org.gitRemoteUrl) {
      try {
        const remotes = await git.getRemotes();
        if (!remotes.find((r) => r.name === 'origin')) {
          await git.addRemote('origin', org.gitRemoteUrl);
        }
        await git.push('origin', branch);
      } catch {
        // push failures are non-fatal
      }
    }

    return { commitSha: commitResult.commit };
  }
}
