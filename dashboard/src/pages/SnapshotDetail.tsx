import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, GitCommit, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { getSnapshot, listOrgs, buildDiff, getDiffPlan, triggerRestore, getRestoreJob } from '../lib/backup-api';
import type { DiffPlan } from '../lib/backup-api';
import { api } from '../lib/api';
import { relativeTime, bytes } from '../lib/format';

/* ─── Diff Explainer (AI) ─────────────────────────────────────────────── */

interface EntityExplanation {
  objectName: string;
  verdict: 'safe' | 'review' | 'skip';
  reasoning: string;
  insertCount: number;
  updateCount: number;
  skipDeleteCount: number;
}

interface DiffExplanation {
  summary: string;
  overallVerdict: 'safe' | 'review' | 'skip';
  entities: EntityExplanation[];
  warnings: string[];
}

const VERDICT_META = {
  safe: {
    label: 'Safe to restore',
    color: 'emerald',
    icon: CheckCircle2,
    bg: 'bg-emerald-900/20 border-emerald-800/50',
    pill: 'bg-emerald-500',
    text: 'text-emerald-300',
  },
  review: {
    label: 'Needs review',
    color: 'amber',
    icon: AlertTriangle,
    bg: 'bg-amber-900/20 border-amber-800/50',
    pill: 'bg-amber-500',
    text: 'text-amber-300',
  },
  skip: {
    label: 'Skip — do not restore',
    color: 'red',
    icon: XCircle,
    bg: 'bg-red-900/20 border-red-800/50',
    pill: 'bg-red-500',
    text: 'text-red-300',
  },
} as const;

function DiffExplainer({ planId }: { planId: string }) {
  const [explanation, setExplanation] = useState<DiffExplanation | null>(null);

  const explain = useMutation({
    mutationFn: async () => {
      const res = await api<{ explanation: DiffExplanation }>('/v1/agents/explain-diff', {
        json: { planId },
      });
      return res.explanation;
    },
    onSuccess: (exp) => setExplanation(exp),
  });

  const grouped = explanation
    ? {
        safe: explanation.entities.filter((e) => e.verdict === 'safe'),
        review: explanation.entities.filter((e) => e.verdict === 'review'),
        skip: explanation.entities.filter((e) => e.verdict === 'skip'),
      }
    : null;

  return (
    <Card className="border-amber-900/30">
      <CardHeader
        title="AI Diff Explainer"
        subtitle="Claude reads the diff and tells you what's safe to restore"
        right={
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-700/40 bg-amber-900/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200">
            <Sparkles size={10} />
            Opus 4.7
          </div>
        }
      />
      <CardBody className="space-y-4">
        {!explanation && !explain.isPending && (
          <button
            onClick={() => explain.mutate()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 text-sm font-medium shadow-lg shadow-amber-900/40 transition"
          >
            <Sparkles size={14} />
            Explain this diff
          </button>
        )}

        {explain.isPending && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Claude is analysing {/* could show count */}…
          </div>
        )}

        {explain.isError && (
          <div className="rounded-md border border-red-800/50 bg-red-900/20 p-3 text-xs text-red-200">
            Failed to generate explanation: {(explain.error as Error).message}
          </div>
        )}

        {explanation && grouped && (
          <>
            {/* Overall summary */}
            <div className="rounded-md border border-slate-700 bg-slate-800/40 p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Claude's verdict
              </div>
              <p className="text-sm text-slate-100 leading-relaxed">{explanation.summary}</p>
            </div>

            {/* Headline counts (matches the storyboard frame IV: 12 / 3 / 1) */}
            <div className="grid grid-cols-3 gap-3">
              {(['safe', 'review', 'skip'] as const).map((v) => {
                const count = grouped[v].reduce(
                  (sum, e) => sum + e.insertCount + e.updateCount + e.skipDeleteCount,
                  0,
                );
                const meta = VERDICT_META[v];
                const Icon = meta.icon;
                return (
                  <div key={v} className={`rounded-md border p-3 ${meta.bg}`}>
                    <div className={`flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
                      <Icon size={12} />
                      {meta.label}
                    </div>
                    <div className="mt-1 font-mono text-3xl font-semibold text-slate-100">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Per-entity reasoning */}
            <div className="space-y-2">
              {(['safe', 'review', 'skip'] as const).map((v) =>
                grouped[v].map((e) => {
                  const meta = VERDICT_META[v];
                  const Icon = meta.icon;
                  const total = e.insertCount + e.updateCount + e.skipDeleteCount;
                  return (
                    <div
                      key={`${v}-${e.objectName}`}
                      className={`rounded-md border p-3 ${meta.bg}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <Icon size={14} className={`${meta.text} mt-0.5 shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="text-sm font-medium text-slate-100">
                              {e.objectName}
                            </div>
                            <div className="text-xs text-slate-400 font-mono shrink-0">
                              {total} {total === 1 ? 'change' : 'changes'}
                            </div>
                          </div>
                          <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                            {e.reasoning}
                          </p>
                          <div className="mt-2 flex gap-3 text-[11px] text-slate-500 font-mono">
                            {e.insertCount > 0 && <span>+{e.insertCount} insert</span>}
                            {e.updateCount > 0 && <span>~{e.updateCount} update</span>}
                            {e.skipDeleteCount > 0 && <span>−{e.skipDeleteCount} skip-delete</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }),
              )}
            </div>

            {explanation.warnings.length > 0 && (
              <div className="rounded-md border border-amber-800/50 bg-amber-900/20 p-3 space-y-1.5">
                <div className="text-xs font-medium text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Warnings
                </div>
                {explanation.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-100/80 leading-relaxed">
                    {w}
                  </p>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                setExplanation(null);
                explain.reset();
              }}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Clear & re-run
            </button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function RestorePanel({ snapshotId, diffPlan }: { snapshotId: string; diffPlan: DiffPlan }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmExecute, setConfirmExecute] = useState(false);

  const { data: job } = useQuery({
    queryKey: ['restore-job', jobId],
    queryFn: () => getRestoreJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const j = query.state.data;
      return j && (j.status === 'pending' || j.status === 'running') ? 3000 : false;
    },
  });

  const restore = useMutation({
    mutationFn: (mode: 'dry-run' | 'execute') =>
      triggerRestore(snapshotId, {
        targetOrgId: diffPlan.targetOrgId,
        diffPlanId: diffPlan.id,
        mode,
        confirm: mode === 'execute' ? true : undefined,
      }),
    onSuccess: (res) => setJobId(res.jobId),
  });

  const counts = (() => {
    try { return JSON.parse(diffPlan.summaryCounts) as { insert: number; update: number; skipDelete: number }; }
    catch { return null; }
  })();

  return (
    <Card>
      <CardHeader title="Restore" subtitle="Apply this snapshot to a target org" />
      <CardBody className="space-y-4">
        {counts && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-emerald-900/30 border border-emerald-800/50 p-3">
              <div className="text-2xl font-mono font-semibold text-emerald-300">{counts.insert}</div>
              <div className="text-xs text-slate-400 mt-1">Insert</div>
            </div>
            <div className="rounded-md bg-blue-900/30 border border-blue-800/50 p-3">
              <div className="text-2xl font-mono font-semibold text-blue-300">{counts.update}</div>
              <div className="text-xs text-slate-400 mt-1">Update</div>
            </div>
            <div className="rounded-md bg-slate-800/50 border border-slate-700/50 p-3">
              <div className="text-2xl font-mono font-semibold text-slate-300">{counts.skipDelete}</div>
              <div className="text-xs text-slate-400 mt-1">Skip Delete</div>
            </div>
          </div>
        )}

        {!jobId && (
          <div className="flex gap-3">
            <button
              onClick={() => restore.mutate('dry-run')}
              disabled={restore.isPending}
              className="px-4 py-2 text-sm rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 disabled:opacity-50"
            >
              {restore.isPending ? 'Starting…' : 'Dry Run'}
            </button>
            <button
              onClick={() => setConfirmExecute(true)}
              disabled={restore.isPending}
              className="px-4 py-2 text-sm rounded-md bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
            >
              Execute Restore
            </button>
          </div>
        )}

        {confirmExecute && !jobId && (
          <div className="rounded-md border border-red-800 bg-red-900/20 p-4 space-y-3">
            <p className="text-sm text-red-200">This will write changes to the target org. Are you sure?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmExecute(false)} className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-300">Cancel</button>
              <button
                onClick={() => { restore.mutate('execute'); setConfirmExecute(false); }}
                className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white"
              >
                Yes, Execute
              </button>
            </div>
          </div>
        )}

        {job && (
          <div className="rounded-md border border-slate-700 p-4">
            <div className="flex items-center gap-2 text-sm">
              {(job.status === 'pending' || job.status === 'running') && <RefreshCw size={14} className="animate-spin text-blue-400" />}
              <span className="font-medium capitalize">{job.status}</span>
              <span className="text-slate-400 text-xs">({job.mode})</span>
            </div>
            {job.appliedChangesSummary && (
              <pre className="mt-2 text-xs text-slate-400 bg-slate-950 rounded p-2 overflow-auto">
                {JSON.stringify(JSON.parse(job.appliedChangesSummary), null, 2)}
              </pre>
            )}
            {job.error && <p className="mt-2 text-xs text-red-400">{job.error}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function SnapshotDetail() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const [targetOrgId, setTargetOrgId] = useState('');
  const [diffPlanId, setDiffPlanId] = useState<string | null>(null);

  const { data: snap, isLoading } = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => getSnapshot(snapshotId!),
    refetchInterval: (query) => {
      const s = query.state.data;
      return s && (s.status === 'pending' || s.status === 'running') ? 3000 : false;
    },
    enabled: !!snapshotId,
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['orgs'],
    queryFn: listOrgs,
  });

  const { data: diffPlan } = useQuery({
    queryKey: ['diff-plan', diffPlanId],
    queryFn: () => getDiffPlan(diffPlanId!),
    enabled: !!diffPlanId,
  });

  const buildDiffMutation = useMutation({
    mutationFn: () => buildDiff(snapshotId!, targetOrgId),
    onSuccess: (res) => setDiffPlanId(res.diffPlanId),
  });

  if (isLoading || !snap) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <Link to="/dashboard/backups" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft size={14} />
        Backups
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshot</h1>
        <p className="font-mono text-xs text-slate-500 mt-1">{snap.id}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Status', value: snap.status },
          { label: 'Records', value: snap.recordCount?.toLocaleString() ?? '—' },
          { label: 'Size', value: snap.sizeBytes != null ? bytes(snap.sizeBytes) : '—' },
          { label: 'Started', value: relativeTime(snap.startedAt) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardBody>
              <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
              <div className="font-mono text-sm mt-1">{value}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {snap.gitCommitSha && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <GitCommit size={14} />
          Git commit: <span className="font-mono text-slate-300">{snap.gitCommitSha}</span>
        </div>
      )}

      {snap.status === 'failed' && snap.error && (
        <Card className="border-red-900/50">
          <CardBody><p className="text-sm text-red-400">{snap.error}</p></CardBody>
        </Card>
      )}

      {snap.status === 'complete' && (
        <Card>
          <CardHeader title="Build Diff" subtitle="Compare this snapshot against a live org" />
          <CardBody className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Org</label>
              <select
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
                value={targetOrgId}
                onChange={(e) => setTargetOrgId(e.target.value)}
              >
                <option value="">Select target org…</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.displayName}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => buildDiffMutation.mutate()}
              disabled={!targetOrgId || buildDiffMutation.isPending}
              className="px-4 py-2 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
            >
              {buildDiffMutation.isPending ? 'Building…' : 'Build Diff'}
            </button>
          </CardBody>
        </Card>
      )}

      {diffPlan && snap.status === 'complete' && (
        <>
          <DiffExplainer planId={diffPlan.id} />
          <RestorePanel snapshotId={snap.id} diffPlan={diffPlan} />
        </>
      )}
    </div>
  );
}
