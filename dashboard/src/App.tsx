import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { LayoutDashboard, Files, Database, Sliders, KeyRound } from 'lucide-react';
import Overview from './pages/Overview';
import FilesPage from './pages/Files';
import RecordsPage from './pages/Records';
import RulesPage from './pages/Rules';
import TenantsPage from './pages/Tenants';

const nav = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/files', label: 'Files', icon: Files },
  { to: '/dashboard/records', label: 'Records', icon: Database },
  { to: '/dashboard/rules', label: 'Rules', icon: Sliders },
  { to: '/dashboard/tenants', label: 'Tenants', icon: KeyRound },
];

export default function App() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/50 p-5">
        <div className="mb-8">
          <div className="text-lg font-semibold tracking-tight">Vastify</div>
          <div className="text-xs text-slate-400">CRM Storage</div>
        </div>
        <nav className="space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
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
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Overview />} />
          <Route path="/dashboard/files" element={<FilesPage />} />
          <Route path="/dashboard/records" element={<RecordsPage />} />
          <Route path="/dashboard/rules" element={<RulesPage />} />
          <Route path="/dashboard/tenants" element={<TenantsPage />} />
        </Routes>
      </main>
    </div>
  );
}
