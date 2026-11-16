import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, Send } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import CustomerFooter from '../../components/CustomerFooter';
import CustomerNav from '../../components/CustomerNav';
import { useAuth } from '../../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

type InfoSection = { title: string; body: string };
type InfoPageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  sections?: InfoSection[];
  faqs?: InfoSection[];
};

const pages: Record<string, InfoPageContent> = {
  'contact-us': {
    eyebrow: 'Help',
    title: 'Contact Us',
    intro: 'Send us a message about an order, a product, or the website. We will route your inquiry to the right support team.',
  },
  'shipping-policy': {
    eyebrow: 'Help',
    title: 'Shipping Policy',
    intro: 'Review delivery options and timing before placing your order. The details shown at checkout are the ones that apply to your address and items.',
    sections: [
      { title: 'Delivery options', body: 'Available delivery methods, estimated arrival dates, and any shipping fees are shown during checkout before you confirm your order.' },
      { title: 'Track an order', body: 'After signing in, open Orders in your account to review the current status of your purchase.' },
      { title: 'Need help?', body: 'If an order is delayed or an address needs attention, contact support with your order number so the team can review it.' },
    ],
  },
  returns: {
    eyebrow: 'Help',
    title: 'Returns',
    intro: 'Product pages describe our 30-day return window. Contact support with your order number and the item you want to return so the request can be reviewed.',
    sections: [
      { title: 'Request a return', body: 'Send a return request within 30 days of delivery. Include your order number, the product name, and a short description of the issue.' },
      { title: 'After you contact us', body: 'The support team will confirm eligibility and provide the next steps. Please wait for those instructions before sending an item back.' },
      { title: 'Refunds', body: 'Once an approved return is received and reviewed, the team will share the refund status and timing.' },
    ],
  },
  faq: {
    eyebrow: 'Help',
    title: 'Frequently Asked Questions',
    intro: 'Quick answers about shopping, recommendations, delivery, and support.',
    faqs: [
      { title: 'How do I get personalized recommendations?', body: 'Take the Beauty Quiz and save your answers. The For You page uses your saved profile and shopping activity to rank matching products.' },
      { title: 'Where can I find my order status?', body: 'Sign in and open Orders from your account menu to review available order updates.' },
      { title: 'Where can I see delivery fees and estimates?', body: 'Available delivery options, fees, and estimates are shown during checkout for your order.' },
      { title: 'How do I ask for help with an order?', body: 'Use the Contact Us form and include your order number so support can find the purchase.' },
    ],
  },
  'about-pg': {
    eyebrow: 'Company',
    title: 'About P&G Beauty',
    intro: 'P&G Beauty brings together beauty products across skin care, hair care, and personal care. This storefront helps you explore products and find options aligned with your preferences.',
    sections: [
      { title: 'Beauty, made personal', body: 'Use the Beauty Quiz to save your concerns and preferences, then explore recommendations alongside the full product catalog.' },
      { title: 'Browse with confidence', body: 'Product pages bring together available details, ratings, variants, and stock information to support your decision.' },
    ],
  },
  sustainability: {
    eyebrow: 'Company',
    title: 'Sustainability',
    intro: 'Sustainability considerations can vary by brand, product, and packaging. Review the current product packaging and official brand information for details relevant to a specific item.',
    sections: [
      { title: 'Product information', body: 'For ingredient, packaging, or recycling questions, check the label on the product and the relevant brand’s current information.' },
      { title: 'Questions', body: 'Contact us with the product name and your question, and our team will help direct you to the right information.' },
    ],
  },
  careers: {
    eyebrow: 'Company',
    title: 'Careers',
    intro: 'Explore opportunities to work with Procter & Gamble across teams, disciplines, and locations.',
    sections: [
      { title: 'Find current openings', body: 'For current roles and application details, visit the official P&G Careers website.' },
    ],
  },
  press: {
    eyebrow: 'Company',
    title: 'Press',
    intro: 'For media or press questions about P&G Beauty, send our team a message and include your publication, deadline, and the subject of your request.',
    sections: [
      { title: 'Press inquiries', body: 'Use the Contact Us form and select “Press inquiry” as the subject. Please do not include confidential or embargoed material.' },
    ],
  },
  terms: {
    eyebrow: 'Legal',
    title: 'Terms of Service',
    intro: 'These terms describe the basic expectations for using this P&G Beauty storefront.',
    sections: [
      { title: 'Using the site', body: 'Use the storefront lawfully and provide accurate information when placing an order or contacting support.' },
      { title: 'Product and order information', body: 'Availability, pricing, delivery options, and product details are shown on the site and may change. Checkout displays the order details before you submit it.' },
      { title: 'Support', body: 'Contact us if you need help with your account, an order, or site content.' },
    ],
  },
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy Policy',
    intro: 'This storefront uses the information you provide to manage your account, personalize product recommendations, and respond to support requests.',
    sections: [
      { title: 'Information used', body: 'Account details, quiz preferences, and activity associated with your account are used to provide storefront features such as order history and personalized recommendations.' },
      { title: 'Support requests', body: 'Messages submitted through Contact Us are stored so the support team can review and respond to your inquiry.' },
      { title: 'Your choices', body: 'You can review and update available account information from My Account. Contact support with questions about your data.' },
    ],
  },
};

function ContactForm() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setForm(current => ({
      ...current,
      name: current.name || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
      email: current.email || user?.email || '',
    }));
  }, [user]);

  const setField = (field: keyof typeof form, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setError('');
    setSubmitted(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      setError('Contact support is temporarily unavailable. Please try again later.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { error: insertError } = await supabase.from('support_inquiries').insert({
        user_id: user?.id || null,
        customer_name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        subject: form.subject.trim(),
        message: form.message.trim(),
        status: 'Open',
        channel: 'Web',
        sentiment: 'Needs review',
        support_reply: '',
        last_reply: 'Just now',
      });
      if (insertError) throw insertError;
      setSubmitted(true);
      setForm(current => ({ ...current, subject: '', message: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send your message. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={event => void submit(event)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Name" autoComplete="name" required value={form.name} onChange={event => setField('name', event.target.value)} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} onChange={event => setField('email', event.target.value)} />
      </div>
      <Input label="Subject" required value={form.subject} onChange={event => setField('subject', event.target.value)} placeholder="Order, product, press inquiry…" />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Message
        <textarea required rows={5} value={form.message} onChange={event => setField('message', event.target.value)} className="w-full resize-y rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {submitted && <p role="status" className="text-sm text-emerald-700">Message sent. Our support team will review your inquiry.</p>}
      <div><Button type="submit" loading={saving}><Send size={15} /> Send Message</Button></div>
    </form>
  );
}

export default function InfoPage() {
  const { slug = '' } = useParams();
  const page = pages[slug];
  if (!page) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 border-b border-[var(--border)] pb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">{page.eyebrow}</p>
          <h1 className="font-display text-4xl sm:text-5xl">{page.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[var(--muted-foreground)]">{page.intro}</p>
        </div>

        {slug === 'contact-us' ? (
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <section>
              <h2 className="font-display text-2xl">How can we help?</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)]">Send a message about an order, a product, or the website. Include your order number when you’re asking about a purchase.</p>
              <Link to="/orders" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)] hover:underline">Review your orders <ArrowRight size={14} /></Link>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-white p-5 sm:p-6">
              <ContactForm />
            </section>
          </div>
        ) : page.faqs ? (
          <section className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {page.faqs.map(item => (
              <details key={item.title} className="group py-4">
                <summary className="cursor-pointer list-none pr-6 font-semibold marker:hidden focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{item.title}</summary>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--muted-foreground)]">{item.body}</p>
              </details>
            ))}
          </section>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {page.sections?.map(section => (
              <section key={section.title} className="grid gap-2 py-6 sm:grid-cols-[220px_1fr] sm:gap-8">
                <h2 className="font-semibold">{section.title}</h2>
                <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{section.body}</p>
              </section>
            ))}
            {slug === 'careers' && <a href="https://www.pgcareers.com/" target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline">Visit P&G Careers <ArrowRight size={14} /></a>}
            {(slug === 'press' || slug === 'sustainability') && <Link to="/info/contact-us" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline">Contact Us <ArrowRight size={14} /></Link>}
          </div>
        )}
      </main>
      <CustomerFooter />
    </div>
  );
}