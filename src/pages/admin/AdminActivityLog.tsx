import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, DataTable, LoadingState } from '../../components/ui';
import AdminSidebar from '../../components/AdminSidebar';
import { fetchCustomerActivity, fetchUserActivity } from '../../lib/adminData';

const roleLabels: Record<string, string> = {
  super_admin: 'Super Administrator',
  beauty_admin: 'Beauty Administrator',
  beauty_staff: 'Beauty Staff',
  customer: 'Customer',
};

const actionLabels: Record<string, string> = {
  'session.active': 'Signed in',
  'user.invited': 'User invited',
  'user.role_changed': 'Role changed',
  'customer.status_changed': 'Customer status changed',
  'order.placed': 'Order placed',
  'order.cancelled': 'Order cancelled',
  'order.delivered': 'Order delivered',
  'order.received': 'Order received',
  'ai.chat': 'AI chat message',
  'support.ticket_submitted': 'Support ticket submitted',
};

function humanize(value: unknown) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
}

function formatRole(value: unknown) {
  const role = String(value ?? '');
  return roleLabels[role] || humanize(role) || 'Unknown role';
}

function formatAction(action: string) {
  if (actionLabels[action]) return actionLabels[action];

  const [subject, operation] = action.split('.');
  const operationLabels: Record<string, string> = {
    insert: 'created',
    update: 'updated',
    delete: 'deleted',
  };
  if (subject && operationLabels[operation]) {
    const subjectLabels: Record<string, string> = {
      profiles: 'Profile',
      products: 'Product',
      product_variants: 'Product variant',
      inventory: 'Inventory',
      orders: 'Order',
      support_inquiries: 'Support inquiry',
      support_responses: 'Support response',
    };
    return `${subjectLabels[subject] || humanize(subject)} ${operationLabels[operation]}`;
  }

  return humanize(action.replace(/\./g, ' ')) || 'Activity recorded';
}

function formatDetails(action: string, details: Record<string, unknown> = {}) {
  if (action === 'user.role_changed') {
    return `${formatRole(details.previous_role)} → ${formatRole(details.role)}`;
  }
  if (action === 'user.invited') return `Role: ${formatRole(details.role)}`;
  if (action === 'customer.status_changed') {
    return `${humanize(details.previous_status)} → ${humanize(details.status)}`;
  }
  if (action === 'session.active') return formatRole(details.role);
  if (action === 'order.placed') {
    const amount = Number(details.total_amount);
    const amountLabel = Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
    return [details.order_no ? `#${details.order_no}` : '', details.status, amountLabel].filter(Boolean).join(' · ') || '—';
  }
  if (action === 'order.delivered') {
    const amount = Number(details.total_amount);
    const amountLabel = Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
    return [details.order_no ? `#${details.order_no}` : '', 'Delivered', amountLabel].filter(Boolean).join(' · ') || '—';
  }
  if (action === 'order.cancelled') {
    return [details.order_no ? `#${details.order_no}` : '', 'Cancelled'].filter(Boolean).join(' · ') || '—';
  }
  if (action === 'order.received') {
    return [details.order_no ? `#${details.order_no}` : '', 'Delivered'].filter(Boolean).join(' · ') || '—';
  }
  if (action === 'ai.chat') {
    const conversation = details.conversation === 'support' ? 'Support Desk' : 'Beauty Stylist';
    const message = details.message ? String(details.message) : '';
    return [conversation, message ? `“${message}”` : 'Conversation started'].join(' · ');
  }
  if (action === 'support.ticket_submitted') {
    return [details.subject ? `Subject: ${details.subject}` : '', details.status || 'Open'].filter(Boolean).join(' · ') || '—';
  }
  if (action.startsWith('product.')) return String(details.product || 'Product');

  const ignoredKeys = new Set(['id', 'record_id', 'table', 'role', 'user_id', 'product_id', 'recommendation_id']);
  return Object.entries(details)
    .filter(([key, value]) => value !== null && value !== undefined && !ignoredKeys.has(key) && !key.endsWith('_id'))
    .map(([key, value]) => `${humanize(key)}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ') || '—';
}

export default function AdminActivityLog() {
  const [staffActivity, setStaffActivity] = useState<any[]>([]);
  const [customerActivity, setCustomerActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const [staff, customers] = await Promise.all([fetchUserActivity(), fetchCustomerActivity()]);
      setStaffActivity(staff);
      setCustomerActivity(customers);
      setError('');
    } catch (cause) {
      // supabase-js rejects with plain PostgrestError objects, not Error
      // instances, so read the message from the cause directly — otherwise the
      // real RPC failure (the reason the page was empty) is swallowed.
      const detail = cause instanceof Error
        ? cause.message
        : typeof (cause as { message?: unknown })?.message === 'string'
          ? (cause as { message: string }).message
          : '';
      setError(detail || 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadActivity(); }, [loadActivity]);

  const formatTime = (value: string) => value ? new Date(value).toLocaleString() : '—';

  return (
    <AdminSidebar>
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Activity Log</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Recorded account, catalog, and order activity.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadActivity()} loading={loading} aria-label="Refresh activity logs">
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">Unable to load activity logs: {error}</p>}

        <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-sm">Staff and Administrator Activity</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">Super administrators, beauty administrators, and beauty staff.</p>
          </div>
          <DataTable
            data={staffActivity.map(row => ({ ...row, occurred: formatTime(row.time) })) as any}
            emptyMessage={loading ? <LoadingState message="Hang tight, loading staff activity…" /> : 'No staff or administrator activity recorded.'}
            columns={[
              { key: 'user', label: 'User', render: (row: any) => <span className="font-medium">{row.user}</span> },
              { key: 'role', label: 'Role', render: (row: any) => <Badge variant="muted">{formatRole(row.role)}</Badge> },
              { key: 'action', label: 'Activity', render: (row: any) => formatAction(row.action) },
              { key: 'details', label: 'Details', render: (row: any) => <span className="block max-w-[280px] truncate text-xs text-[var(--muted-foreground)]" title={formatDetails(row.action, row.details)}>{formatDetails(row.action, row.details)}</span> },
              { key: 'occurred', label: 'Time' },
            ]}
          />
        </section>

        <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-sm">Customer Activity</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">Orders placed, cancelled, delivered, and support tickets submitted.</p>
          </div>
          <DataTable
            data={customerActivity.map(row => ({ ...row, occurred: formatTime(row.time) })) as any}
            emptyMessage={loading ? <LoadingState message="Hang tight, loading customer activity…" /> : 'No customer activity recorded.'}
            columns={[
              { key: 'customer', label: 'Customer', render: (row: any) => <div><div className="font-medium">{row.customer}</div><div className="text-xs text-[var(--muted-foreground)]">{row.email}</div></div> },
              { key: 'action', label: 'Activity', render: (row: any) => formatAction(row.action) },
              { key: 'details', label: 'Details', render: (row: any) => <span className="block max-w-[320px] truncate text-xs text-[var(--muted-foreground)]" title={formatDetails(row.action, row.details)}>{formatDetails(row.action, row.details)}</span> },
              { key: 'occurred', label: 'Time' },
            ]}
          />
        </section>
      </div>
    </AdminSidebar>
  );
}
