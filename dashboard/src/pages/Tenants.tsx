import { useState } from 'react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { getApiKey, setApiKey } from '../lib/api';

export default function TenantsPage() {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(false);

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
        <p className="text-sm text-slate-400">
          API key the dashboard uses when calling the middleware.
        </p>
      </header>

      <Card>
        <CardHeader title="Dashboard API key" subtitle="Stored in localStorage" />
        <CardBody>
          <label className="text-xs text-slate-400">Key</label>
          <div className="mt-1 flex gap-2">
            <input
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setSaved(false);
              }}
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={() => {
                setApiKey(key);
                setSaved(true);
              }}
              className="rounded-md border border-brand-600/50 bg-brand-600/30 px-4 py-2 text-sm hover:bg-brand-600/50"
            >
              Save
            </button>
          </div>
          {saved && <div className="mt-2 text-xs text-emerald-400">Saved.</div>}
          <p className="mt-4 text-xs text-slate-500">
            This key must match one the middleware seeded (see <code>.env</code> →{' '}
            <code>DEMO_TENANT_API_KEY</code>).
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
