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
  role: 'customer' | 'beauty_staff' | 'beauty_admin' | 'super_admin';
  accountStatus: 'Active' | 'Inactive';
  initials: string;
  /** Beauty quiz answers saved to profiles.skin_profile; null until the quiz is taken. */
  skinProfile?: Record<string, unknown> | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role?: string) => Promise<{ ok: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ ok: boolean; error?: string }>;
  socialLogin: (provider: 'Google' | 'Facebook') => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
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
  user_id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null;
  role: User['role'];
  account_status?: 'Active' | 'Inactive' | null;
  skin_profile?: Record<string, unknown>;
};

function toUser(authUser: SupabaseUser, profile?: ProfileRow | null): User {
  const legacyNames = (authUser.user_metadata?.full_name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = profile?.first_name || authUser.user_metadata?.first_name || legacyNames[0] || authUser.email?.split('@')[0] || 'User';
  const lastName = profile?.last_name || authUser.user_metadata?.last_name || legacyNames.slice(1).join(' ');
  return {
    id: authUser.id,
    firstName,
    lastName,
    email: profile?.email || authUser.email || '',
    phone: profile?.phone || undefined,
    birthday: profile?.birthday || undefined,
    role: profile?.role || 'customer',
    accountStatus: profile?.account_status === 'Inactive' ? 'Inactive' : 'Active',
    initials: `${firstName[0] || 'U'}${lastName[0] || ''}`.toUpperCase(),
    skinProfile: profile?.skin_profile ?? null,
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

  const loadProfile = async (authUser: SupabaseUser | null): Promise<User | null> => {
    if (!authUser) {
      setUser(null);
      persistUser(null);
      return null;
    }

    const storedUser = readStoredUser();
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', authUser.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Your account profile could not be loaded.');
    const dbUser = toUser(authUser, data);
    const nextUser = storedUser && storedUser.id === authUser.id
      ? {
          ...dbUser,
          id: authUser.id,
          email: dbUser.email || storedUser.email,
          firstName: dbUser.firstName || storedUser.firstName,
          lastName: dbUser.lastName || storedUser.lastName,
          phone: dbUser.phone || storedUser.phone,
          birthday: data ? dbUser.birthday : storedUser.birthday,
          initials: dbUser.initials || storedUser.initials,
        }
      : dbUser;

    setUser(nextUser);
    persistUser(nextUser);
    return nextUser;
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      try {
        await loadProfile(data.session?.user || null);
      } catch (error) {
        console.error('Unable to load account profile:', error);
        setUser(null);
        persistUser(null);
        if (data.session) await supabase.auth.signOut();
      } finally {
        if (active) setLoading(false);
      }
    }).catch(error => {
      console.error('Unable to restore the authentication session:', error);
      if (active) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        void loadProfile(session?.user || null).catch(error => {
          console.error('Unable to load account profile:', error);
          setUser(null);
          persistUser(null);
          if (session) void supabase.auth.signOut();
        });
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const markActive = () => {
      void supabase.rpc('touch_user_activity')
        .then(({ error }) => { if (error) console.error('Unable to update account activity:', error.message); });
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') markActive(); };
    markActive();
    const interval = window.setInterval(markActive, 30_000);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', markActive);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', markActive);
    };
  }, [user?.id]);

  const unavailable = () => ({ ok: false, error: 'Supabase is not configured. Add the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables.' });

  const login = async (email: string, password: string, role?: string) => {
    if (!isSupabaseConfigured) return unavailable();
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.user) return { ok: false, error: error?.message || 'Login failed.' };
    let signedInUser: User | null;
    try {
      signedInUser = await loadProfile(data.user);
    } catch (cause) {
      await supabase.auth.signOut();
      return { ok: false, error: cause instanceof Error ? cause.message : 'Unable to load your account.' };
    }
    if (!signedInUser || signedInUser.accountStatus !== 'Active') {
      await supabase.auth.signOut();
      setUser(null);
      persistUser(null);
      return { ok: false, error: 'This account is inactive. Contact an administrator for assistance.' };
    }

    if (role && role !== 'customer') {
      if (signedInUser.role === 'customer') {
        await supabase.auth.signOut();
        return { ok: false, error: 'This account does not have admin access.' };
      }
    } else if (signedInUser.role !== 'customer') {
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
      options: { data: { first_name: data.firstName, last_name: data.lastName } },
    });
    if (error) return { ok: false, error: error.message };
    if (result.session?.user) await loadProfile(result.session.user);
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

  const refreshUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('Your session has expired. Sign in again.');
    const refreshedUser = await loadProfile(data.user);
    if (!refreshedUser) throw new Error('Your account profile could not be loaded.');
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;

    const nextFirstName = (data.firstName || user.firstName || '').trim();
    const nextLastName = (data.lastName || user.lastName || '').trim();
    const nextPhone = data.phone?.trim() ? data.phone.trim() : user.phone || undefined;
    const nextBirthday = data.birthday !== undefined ? data.birthday || undefined : user.birthday;

    const { data: updated, error } = await supabase
      .from('profiles')
      .update({
        first_name: nextFirstName,
        last_name: nextLastName,
        phone: nextPhone || null,
        birthday: nextBirthday || null,
      })
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!updated) throw new Error('Your profile could not be found.');

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

  const isAdmin = !!user && user.role !== 'customer';
  const isCustomer = !!user && user.role === 'customer';

  return <Ctx.Provider value={{ user, loading, login, register, socialLogin, logout, refreshUser, updateUser, isAdmin, isCustomer }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
