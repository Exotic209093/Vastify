import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { api, type RoutingRule } from '../lib/api';
import { TierPill } from './Files';

export default function RulesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: async () => api<{ rules: RoutingRule[] }>('/v1/rules'),
  });

  const update = useMutation({
    mutationFn: async (r: RoutingRule) =>
      api(`/v1/rules/${r.id}`, {
        method: 'PUT',
        json: { priority: r.priority, match: r.match, target: r.target, enabled: r.enabled },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api(`/v1/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const rules = data?.rules ?? [];

  function shiftPriority(r: RoutingRule, delta: number) {
    update.mutate({ ...r, priority: r.priority + delta });
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Routing rules</h1>
        <p className="text-sm text-slate-400">
          Evaluated in priority order — lowest wins. Disabled rules are skipped. Edits apply on
          the next upload.
        </p>
      </header>

      <Card>
        <CardHeader title={`${rules.length} rules`} subtitle="Lower priority = evaluated first" />
        <CardBody>
          {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
          {rules.length === 0 && !isLoading && (
            <div className="text-sm text-slate-500">No rules defined. Run the seed script.</div>
          )}
          <div className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-4 py-3"
              >
                <div className="font-mono text-xs text-slate-500 w-10 text-right">
                  {r.priority}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => shiftPriority(r, -5)}
                    className="text-slate-500 hover:text-slate-200"
                    title="Bump priority up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => shiftPriority(r, 5)}
                    className="text-slate-500 hover:text-slate-200"
                    title="Bump priority down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500">Match</div>
                    <div className="mt-1 font-mono text-xs text-slate-300">
                      {formatMatch(r.match)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500">Target</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-mono text-xs">{r.target.backendId}</span>
                      <TierPill tier={r.target.storageClass} />
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => update.mutate({ ...r, enabled: e.target.checked })}
                    className="accent-brand-500"
                  />
                  enabled
                </label>
                <button
                  onClick={() => confirm('Delete this rule?') && remove.mutate(r.id)}
                  className="text-slate-500 hover:text-red-400"
                  title="Delete rule"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <RulePreview />
    </div>
  );
}

function formatMatch(m: RoutingRule['match']): string {
  const parts: string[] = [`kind=${m.kind}`];
  if (m.sizeBytesMin !== undefined) parts.push(`size≥${m.sizeBytesMin}`);
  if (m.sizeBytesMax !== undefined) parts.push(`size≤${m.sizeBytesMax}`);
  if (m.ageDaysMin !== undefined) parts.push(`age≥${m.ageDaysMin}d`);
  if (m.ageDaysMax !== undefined) parts.push(`age≤${m.ageDaysMax}d`);
  if (m.mimeRegex) parts.push(`mime=${m.mimeRegex}`);
  if (m.entity) parts.push(`entity=${m.entity}`);
  return parts.join(' ∧ ');
}

function RulePreview() {
  const [kind, setKind] = useState<'file' | 'record'>('file');
  const [sizeMb, setSizeMb] = useState(5);
  const [mime, setMime] = useState('application/pdf');
  const [ageDays, setAgeDays] = useState(30);
  const [result, setResult] = useState<unknown>(null);

  async function run() {
    const body: Record<string, unknown> = { kind };
    if (kind === 'file') {
      body.sizeBytes = sizeMb * 1024 * 1024;
      body.mime = mime;
    } else {
      body.ageDays = ageDays;
      body.entity = 'Interaction';
    }
    const r = await api('/v1/rules/preview', { json: body });
    setResult(r);
  }

  return (
    <Card>
      <CardHeader title="Preview a routing decision" subtitle="Simulate an upload" />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs flex flex-col">
            <span className="text-slate-400">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'file' | 'record')}
              className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              <option value="file">file</option>
              <option value="record">record</option>
            </select>
          </label>
          {kind === 'file' ? (
            <>
              <label className="text-xs flex flex-col">
                <span className="text-slate-400">Size (MB)</span>
                <input
                  type="number"
                  value={sizeMb}
                  onChange={(e) => setSizeMb(parseFloat(e.target.value) || 0)}
                  className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 w-20"
                />
              </label>
              <label className="text-xs flex flex-col">
                <span className="text-slate-400">MIME type</span>
                <input
                  value={mime}
                  onChange={(e) => setMime(e.target.value)}
                  className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 w-44"
                />
              </label>
            </>
          ) : (
            <label className="text-xs flex flex-col">
              <span className="text-slate-400">Age (days)</span>
              <input
                type="number"
                value={ageDays}
                onChange={(e) => setAgeDays(parseInt(e.target.value, 10) || 0)}
                className="mt-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 w-20"
              />
            </label>
          )}
          <button
            onClick={run}
            className="rounded-md border border-brand-600/50 bg-brand-600/30 px-3 py-1.5 text-xs hover:bg-brand-600/50"
          >
            Run
          </button>
        </div>
        {result !== null && (
          <pre className="mt-4 overflow-auto rounded-md bg-slate-950 border border-slate-800 p-3 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardBody>
    </Card>
  );
}
