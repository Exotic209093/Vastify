import { useQuery } from '@tanstack/react-query';
import { Card, CardBody, CardHeader } from '../components/Card';
import { api, type FileRow } from '../lib/api';
import { bytes, relativeTime } from '../lib/format';

export default function FilesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['files'],
    queryFn: async () => api<{ files: FileRow[] }>('/v1/files'),
    refetchInterval: 4000,
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="text-sm text-slate-400">Salesforce attachments offloaded to cloud storage.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs hover:bg-slate-700/60"
        >
          Refresh
        </button>
      </header>

      <Card>
        <CardHeader
          title={`${data?.files.length ?? 0} files`}
          subtitle="Click a row to copy its presigned URL"
        />
        <CardBody>
          {isLoading && <div className="text-sm text-slate-400">Loading…</div>}
          {error && <div className="text-sm text-red-400">Error: {(error as Error).message}</div>}
          {data && data.files.length === 0 && (
            <div className="text-sm text-slate-500">
              No files yet. Upload an attachment to a Salesforce record to see it here.
            </div>
          )}
          {data && data.files.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-left">Backend</th>
                  <th className="py-2 text-left">Tier</th>
                  <th className="py-2 text-right">Size</th>
                  <th className="py-2 text-left">MIME</th>
                  <th className="py-2 text-right">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {data.files.map((f) => (
                  <tr
                    key={f.id}
                    className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                    onClick={async () => {
                      const r = await api<{ presignedUrl: string }>(
                        `/v1/files/${f.id}/refresh`,
                      );
                      await navigator.clipboard.writeText(r.presignedUrl);
                      alert('Presigned URL copied to clipboard');
                    }}
                  >
                    <td className="py-2 pr-4 font-medium">
                      {f.original_name ?? <span className="text-slate-500">(no name)</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <BackendPill id={f.backend_id} />
                    </td>
                    <td className="py-2 pr-4">
                      <TierPill tier={f.storage_class} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-xs">{bytes(f.size_bytes)}</td>
                    <td className="py-2 pr-4 text-xs text-slate-400">{f.mime_type ?? '—'}</td>
                    <td className="py-2 text-right text-xs text-slate-400">
                      {relativeTime(f.created_at)}
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

function BackendPill({ id }: { id: string }) {
  const color: Record<string, string> = {
    gcs: 'bg-blue-900/40 text-blue-200 border-blue-800',
    s3: 'bg-orange-900/40 text-orange-200 border-orange-800',
    azure: 'bg-sky-900/40 text-sky-200 border-sky-800',
    minio: 'bg-rose-900/40 text-rose-200 border-rose-800',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${color[id] ?? 'bg-slate-800 text-slate-300'}`}>
      {id}
    </span>
  );
}

export function TierPill({ tier }: { tier: string }) {
  const color: Record<string, string> = {
    STANDARD: 'bg-indigo-900/40 text-indigo-200 border-indigo-800',
    NEARLINE: 'bg-emerald-900/40 text-emerald-200 border-emerald-800',
    COLDLINE: 'bg-amber-900/40 text-amber-200 border-amber-800',
    ARCHIVE: 'bg-red-900/40 text-red-200 border-red-800',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${color[tier] ?? 'bg-slate-800 text-slate-300'}`}>
      {tier}
    </span>
  );
}

export { BackendPill };
