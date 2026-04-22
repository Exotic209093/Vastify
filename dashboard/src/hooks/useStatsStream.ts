import { useEffect, useState } from 'react';
import type { TenantStats } from '../lib/api';
import { getApiBase, getApiKey } from '../lib/api';

/**
 * Connects to /v1/stats/events (SSE) and returns the latest snapshot.
 * EventSource can't set custom headers, so we fall back to polling /v1/stats
 * every 3s with the API-key header. That still gives a lively feel.
 */
export function useStatsStream(): { stats: TenantStats | null; error: string | null } {
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = getApiKey();

    async function poll() {
      try {
        const res = await fetch(`${getApiBase()}/v1/stats`, {
          headers: { 'X-Vastify-Api-Key': key },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as TenantStats;
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { stats, error };
}
