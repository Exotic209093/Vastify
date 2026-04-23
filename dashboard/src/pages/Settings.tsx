import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { authApi } from '../lib/api';

interface StorageConfig {
  useOwnS3: boolean;
  s3BucketName: string | null;
  s3Region: string | null;
  s3AccessKeyId: string | null;
  s3Secret: string | null;
  useOwnGcs: boolean;
  gcsBucketName: string | null;
  gcsProjectId: string | null;
  gcsServiceAccountJson: string | null;
  updatedAt: number;
}

function MaskedInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? ''}
          className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 pr-9 text-sm"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function StorageSection() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery<StorageConfig>({
    queryKey: ['storage-config'],
    queryFn: () => authApi('/v1/settings/storage'),
  });

  const [s3BucketName, setS3BucketName] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  const [s3Secret, setS3Secret] = useState('');
  const [useOwnS3, setUseOwnS3] = useState(false);

  const [gcsBucketName, setGcsBucketName] = useState('');
  const [gcsProjectId, setGcsProjectId] = useState('');
  const [gcsServiceAccountJson, setGcsServiceAccountJson] = useState('');
  const [useOwnGcs, setUseOwnGcs] = useState(false);

  const [initialized, setInitialized] = useState(false);
  if (config && !initialized) {
    setS3BucketName(config.s3BucketName ?? '');
    setS3Region(config.s3Region ?? '');
    setUseOwnS3(config.useOwnS3);
    setGcsBucketName(config.gcsBucketName ?? '');
    setGcsProjectId(config.gcsProjectId ?? '');
    setUseOwnGcs(config.useOwnGcs);
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: () => authApi('/v1/settings/storage', {
      method: 'PUT',
      json: {
        useOwnS3,
        ...(useOwnS3 && { s3BucketName, s3Region, ...(s3AccessKeyId && { s3AccessKeyId }), ...(s3Secret && { s3Secret }) }),
        useOwnGcs,
        ...(useOwnGcs && { gcsBucketName, gcsProjectId, ...(gcsServiceAccountJson && { gcsServiceAccountJson }) }),
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['storage-config'] }),
  });

  if (isLoading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <Card>
      <CardHeader title="Object Storage" subtitle="Backup archives and diff plans are stored here" />
      <CardBody className="space-y-6">
        {/* S3 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Amazon S3</span>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={useOwnS3} onChange={(e) => setUseOwnS3(e.target.checked)} className="rounded" />
              Use my own bucket
            </label>
            {!useOwnS3 && <span className="text-xs bg-emerald-900/40 text-emerald-300 rounded px-2 py-0.5">Vastify-provisioned</span>}
          </div>
          {useOwnS3 && (
            <div className="grid grid-cols-2 gap-3 pl-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Bucket Name</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={s3BucketName} onChange={(e) => setS3BucketName(e.target.value)} placeholder="my-vastify-bucket" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Region</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" />
              </div>
              <MaskedInput label="Access Key ID" value={s3AccessKeyId} onChange={setS3AccessKeyId} placeholder={config?.s3AccessKeyId === '***' ? '(saved — leave blank to keep)' : ''} />
              <MaskedInput label="Secret Access Key" value={s3Secret} onChange={setS3Secret} placeholder={config?.s3Secret === '***' ? '(saved — leave blank to keep)' : ''} />
            </div>
          )}
        </section>

        {/* GCS */}
        <section className="space-y-3 border-t border-slate-800 pt-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Google Cloud Storage</span>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={useOwnGcs} onChange={(e) => setUseOwnGcs(e.target.checked)} className="rounded" />
              Use my own bucket
            </label>
            {!useOwnGcs && <span className="text-xs bg-emerald-900/40 text-emerald-300 rounded px-2 py-0.5">Vastify-provisioned</span>}
          </div>
          {useOwnGcs && (
            <div className="grid grid-cols-2 gap-3 pl-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Bucket Name</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={gcsBucketName} onChange={(e) => setGcsBucketName(e.target.value)} placeholder="my-vastify-bucket" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Project ID</label>
                <input className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm" value={gcsProjectId} onChange={(e) => setGcsProjectId(e.target.value)} placeholder="my-gcp-project" />
              </div>
              <div className="col-span-2">
                <MaskedInput label="Service Account JSON" value={gcsServiceAccountJson} onChange={setGcsServiceAccountJson} placeholder={config?.gcsServiceAccountJson === '***' ? '(saved — leave blank to keep)' : '{"type":"service_account",...}'} />
              </div>
            </div>
          )}
        </section>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm disabled:opacity-50"
        >
          <Save size={14} />
          {save.isPending ? 'Saving…' : 'Save Storage Config'}
        </button>

        {save.isSuccess && <p className="text-xs text-emerald-400">Saved successfully.</p>}
        {save.isError && <p className="text-xs text-red-400">Failed to save: {(save.error as Error).message}</p>}
      </CardBody>
    </Card>
  );
}

function ApiKeySection() {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = useMutation({
    mutationFn: () => authApi<{ apiKey: string }>('/v1/settings/api-key', { method: 'POST' }),
    onSuccess: (res) => setNewKey(res.apiKey),
  });

  async function copy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader title="API Key" subtitle="Used for programmatic access and integrations" />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-400">
          API keys are stored hashed and cannot be retrieved. Regenerate to get a new key — the old key is immediately invalidated.
        </p>

        {newKey ? (
          <div className="rounded-md border border-emerald-800 bg-emerald-900/20 p-4 space-y-2">
            <p className="text-xs text-emerald-300 font-medium">New API key — copy it now, it won't be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-slate-950 rounded px-3 py-2 text-emerald-200 overflow-auto">{newKey}</code>
              <button onClick={copy} className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-sm text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate API Key'}
          </button>
        )}
      </CardBody>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage storage backends and API access.</p>
      </header>
      <StorageSection />
      <ApiKeySection />
    </div>
  );
}
