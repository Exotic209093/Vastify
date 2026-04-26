import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireApiKey, tenantOf } from '../../auth/api-key.ts';
import { runSetupAgent } from './runner.ts';
import { log } from '../../util/logger.ts';
import { loadConfig } from '../../config.ts';
import { rateLimit } from '../../util/rate-limit.ts';

export const setupAgentRoutes = new Hono();

setupAgentRoutes.use('*', requireApiKey);

// POST /v1/agents/setup/run
// Body: {} | { orgHint?: string }
// Returns: SSE stream of agent events
setupAgentRoutes.post('/run', (c) => {
  // Guard: key must be present before we attempt to stream anything.
  if (!loadConfig().anthropicApiKey) {
    return c.json(
      {
        error: 'service_unavailable',
        message:
          'ANTHROPIC_API_KEY is not configured. Set it in api/.env and restart the server.',
      },
      503,
    );
  }

  const tenantId = tenantOf(c);

  // One Setup Agent run per tenant per 30s. A full run takes ~30s of tool calls,
  // so this caps a tenant at ~120 runs/hour on the live Anthropic key.
  const limit = rateLimit({ key: 'agent:setup', tenantId, minIntervalMs: 30_000 });
  if (!limit.ok) {
    c.header('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
    return c.json(
      { error: 'rate_limited', retryAfterMs: limit.retryAfterMs },
      429,
    );
  }

  return streamSSE(c, async (stream) => {
    let eventId = 0;

    const send = async (eventName: string, data: unknown): Promise<void> => {
      await stream.writeSSE({
        id: String(eventId++),
        event: eventName,
        data: JSON.stringify(data),
      });
    };

    // Wire an AbortController so we can cancel the runner when the client
    // disconnects mid-stream.
    const controller = new AbortController();
    stream.onAbort(() => {
      log.info('setup agent: client disconnected, aborting run', { tenantId });
      controller.abort();
    });

    // Parse optional body — non-fatal if missing or malformed.
    let orgHint: string | undefined;
    try {
      const body = (await c.req.json().catch(() => ({}))) as { orgHint?: unknown };
      if (typeof body.orgHint === 'string' && body.orgHint.trim()) {
        orgHint = body.orgHint.trim();
      }
    } catch {
      // Body parsing failure is not an error; proceed without orgHint.
    }

    log.info('setup agent: SSE connection open', { tenantId, orgHint });

    // Heartbeat every 5s — keeps the SSE stream alive during long tool waits
    // (e.g. generate_starter_rules sleeps 17s) and across any flaky proxy.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: 'ping', data: JSON.stringify({ at: Date.now() }) }).catch(() => {});
    }, 5_000);
    stream.onAbort(() => clearInterval(heartbeat));

    try {
      for await (const event of runSetupAgent({ orgHint, signal: controller.signal, tenantId })) {
        if (controller.signal.aborted) break;

        switch (event.kind) {
          case 'tool_use_started':
            await send('tool_use_started', {
              id: event.id,
              name: event.name,
              input: event.input,
              startedAt: event.startedAt,
            });
            break;

          case 'tool_use_completed':
            await send('tool_use_completed', {
              id: event.id,
              name: event.name,
              output: event.output,
              elapsedMs: event.elapsedMs,
            });
            break;

          case 'agent_text':
            await send('agent_text', { delta: event.delta });
            break;

          case 'done':
            await send('done', {
              totalToolCalls: event.totalToolCalls,
              totalElapsedMs: event.totalElapsedMs,
              summary: event.summary,
            });
            break;

          case 'error':
            await send('error', { message: event.message });
            break;
        }
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'unexpected error';
      log.error('setup agent: stream error', { tenantId, err: msg });
      try {
        await send('error', { message: msg });
      } catch {
        // Stream may already be closed; nothing to do.
      }
    } finally {
      clearInterval(heartbeat);
    }
  });
});
