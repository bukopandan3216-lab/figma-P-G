import { useState } from 'react';
import { MessageCircle, Send, X, Sparkles, Headphones } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const SUPPORT_INQUIRIES_KEY = 'pgbeauty-support-inquiries';

function readSupportInquiries() {
  try {
    const raw = localStorage.getItem(SUPPORT_INQUIRIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSupportInquiry(inquiry: Record<string, unknown>) {
  const inquiries = readSupportInquiries();
  localStorage.setItem(SUPPORT_INQUIRIES_KEY, JSON.stringify([...inquiries, inquiry]));
}

async function persistSupportInquiry(inquiry: {
  customer: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  channel: string;
  sentiment: string;
}) {
  if (!isSupabaseConfigured) {
    saveSupportInquiry({ ...inquiry, id: `inq-${Date.now()}`, createdAt: new Date().toISOString() });
    return;
  }

  try {
    const { error } = await supabase.from('support_inquiries').insert({
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

    if (error) {
      saveSupportInquiry({ ...inquiry, id: `inq-${Date.now()}`, createdAt: new Date().toISOString() });
    }
  } catch {
    saveSupportInquiry({ ...inquiry, id: `inq-${Date.now()}`, createdAt: new Date().toISOString() });
  }
}

interface ChatBubbleProps {
  variant?: 'ai' | 'support';
  title?: string;
  subtitle?: string;
  initialMessages?: { sender: 'bot' | 'user'; text: string }[];
}

export default function FloatingChat({
  variant = 'ai',
  title = 'AI Assistant',
  subtitle = 'Ask about product matches or beauty concerns',
  initialMessages = [
    { sender: 'bot', text: 'Hi! I can help with product recommendations and routine guidance.' },
  ],
}: ChatBubbleProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const { user } = useAuth();

  const submit = async () => {
    const text = message.trim();
    if (!text) return;

    if (variant === 'support') {
      const customerName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'Guest Customer';
      const email = user?.email || 'guest@customer.com';
      const inquiry = {
        customer: customerName,
        email,
        subject: `Support request: ${text.slice(0, 60)}`,
        message: text,
        status: 'Open',
        channel: 'Chat',
        sentiment: 'Needs review',
      };

      await persistSupportInquiry(inquiry);
      setMessages(prev => [
        ...prev,
        { sender: 'user', text },
        { sender: 'bot', text: 'Your message has been sent to our customer support team. We will reply by email soon.' },
      ]);
      setMessage('');
      return;
    }

    setMessages(prev => [
      ...prev,
      { sender: 'user', text },
      {
        sender: 'bot',
        text: `I can suggest products based on your profile. For now, I’ve noted: “${text}”.`,
      },
    ]);
    setMessage('');
  };

  return (
    <div className="relative z-[100]">
      {open ? (
        <div className="w-[340px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-white shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          <div className={`flex items-center justify-between gap-3 px-4 py-3 ${variant === 'ai' ? 'bg-gradient-to-r from-[var(--primary)] to-[#9e4e5d] text-white' : 'bg-slate-900 text-white'}`}>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                {variant === 'ai' ? <Sparkles size={16} /> : <Headphones size={16} />}
              </div>
              <div>
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-[10px] opacity-80">{subtitle}</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </div>

          <div className="max-h-[320px] space-y-3 overflow-y-auto bg-[var(--secondary)] p-3">
            {messages.map((item, index) => (
              <div key={`${item.sender}-${index}`} className={`flex ${item.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-[var(--radius-lg)] px-3 py-2 text-sm ${
                    item.sender === 'user'
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-white text-[var(--foreground)] border border-[var(--border)]'
                  }`}
                >
                  {item.text}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-[var(--border)] bg-white p-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Type your message..."
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
            <button
              type="button"
              onClick={submit}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)] text-white transition hover:opacity-90"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex h-16 w-16 items-center justify-center rounded-full shadow-[0_10px_30px_rgba(181,105,122,0.4)] ring-4 ring-white/80 transition duration-200 hover:scale-105 active:scale-95 ${
            variant === 'ai' ? 'bg-gradient-to-br from-[var(--primary)] to-[#9e4e5d] text-white' : 'bg-slate-900 text-white'
          }`}
          aria-label={title}
        >
          {variant === 'ai' ? <MessageCircle size={26} /> : <Headphones size={26} />}
        </button>
      )}
    </div>
  );
}
