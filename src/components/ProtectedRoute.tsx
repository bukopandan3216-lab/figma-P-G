import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getFirstAdminRoute, hasModulePermission, type AdminModule, type PermissionAction } from '../lib/permissions';
import { LoadingState } from './ui';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isCustomer, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState fullScreen message="Hang tight, checking your account…" />;
  if (!user) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  if (!isCustomer) return <Navigate to="/admin/dashboard" replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState fullScreen message="Hang tight, checking administrator access…" />;
  if (!user) return <Navigate to="/admin/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RequirePermission({
  module,
  action = 'view',
  children,
}: {
  module: AdminModule;
  action?: PermissionAction;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState fullScreen message="Hang tight, checking your permissions…" />;
  if (!user) return <Navigate to="/admin/login" state={{ from: `${location.pathname}${location.search}` }} replace />;
  if (user.role === 'customer') return <Navigate to="/" replace />;
  if (hasModulePermission(user, module, action)) return <>{children}</>;

  const fallback = getFirstAdminRoute(user);
  if (fallback && fallback !== location.pathname) return <Navigate to={fallback} replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-6">
      <div role="alert" className="max-w-md rounded-[var(--radius-xl)] border border-[var(--border)] bg-white p-6 text-center">
        <h1 className="font-semibold mb-2">Access not assigned</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Your account is not authorized to access this module. Contact your Super Admin.</p>
      </div>
    </div>
  );
}

export function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingState fullScreen message="Hang tight, checking your account…" />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
