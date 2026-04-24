import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm space-y-8 px-6">
        <div className="text-center">
          <div className="text-2xl font-semibold tracking-tight text-white">Vastify</div>
          <div className="text-sm text-slate-400 mt-1">CRM Storage & Backup</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-white">Sign in</h2>
            <p className="text-sm text-slate-400 mt-1">
              Use your Salesforce account to access Vastify.
            </p>
          </div>

          <a
            href="/auth/salesforce/login"
            className="flex items-center justify-center gap-3 w-full rounded-lg bg-[#00A1E0] hover:bg-[#0090c8] text-white font-medium py-3 px-4 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9.7 7.4C10.3 6.2 11.5 5.4 12.9 5.4c1.8 0 3.3 1.2 3.8 2.9.6-.3 1.2-.4 1.9-.4 2.4 0 4.4 2 4.4 4.4s-2 4.4-4.4 4.4H7.1C5 16.7 3.3 15 3.3 12.9c0-1.9 1.3-3.4 3-3.8-.1-.3-.1-.6-.1-.9 0-2 1.6-3.6 3.6-3.6.3 0 .6 0 .9.1V7.4z"/>
            </svg>
            Continue with Salesforce
          </a>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-slate-900 px-3 text-slate-500">or</span>
            </div>
          </div>

          <a
            href="/auth/demo/login"
            className="flex items-center justify-center w-full rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium py-3 px-4 transition-colors text-sm"
          >
            Continue as Demo User
          </a>

          <p className="text-xs text-slate-500 text-center">
            Your Salesforce org becomes your Vastify workspace.
            First user is automatically the admin.
          </p>
        </div>
      </div>
    </div>
  );
}
