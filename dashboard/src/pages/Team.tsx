import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Link, Clock } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/Card';
import { authApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expiresAt: number;
  createdAt: number;
}

function relTime(ms: number) {
  const diff = Date.now() - ms;
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

export default function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<{ members: Member[]; invites: Invite[] }>({
    queryKey: ['team'],
    queryFn: () => authApi('/v1/team'),
  });

  const invite = useMutation({
    mutationFn: () => authApi<{ token: string; inviteUrl: string }>('/v1/team/invite', { json: { email, role } }),
    onSuccess: (res) => {
      setInviteUrl(res.inviteUrl);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['team'] });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => authApi(`/v1/team/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-slate-400 mt-1">Manage who has access to your Vastify workspace.</p>
      </header>

      {/* Members */}
      <Card>
        <CardHeader title="Members" subtitle={`${members.length} member${members.length !== 1 ? 's' : ''}`} />
        <CardBody className="p-0">
          {isLoading ? (
            <div className="px-6 py-4 text-sm text-slate-500">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">User ID</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-slate-800/50">
                    <td className="px-6 py-3 font-mono text-xs text-slate-300">{m.userId}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.role === 'admin' ? 'bg-brand-600/20 text-brand-300' : 'bg-slate-700 text-slate-300'}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400">{relTime(m.joinedAt)}</td>
                    <td className="px-6 py-3 text-right">
                      {m.userId !== user?.userId && (
                        <button
                          onClick={() => remove.mutate(m.userId)}
                          disabled={remove.isPending}
                          className="text-slate-500 hover:text-red-400 transition disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card>
          <CardHeader title="Pending Invites" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400">Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-800/50">
                    <td className="px-6 py-3 text-xs text-slate-300">{inv.email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${inv.role === 'admin' ? 'bg-brand-600/20 text-brand-300' : 'bg-slate-700 text-slate-300'}`}>
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/dashboard/team/invite/${inv.token}`;
                          await navigator.clipboard.writeText(url);
                        }}
                        className="text-slate-500 hover:text-brand-400 transition"
                        title="Copy invite link"
                      >
                        <Link size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Invite form */}
      <Card>
        <CardHeader title="Invite Member" subtitle="Send an invite link to a Salesforce user" />
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                className="rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => invite.mutate()}
            disabled={!email || invite.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm disabled:opacity-50"
          >
            <UserPlus size={14} />
            {invite.isPending ? 'Sending…' : 'Create Invite Link'}
          </button>

          {invite.isError && (
            <p className="text-xs text-red-400">Failed: {(invite.error as Error).message}</p>
          )}

          {inviteUrl && (
            <div className="rounded-md border border-brand-800/50 bg-brand-900/20 p-4 space-y-2">
              <p className="text-xs text-brand-300 font-medium">Invite link created — share this with {email}:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-slate-950 rounded px-3 py-2 text-brand-200 overflow-auto break-all">{inviteUrl}</code>
                <button onClick={copy} className="px-3 py-1.5 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800 shrink-0">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
