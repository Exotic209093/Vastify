import { describe, it, expect, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { RestoreExecutor } from '../restore-executor.js';
import type { CRMAdapter, CrmRecord, IdRemap } from '../crm/types.js';
import type { DiffPlanDocument } from '../diff-types.js';

function hashIds(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

function makeAdapter(
  targetIds: Record<string, string[]>,
  upsertImpl?: (obj: string, record: CrmRecord, remap: IdRemap) => Promise<string>,
): CRMAdapter {
  return {
    listObjects: mock(() => Promise.resolve([])),
    describe: mock(),
    queryRecords: mock(async function* (objectName: string) {
      for (const id of targetIds[objectName] ?? []) yield { Id: id };
    }) as CRMAdapter['queryRecords'],
    downloadFile: mock(),
    upsertRecord: upsertImpl ?? mock(() => Promise.resolve('new-id')),
    deployMetadata: mock(),
    uploadFile: mock(),
  };
}

function makeDoc(targetStateHash: string, overrides: Partial<DiffPlanDocument> = {}): DiffPlanDocument {
  return {
    id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
    targetStateHash, builtAt: 1000,
    objectOrder: ['Account', 'Contact'],
    changes: [
      { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-acc-1', Name: 'Acme' }, targetId: null },
      { op: 'update', objectName: 'Contact', sourceRecord: { Id: 'src-con-1', AccountId: 'src-acc-1' }, targetId: 'tgt-con-1' },
      { op: 'skip-delete', objectName: 'Contact', sourceRecord: {}, targetId: 'ghost-001' },
    ],
    counts: { insert: 1, update: 1, skipDelete: 1 },
    ...overrides,
  };
}

describe('RestoreExecutor', () => {
  it('applies inserts and updates; counts skip-deletes as skipped', async () => {
    const targetIds = { Account: [], Contact: ['tgt-con-1', 'ghost-001'] };
    const hash = hashIds(['tgt-con-1', 'ghost-001']);
    const upsertRecord = mock(() => Promise.resolve('new-tgt-acc-1'));
    const adapter = makeAdapter(targetIds, upsertRecord);

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc: makeDoc(hash), targetAdapter: adapter, dryRun: false });

    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(upsertRecord).toHaveBeenCalledTimes(2);
  });

  it('dry-run: passes drift check but makes no writes', async () => {
    const targetIds = { Account: [], Contact: ['tgt-con-1', 'ghost-001'] };
    const hash = hashIds(['tgt-con-1', 'ghost-001']);
    const upsertRecord = mock(() => Promise.resolve(''));
    const adapter = makeAdapter(targetIds, upsertRecord);

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc: makeDoc(hash), targetAdapter: adapter, dryRun: true });

    expect(upsertRecord).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('throws on drift: target state changed since diff was built', async () => {
    const targetIds = { Account: ['unexpected-new-record'], Contact: [] };
    const staleHash = hashIds(['tgt-con-1']);
    const adapter = makeAdapter(targetIds);

    const executor = new RestoreExecutor();
    await expect(
      executor.execute({ doc: makeDoc(staleHash), targetAdapter: adapter, dryRun: false }),
    ).rejects.toThrow('drifted');
  });

  it('records idRemap from insert so child records can reference parent', async () => {
    const hash = hashIds([]);
    const doc: DiffPlanDocument = {
      id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
      targetStateHash: hash, builtAt: 1000, objectOrder: ['Account'],
      changes: [{ op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-1' }, targetId: null }],
      counts: { insert: 1, update: 0, skipDelete: 0 },
    };
    const adapter = makeAdapter({ Account: [] }, async () => 'tgt-assigned-1');
    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc, targetAdapter: adapter, dryRun: false });

    expect(result.idRemap['src-1']).toBe('tgt-assigned-1');
  });

  it('continues past individual record failures; counts them', async () => {
    const hash = hashIds([]);
    const doc: DiffPlanDocument = {
      id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-t',
      targetStateHash: hash, builtAt: 1000, objectOrder: ['Account'],
      changes: [
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-1' }, targetId: null },
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'src-2' }, targetId: null },
      ],
      counts: { insert: 2, update: 0, skipDelete: 0 },
    };

    let callCount = 0;
    const adapter = makeAdapter({ Account: [] }, async () => {
      callCount++;
      if (callCount === 1) throw new Error('CRM API rate limit');
      return 'tgt-2';
    });

    const executor = new RestoreExecutor();
    const result = await executor.execute({ doc, targetAdapter: adapter, dryRun: false });

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.message).toContain('rate limit');
  });
});
