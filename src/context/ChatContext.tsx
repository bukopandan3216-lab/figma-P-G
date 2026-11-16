import { createContext, useContext, useState, type ReactNode } from 'react';

interface ChatContextValue {
  openChat: 'ai' | 'support' | null;
  setOpenChat: (variant: 'ai' | 'support' | null) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [openChat, setOpenChat] = useState<'ai' | 'support' | null>(null);
  return (
    <ChatContext.Provider value={{ openChat, setOpenChat }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat outside ChatProvider');
  return context;
}
