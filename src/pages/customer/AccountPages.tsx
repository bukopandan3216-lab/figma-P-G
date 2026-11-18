import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Package, Heart, Settings, LogOut, ChevronRight, MapPin, CreditCard, MessageSquare,
  Eye, EyeOff, Sparkles, Plus, Trash2, Edit2, Check, X, Smartphone, ArrowLeft, Mail
} from 'lucide-react';
import { Button, Input, Badge, Modal, LoadingState } from '../../components/ui';
import { useCart } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../context/CatalogContext';
import CustomerNav from '../../components/CustomerNav';
import { useToast, ToastContainer } from '../../components/ui';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { safeImage } from '../../lib/image';
import { resolveVariant } from '../../lib/variant';

// ─── Login Page ───────────────────────────────────────────────────────────────
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, socialLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/';
  const goBack = () => window.history.length > 1 ? navigate(-1) : navigate('/');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setLoading(true); setError('');
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) navigate(destination, { replace: true });
    else setError(result.error || 'Login failed.');
  };

  const handleSocialLogin = async (provider: 'Google' | 'Facebook') => {
    setLoading(true); setError('');
    const result = await socialLogin(provider);
    setLoading(false);
    if (result.ok) navigate(destination, { replace: true });
    else setError(result.error || `${provider} sign in failed.`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4 sm:p-6">
      <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center"><Sparkles size={14} className="text-white" /></div>
            <span className="font-display text-xl">P&G Beauty</span>
          </div>
          <div className="flex items-center justify-between gap-4 mb-1">
            <h1 className="font-display text-3xl">Welcome back</h1>
            <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors" aria-label="Go back">
              <ArrowLeft size={15} aria-hidden="true" /> Back
            </button>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm mb-8">Sign in to your account</p>
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius)] text-sm text-red-700 flex items-center gap-2">
              <X size={14} className="flex-shrink-0" />{error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input label="Email" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </div>
            <div className="flex justify-end"><Link to="/forgot-password" className="text-xs text-[#B5697A] hover:underline">Forgot password?</Link></div>
            <Button type="submit" size="lg" className="w-full" loading={loading}>Sign In</Button>
            <div className="relative flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-[var(--muted-foreground)]">or continue with</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" onClick={() => handleSocialLogin('Google')} disabled={loading}><span className="font-bold text-sm text-[#4285F4]">G</span> Google</Button>
              <Button type="button" variant="outline" onClick={() => handleSocialLogin('Facebook')} disabled={loading}><span className="font-bold text-sm">f</span> Facebook</Button>
            </div>
            <div className="text-center text-sm text-[var(--muted-foreground)]">
              Don't have an account? <Link to="/register" className="text-[var(--primary)] font-medium hover:underline">Create one</Link>
            </div>
          </form>
        </div>
    </div>
  );
}

// ─── Register Page ────────────────────────────────────────────────────────────
export function RegisterPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const { register, socialLogin } = useAuth();
  const navigate = useNavigate();
  const goBack = () => window.history.length > 1 ? navigate(-1) : navigate('/');

  const handleSocialRegister = async (provider: 'Google' | 'Facebook') => {
    setLoading(true); setError('');
    const result = await socialLogin(provider);
    setLoading(false);
    if (result.ok) navigate('/quiz');
    else setError(result.error || `${provider} sign up failed.`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.password) { setError('Please fill in all fields.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!agreed) { setError('Please agree to the Terms of Service.'); return; }
    setLoading(true); setError('');
    const result = await register({ firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password });
    setLoading(false);
    if (result.ok) navigate('/quiz');
    else setError(result.error || 'Registration failed.');
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center"><Sparkles size={14} className="text-white" /></div>
          <span className="font-display text-xl">P&G Beauty</span>
        </div>
        <div className="flex items-center justify-between gap-4 mb-1">
          <h1 className="font-display text-3xl">Create your account</h1>
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors" aria-label="Go back">
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
        </div>
        <p className="text-[var(--muted-foreground)] text-sm mb-8">Get personalized beauty recommendations</p>
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius)] text-sm text-red-700 flex items-center gap-2">
            <X size={14} className="flex-shrink-0" />{error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="First Name" placeholder="Maria" value={form.firstName} onChange={set('firstName')} />
            <Input label="Last Name" placeholder="Santos" value={form.lastName} onChange={set('lastName')} />
          </div>
          <Input label="Email" type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} />
          <Input label="Password" type="password" placeholder="••••••••" value={form.password} onChange={set('password')} hint="At least 8 characters" />
          <Input label="Confirm Password" type="password" placeholder="••••••••" value={form.confirmPassword} onChange={set('confirmPassword')} />
          <label className="flex items-start gap-2.5 cursor-pointer text-sm text-[var(--muted-foreground)]">
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[var(--primary)]" />
            I agree to the <Link to="/info/terms" className="text-[var(--primary)] underline">Terms of Service</Link> and <Link to="/info/privacy" className="text-[var(--primary)] underline">Privacy Policy</Link>
          </label>
          <Button type="submit" size="lg" className="w-full" loading={loading}>Create Account & Take Beauty Quiz</Button>
          <div className="relative flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs text-[var(--muted-foreground)]">or sign up with</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={() => handleSocialRegister('Google')} disabled={loading}><span className="font-bold text-sm text-[#4285F4]">G</span> Google</Button>
            <Button type="button" variant="outline" onClick={() => handleSocialRegister('Facebook')} disabled={loading}><span className="font-bold text-sm">f</span> Facebook</Button>
          </div>
          <div className="text-center text-sm text-[var(--muted-foreground)]">
            Already have an account? <Link to="/login" className="text-[var(--primary)] font-medium hover:underline">Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Forgot Password ──────────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center"><Sparkles size={14} className="text-white" /></div>
          <span className="font-display text-xl">P&G Beauty</span>
        </div>
        {!sent ? (
          <>
            <h1 className="font-display text-3xl mb-1">Reset password</h1>
            <p className="text-[var(--muted-foreground)] text-sm mb-8">Enter your email and we'll send a reset link.</p>
            <div className="flex flex-col gap-4">
              <Input label="Email" type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} />
              <Button className="w-full" onClick={() => email && setSent(true)}>Send Reset Link</Button>
              <Link to="/login" className="text-center text-sm text-[var(--primary)] hover:underline">Back to sign in</Link>
            </div>
          </>
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--primary)]"><Mail size={22} aria-hidden="true" /></div>
            <h2 className="font-semibold text-lg mb-2">Check your inbox</h2>
            <p className="text-sm text-[var(--muted-foreground)] mb-1">A password reset link has been sent to</p>
            <p className="font-medium text-sm mb-6">{email}</p>
            <Link to="/login"><Button variant="outline">Back to Sign In</Button></Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Account Settings ─────────────────────────────────────────────────────────
type AccountSectionId = 'profile' | 'tickets' | 'orders' | 'wishlist' | 'addresses' | 'payment';

export function AccountPage({ initialSection = 'profile' }: { initialSection?: AccountSectionId }) {
  const [activeSection, setActiveSection] = useState<AccountSectionId>(initialSection);
  const { user, logout, updateUser } = useAuth();
  const { toasts, add: addToast, remove } = useToast();
  const navigate = useNavigate();

  useEffect(() => { setActiveSection(initialSection); }, [initialSection]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems: { id: AccountSectionId; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Profile', icon: <Settings size={16} /> },
    { id: 'tickets', label: 'Support Tickets', icon: <MessageSquare size={16} /> },
    { id: 'orders', label: 'My Orders', icon: <Package size={16} /> },
    { id: 'wishlist', label: 'Wishlist', icon: <Heart size={16} /> },
    { id: 'addresses', label: 'Addresses', icon: <MapPin size={16} /> },
    { id: 'payment', label: 'Payment Methods', icon: <CreditCard size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-display text-3xl mb-8">My Account</h1>
        <div className="flex flex-col gap-6 md:flex-row">
          <aside className="md:w-56 flex-shrink-0">
            <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-4">
              <div className="flex items-center gap-3 mb-4 px-2">
                <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-bold text-[var(--primary)]">
                  {user?.initials || 'U'}
                </div>
                <div>
                  <div className="font-semibold text-sm">{user?.firstName} {user?.lastName}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{user?.email}</div>
                </div>
              </div>
              <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
                {navItems.map(item => (
                  <button key={item.id} onClick={() => setActiveSection(item.id)} className={`flex shrink-0 items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-inner)] text-sm font-medium transition-all text-left ${activeSection === item.id ? 'bg-[var(--primary)] text-white' : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'}`}>
                    {item.icon}{item.label}
                  </button>
                ))}
                <button onClick={handleLogout} className="flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius)] text-sm font-medium text-red-500 hover:bg-red-50 transition-all mt-2">
                  <LogOut size={16} />Sign Out
                </button>
              </nav>
            </div>
          </aside>
          <main className="flex-1 min-w-0">
            {activeSection === 'profile' && <ProfileSection user={user} updateUser={updateUser} addToast={addToast} />}
            {activeSection === 'tickets' && <TicketsSection />}
            {activeSection === 'orders' && <OrdersSection addToast={addToast} />}
            {activeSection === 'wishlist' && <WishlistSection />}
            {activeSection === 'addresses' && <AddressesSection addToast={addToast} />}
            {activeSection === 'payment' && <PaymentSection addToast={addToast} />}
          </main>
        </div>
      </div>
    </div>
  );
}

type SupportTicket = {
  id: number;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  support_reply: string | null;
};

function TicketsSection() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const loadTickets = async () => {
      setLoading(true);
      setError('');
      setTickets([]);
      try {
        if (!user) {
          throw new Error('Sign in to view your support tickets.');
        }
        if (!isSupabaseConfigured) {
          throw new Error('Support tickets are unavailable because Supabase is not configured.');
        }

        const fields = 'id:inquiry_id, subject, message, status, created_at, support_reply';
        const { data: ownedTickets, error: ownedError } = await supabase
          .from('support_inquiries')
          .select(fields)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (ownedError) throw ownedError;

        let legacyTickets: SupportTicket[] = [];
        if (user.email) {
          const { data, error: legacyError } = await supabase
            .from('support_inquiries')
            .select(fields)
            .is('user_id', null)
            .eq('email', user.email)
            .order('created_at', { ascending: false });
          if (legacyError) throw legacyError;
          legacyTickets = (data || []) as SupportTicket[];
        }

        if (active) {
          setTickets([...((ownedTickets || []) as SupportTicket[]), ...legacyTickets]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load support tickets.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadTickets();
    return () => { active = false; };
  }, [user?.id, user?.email]);

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <h2 className="font-semibold mb-5">Support Tickets</h2>
      {loading && <LoadingState message="Hang tight, loading your support tickets…" />}
      {!loading && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!loading && !error && tickets.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">You haven't sent any support tickets yet.</p>
      )}
      {!loading && !error && tickets.length > 0 && (
        <div className="flex flex-col gap-4">
          {tickets.map(ticket => {
            const statusVariant = ticket.status === 'Resolved' ? 'success' : ticket.status === 'Pending' ? 'info' : 'warning';
            const submitted = new Date(ticket.created_at);
            return (
              <article key={ticket.id} className="border border-[var(--border)] rounded-[var(--radius-lg)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div>
                    <h3 className="font-semibold text-sm">{ticket.subject}</h3>
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      Ticket #{ticket.id} · {Number.isNaN(submitted.getTime()) ? 'Date unavailable' : submitted.toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={statusVariant}>{ticket.status}</Badge>
                </div>
                <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap">{ticket.message}</p>
                {ticket.support_reply && (
                  <div className="mt-4 rounded-[var(--radius)] bg-[var(--secondary)] p-3">
                    <p className="text-xs font-semibold mb-1">Support reply</p>
                    <p className="text-sm whitespace-pre-wrap">{ticket.support_reply}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Profile Section ──────────────────────────────────────────────────────────
function ProfileSection({ user, updateUser, addToast }: any) {
  const [form, setForm] = useState({ firstName: user?.firstName || '', lastName: user?.lastName || '', email: user?.email || '', phone: user?.phone || '' });
  const [birthdayParts, setBirthdayParts] = useState(() => {
    const [year = '', month = '', day = ''] = (user?.birthday || '').split('-');
    return { year, month, day };
  });
  useEffect(() => {
    const [year = '', month = '', day = ''] = (user?.birthday || '').split('-');
    setBirthdayParts({ year, month, day });
  }, [user?.birthday]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const { year: birthdayYear, month: birthdayMonth, day: birthdayDay } = birthdayParts;
  const years = Array.from({ length: new Date().getFullYear() - 1919 }, (_, index) => String(new Date().getFullYear() - index));
  const dayCount = birthdayYear && birthdayMonth
    ? new Date(Number(birthdayYear), Number(birthdayMonth), 0).getDate()
    : 31;
  const updateBirthday = (part: 'year' | 'month' | 'day', value: string) => {
    setBirthdayParts(previous => {
      const next = { ...previous, [part]: value };
      if (next.year && next.month && Number(next.day) > new Date(Number(next.year), Number(next.month), 0).getDate()) {
        next.day = '';
      }
      return next;
    });
  };

  const save = async () => {
    const birthdayValues = [birthdayYear, birthdayMonth, birthdayDay];
    const hasBirthdayPart = birthdayValues.some(Boolean);
    const hasCompleteBirthday = birthdayValues.every(Boolean);
    if (hasBirthdayPart && !hasCompleteBirthday) {
      addToast('error', 'Select a month, day, and year, or clear all birthday fields.');
      return;
    }

    try {
      await updateUser({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        birthday: hasCompleteBirthday ? `${birthdayYear}-${birthdayMonth}-${birthdayDay}` : '',
        initials: `${(form.firstName || 'U')[0]}${(form.lastName || 'U')[0]}`.toUpperCase(),
      });
      addToast('success', 'Profile updated successfully!');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Profile update failed.');
    }
  };

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <h2 className="font-semibold mb-5">Profile Information</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="First Name" value={form.firstName} onChange={set('firstName')} />
        <Input label="Last Name" value={form.lastName} onChange={set('lastName')} />
        <Input label="Email" type="email" value={form.email} disabled className="sm:col-span-2 opacity-60" />
        <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="+63 912 345 6789" />
        <div className="sm:col-span-2">
          <label className="text-sm font-medium block mb-1.5">Birthday</label>
          <div className="grid grid-cols-3 gap-2">
            <select aria-label="Birth month" value={birthdayMonth} onChange={event => updateBirthday('month', event.target.value)} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm">
              <option value="">Month</option>
              {Array.from({ length: 12 }, (_, index) => { const value = String(index + 1).padStart(2, '0'); return <option key={value} value={value}>{new Date(2000, index).toLocaleString('en', { month: 'long' })}</option>; })}
            </select>
            <select aria-label="Birth day" value={birthdayDay} onChange={event => updateBirthday('day', event.target.value)} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm">
              <option value="">Day</option>
              {Array.from({ length: dayCount }, (_, index) => { const value = String(index + 1).padStart(2, '0'); return <option key={value} value={value}>{index + 1}</option>; })}
            </select>
            <select aria-label="Birth year" value={birthdayYear} onChange={event => updateBirthday('year', event.target.value)} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm">
              <option value="">Year</option>
              {years.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
        </div>
      </div>
      <Button className="mt-6" onClick={save}>Save Changes</Button>
    </div>
  );
}

// ─── Orders Section ───────────────────────────────────────────────────────────
function OrdersSection({ addToast }: { addToast: (t: any, m: string) => void }) {
  const [tracking, setTracking] = useState<string | null>(null);
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    if (!user) return;
    void supabase.from('orders').select('id:order_id, created_at, status, total_amount, order_items(quantity, price_at_purchase, product_variants(products(name, image)))').eq('user_id', user.id).order('created_at', { ascending: false }).then(({ data }) => {
      setOrders((data || []).map((order: any) => ({ id: order.id, date: new Date(order.created_at).toLocaleDateString(), status: order.status, total: Number(order.total_amount), items: (order.order_items || []).map((item: any) => ({ name: item.product_variants?.products?.name || 'Product', qty: item.quantity, price: Number(item.price_at_purchase), image: item.product_variants?.products?.image || '' })) })));
    });
  }, [user?.id]);
  const trackingSteps = ['Order Placed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'];

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <h2 className="font-semibold mb-5">My Orders</h2>
      {orders.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No orders yet.</p>}
      <div className="flex flex-col gap-4">
        {orders.map(order => (
          <div key={order.id} className="border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[var(--secondary)]">
              <div>
                <div className="text-sm font-semibold">{order.id}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{order.date}</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={order.status === 'Delivered' ? 'success' : order.status === 'In Transit' ? 'info' : 'warning'}>{order.status}</Badge>
                <span className="font-bold text-sm">₱{order.total.toFixed(2)}</span>
              </div>
            </div>
            {order.items.map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-t border-[var(--border)]">
                <img src={safeImage(item.image, item.name)} alt="" className="w-12 h-12 object-cover rounded-[var(--radius)] bg-[var(--secondary)] flex-shrink-0" />
                <div className="flex-1"><div className="text-sm font-medium">{item.name}</div><div className="text-xs text-[var(--muted-foreground)]">Qty: {item.qty}</div></div>
                <span className="text-sm font-semibold">₱{item.price.toFixed(2)}</span>
              </div>
            ))}
            <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
              <Button size="sm" variant="outline" onClick={() => setTracking(tracking === order.id ? null : order.id)}>
                {tracking === order.id ? 'Hide' : 'Track'} Order
              </Button>
              <Button size="sm" variant="ghost" onClick={() => addToast('success', 'Items added to cart!')}>Reorder</Button>
            </div>
            {tracking === order.id && (
              <div className="px-4 pb-4">
                <div className="flex items-center">
                  {trackingSteps.map((step, i) => {
                    const done = order.status === 'Delivered' ? i <= 4 : i <= 2;
                    return (
                      <div key={step} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center gap-1">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${done ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>{done ? <Check size={11} /> : i + 1}</div>
                          <span className="text-[9px] text-center text-[var(--muted-foreground)] leading-tight w-14">{step}</span>
                        </div>
                        {i < trackingSteps.length - 1 && <div className={`flex-1 h-0.5 mb-5 ${done && i < (order.status === 'Delivered' ? 4 : 2) ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'}`} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Wishlist Section ─────────────────────────────────────────────────────────
function WishlistSection() {
  const { wishlist, addToCart, toggleWishlist } = useCart();
  const { products } = useCatalog();
  const wishedProducts = products.filter(p => wishlist.includes(p.id));

  if (wishedProducts.length === 0) return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6 text-center py-16">
      <Heart size={44} className="mx-auto text-[var(--muted-foreground)] opacity-20 mb-4" />
      <h3 className="font-semibold mb-1">Your wishlist is empty</h3>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">Save products you love by clicking the heart icon.</p>
      <Link to="/"><Button>Explore Products</Button></Link>
    </div>
  );

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <h2 className="font-semibold mb-5">Wishlist <span className="text-[var(--muted-foreground)] font-normal text-sm">({wishedProducts.length})</span></h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {wishedProducts.map(p => (
          <div key={p.id} className="group border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="relative aspect-square bg-[var(--secondary)] overflow-hidden">
              <img src={safeImage(p.image, p.name)} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              <button onClick={() => toggleWishlist(p.id)} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
                <Heart size={14} fill="currentColor" className="text-[var(--primary)]" />
              </button>
            </div>
            <div className="p-3">
              <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">{p.brand}</div>
              <div className="text-sm font-semibold line-clamp-2 mb-2 leading-snug">{p.name}</div>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">₱{resolveVariant(p).price.toFixed(2)}</span>
                <Button size="sm" onClick={() => addToCart({ id: p.id, name: p.name, brand: p.brand, price: resolveVariant(p).price, image: p.image, stock: resolveVariant(p).stock, inStock: p.inStock && resolveVariant(p).stock > 0, variantId: resolveVariant(p).variantId, variantLabel: resolveVariant(p).label })} disabled={!p.inStock || resolveVariant(p).stock <= 0} className="text-xs">Add</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Addresses Section ────────────────────────────────────────────────────────
interface Address { id: string; label: string; name: string; line1: string; city: string; zip: string; phone: string; isDefault: boolean; }

function readStoredAddresses(): Address[] {
  try {
    const raw = localStorage.getItem('pgbeauty-addresses');
    return raw ? JSON.parse(raw) as Address[] : [];
  } catch {
    return [];
  }
}

function persistAddresses(addresses: Address[]) {
  try {
    localStorage.setItem('pgbeauty-addresses', JSON.stringify(addresses));
  } catch {
    // Ignore storage quota issues.
  }
}

function AddressesSection({ addToast }: any) {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editAddr, setEditAddr] = useState<Address | null>(null);
  const [form, setForm] = useState({ label: 'Home', name: '', line1: '', city: '', zip: '', phone: '' });

  useEffect(() => {
    if (!user) return;
    void supabase.from('user_addresses').select('id:address_id, label, full_name, line1, city, zip, phone, is_default').eq('user_id', user.id).order('created_at').then(({ data, error }) => {
      if (error) { addToast('error', error.message); return; }
      setAddresses((data || []).map((address: any) => ({
        id: address.id,
        label: address.label,
        name: address.full_name,
        line1: address.line1,
        city: address.city,
        zip: address.zip,
        phone: address.phone || '',
        isDefault: address.is_default,
      })));
    });
  }, [user?.id]);

  const openAdd = () => { setEditAddr(null); setForm({ label: 'Home', name: '', line1: '', city: '', zip: '', phone: '' }); setModalOpen(true); };
  const openEdit = (a: Address) => { setEditAddr(a); setForm({ label: a.label, name: a.name, line1: a.line1, city: a.city, zip: a.zip, phone: a.phone }); setModalOpen(true); };

  const save = async () => {
    if (!user) return;
    const isDefault = editAddr ? editAddr.isDefault : addresses.length === 0;
    const payload = { user_id: user.id, label: form.label, full_name: form.name, line1: form.line1, city: form.city, zip: form.zip, phone: form.phone, is_default: isDefault };
    const { data, error } = editAddr
      ? await supabase.from('user_addresses').update(payload).eq('address_id', editAddr.id).eq('user_id', user.id).select().single()
      : await supabase.from('user_addresses').insert(payload).select().single();
    if (error) { addToast('error', error.message); return; }
    if (isDefault) await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', user.id).neq('address_id', data.id);
    const nextAddress = { id: data.id, label: data.label, name: data.full_name, line1: data.line1, city: data.city, zip: data.zip, phone: data.phone || '', isDefault: data.is_default };
    setAddresses(prev => editAddr ? prev.map(address => address.id === editAddr.id ? nextAddress : (isDefault ? { ...address, isDefault: false } : address)) : [...prev.map(address => isDefault ? { ...address, isDefault: false } : address), nextAddress]);
    addToast('success', editAddr ? 'Address updated!' : 'Address added!');
    setModalOpen(false);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('user_addresses').delete().eq('address_id', id).eq('user_id', user?.id);
    if (error) { addToast('error', error.message); return; }
    setAddresses(prev => prev.filter(a => a.id !== id)); addToast('info', 'Address removed.');
  };
  const setDefault = async (id: string) => {
    if (!user) return;
    const { error: clearError } = await supabase.from('user_addresses').update({ is_default: false }).eq('user_id', user.id);
    const { error } = clearError ? { error: clearError } : await supabase.from('user_addresses').update({ is_default: true }).eq('address_id', id).eq('user_id', user.id);
    if (error) { addToast('error', error.message); return; }
    setAddresses(prev => prev.map(a => ({ ...a, isDefault: a.id === id }))); addToast('success', 'Default address updated.');
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold">Delivery Addresses</h2>
        <Button size="sm" onClick={openAdd}><Plus size={14} /> Add Address</Button>
      </div>
      <div className="flex flex-col gap-3">
        {addresses.map(addr => (
          <div key={addr.id} className={`relative border-2 rounded-[var(--radius-lg)] p-4 transition-all ${addr.isDefault ? 'border-[var(--primary)] bg-[var(--rose-light)]/30' : 'border-[var(--border)]'}`}>
            {addr.isDefault && <div className="absolute top-3 right-3"><Badge variant="rose">Default</Badge></div>}
            <div className="flex items-center gap-2 mb-2">
              <MapPin size={14} className="text-[var(--primary)]" />
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">{addr.label}</span>
            </div>
            <div className="text-sm font-semibold">{addr.name}</div>
            <div className="text-sm text-[var(--muted-foreground)] mt-0.5">{addr.line1}</div>
            <div className="text-sm text-[var(--muted-foreground)]">{addr.city} {addr.zip}</div>
            <div className="text-sm text-[var(--muted-foreground)]">{addr.phone}</div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => openEdit(addr)} className="text-xs"><Edit2 size={12} /> Edit</Button>
              {!addr.isDefault && <Button size="sm" variant="ghost" onClick={() => setDefault(addr.id)} className="text-xs">Set as Default</Button>}
              {!addr.isDefault && (
                <Button size="sm" variant="ghost" onClick={() => remove(addr.id)} className="text-xs text-red-500 hover:bg-red-50">
                  <Trash2 size={12} /> Remove
                </Button>
              )}
            </div>
          </div>
        ))}
        {addresses.length === 0 && (
          <div className="text-center py-10 text-[var(--muted-foreground)] text-sm">
            <MapPin size={32} className="mx-auto opacity-20 mb-2" />No addresses saved yet.
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editAddr ? 'Edit Address' : 'Add New Address'}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Label</label>
            <select value={form.label} onChange={set('label')} className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]">
              {['Home', 'Office', 'Other'].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
          <Input label="Full Name" value={form.name} onChange={set('name')} placeholder="Maria Santos" />
          <Input label="Street Address" value={form.line1} onChange={set('line1')} placeholder="123 Rizal St., Barangay San Antonio" />
          <Input label="City & Province" value={form.city} onChange={set('city')} placeholder="Makati City, Metro Manila" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="ZIP Code" value={form.zip} onChange={set('zip')} placeholder="1220" />
            <Input label="Phone" value={form.phone} onChange={set('phone')} placeholder="+63 912 345 6789" />
          </div>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={save} className="flex-1">{editAddr ? 'Save Changes' : 'Add Address'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Payment Methods Section ──────────────────────────────────────────────────
type PaymentType = 'gcash' | 'paymaya' | 'credit' | 'debit';

interface PaymentMethod {
  id: string;
  type: PaymentType;
  label: string;
  detail: string;
  isDefault: boolean;
}

function readStoredPaymentMethods(): PaymentMethod[] {
  try {
    const raw = localStorage.getItem('pgbeauty-payment-methods');
    return raw ? JSON.parse(raw) as PaymentMethod[] : [];
  } catch {
    return [];
  }
}

function persistPaymentMethods(methods: PaymentMethod[]) {
  try {
    localStorage.setItem('pgbeauty-payment-methods', JSON.stringify(methods));
  } catch {
    // Ignore storage quota issues.
  }
}

function PaymentSection({ addToast }: any) {
  const { user } = useAuth();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [addType, setAddType] = useState<PaymentType>('gcash');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phone: '', cardName: '', cardNumber: '', expiry: '', cvv: '' });

  useEffect(() => {
    if (!user) return;
    void supabase.from('user_payment_methods').select('id:payment_method_id, method_type, label, detail, is_default').eq('user_id', user.id).order('created_at').then(({ data, error }) => {
      if (error) { addToast('error', error.message); return; }
      setMethods((data || []).map((method: any) => ({
        id: method.id,
        type: method.method_type,
        label: method.label,
        detail: method.detail || '',
        isDefault: method.is_default,
      })));
    });
  }, [user?.id]);

  const paymentIcons: Record<PaymentType, string> = {
    gcash: '💙', paymaya: '💚', credit: '💳', debit: '🏧'
  };
  const paymentColors: Record<PaymentType, string> = {
    gcash: 'bg-blue-50 text-blue-600 border-blue-200',
    paymaya: 'bg-green-50 text-green-700 border-green-200',
    credit: 'bg-[var(--rose-light)] text-[var(--primary)] border-[var(--primary)]/20',
    debit: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  const openAdd = () => {
    setEditingMethod(null);
    setAddType('gcash');
    setForm({ phone: '', cardName: '', cardNumber: '', expiry: '', cvv: '' });
    setModalOpen(true);
  };
  const openEdit = (method: PaymentMethod) => {
    setEditingMethod(method);
    setAddType(method.type);
    setForm({
      phone: method.type === 'gcash' || method.type === 'paymaya' ? method.detail : '',
      cardName: '',
      cardNumber: '',
      expiry: method.type === 'credit' || method.type === 'debit' ? method.detail.replace(/^Expires\s*/, '') : '',
      cvv: '',
    });
    setModalOpen(true);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('user_payment_methods').delete().eq('payment_method_id', id).eq('user_id', user?.id);
    if (error) { addToast('error', error.message); return; }
    setMethods(prev => prev.filter(m => m.id !== id)); addToast('info', 'Payment method removed.');
  };
  const setDefault = async (id: string) => {
    if (!user) return;
    const { error: clearError } = await supabase.from('user_payment_methods').update({ is_default: false }).eq('user_id', user.id);
    const { error } = clearError ? { error: clearError } : await supabase.from('user_payment_methods').update({ is_default: true }).eq('payment_method_id', id).eq('user_id', user.id);
    if (error) { addToast('error', error.message); return; }
    setMethods(prev => prev.map(m => ({ ...m, isDefault: m.id === id })));
  };

  const saveMethod = async () => {
    if (!user) return;
    let label = '', detail = '';
    if (addType === 'gcash') { label = 'GCash'; detail = form.phone; }
    else if (addType === 'paymaya') { label = 'PayMaya'; detail = form.phone; }
    else if (addType === 'credit') {
      label = form.cardNumber ? `Visa ending in ${form.cardNumber.slice(-4)}` : editingMethod?.label || 'Visa ending in 0000';
      detail = form.expiry ? `Expires ${form.expiry}` : editingMethod?.detail || 'Expires ';
    } else {
      label = form.cardNumber ? `Debit ending in ${form.cardNumber.slice(-4)}` : editingMethod?.label || 'Debit ending in 0000';
      detail = form.expiry ? `Expires ${form.expiry}` : editingMethod?.detail || 'Expires ';
    }

    setSaving(true);
    try {
      if (editingMethod) {
        const { data, error } = await supabase.from('user_payment_methods').update({ label, detail })
          .eq('payment_method_id', editingMethod.id).eq('user_id', user.id)
          .select('id:payment_method_id, method_type, label, detail, is_default').single();
        if (error) { addToast('error', error.message); return; }
        setMethods(prev => prev.map(method => method.id === data.id ? {
          id: data.id,
          type: data.method_type,
          label: data.label,
          detail: data.detail || '',
          isDefault: data.is_default,
        } : method));
        addToast('success', 'Payment method updated.');
        setModalOpen(false);
        setEditingMethod(null);
        setForm({ phone: '', cardName: '', cardNumber: '', expiry: '', cvv: '' });
        return;
      }

      const { data, error } = await supabase.from('user_payment_methods').insert({
        user_id: user.id,
        method_type: addType,
        label,
        detail,
        is_default: methods.length === 0,
      }).select().single();
      if (error) { addToast('error', error.message); return; }
      if (methods.length === 0) setMethods([{ id: data.id, type: data.method_type, label: data.label, detail: data.detail, isDefault: true }]);
      else setMethods(prev => [...prev, { id: data.id, type: data.method_type, label: data.label, detail: data.detail, isDefault: false }]);
      addToast('success', 'Payment method added!');
      setModalOpen(false);
      setForm({ phone: '', cardName: '', cardNumber: '', expiry: '', cvv: '' });
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Unable to save the payment method.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold">Payment Methods</h2>
        <Button size="sm" onClick={openAdd}><Plus size={14} /> Add Method</Button>
      </div>
      <div className="flex flex-col gap-3">
        {methods.map(m => (
          <div key={m.id} className={`relative border-2 rounded-[var(--radius-lg)] p-4 transition-all ${m.isDefault ? 'border-[var(--primary)] bg-[var(--rose-light)]/20' : 'border-[var(--border)]'}`}>
            {m.isDefault && <div className="absolute top-3 right-3"><Badge variant="rose">Default</Badge></div>}
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-[var(--radius)] border flex items-center justify-center text-xl flex-shrink-0 ${paymentColors[m.type]}`}>
                {paymentIcons[m.type]}
              </div>
              <div>
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{m.detail}</div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {!m.isDefault && <Button size="sm" variant="ghost" onClick={() => setDefault(m.id)} className="text-xs">Set as Default</Button>}
              <Button size="sm" variant="ghost" onClick={() => openEdit(m)} className="text-xs"><Edit2 size={12} /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(m.id)} className="text-xs text-red-500 hover:bg-red-50"><Trash2 size={12} /> Remove</Button>
            </div>
          </div>
        ))}
        {methods.length === 0 && (
          <div className="text-center py-10 text-[var(--muted-foreground)] text-sm">
            <CreditCard size={32} className="mx-auto opacity-20 mb-2" />No payment methods saved yet.
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingMethod ? 'Edit Payment Method' : 'Add Payment Method'}>
        <div className="flex flex-col gap-4">
          {/* Type selector */}
          {!editingMethod && <div>
            <label className="text-sm font-medium block mb-2">Payment Type</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([['gcash', 'GCash'], ['paymaya', 'PayMaya'], ['credit', 'Credit Card'], ['debit', 'Debit Card']] as [PaymentType, string][]).map(([type, label]) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setAddType(type)}
                  aria-pressed={addType === type}
                  className={`flex items-center gap-2 rounded-[var(--radius-inner)] border-2 p-3 text-left text-sm font-medium transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${addType === type ? 'border-[var(--primary)] bg-[var(--rose-light)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--foreground)]'}`}
                >
                  {type === 'gcash' || type === 'paymaya' ? <Smartphone size={16} aria-hidden="true" /> : <CreditCard size={16} aria-hidden="true" />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>}

          {/* Form based on type */}
          {(addType === 'gcash' || addType === 'paymaya') && (
            <>
              <div className={`p-3 rounded-[var(--radius)] border flex items-center gap-2 text-sm ${addType === 'gcash' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
                <Smartphone size={14} />
                Link your {addType === 'gcash' ? 'GCash' : 'PayMaya'} account via mobile number.
              </div>
              <Input label="Mobile Number" placeholder="+63 912 345 6789" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
            </>
          )}
          {(addType === 'credit' || addType === 'debit') && (
            <>
              <Input label="Cardholder Name" placeholder="Maria Santos" value={form.cardName} onChange={e => setForm(p => ({ ...p, cardName: e.target.value }))} />
              <Input label="Card Number" placeholder={editingMethod ? 'Leave blank to keep the current number' : '1234 5678 9012 3456'} value={form.cardNumber} onChange={e => setForm(p => ({ ...p, cardNumber: e.target.value.replace(/\D/g, '').slice(0, 16) }))} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Expiry (MM/YY)" placeholder="08 / 28" value={form.expiry} onChange={e => setForm(p => ({ ...p, expiry: e.target.value }))} />
                <Input label="CVV" placeholder="123" value={form.cvv} onChange={e => setForm(p => ({ ...p, cvv: e.target.value.slice(0, 4) }))} />
              </div>
            </>
          )}
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={saveMethod} loading={saving} className="flex-1">{editingMethod ? 'Save Changes' : 'Add Payment Method'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

