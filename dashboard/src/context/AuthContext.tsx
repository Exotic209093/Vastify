import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '../lib/auth';
import { fetchMe } from '../lib/auth';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: null,
  refetch: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchMe()
      .then((u) => { setUser(u); setError(null); })
      .catch(() => { setUser(null); setError(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, refetch: load }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
