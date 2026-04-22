import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireApiKey, tenantOf } from '../auth/api-key.ts';
import { computeStats } from './service.ts';
import { subscribeEvents } from '../events.ts';

export const statsRoutes = new Hono();

statsRoutes.use('*', requireApiKey);

// GET /v1/stats — snapshot JSON
statsRoutes.get('/', (c) => c.json(computeStats(tenantOf(c))));

// GET /v1/stats/events — SSE stream
// Emits an initial 'snapshot' event, then 'event' per domain event, then periodic 'snapshot' every 30s.
statsRoutes.get('/events', (c) => {
  const tenantId = tenantOf(c);
  return streamSSE(c, async (stream) => {
    let id = 0;
    const send = async (event: string, data: unknown) => {
      await stream.writeSSE({ id: String(id++), event, data: JSON.stringify(data) });
    };

    await send('snapshot', computeStats(tenantId));

    const unsubscribe = subscribeEvents((ev) => {
      if (ev.tenantId !== tenantId) return;
      void (async () => {
        try {
          await send('event', { kind: ev.kind, at: ev.at, payload: ev.payload });
          await send('snapshot', computeStats(tenantId));
        } catch {
          // stream may already be closed
        }
      })();
    });

    // Heartbeat every 15s so proxies don't idle-close.
    const heartbeat = setInterval(() => {
      void send('ping', { at: Date.now() }).catch(() => {});
    }, 15_000);

    stream.onAbort(() => {
      unsubscribe();
      clearInterval(heartbeat);
    });

    // Keep the stream open until aborted.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});
