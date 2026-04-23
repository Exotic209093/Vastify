import type { ObjectBackend } from '../object/backend.js';
import type { DiffPlanDocument } from './diff-types.js';

export class DiffPlanStore {
  constructor(private backend: ObjectBackend) {}

  async save(tenantId: string, planId: string, doc: DiffPlanDocument): Promise<string> {
    const storageKey = `tenants/${tenantId}/diff-plans/${planId}.json`;
    const json = JSON.stringify(doc);
    const bytes = new TextEncoder().encode(json);
    await this.backend.put(storageKey, bytes, { storageClass: 'STANDARD', contentType: 'application/json' });
    return storageKey;
  }

  async load(storageKey: string): Promise<DiffPlanDocument> {
    const bytes = await this.backend.get(storageKey);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as DiffPlanDocument;
  }
}
