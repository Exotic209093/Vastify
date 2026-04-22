import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardBody, CardHeader } from '../components/Card';
import { api, type RecordRow } from '../lib/api';
import { relativeTime } from '../lib/format';
import { BackendPill, TierPill } from './Files';

type Entity = 'Interaction' | 'ArchivedInteraction';

export default function RecordsPage() {
  const [entity, setEntity] = useState<Entity>('Interaction');
  const { data, isLoading, error } = useQuery({
    queryKey: ['records', entity],
    queryFn: async () => api<{ rows: RecordRow[] }>(`/v1/records/${entity}`),
    refetchInterval: 4000,
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Records</h1>
          <p className="text-sm text-slate-400">
            Offloaded SObject rows served back to Salesforce via OData.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-slate-700 overflow-hidden">
          {(['Interaction', 'ArchivedInteraction'] as Entity[]).map((e) => (
            <button
              key={e}
              onClick={() => setEntity(e)}
              className={`px-3 py-1.5 text-xs ${
                entity === e
                  ? 'bg-brand-600/30 text-brand-50'
                  : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              {e === 'Interaction' ? 'Live' : 'Archived'}
            </button>
          ))}
        </div>
      </header>

      <Card>
        <CardHeader
          title={`${data?.rows.length ?? 0} ${entity === 'Interaction' ? 'live' : 'archived'} records`}
        />
        <CardBody>
          {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
          {error && <div className="text-sm text-red-400">Error: {(error as Error).message}</div>}
          {data && data.rows.length === 0 && (
            <div className="text-sm text-slate-500">
              No records yet. Create an Interaction in Salesforce — or run the archiver to move
              old native records in.
            </div>
          )}
          {data && data.rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 text-left">Subject</th>
                  <th className="py-2 text-left">Channel</th>
                  <th className="py-2 text-left">Type</th>
                  <th className="py-2 text-left">Backend</th>
                  <th className="py-2 text-left">Tier</th>
                  <th className="py-2 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.pk} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-2 pr-4">
                      {r.subject ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-300">{r.channel ?? '—'}</td>
                    <td className="py-2 pr-4 text-xs text-slate-300">{r.type ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <BackendPill id={r.backend_id} />
                    </td>
                    <td className="py-2 pr-4">
                      <TierPill tier={r.storage_class} />
                    </td>
                    <td className="py-2 text-right text-xs text-slate-400">
                      {r.timestamp ? relativeTime(r.timestamp) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
