/**
 * Per-tenant minimum-interval rate limiter.
 *
 * In-memory only — resets on process restart, not shared across replicas.
 * Good enough to cap AI tool-call abuse against a single Anthropic key on
 * a single-replica hackathon deploy. Not a substitute for a real per-key
 * quota at the API gateway when scale matters.
 */

const buckets = new Map<string, Map<string, number>>();

export interface RateLimitOk {
  ok: true;
}
export interface RateLimitDenied {
  ok: false;
  retryAfterMs: number;
}

export function rateLimit(opts: {
  /** Logical bucket name, e.g. "agent:setup". */
  key: string;
  /** Tenant (or any caller-identity) ID to scope the limit per. */
  tenantId: string;
  /** Minimum gap between successful requests, in ms. */
  minIntervalMs: number;
}): RateLimitOk | RateLimitDenied {
  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = new Map();
    buckets.set(opts.key, bucket);
  }
  const now = Date.now();
  const last = bucket.get(opts.tenantId) ?? 0;
  const elapsed = now - last;
  if (elapsed < opts.minIntervalMs) {
    return { ok: false, retryAfterMs: opts.minIntervalMs - elapsed };
  }
  bucket.set(opts.tenantId, now);
  return { ok: true };
}
