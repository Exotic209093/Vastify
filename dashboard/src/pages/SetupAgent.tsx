import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Check, AlertTriangle, Loader2, Cpu } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { getApiBase, getApiKey } from '../lib/api';

/* ─── Types matching the backend SSE contract ─────────────────────────── */

interface ToolStarted {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: number;
}

interface ToolCompleted {
  id: string;
  name: string;
  output: { detail?: string } & Record<string, unknown>;
  elapsedMs: number;
}

interface DoneEvent {
  totalToolCalls: number;
  totalElapsedMs: number;
  summary: string;
}

interface ToolEntry {
  id: string;
  name: string;
  startedAt: number;
  status: 'running' | 'done' | 'error';
  detail?: string;
  elapsedMs?: number;
}

type RunPhase = 'idle' | 'running' | 'complete' | 'error';

/* ─── Friendly labels for the 6 known tool names ──────────────────────── */

const TOOL_LABELS: Record<string, string> = {
  inspect_org: 'Reading Salesforce schema',
  pick_backend: 'Choosing storage backend',
  write_storage_config: 'Writing encrypted storage config',
  generate_starter_rules: 'Generating starter routing rules',
  deploy_sf_package: 'Deploying Salesforce package',
  validate_connection: 'Validating OData endpoint',
};

/* ─── Page ────────────────────────────────────────────────────────────── */

export default function SetupAgent() {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [agentText, setAgentText] = useState('');
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Wall-clock timer while the run is active.
  useEffect(() => {
    if (phase !== 'running' || startedAtRef.current === null) return;
    const start = startedAtRef.current;
    const tick = () => setElapsedMs(Date.now() - start);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    startedAtRef.current = null;
    setPhase('idle');
    setTools([]);
    setAgentText('');
    setDone(null);
    setError(null);
    setElapsedMs(0);
  }, []);

  const runAgent = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('running');
    setTools([]);
    setAgentText('');
    setDone(null);
    setError(null);
    setElapsedMs(0);
    startedAtRef.current = Date.now();

    try {
      const res = await fetch(`${getApiBase()}/v1/agents/setup/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vastify-Api-Key': getApiKey(),
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text || 'Setup agent unavailable'}`);
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });

        // Parse SSE frames separated by \n\n
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleFrame(frame);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleFrame = useCallback((raw: string) => {
    let event = 'message';
    let data = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;

    let payload: unknown;
    try { payload = JSON.parse(data); } catch { return; }

    switch (event) {
      case 'tool_use_started': {
        const p = payload as ToolStarted;
        setTools((prev) => [
          ...prev,
          {
            id: p.id,
            name: p.name,
            startedAt: p.startedAt,
            status: 'running',
          },
        ]);
        break;
      }
      case 'tool_use_completed': {
        const p = payload as ToolCompleted;
        setTools((prev) =>
          prev.map((t) =>
            t.id === p.id
              ? { ...t, status: 'done', detail: p.output.detail, elapsedMs: p.elapsedMs }
              : t,
          ),
        );
        break;
      }
      case 'agent_text': {
        const p = payload as { delta: string };
        setAgentText((prev) => prev + p.delta);
        break;
      }
      case 'done': {
        const p = payload as DoneEvent;
        setDone(p);
        setPhase('complete');
        if (startedAtRef.current !== null) {
          setElapsedMs(Date.now() - startedAtRef.current);
        }
        abortRef.current = null;
        break;
      }
      case 'error': {
        const p = payload as { message: string };
        setError(p.message);
        setPhase('error');
        abortRef.current = null;
        break;
      }
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header>
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-700/40 bg-amber-900/20 px-3 py-1 text-xs font-medium text-amber-200">
          <Sparkles size={12} />
          Built with Claude Opus 4.7
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-3">Setup Agent</h1>
        <p className="text-sm text-slate-400 mt-1">
          One click. Six tool calls. A fully configured Vastify tenant in under a minute.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT: hero + CTA */}
        <Card className="lg:col-span-2">
          <CardBody className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Setup time</div>
              <div className="mt-1 font-mono text-5xl font-semibold tabular-nums">
                {fmtTimer(elapsedMs)}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                {phase === 'idle' && 'Used to take 45 minutes.'}
                {phase === 'running' && 'Claude is configuring your tenant…'}
                {phase === 'complete' && (
                  <span className="text-emerald-400">Ready. First file landed in your bucket.</span>
                )}
                {phase === 'error' && <span className="text-red-400">Run failed. See log.</span>}
              </div>
            </div>

            {phase === 'idle' && (
              <button
                onClick={runAgent}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white px-5 py-3 text-sm font-medium shadow-lg shadow-brand-900/40 transition"
              >
                <Sparkles size={16} />
                Set Vastify up for me
              </button>
            )}

            {phase === 'running' && (
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-800 border border-slate-700 text-slate-300 px-5 py-3 text-sm font-medium"
              >
                <Loader2 size={16} className="animate-spin" />
                Claude is working…
              </button>
            )}

            {(phase === 'complete' || phase === 'error') && (
              <button
                onClick={reset}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 px-5 py-3 text-sm"
              >
                Run again
              </button>
            )}

            {done && (
              <div className="rounded-md border border-emerald-800/50 bg-emerald-900/20 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
                  <Check size={14} /> {done.totalToolCalls} tool calls · {fmtTimer(done.totalElapsedMs)}
                </div>
                {done.summary && (
                  <p className="text-xs text-emerald-100/80 leading-relaxed">{done.summary}</p>
                )}
              </div>
            )}

            {error && phase === 'error' && (
              <div className="rounded-md border border-red-800/50 bg-red-900/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-red-200">
                  <AlertTriangle size={14} /> Setup failed
                </div>
                <p className="text-xs text-red-100/80 mt-1 break-words">{error}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* RIGHT: live terminal */}
        <Card className="lg:col-span-3 bg-[#11100c] border-slate-800/60 overflow-hidden">
          <CardHeader
            title="Agent transcript"
            subtitle="Live tool calls as Claude works"
            right={
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                <Cpu size={11} /> opus 4.7 · adaptive
              </div>
            }
          />
          <CardBody className="font-mono text-[13px] text-slate-200 space-y-1.5 max-h-[480px] overflow-auto">
            {tools.length === 0 && phase === 'idle' && (
              <div className="text-slate-500 italic text-xs">
                Click <span className="text-slate-300">Set Vastify up for me</span> to start.
              </div>
            )}

            {tools.length === 0 && phase === 'running' && (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Loader2 size={12} className="animate-spin" />
                Waiting for first tool call…
              </div>
            )}

            {tools.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-[20px_220px_1fr_auto] gap-3 items-baseline"
              >
                <span
                  className={
                    t.status === 'done'
                      ? 'text-emerald-400'
                      : t.status === 'error'
                        ? 'text-red-400'
                        : 'text-amber-300'
                  }
                >
                  {t.status === 'done' ? '✓' : t.status === 'running' ? <Loader2 size={11} className="animate-spin inline" /> : '✗'}
                </span>
                <span className="text-amber-200 font-medium">{t.name}</span>
                <span className="text-slate-400 truncate">
                  {t.detail ?? TOOL_LABELS[t.name] ?? '…'}
                </span>
                <span className="text-slate-500 text-[11px] tabular-nums">
                  {t.elapsedMs != null ? fmtMs(t.elapsedMs) : ''}
                </span>
              </div>
            ))}

            {agentText && (
              <div className="mt-4 pt-3 border-t border-slate-800/50 text-slate-300 text-[12px] whitespace-pre-wrap leading-relaxed">
                {agentText}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="text-xs text-slate-400 leading-relaxed space-y-2">
          <p>
            <strong className="text-slate-200">What just happened?</strong> The agent autonomously inspected
            your Salesforce org, picked the cheapest cloud backend for your data shape, wrote and
            encrypted the storage config, generated routing rules from the file/record patterns it saw,
            deployed the Vastify Salesforce package, and verified the OData endpoint is responding —
            without you wiring anything by hand.
          </p>
          <p>
            Each tool call is a real function in <code className="text-slate-300">api/src/agents/setup/tools.ts</code>{' '}
            invoked by Claude Opus 4.7 via the Anthropic Agent SDK. The model decides the order, recovers
            from intermediate results, and stops when the tenant is live.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

/* ─── Format helpers ──────────────────────────────────────────────────── */

function fmtTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
