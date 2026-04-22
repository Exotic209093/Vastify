import type { RoutingContext, RoutingDecision, RoutingRule } from './types.ts';

const FALLBACK: Pick<RoutingDecision, 'backendId' | 'storageClass'> = {
  backendId: 'minio',
  storageClass: 'STANDARD',
};

function matches(rule: RoutingRule, ctx: RoutingContext): boolean {
  const m = rule.match;
  if (m.kind !== ctx.kind) return false;
  if (m.sizeBytesMax !== undefined && (ctx.sizeBytes ?? 0) > m.sizeBytesMax) return false;
  if (m.sizeBytesMin !== undefined && (ctx.sizeBytes ?? 0) < m.sizeBytesMin) return false;
  if (m.ageDaysMin !== undefined && (ctx.ageDays ?? 0) < m.ageDaysMin) return false;
  if (m.ageDaysMax !== undefined && (ctx.ageDays ?? Number.POSITIVE_INFINITY) > m.ageDaysMax) return false;
  if (m.mimeRegex !== undefined) {
    if (!ctx.mime) return false;
    if (!new RegExp(m.mimeRegex).test(ctx.mime)) return false;
  }
  if (m.entity !== undefined && m.entity !== ctx.entity) return false;
  return true;
}

/** Evaluate rules in priority order. First match wins. Disabled rules are skipped. */
export function decide(ctx: RoutingContext, rules: RoutingRule[]): RoutingDecision {
  const ordered = rules
    .filter((r) => r.enabled && r.tenantId === ctx.tenantId)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    if (matches(rule, ctx)) {
      return { backendId: rule.target.backendId, storageClass: rule.target.storageClass, ruleId: rule.id };
    }
  }
  return { ...FALLBACK, ruleId: null };
}

/** Test helper — preview the routing decision without hitting the DB. */
export function explainDecision(ctx: RoutingContext, rules: RoutingRule[]): {
  decision: RoutingDecision;
  considered: Array<{ rule: RoutingRule; matched: boolean }>;
} {
  const considered = rules
    .filter((r) => r.enabled && r.tenantId === ctx.tenantId)
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => ({ rule, matched: matches(rule, ctx) }));
  return { decision: decide(ctx, rules), considered };
}
