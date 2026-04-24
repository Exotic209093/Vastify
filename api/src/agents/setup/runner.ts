import { getAnthropic, modelId } from '../shared/client.ts';
import { setupTools } from './tools.ts';
import { log } from '../../util/logger.ts';

// ---------------------------------------------------------------------------
// Normalised SSE event shapes emitted by the runner
// ---------------------------------------------------------------------------

export interface ToolUseStartedEvent {
  kind: 'tool_use_started';
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: number;
}

export interface ToolUseCompletedEvent {
  kind: 'tool_use_completed';
  id: string;
  name: string;
  output: unknown;
  elapsedMs: number;
}

export interface AgentTextEvent {
  kind: 'agent_text';
  delta: string;
}

export interface DoneEvent {
  kind: 'done';
  totalToolCalls: number;
  totalElapsedMs: number;
  summary: string;
}

export interface ErrorEvent {
  kind: 'error';
  message: string;
}

export type AgentEvent =
  | ToolUseStartedEvent
  | ToolUseCompletedEvent
  | AgentTextEvent
  | DoneEvent
  | ErrorEvent;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are the Vastify setup agent. A new tenant just clicked 'set me up'. Your job: in 6 tool calls, inspect their Salesforce org, pick the cheapest cloud backend, write the storage config, generate starter routing rules from what you see in the org, deploy the Salesforce package, and validate the connection. Always call inspect_org first. Be concise — one or two short sentences between tool calls maximum. Finish with a one-line confirmation.";

// ---------------------------------------------------------------------------
// runSetupAgent
// Yields normalised AgentEvents for the route to forward over SSE.
// ---------------------------------------------------------------------------

export async function* runSetupAgent(
  opts: {
    orgHint?: string;
    signal?: AbortSignal;
    tenantId: string;
  },
): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();
  let totalToolCalls = 0;
  let summaryText = '';

  let client: ReturnType<typeof getAnthropic>;
  try {
    client = getAnthropic();
  } catch (err) {
    yield {
      kind: 'error',
      message: (err as Error).message,
    };
    return;
  }

  const initialMessages: { role: 'user'; content: string }[] = [
    {
      role: 'user',
      content: opts.orgHint
        ? `Please set up Vastify for my Salesforce org. Org hint: ${opts.orgHint}`
        : 'Please set up Vastify for my Salesforce org.',
    },
  ];

  log.info('setup agent: starting run', { tenantId: opts.tenantId });

  // Track in-flight tool calls so we can emit tool_use_completed when the
  // runner returns the next message (meaning all pending tools have finished).
  const pendingTools = new Map<string, { name: string; startedAt: number }>();

  const runner = client.beta.messages.toolRunner(
    {
      model: modelId(),
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'xhigh' },
      system: SYSTEM_PROMPT,
      tools: setupTools,
      messages: initialMessages,
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  try {
    // BetaToolRunner<false> — non-streaming, yields BetaMessage per iteration.
    // Each message arrival means all tools started in the previous iteration
    // have completed — flush them before processing the new message's blocks.
    for await (const message of runner) {
      if (opts.signal?.aborted) break;

      // Flush tool_use_completed for all tools that were pending.
      for (const [id, meta] of pendingTools) {
        yield {
          kind: 'tool_use_completed',
          id,
          name: meta.name,
          output: null,
          elapsedMs: Date.now() - meta.startedAt,
        };
      }
      pendingTools.clear();

      for (const block of message.content) {
        if (block.type === 'text' && block.text.trim()) {
          // Accumulate for summary; also emit as streaming delta.
          summaryText = block.text.trim();
          yield { kind: 'agent_text', delta: block.text };
        }

        if (block.type === 'tool_use') {
          totalToolCalls++;
          const now = Date.now();
          pendingTools.set(block.id, { name: block.name, startedAt: now });

          yield {
            kind: 'tool_use_started',
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
            startedAt: now,
          };
        }
      }
    }

    // Flush any tools that were pending when the runner finished
    // (e.g. last message was all tool_use with no subsequent assistant turn).
    for (const [id, meta] of pendingTools) {
      yield {
        kind: 'tool_use_completed',
        id,
        name: meta.name,
        output: null,
        elapsedMs: Date.now() - meta.startedAt,
      };
    }
  } catch (err) {
    const msg = (err as Error).message ?? 'unknown error';
    log.error('setup agent: run failed', { tenantId: opts.tenantId, err: msg });
    yield { kind: 'error', message: msg };
    return;
  }

  const totalElapsedMs = Date.now() - startedAt;
  log.info('setup agent: run complete', {
    tenantId: opts.tenantId,
    totalToolCalls,
    totalElapsedMs,
  });

  yield {
    kind: 'done',
    totalToolCalls,
    totalElapsedMs,
    summary: summaryText || 'Vastify setup complete.',
  };
}
