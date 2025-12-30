import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { messagesService, type ChatMessage } from "@/services/api";
import { getDirectMessageChatId, isAIAssistantChatId } from "@/hooks/useChatId";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  email?: string;
}

interface UseTeamChatsResult {
  selectedChat: string | null;
  setSelectedChat: (chatId: string | null) => void;
  unreadCounts: Map<string, number>;
  totalUnreadCount: number;
  allTeamMembers: TeamMember[];
  projects: any[];
  teams: any[];
}

export function useTeamChats(): UseTeamChatsResult {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { data: allDomainUsers = [] } = useUsers();

  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [totalUnreadCount, setTotalUnreadCount] = useState<number>(0);
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Map<string, number>>(new Map());
  const [allChatCaches, setAllChatCaches] = useState<Map<string, { messages: ChatMessage[], lastSync: number }>>(new Map());
  const cacheLoadedForSessionRef = useRef(false);
  const timestampsLoadedRef = useRef(false);
  // Track chats that have been marked as read in this session to prevent recalculation
  const markedAsReadRef = useRef<Set<string>>(new Set());
  // Ref to store timestamps from server for immediate access (before state updates)
  const lastReadTimestampsRef = useRef<Map<string, number>>(new Map());

  // Get all team members (excluding current user)
  const allTeamMembers = useMemo(() => {
    return allDomainUsers
      .filter((domainUser) => {
        const userEmail = domainUser.email?.toLowerCase();
        return userEmail && userEmail !== user?.email?.toLowerCase();
      })
      .map((domainUser) => {
        const userEmail = domainUser.email?.toLowerCase() || '';
        const firstName = domainUser.firstName || '';
        const lastName = domainUser.lastName || '';
        const name = `${firstName} ${lastName}`.trim() || userEmail;
        const avatar = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || userEmail.charAt(0).toUpperCase();
        
        return {
          id: userEmail,
          name: name,
          role: domainUser.jobTitle || 'User',
          avatar: avatar,
          email: userEmail,
        } as TeamMember;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allDomainUsers, user?.email]);

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

  // Load lastReadTimestamps from server and merge with localStorage cache
  useEffect(() => {
    if (!user?.email || timestampsLoadedRef.current) return;

    const loadReadReceipts = async () => {
      try {
        // Load from localStorage first (for immediate UI)
        const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
        const stored = localStorage.getItem(storageKey);
        const localTimestamps = new Map<string, number>();
        
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            Object.entries(parsed).forEach(([chatId, timestamp]) => {
              localTimestamps.set(chatId, timestamp as number);
            });
          } catch (e) {
            console.error('Failed to parse localStorage timestamps:', e);
          }
        }

        // Load from server (source of truth)
        try {
          const serverReceipts = await messagesService.getReadReceipts();
          const serverTimestamps = new Map<string, number>();
          
          serverReceipts.forEach(({ chatId, lastReadTimestamp }) => {
            serverTimestamps.set(chatId, lastReadTimestamp);
            // Mark chats with server timestamps as read
            markedAsReadRef.current.add(chatId);
          });

          // Merge: server takes precedence, but keep local if server doesn't have it
          const merged = new Map<string, number>();
          serverTimestamps.forEach((timestamp, chatId) => {
            merged.set(chatId, timestamp);
          });
          localTimestamps.forEach((timestamp, chatId) => {
            // Only keep local if server doesn't have it (for backward compatibility)
            if (!serverTimestamps.has(chatId)) {
              merged.set(chatId, timestamp);
              markedAsReadRef.current.add(chatId);
            }
          });

          // Update ref immediately for synchronous access
          lastReadTimestampsRef.current = merged;
          
          // Update state
          setLastReadTimestamps(merged);
          
          // Update localStorage cache with merged data
          try {
            const serialized = Object.fromEntries(merged);
            localStorage.setItem(storageKey, JSON.stringify(serialized));
          } catch (e) {
            console.error('Failed to save merged timestamps to localStorage:', e);
          }
        } catch (error) {
          console.error('Failed to load read receipts from server, using localStorage only:', error);
          // Fallback to localStorage only
          lastReadTimestampsRef.current = localTimestamps;
          setLastReadTimestamps(localTimestamps);
          localTimestamps.forEach((_, chatId) => {
            markedAsReadRef.current.add(chatId);
          });
        }
      } catch (error) {
        console.error('Failed to load lastReadTimestamps:', error);
      } finally {
        timestampsLoadedRef.current = true;
      }
    };

    loadReadReceipts();
  }, [user?.email]);

  // Keep ref in sync with state (for when state updates from other sources)
  useEffect(() => {
    lastReadTimestampsRef.current = new Map(lastReadTimestamps);
  }, [lastReadTimestamps]);

  // Save lastReadTimestamps to localStorage (as cache)
  useEffect(() => {
    if (!user?.email) return;
    
    try {
      const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
      const serialized = Object.fromEntries(lastReadTimestamps);
      localStorage.setItem(storageKey, JSON.stringify(serialized));
    } catch (error) {
      console.error('Failed to save lastReadTimestamps to localStorage:', error);
    }
  }, [lastReadTimestamps, user?.email]);

  // Calculate unread counts for team chats only (exclude AI chat)
  useEffect(() => {
    if (!user || !user.email || !timestampsLoadedRef.current) return;

    const calculateUnreadCounts = async () => {
      const newUnreadCounts = new Map<string, number>();
      const allChatIds: string[] = [];

      // Add all project channels
      projects.forEach((project) => {
        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`project-${projectId}`);
      });

      // Add all team channels
      userTeams.forEach((team) => {
        const teamId = team.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`team-${teamId}`);
      });

      // Add all domain user direct message chats
      allTeamMembers.forEach((member) => {
        if (member.email) {
          const chatId = getDirectMessageChatId(user.email, member.email);
          allChatIds.push(chatId);
        }
      });

      // Process requests in batches
      const BATCH_SIZE = 3;
      const chatIdsToProcess = allChatIds.filter((chatId) => {
        // Skip if this chat is currently selected or marked as read in this session
        if (selectedChat === chatId || markedAsReadRef.current.has(chatId)) {
          return false;
        }
        
        const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
        const cacheIsRecent = cached && !isCacheStale(cached.lastSync);
        const cacheIsEmpty = cached && cached.messages.length === 0;
        
        if (cacheIsRecent && cacheIsEmpty) {
          newUnreadCounts.set(chatId, 0);
          return false;
        }
        return true;
      });

      for (let i = 0; i < chatIdsToProcess.length; i += BATCH_SIZE) {
        const batch = chatIdsToProcess.slice(i, i + BATCH_SIZE);
        
        await Promise.all(
          batch.map(async (chatId) => {
            try {
              const firestoreMessages = await messagesService.getByChatId(chatId);
              // Use ref for immediate access (server-loaded timestamps)
              const lastRead = lastReadTimestampsRef.current.get(chatId) || 0;

              const unreadCount = firestoreMessages.filter((msg) => {
                const msgTime =
                  msg.timestamp instanceof Date
                    ? msg.timestamp.getTime()
                    : new Date(msg.timestamp).getTime();
                const isAfterLastRead = msgTime > lastRead;
                const isUnread = msg.userId?.toLowerCase() !== user?.email?.toLowerCase();
                return isAfterLastRead && isUnread;
              }).length;

              newUnreadCounts.set(chatId, unreadCount);
            } catch (error) {
              const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
              if (cached && cached.messages.length === 0) {
                newUnreadCounts.set(chatId, 0);
              }
            }
          })
        );
        
        if (i + BATCH_SIZE < chatIdsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Update unread counts
      setUnreadCounts((prev) => {
        // Always create a new Map to ensure React detects the change
        const merged = new Map();
        
        // First, copy all existing counts except for selected chat and marked-as-read chats
        prev.forEach((count, chatId) => {
          if (chatId !== selectedChat && !markedAsReadRef.current.has(chatId)) {
            merged.set(chatId, count);
          }
        });
        
        // Then update with new calculated counts (excluding selected chat and marked-as-read chats)
        newUnreadCounts.forEach((count, chatId) => {
          if (chatId !== selectedChat && !markedAsReadRef.current.has(chatId)) {
            if (count > 0) {
              merged.set(chatId, count);
            } else {
              merged.delete(chatId);
            }
          }
        });
        
        // Calculate and update total unread count
        const totalUnread = Array.from(merged.values()).reduce((sum, count) => sum + count, 0);
        setTotalUnreadCount(totalUnread);
        
        // Broadcast team chat unread count
        window.dispatchEvent(new CustomEvent('teamChatUnreadCount', { 
          detail: { totalUnread } 
        }));
        
        return merged;
      });
    };

    const timeoutId = setTimeout(() => {
      calculateUnreadCounts();
    }, 300);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [user?.email, projects, userTeams, allTeamMembers, selectedChat, lastReadTimestamps, allChatCaches, loadCachedMessages, isCacheStale]);

  // Update last read timestamp when a chat is opened
  useEffect(() => {
    if (!user?.email) {
      // When user logs out or email is cleared, reset marked-as-read tracking
      markedAsReadRef.current.clear();
      return;
    }

    if (!selectedChat) {
      // When chat is closed, don't clear the marked-as-read set
      // This ensures chats stay marked as read even when navigating away
      return;
    }

    // Only mark as read once per chat session to prevent unnecessary updates
    if (markedAsReadRef.current.has(selectedChat)) {
      return;
    }

    const now = Date.now();
    markedAsReadRef.current.add(selectedChat);
    
    // Optimistically update local state and ref
    setLastReadTimestamps((prev) => {
      const updated = new Map(prev);
      const previousTimestamp = updated.get(selectedChat) || 0;
      
      // Only update if this is a new read (timestamp is newer)
      if (now > previousTimestamp) {
        updated.set(selectedChat, now);
        // Update ref immediately for synchronous access
        lastReadTimestampsRef.current.set(selectedChat, now);
        
        // Immediately save to localStorage as cache
        try {
          const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
          const serialized = Object.fromEntries(updated);
          localStorage.setItem(storageKey, JSON.stringify(serialized));
        } catch (error) {
          console.error('Failed to save lastReadTimestamp to localStorage:', error);
        }
      }
      
      return updated;
    });

    // Call API to persist to server (fire and forget, with error handling)
    messagesService.markChatAsRead(selectedChat).catch((error) => {
      console.error('Failed to mark chat as read on server:', error);
      // Optionally retry or show user notification
    });

    // Clear unread count for the selected chat immediately
    setUnreadCounts((prev) => {
      // If chat already has no unread count, check if we need to update anyway
      const hasUnread = prev.has(selectedChat) && (prev.get(selectedChat) || 0) > 0;
      if (!hasUnread && prev.size === 0) {
        return prev; // No change needed
      }
      
      // Always create a completely new Map to ensure React detects the change
      const updated = new Map();
      
      prev.forEach((count, chatId) => {
        if (chatId !== selectedChat) {
          updated.set(chatId, count);
        }
      });
      
      // Calculate and update total unread count immediately
      const totalUnread = Array.from(updated.values()).reduce((sum, count) => sum + count, 0);
      setTotalUnreadCount(totalUnread);
      
      // Broadcast updated team chat unread count immediately
      window.dispatchEvent(new CustomEvent('teamChatUnreadCount', { 
        detail: { totalUnread } 
      }));
      
      // Force a re-render by always returning a new Map instance
      return updated;
    });
  }, [selectedChat, user?.email]);

  // Load all chat caches upfront
  useEffect(() => {
    if (!user || !user.email || cacheLoadedForSessionRef.current) return;

    const loadAllChatCaches = () => {
      const allChatIds: string[] = [];
      const caches = new Map<string, { messages: ChatMessage[], lastSync: number }>();

      projects.forEach((project) => {
        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`project-${projectId}`);
      });

      userTeams.forEach((team) => {
        const teamId = team.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`team-${teamId}`);
      });

      allTeamMembers.forEach((member) => {
        if (member.email) {
          const chatId = getDirectMessageChatId(user.email, member.email);
          allChatIds.push(chatId);
        }
      });

      allChatIds.forEach((chatId) => {
        const cached = loadCachedMessages(chatId);
        if (cached) {
          caches.set(chatId, cached);
        }
      });

      setAllChatCaches(caches);
      cacheLoadedForSessionRef.current = true;
    };

    loadAllChatCaches();
  }, [user?.email, projects, userTeams, allTeamMembers, loadCachedMessages]);


  return {
    selectedChat,
    setSelectedChat,
    unreadCounts,
    totalUnreadCount,
    allTeamMembers,
    projects,
    teams: userTeams,
  };
}

