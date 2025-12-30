import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { messagesService, type ChatMessage } from "@/services/api";
import { getAIAssistantChatId, isAIAssistantChatId } from "@/hooks/useChatId";

interface UseAIChatResult {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chatId: string | null;
}

export function useAIChat(): UseAIChatResult {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const [isOpen, setIsOpen] = useState(false);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);
  const cacheLoadedForSessionRef = useRef(false);

  const chatId = useMemo(() => {
    return user?.email ? getAIAssistantChatId(user.email) : null;
  }, [user?.email]);

  // Helper functions for message caching
  const getCacheKey = useCallback((chatId: string) => {
    if (!user?.email) return null;
    const orgId = currentOrg?.id || 'default';
    return `chat_messages_${orgId}_${user.email.toLowerCase()}_${chatId}`;
  }, [user?.email, currentOrg?.id]);

  const loadCachedMessages = useCallback((chatId: string): { messages: ChatMessage[], lastSync: number } | null => {
    const cacheKey = getCacheKey(chatId);
    if (!cacheKey) return null;
    
    const currentOrgId = currentOrg?.id || 'default';
    if (!cacheKey.includes(currentOrgId)) {
      return null;
    }
    
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.messages && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          return {
            messages: parsed.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
              citedContext: msg.citedContext || null,
              likes: Array.isArray(msg.likes) ? msg.likes : [],
            })),
            lastSync: parsed.lastSync || 0,
          };
        }
      }
    } catch (error) {
      console.error('Failed to load cached messages:', error);
    }
    return null;
  }, [getCacheKey, currentOrg?.id]);

  const isCacheStale = useCallback((lastSync: number): boolean => {
    const CACHE_STALE_TIME = 30 * 1000; // 30 seconds
    return Date.now() - lastSync > CACHE_STALE_TIME;
  }, []);

  // Load lastReadTimestamp from localStorage
  useEffect(() => {
    if (!user?.email || !chatId) return;
    
    try {
      const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const timestamp = parsed[chatId];
        if (timestamp) {
          setLastReadTimestamp(timestamp);
        }
      }
    } catch (error) {
      console.error('Failed to load lastReadTimestamp from localStorage:', error);
    }
  }, [user?.email, chatId]);

  // Save lastReadTimestamp to localStorage
  useEffect(() => {
    if (!user?.email || !chatId) return;
    
    try {
      const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : {};
      parsed[chatId] = lastReadTimestamp;
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch (error) {
      console.error('Failed to save lastReadTimestamp to localStorage:', error);
    }
  }, [lastReadTimestamp, user?.email, chatId]);


  // Update last read timestamp when chat is opened
  useEffect(() => {
    if (isOpen && chatId) {
      const now = Date.now();
      setLastReadTimestamp(now);
    }
  }, [isOpen, chatId]);

  return {
    isOpen,
    setIsOpen,
    chatId,
  };
}

