import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  birthday?: string;
  role: 'customer' | 'super_admin' | 'beauty_admin' | 'beauty_staff';
  initials: string;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role?: string) => Promise<{ ok: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ ok: boolean; error?: string }>;
  socialLogin: (provider: 'Google' | 'Facebook') => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  isAdmin: boolean;
  isCustomer: boolean;
}

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

const Ctx = createContext<AuthCtx | null>(null);
const USER_STORAGE_KEY = 'pgbeauty-user';

type ProfileRow = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  role: 'Customer' | 'Beauty Staff' | 'Beauty Admin' | 'Super Admin';
  skin_profile?: Record<string, unknown>;
};

function toUser(authUser: SupabaseUser, profile?: ProfileRow | null): User {
  const names = (profile?.full_name || authUser.user_metadata?.full_name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = names[0] || authUser.email?.split('@')[0] || 'User';
  const lastName = names.slice(1).join(' ');
  const roleMap: Record<ProfileRow['role'], User['role']> = { Customer: 'customer', 'Beauty Staff': 'beauty_staff', 'Beauty Admin': 'beauty_admin', 'Super Admin': 'super_admin' };
  return {
    id: authUser.id,
    firstName,
    lastName,
    email: profile?.email || authUser.email || '',
    phone: profile?.phone || undefined,
    birthday: profile?.birthday || undefined,
    role: profile ? roleMap[profile.role] : 'customer',
    initials: `${firstName[0] || 'U'}${lastName[0] || ''}`.toUpperCase(),
  };
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function persistUser(nextUser: User | null) {
  try {
    if (!nextUser) {
      localStorage.removeItem(USER_STORAGE_KEY);
      return;
    }
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
  } catch {
    // Ignore storage quota issues.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [loading, setLoading] = useState(true);

  const loadProfile = async (authUser: SupabaseUser | null) => {
    if (!authUser) {
      setUser(null);
      persistUser(null);
      return;
    }

    const storedUser = readStoredUser();
    const { data, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
    const dbUser = toUser(authUser, data);
    const nextUser = storedUser && storedUser.id === authUser.id
      ? {
          ...dbUser,
          id: authUser.id,
          email: dbUser.email || storedUser.email,
          firstName: dbUser.firstName || storedUser.firstName,
          lastName: dbUser.lastName || storedUser.lastName,
          phone: dbUser.phone || storedUser.phone,
          birthday: dbUser.birthday || storedUser.birthday,
          role: dbUser.role || storedUser.role,
          initials: dbUser.initials || storedUser.initials,
        }
      : dbUser;

    setUser(nextUser);
    persistUser(nextUser);
    if (error) return;
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) void loadProfile(data.session?.user || null).finally(() => setLoading(false));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void loadProfile(session?.user || null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const unavailable = () => ({ ok: false, error: 'Supabase is not configured. Add the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables.' });

  const login = async (email: string, password: string, role?: string) => {
    if (!isSupabaseConfigured) return unavailable();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, error: error?.message || 'Login failed.' };
    await loadProfile(data.user);
    const nextRole = (await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle()).data?.role;
    if (role && role !== 'customer') {
      if (!['Super Admin', 'Beauty Admin', 'Beauty Staff'].includes(nextRole)) {
        await supabase.auth.signOut();
        return { ok: false, error: 'This account does not have admin access.' };
      }
    } else if (nextRole && nextRole !== 'Customer') {
      await supabase.auth.signOut();
      setUser(null);
      return { ok: false, error: 'Use the admin portal to sign in with this account.' };
    }
    return { ok: true };
  };

  const register = async (data: RegisterData) => {
    if (!isSupabaseConfigured) return unavailable();
    const { data: result, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { full_name: `${data.firstName} ${data.lastName}`.trim() } },
    });
    if (error) return { ok: false, error: error.message };
    if (result.user) await loadProfile(result.session?.user || null);
    return { ok: true };
  };

  const socialLogin = async (provider: 'Google' | 'Facebook') => {
    if (!isSupabaseConfigured) return unavailable();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider.toLowerCase() as 'google' | 'facebook',
      options: { redirectTo: `${window.location.origin}/login` },
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    persistUser(null);
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;

    const nextFirstName = (data.firstName || user.firstName || '').trim();
    const nextLastName = (data.lastName || user.lastName || '').trim();
    const nextPhone = data.phone?.trim() ? data.phone.trim() : user.phone || undefined;
    const nextBirthday = data.birthday && data.birthday !== '' ? data.birthday : user.birthday || undefined;

    const profileData = {
      id: user.id,
      full_name: `${nextFirstName} ${nextLastName}`.trim(),
      email: user.email,
      phone: nextPhone || null,
      birthday: nextBirthday || null,
    };

    const { data: updated, error } = await supabase
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) throw error;

    const mergedUser = {
      ...user,
      firstName: nextFirstName || user.firstName,
      lastName: nextLastName || user.lastName,
      phone: nextPhone,
      birthday: nextBirthday,
      initials: `${(nextFirstName || user.firstName || 'U')[0]}${(nextLastName || user.lastName || 'U')[0]}`.toUpperCase(),
    };

    const nextUser = updated ? toUser({ id: user.id, email: user.email } as SupabaseUser, updated) : mergedUser;
    setUser(nextUser);
    persistUser(nextUser);
  };

  const isAdmin = !!user && ['super_admin', 'beauty_admin', 'beauty_staff'].includes(user.role);
  const isCustomer = !!user && user.role === 'customer';

  return <Ctx.Provider value={{ user, loading, login, register, socialLogin, logout, updateUser, isAdmin, isCustomer }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
