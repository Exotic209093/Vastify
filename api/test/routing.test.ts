import { describe, test, expect } from 'bun:test';
import { decide, explainDecision } from '../src/routing/engine.ts';
import type { RoutingRule } from '../src/routing/types.ts';

const T = 'demo';
const rule = (over: Partial<RoutingRule>): RoutingRule => ({
  id: over.id ?? crypto.randomUUID(),
  tenantId: T,
  priority: over.priority ?? 100,
  match: over.match!,
  target: over.target ?? { backendId: 'minio', storageClass: 'STANDARD' },
  enabled: over.enabled ?? true,
});

describe('RoutingEngine', () => {
  test('no rules → fallback minio STANDARD', () => {
    const d = decide({ tenantId: T, kind: 'file' }, []);
    expect(d).toEqual({ backendId: 'minio', storageClass: 'STANDARD', ruleId: null });
  });

  test('first matching rule wins by priority (lower = earlier)', () => {
    const a = rule({
      priority: 10,
      match: { kind: 'file' },
      target: { backendId: 'gcs', storageClass: 'STANDARD' },
    });
    const b = rule({
      priority: 20,
      match: { kind: 'file' },
      target: { backendId: 's3', storageClass: 'NEARLINE' },
    });
    const d = decide({ tenantId: T, kind: 'file' }, [b, a]);
    expect(d.ruleId).toBe(a.id);
    expect(d.backendId).toBe('gcs');
  });

  test('disabled rule is skipped', () => {
    const skipped = rule({
      priority: 5,
      enabled: false,
      match: { kind: 'file' },
      target: { backendId: 'azure', storageClass: 'ARCHIVE' },
    });
    const live = rule({
      priority: 10,
      match: { kind: 'file' },
      target: { backendId: 'gcs', storageClass: 'STANDARD' },
    });
    const d = decide({ tenantId: T, kind: 'file' }, [skipped, live]);
    expect(d.ruleId).toBe(live.id);
  });

  test('foreign tenant rules are ignored', () => {
    const foreign = rule({ priority: 1, match: { kind: 'file' } });
    foreign.tenantId = 'other';
    const d = decide({ tenantId: T, kind: 'file' }, [foreign]);
    expect(d.ruleId).toBe(null);
  });

  test('mime regex matches only when context provides mime', () => {
    const img = rule({
      priority: 10,
      match: { kind: 'file', mimeRegex: '^image/' },
      target: { backendId: 'gcs', storageClass: 'STANDARD' },
    });
    const hit = decide({ tenantId: T, kind: 'file', mime: 'image/png' }, [img]);
    expect(hit.ruleId).toBe(img.id);
    const miss = decide({ tenantId: T, kind: 'file', mime: 'application/pdf' }, [img]);
    expect(miss.ruleId).toBe(null);
    const noMime = decide({ tenantId: T, kind: 'file' }, [img]);
    expect(noMime.ruleId).toBe(null);
  });

  test('sizeBytesMin enforces inclusive lower bound', () => {
    const large = rule({
      priority: 10,
      match: { kind: 'file', sizeBytesMin: 10 },
      target: { backendId: 'gcs', storageClass: 'COLDLINE' },
    });
    expect(decide({ tenantId: T, kind: 'file', sizeBytes: 9 }, [large]).ruleId).toBe(null);
    expect(decide({ tenantId: T, kind: 'file', sizeBytes: 10 }, [large]).ruleId).toBe(large.id);
    expect(decide({ tenantId: T, kind: 'file', sizeBytes: 100 }, [large]).ruleId).toBe(large.id);
  });

  test('ageDaysMin routes old records to ARCHIVE', () => {
    const cold = rule({
      priority: 10,
      match: { kind: 'record', ageDaysMin: 90 },
      target: { backendId: 'gcs', storageClass: 'ARCHIVE' },
    });
    const hot = rule({
      priority: 20,
      match: { kind: 'record' },
      target: { backendId: 'gcs', storageClass: 'STANDARD' },
    });
    expect(decide({ tenantId: T, kind: 'record', ageDays: 120 }, [cold, hot]).storageClass).toBe('ARCHIVE');
    expect(decide({ tenantId: T, kind: 'record', ageDays: 10 }, [cold, hot]).storageClass).toBe('STANDARD');
  });

  test('entity match routes only matching records', () => {
    const interactionsOnly = rule({
      priority: 10,
      match: { kind: 'record', entity: 'Interaction' },
      target: { backendId: 'azure', storageClass: 'NEARLINE' },
    });
    expect(decide({ tenantId: T, kind: 'record', entity: 'Interaction' }, [interactionsOnly]).ruleId).toBe(
      interactionsOnly.id,
    );
    expect(decide({ tenantId: T, kind: 'record', entity: 'Other' }, [interactionsOnly]).ruleId).toBe(null);
  });

  test('explainDecision reports every rule evaluation', () => {
    const a = rule({ priority: 10, match: { kind: 'file', mimeRegex: '^image/' } });
    const b = rule({ priority: 20, match: { kind: 'file' } });
    const { decision, considered } = explainDecision(
      { tenantId: T, kind: 'file', mime: 'application/pdf' },
      [a, b],
    );
    expect(considered).toHaveLength(2);
    expect(considered[0].matched).toBe(false);
    expect(considered[1].matched).toBe(true);
    expect(decision.ruleId).toBe(b.id);
  });
});
