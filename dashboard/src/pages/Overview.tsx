import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { Card, CardBody, CardHeader } from '../components/Card';
import { useStatsStream } from '../hooks/useStatsStream';
import { usd, bytes, relativeTime } from '../lib/format';

const TIER_COLORS: Record<string, string> = {
  STANDARD: '#4f6bff',
  NEARLINE: '#22c55e',
  COLDLINE: '#f59e0b',
  ARCHIVE: '#ef4444',
};

const BACKEND_COLORS: Record<string, string> = {
  gcs: '#4285f4',
  s3: '#ff9900',
  azure: '#0078d4',
  minio: '#c72c48',
};

export default function Overview() {
  const { stats, error } = useStatsStream();

  const tierData = useMemo(() => {
    if (!stats) return [];
    const byClass = new Map<string, number>();
    for (const t of [...stats.files.byTier, ...stats.records.byTier]) {
      byClass.set(t.storageClass, (byClass.get(t.storageClass) ?? 0) + t.bytes);
    }
    return Array.from(byClass.entries()).map(([k, v]) => ({ name: k, value: v }));
  }, [stats]);

  const backendData = useMemo(() => {
    if (!stats) return [];
    const by = new Map<string, number>();
    for (const t of [...stats.files.byTier, ...stats.records.byTier]) {
      by.set(t.backendId, (by.get(t.backendId) ?? 0) + t.bytes);
    }
    return Array.from(by.entries()).map(([k, v]) => ({ name: k, value: v }));
  }, [stats]);

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-slate-400">Live savings and routing across your Salesforce org.</p>
        </div>
        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-200">
            API error: {error}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2 bg-gradient-to-br from-brand-600/20 via-slate-900/60 to-slate-900/60">
          <CardBody>
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Net savings this month
            </div>
            <div className="mt-2 font-mono text-5xl font-semibold text-emerald-300">
              {stats ? usd(stats.totals.usdNetSavedPerMonth) : '—'}
            </div>
            <div className="mt-3 flex gap-6 text-xs text-slate-400">
              <div>
                Avoided SF:{' '}
                <span className="text-slate-200">
                  {stats ? usd(stats.totals.usdAvoidedVsSalesforce) : '—'}
                </span>
              </div>
              <div>
                Backend spend:{' '}
                <span className="text-slate-200">
                  {stats ? usd(stats.totals.usdPerMonthOnBackend) : '—'}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Counter label="Files offloaded" value={stats?.files.count ?? 0} />
            <Counter
              label="Records (live)"
              value={stats?.records.countLive ?? 0}
              className="mt-4"
            />
            <Counter
              label="Records archived"
              value={stats?.records.countArchived ?? 0}
              className="mt-4"
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Storage class distribution" subtitle="Bytes stored, all backends" />
          <CardBody>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={tierData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={2}
                  >
                    {tierData.map((e, i) => (
                      <Cell key={i} fill={TIER_COLORS[e.name] ?? '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155' }}
                    formatter={(v: number) => bytes(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 justify-center text-xs">
              {tierData.map((t) => (
                <div key={t.name} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: TIER_COLORS[t.name] ?? '#64748b' }}
                  />
                  {t.name} — {bytes(t.value)}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Bytes by cloud backend" />
          <CardBody>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={backendData}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(v) => bytes(v)} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155' }}
                    formatter={(v: number) => bytes(v)}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {backendData.map((e, i) => (
                      <Cell key={i} fill={BACKEND_COLORS[e.name] ?? '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" subtitle="Events as they happen" />
        <CardBody className="space-y-2 max-h-96 overflow-auto">
          {(stats?.recentEvents ?? []).length === 0 && (
            <div className="text-sm text-slate-500">
              No events yet — upload a file or create an Interaction in Salesforce.
            </div>
          )}
          {(stats?.recentEvents ?? []).map((e, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-slate-800 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-brand-500">{e.kind}</span>
                <span className="text-slate-400 text-xs">
                  {JSON.stringify(e.payload).slice(0, 80)}
                </span>
              </div>
              <span className="text-xs text-slate-500">{relativeTime(e.at)}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function Counter({
  label,
  value,
  className = '',
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-3xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}
