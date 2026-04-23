import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, GitCommit, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { getSnapshot, listOrgs, buildDiff, getDiffPlan, triggerRestore, getRestoreJob } from '../lib/backup-api';
import type { DiffPlan } from '../lib/backup-api';
import { relativeTime, bytes } from '../lib/format';

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
        <RestorePanel snapshotId={snap.id} diffPlan={diffPlan} />
      )}
    </div>
  );
}
