import { describe, it, expect, mock } from 'bun:test';
import { DiffPlanStore } from '../diff-plan-store.js';
import type { DiffPlanDocument } from '../diff-types.js';
import type { ObjectBackend } from '../../object/backend.js';

function makeDoc(overrides: Partial<DiffPlanDocument> = {}): DiffPlanDocument {
  return {
    id: 'plan-1', snapshotId: 'snap-1', tenantId: 'tenant-a', targetOrgId: 'org-1',
    targetStateHash: 'abc123', builtAt: 1000,
    objectOrder: ['Account', 'Contact'],
    changes: [{ op: 'insert', objectName: 'Account', sourceRecord: { Id: 'acc-1', Name: 'Acme' }, targetId: null }],
    counts: { insert: 1, update: 0, skipDelete: 0 },
    ...overrides,
  };
}

function makeBackend(): { backend: ObjectBackend; storage: Map<string, Uint8Array> } {
  const storage = new Map<string, Uint8Array>();
  const backend: ObjectBackend = {
    put: mock(async (key: string, body: Uint8Array) => {
      storage.set(key, body);
      return { key, backendId: 'test', storageClass: 'STANDARD' };
    }),
    get: mock(async (key: string) => {
      const data = storage.get(key);
      if (!data) throw new Error(`Key not found: ${key}`);
      return data;
    }),
    presignGet: mock(async () => ''),
    delete: mock(async () => {}),
    setStorageClass: mock(async () => {}),
    list: mock(async function* () {}),
  } as unknown as ObjectBackend;
  return { backend, storage };
}

describe('DiffPlanStore', () => {
  it('round-trips a DiffPlanDocument through the backend', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const doc = makeDoc();

    const storageKey = await store.save('tenant-a', 'plan-1', doc);
    expect(storageKey).toBe('tenants/tenant-a/diff-plans/plan-1.json');

    const loaded = await store.load(storageKey);
    expect(loaded).toEqual(doc);
  });

  it('preserves the full changes array', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const doc = makeDoc({
      changes: [
        { op: 'insert', objectName: 'Account', sourceRecord: { Id: 'a1' }, targetId: null },
        { op: 'update', objectName: 'Contact', sourceRecord: { Id: 'c1', AccountId: 'a1' }, targetId: 'tgt-c1' },
        { op: 'skip-delete', objectName: 'Contact', sourceRecord: {}, targetId: 'ghost-01' },
      ],
      counts: { insert: 1, update: 1, skipDelete: 1 },
    });

    const key = await store.save('tenant-a', 'plan-2', doc);
    const loaded = await store.load(key);
    expect(loaded.changes).toHaveLength(3);
    expect(loaded.changes[0]?.op).toBe('insert');
    expect(loaded.changes[1]?.op).toBe('update');
    expect(loaded.changes[2]?.op).toBe('skip-delete');
  });

  it('uses tenant-scoped key so two tenants do not collide', async () => {
    const { backend } = makeBackend();
    const store = new DiffPlanStore(backend);
    const key1 = await store.save('tenant-a', 'plan-1', makeDoc());
    const key2 = await store.save('tenant-b', 'plan-1', makeDoc({ tenantId: 'tenant-b' }));
    expect(key1).not.toBe(key2);
    expect(key1.startsWith('tenants/tenant-a/')).toBe(true);
    expect(key2.startsWith('tenants/tenant-b/')).toBe(true);
  });
});
