import { useState, useEffect } from 'react';
import { MessageCircle, Send, X, Sparkles, Headphones } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useCatalog } from '../context/CatalogContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

async function persistSupportInquiry(inquiry: {
  userId: string | null;
  customer: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  channel: string;
  sentiment: string;
}) {
  if (!isSupabaseConfigured) {
    throw new Error('Support is unavailable right now. Please try again later.');
  }

  const { error } = await supabase.from('support_inquiries').insert({
    user_id: inquiry.userId,
    customer_name: inquiry.customer,
    email: inquiry.email,
    subject: inquiry.subject,
    message: inquiry.message,
    status: inquiry.status,
    channel: inquiry.channel,
    sentiment: inquiry.sentiment,
    support_reply: '',
    created_at: new Date().toISOString(),
    last_reply: 'Just now',
  });
  if (error) throw error;
}

interface ChatBubbleProps {
  variant?: 'ai' | 'support';
  title?: string;
  subtitle?: string;
  initialMessages?: { sender: 'bot' | 'user'; text: string }[];
  hidden?: boolean;
}

function getAIResponse(text: string, products: any[]): string {
  const lower = text.toLowerCase();
  const keywords = ['dry', 'oily', 'sensitive', 'acne', 'aging', 'wrinkle', 'hair', 'shampoo', 'conditioner', 'deodorant', 'soap', 'lotion', 'cream', 'serum', 'cleanser', 'moisturizer', 'sunscreen', 'lipstick', 'makeup'];
  const matched = keywords.filter(k => lower.includes(k));

  let relevant = products;
  if (matched.length) {
    relevant = products.filter(p =>
      matched.some(k =>
        p.name.toLowerCase().includes(k) ||
        p.category.toLowerCase().includes(k) ||
        p.tags.some((t: string) => t.toLowerCase().includes(k))
      )
    );
  }

  relevant = relevant.slice(0, 3);

  if (relevant.length === 0) {
    return `I received: “${text}”. I'm still learning about our full catalog — could you tell me more about what you're looking for? For example: dry skin, oily hair, sensitive skin, anti-aging, or shampoo.`;
  }

  const list = relevant.map(p => `• ${p.name} — ₱${p.price.toFixed(2)} (${p.category})`).join('\n');
  return `Based on “${text}”, here are some products that may help:\n\n${list}\n\nWould you like more details on any of these?`;
}

export default function FloatingChat({
  variant = 'ai',
  title = 'Beauty Assistant',
  subtitle = 'Ask about product matches or beauty concerns',
  initialMessages = [
    { sender: 'bot', text: 'Hi! I can help with product suggestions and routine guidance.' },
  ],
  hidden = false,
}: ChatBubbleProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const { user } = useAuth();
  const { openChat, setOpenChat } = useChat();
  const { products, loading: catalogLoading } = useCatalog();

  const logChat = (text: string) => {
    if (!isSupabaseConfigured || !user) return;
    void supabase.rpc('log_customer_activity', {
      p_action: 'ai.chat',
      p_details: { message: text, conversation: variant },
    });
  };

  // Close this chat if another chat is opened
  useEffect(() => {
    if (openChat !== null && openChat !== variant) {
      setOpen(false);
    }
  }, [openChat, variant]);

  const isOpen = openChat === variant;
  const setIsOpen = (val: boolean) => setOpenChat(val ? variant : null);

  // When another chat is open, hide this launcher completely (no stacking)
  const isOtherOpen = openChat !== null && openChat !== variant;

  const submit = async () => {
    const text = message.trim();
    if (!text) return;

    if (variant === 'support') {
      const customerName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'Guest Customer';
      const email = user?.email || 'guest@customer.com';
      const inquiry = {
        userId: user?.id || null,
        customer: customerName,
        email,
        subject: `Support request: ${text.slice(0, 60)}`,
        message: text,
        status: 'Open',
        channel: 'Chat',
        sentiment: 'Needs review',
      };

      setSending(true);
      try {
        await persistSupportInquiry(inquiry);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Please try again later.';
        setMessages(prev => [
          ...prev,
          { sender: 'user', text },
          { sender: 'bot', text: `We couldn't save your message to support. ${detail}` },
        ]);
        setSending(false);
        return;
      }
      setMessages(prev => [
        ...prev,
        { sender: 'user', text },
        { sender: 'bot', text: 'Your message has been sent to our customer support team. We will reply by email soon.' },
      ]);
      logChat(text);
      setMessage('');
      setSending(false);
      return;
    }

    setMessages(prev => [
      ...prev,
      { sender: 'user', text },
      {
        sender: 'bot',
        text: getAIResponse(text, products),
      },
    ]);
    logChat(text);
    setMessage('');
  };

  if (hidden || catalogLoading) return null;

  return (

    <div className="relative z-[100]">

      {isOpen ? (
        /* OPEN CHAT WINDOW */
        <div className="w-[320px] sm:w-[340px] overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(0,0,0,0.16)] ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 duration-200">

          {/* Header */}
          <div className={`flex items-center justify-between gap-3 px-4 py-3 ${
            variant === 'ai'
              ? 'bg-[var(--primary)] text-white'
              : 'bg-slate-900 text-white'
          }`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                {variant === 'ai' ? <Sparkles size={17} /> : <Headphones size={17} />}
              </div>

              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{title}</div>
                <div className="text-[11px] opacity-80">{subtitle}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-2 transition hover:bg-white/15"
              aria-label="Close chat"
            >
              <X size={17} />
            </button>
          </div>

          {/* Messages */}
          <div className="h-[300px] space-y-3 overflow-y-auto bg-[var(--secondary)]/70 p-4">
            {messages.map((item, index) => (
              <div
                key={`${item.sender}-${index}`}
                className={`flex ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${item.sender === 'user' ? 'rounded-br-md bg-[var(--primary)] text-white' : 'rounded-bl-md bg-white text-[var(--foreground)] shadow-sm'}`}
                >
                  {item.text}
                </div>
              </div>
            ))}
          </div>

          {/* Message Input */}
          <div className="flex items-center gap-2 border-t border-[var(--border)] bg-white p-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="Type your message..."
              disabled={sending}
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/50 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10"
            />

            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white transition hover:brightness-95 active:scale-95"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </div>

      ) : (
        isOtherOpen ? null : (
          /* CLOSED CHAT LAUNCHER */
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className={`group flex h-17 w-17 items-center justify-center rounded-4xl shadow-[0_5px_18px_rgba(0,0,0,0.16)] transition-all duration-300 ease-out hover:scale-110 hover:shadow-[0_8px_24px_rgba(0,0,0,0.22)] active:scale-95 ${
              variant === 'ai'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-slate-900 text-white'
            }`}
            aria-label={title}
            title={title}
          >
            {variant === 'ai'
              ? <MessageCircle size={21} className="transition-transform duration-300 group-hover:scale-110" />
              : <Headphones size={21} className="transition-transform duration-300 group-hover:scale-110" />}
          </button>
        )
      )}

    </div>

  );
}
