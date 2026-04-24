import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Files, Database, Sliders,
  HardDrive, Settings as SettingsIcon, Users, LogOut, Sparkles,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Overview from './pages/Overview';
import FilesPage from './pages/Files';
import RecordsPage from './pages/Records';
import RulesPage from './pages/Rules';
import TenantsPage from './pages/Tenants';
import Login from './pages/Login';
import Backups from './pages/Backups';
import SnapshotDetail from './pages/SnapshotDetail';
import Settings from './pages/Settings';
import Team from './pages/Team';
import SetupAgent from './pages/SetupAgent';

const mainNav = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/setup', label: 'Setup Agent', icon: Sparkles },
  { to: '/dashboard/files', label: 'Files', icon: Files },
  { to: '/dashboard/records', label: 'Records', icon: Database },
  { to: '/dashboard/rules', label: 'Rules', icon: Sliders },
  { to: '/dashboard/backups', label: 'Backups', icon: HardDrive },
];

const adminNav = [
  { to: '/dashboard/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/dashboard/team', label: 'Team', icon: Users },
];

function Layout() {
  const { user } = useAuth();

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/50 p-5 flex flex-col">
        <div className="mb-8">
          <div className="text-lg font-semibold tracking-tight">Vastify</div>
          <div className="text-xs text-slate-400">CRM Storage</div>
        </div>
        <nav className="space-y-1 flex-1">
          {mainNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-50 border border-brand-600/30'
                    : 'text-slate-300 hover:bg-slate-800/60'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <>
              <div className="pt-4 pb-1 px-3 text-xs uppercase tracking-wider text-slate-500">Admin</div>
              {adminNav.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-brand-600/20 text-brand-50 border border-brand-600/30'
                        : 'text-slate-300 hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {user && (
          <div className="border-t border-slate-800 pt-4 mt-4">
            <div className="text-xs text-slate-400 px-3 mb-2 truncate">{user.displayName ?? user.sfUsername ?? user.userId ?? 'API key'}</div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 transition"
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Overview />} />
          <Route path="/dashboard/setup" element={<SetupAgent />} />
          <Route path="/dashboard/files" element={<FilesPage />} />
          <Route path="/dashboard/records" element={<RecordsPage />} />
          <Route path="/dashboard/rules" element={<RulesPage />} />
          <Route path="/dashboard/tenants" element={<TenantsPage />} />
          <Route path="/dashboard/backups" element={<Backups />} />
          <Route path="/dashboard/backups/:snapshotId" element={<SnapshotDetail />} />
          <Route path="/dashboard/settings" element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
          <Route path="/dashboard/team" element={<ProtectedRoute adminOnly><Team /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
