/**
 * src/lib/auth.tsx
 * Real authentication context — talks to the Express /api/* backend.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
  must_change_password: boolean;
  email_verified: boolean;
  trusted: boolean;
  banned: boolean;
  is_admin: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContext extends AuthState {
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthContext | null>(null);

/** Thin fetch wrapper — always sends credentials (HttpOnly cookie). */
async function api<T>(path: string, opts?: RequestInit): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
      ...opts,
    });
    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) return { error: (json['error'] as string) ?? 'Something went wrong' };
    return { data: json as T };
  } catch {
    return { error: 'Network error — check your connection' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const refresh = useCallback(async () => {
    const { data } = await api<{ user: User | null }>('/api/me');
    setState({ user: data?.user ?? null, loading: false });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = async (username: string, password: string) => {
    const { data, error } = await api<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (error) return { ok: false, error };
    setState({ user: data?.user ?? null, loading: false });
    return { ok: true };
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setState({ user: null, loading: false });
  };

  return (
    <Ctx.Provider value={{ ...state, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
