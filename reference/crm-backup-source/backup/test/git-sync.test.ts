import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import simpleGit from 'simple-git';
import { GitSync } from '../src/git-sync.js';
import type { ConnectedOrg } from '@infinity-docs/shared';
import type { SchemaGraph } from '../src/schema-walker.js';
import type { FieldDescriptor } from '../src/crm/types.js';

function makeOrg(overrides: Partial<ConnectedOrg> = {}): ConnectedOrg {
  return {
    id: 'org-1', tenantId: 'tenant-a', crmType: 'salesforce',
    displayName: 'Acme Prod', instanceUrl: 'https://acme.my.salesforce.com',
    externalOrgId: '00Dxx001', isSandbox: false,
    oauthRefreshTokenEncrypted: 'enc', oauthAccessTokenCache: null,
    accessTokenExpiresAt: null, gitRemoteUrl: null,
    connectedAt: 1000, lastUsedAt: null,
    ...overrides,
  };
}

const sampleField: FieldDescriptor = {
  name: 'Id', label: 'ID', type: 'id', referenceTo: [], nillable: false, externalId: false,
};

function makeGraph(): SchemaGraph {
  return {
    rootObject: 'Account',
    nodes: new Map([
      ['Account', { objectName: 'Account', depth: 0, fields: [sampleField] }],
      ['Contact', { objectName: 'Contact', depth: 1, fields: [sampleField] }],
    ]),
    edges: [],
  };
}

describe('GitSync', () => {
  let gitDataDir: string;

  beforeEach(() => {
    gitDataDir = join(tmpdir(), `gitsync-test-${randomUUID()}`);
    mkdirSync(gitDataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(gitDataDir, { recursive: true, force: true });
  });

  it('creates a git repo and commits metadata on first call', async () => {
    const gitSync = new GitSync({ gitDataDir });
    const org = makeOrg();
    const graph = makeGraph();

    const result = await gitSync.commitSnapshot('tenant-a', org, 'snap-001', 'My Scope', graph);

    expect(result.commitSha).toBeTruthy();
    expect(result.commitSha.length).toBeGreaterThan(6);

    const repoPath = join(gitDataDir, 'tenant-a');
    expect(existsSync(join(repoPath, '.git'))).toBe(true);
    expect(existsSync(join(repoPath, 'metadata', 'objects', 'Account.json'))).toBe(true);
    expect(existsSync(join(repoPath, 'metadata', 'objects', 'Contact.json'))).toBe(true);
    expect(existsSync(join(repoPath, 'manifest.json'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(repoPath, 'manifest.json'), 'utf8')) as { snapshotId: string };
    expect(manifest.snapshotId).toBe('snap-001');
  });

  it('creates a branch named after the org', async () => {
    const gitSync = new GitSync({ gitDataDir });
    const org = makeOrg();
    const graph = makeGraph();

    await gitSync.commitSnapshot('tenant-a', org, 'snap-001', 'My Scope', graph);

    const repoPath = join(gitDataDir, 'tenant-a');
    const git = simpleGit(repoPath);
    const branches = await git.branchLocal();
    expect(branches.all).toContain('salesforce-00Dxx001');
  });

  it('creates a second commit on the same branch for subsequent snapshots', async () => {
    const gitSync = new GitSync({ gitDataDir });
    const org = makeOrg();
    const graph = makeGraph();

    await gitSync.commitSnapshot('tenant-a', org, 'snap-001', 'Scope A', graph);
    await gitSync.commitSnapshot('tenant-a', org, 'snap-002', 'Scope A', graph);

    const repoPath = join(gitDataDir, 'tenant-a');
    const git = simpleGit(repoPath);
    const log = await git.log(['--max-count=10']);
    expect(log.all.length).toBeGreaterThanOrEqual(2);
  });

  it('uses separate branches for different orgs in the same tenant', async () => {
    const gitSync = new GitSync({ gitDataDir });
    const org1 = makeOrg({ externalOrgId: 'ORG1' });
    const org2 = makeOrg({ externalOrgId: 'ORG2' });
    const graph = makeGraph();

    await gitSync.commitSnapshot('tenant-a', org1, 'snap-001', 'Scope', graph);
    await gitSync.commitSnapshot('tenant-a', org2, 'snap-002', 'Scope', graph);

    const repoPath = join(gitDataDir, 'tenant-a');
    const git = simpleGit(repoPath);
    const branches = await git.branchLocal();
    expect(branches.all).toContain('salesforce-ORG1');
    expect(branches.all).toContain('salesforce-ORG2');
  });
});
