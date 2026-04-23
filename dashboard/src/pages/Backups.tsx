import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ExternalLink, HardDrive } from 'lucide-react';
import { Card, CardBody } from '../components/Card';
import { listOrgs, listSnapshots, listScopes, createScope, triggerSnapshot } from '../lib/backup-api';
import type { ConnectedOrg, Snapshot } from '../lib/backup-api';
import { relativeTime, bytes } from '../lib/format';

function statusBadge(status: Snapshot['status']) {
  const styles: Record<Snapshot['status'], string> = {
    pending: 'bg-slate-700 text-slate-300',
    running: 'bg-blue-900/50 text-blue-300',
    complete: 'bg-emerald-900/50 text-emerald-300',
    failed: 'bg-red-900/50 text-red-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function RunBackupModal({ org, onClose }: { org: ConnectedOrg; onClose: () => void }) {
  const qc = useQueryClient();
  const [rootObject, setRootObject] = useState('Account');
  const [maxDepth, setMaxDepth] = useState(2);

  const { data: _scopes } = useQuery({ queryKey: ['scopes', org.id], queryFn: () => listScopes(org.id) });

  const createAndRun = useMutation({
    mutationFn: async () => {
      const { scopeId } = await createScope({
        connectedOrgId: org.id, name: `${rootObject} backup`, rootObject, maxDepth,
        includeFiles: false, includeMetadata: true,
      });
      return triggerSnapshot(org.id, scopeId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Run Backup — {org.displayName}</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Root Object</label>
            <input
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              value={rootObject}
              onChange={(e) => setRootObject(e.target.value)}
              placeholder="Account"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Max Depth</label>
            <input
              type="number"
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              value={maxDepth}
              min={1} max={5}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={() => createAndRun.mutate()}
            disabled={createAndRun.isPending}
            className="px-4 py-2 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {createAndRun.isPending ? 'Starting…' : 'Run Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Backups() {
  const [selectedOrg, setSelectedOrg] = useState<ConnectedOrg | null>(null);

  const { data: orgs = [], isLoading: orgsLoading } = useQuery({ queryKey: ['orgs'], queryFn: listOrgs });
  const { data: snapshots = [], isLoading: snapsLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: listSnapshots,
    refetchInterval: (query) => {
      const snaps = query.state.data ?? [];
      return snaps.some((s) => s.status === 'pending' || s.status === 'running') ? 3000 : false;
    },
  });

  function connectOrg() {
    window.location.href = '/auth/salesforce/login?intent=connect-org';
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="text-sm text-slate-400">Manage CRM connections and snapshot history.</p>
        </div>
        <button
          onClick={connectOrg}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm"
        >
          <Plus size={16} />
          Connect Org
        </button>
      </header>

      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Connected Orgs</h2>
        {orgsLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : orgs.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-8">
                <HardDrive size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-slate-400 text-sm">No orgs connected yet.</p>
                <button onClick={connectOrg} className="mt-4 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm">
                  Connect your first Salesforce org
                </button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map((org) => (
              <Card key={org.id} className="cursor-pointer hover:border-brand-600/40 transition-colors">
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">{org.displayName}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{org.crmType} · {org.externalOrgId}</div>
                      {org.isSandbox && <span className="text-xs bg-yellow-900/40 text-yellow-300 rounded px-1.5 py-0.5 mt-1 inline-block">Sandbox</span>}
                    </div>
                    <a href={org.instanceUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-300">
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setSelectedOrg(org)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                    >
                      <RefreshCw size={12} />
                      Run Backup
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Snapshots</h2>
        <Card>
          {snapsLoading ? (
            <CardBody><div className="text-sm text-slate-500">Loading…</div></CardBody>
          ) : snapshots.length === 0 ? (
            <CardBody><div className="text-sm text-slate-500">No snapshots yet — run a backup above.</div></CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Records</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Size</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Started</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Git SHA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snap) => (
                    <tr key={snap.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-3">{statusBadge(snap.status)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{snap.recordCount?.toLocaleString() ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{snap.sizeBytes != null ? bytes(snap.sizeBytes) : '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{relativeTime(snap.startedAt)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{snap.gitCommitSha?.slice(0, 7) ?? '—'}</td>
                      <td className="px-4 py-3">
                        {snap.status === 'complete' && (
                          <Link to={`/dashboard/backups/${snap.id}`} className="text-xs text-brand-400 hover:text-brand-300">
                            View →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {selectedOrg && <RunBackupModal org={selectedOrg} onClose={() => setSelectedOrg(null)} />}
    </div>
  );
}
