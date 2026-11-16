import type { User } from '../context/AuthContext';

export type AdminModule =
  | 'dashboard'
  | 'products'
  | 'inventory'
  | 'suppliers'
  | 'purchases'
  | 'customers'
  | 'activity'
  | 'sales'
  | 'insights'
  | 'recommendations'
  | 'reports'
  | 'support'
  | 'users'
  | 'settings';

export type PermissionAction = 'view' | 'create' | 'edit' | 'manage' | 'generate' | 'export' | 'respond' | 'delete';

const rolePermissions: Record<Exclude<User['role'], 'customer'>, Partial<Record<AdminModule, PermissionAction[]>>> = {
  super_admin: {
    dashboard: ['view'], products: ['view', 'create', 'edit', 'delete'], inventory: ['view', 'create', 'edit', 'manage'],
    suppliers: ['view', 'create', 'edit', 'delete'], purchases: ['view', 'create', 'manage', 'delete'],
    customers: ['view', 'manage'], activity: ['view'], sales: ['view', 'manage'], insights: ['view'], recommendations: ['view'],
    reports: ['view', 'generate', 'export'], support: ['view', 'respond'], users: ['view', 'manage'], settings: ['view'],
  },
  beauty_admin: {
    dashboard: ['view'], products: ['view', 'create', 'edit', 'delete'], inventory: ['view', 'create', 'edit', 'manage'],
    suppliers: ['view', 'create', 'edit', 'delete'], purchases: ['view', 'create', 'manage', 'delete'],
    customers: ['view', 'manage'], activity: ['view'], sales: ['view', 'manage'], insights: ['view'], recommendations: ['view'],
    reports: ['view', 'generate', 'export'], support: ['view', 'respond'],
  },
  beauty_staff: { dashboard: ['view'], inventory: ['view', 'manage'], activity: ['view'] },
};

export function hasModulePermission(
  user: Pick<User, 'role'> | null,
  module: AdminModule,
  action: PermissionAction = 'view',
): boolean {
  if (!user || user.role === 'customer') return false;
  return rolePermissions[user.role][module]?.includes(action) || false;
}

export function getFirstAdminRoute(user: Pick<User, 'role'> | null): string | null {
  const routes: Array<[AdminModule, string]> = [
    ['dashboard', '/admin/dashboard'],
    ['products', '/admin/products'],
    ['inventory', '/admin/inventory'],
    ['suppliers', '/admin/suppliers'],
    ['purchases', '/admin/purchases'],
    ['customers', '/admin/customers'],
    ['sales', '/admin/sales'],
    ['insights', '/admin/insights'],
    ['recommendations', '/admin/recommendations'],
    ['reports', '/admin/reports'],
    ['support', '/admin/reports/contact-us'],
    ['users', '/admin/users'],
    ['activity', '/admin/activity'],
    ['settings', '/admin/settings'],
  ];
  return routes.find(([module]) => hasModulePermission(user, module))?.[1] || null;
}
