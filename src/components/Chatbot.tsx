import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle, X, Send, Bot, User, FolderOpen, CheckSquare, ChevronDown, Search, Users, Hash, Activity, Filter, MessageSquare, AtSign, Mic, MicOff } from "lucide-react";
import { VoiceCallButton, IncomingCallDialog } from "./VoiceCall";
import { callSignalingService, type CallSignal } from "@/services/firestore";
import { CallStatus } from "@/hooks/useWebRTC";
import { useWebRTCContext } from "@/contexts/WebRTCContext";
import { cn, getUserById, getUserDisplayName, getUserInitials, getAvatarColor } from "@/lib/utils";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Project } from "@/data/projectsData";
import { Task } from "@/data/tasksData";
import { Team } from "@/data/teamsData";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { messagesService, type ChatMessage } from "@/services/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db, auth } from "@/lib/firebase-client";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  userId?: string;
  citedContext?: {
    projects?: Project[];
    tasks?: Task[];
    teams?: Team[];
  };
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  email?: string;
}

interface ChannelMessage {
  id: string;
  memberName: string;
  memberAvatar: string;
  content: string;
  timestamp: Date;
  projectId?: string;
  teamId?: string;
  userId?: string;
  citedContext?: {
    projects?: Project[];
    tasks?: Task[];
    teams?: Team[];
  };
}

interface SearchResult {
  id: string;
  type: "activity" | "task" | "comment" | "update" | "channel-message";
  title: string;
  content: string;
  memberName: string;
  memberAvatar: string;
  date: string;
}


// Generate a consistent chatId for direct messages between two users
// This ensures both users see the same conversation regardless of who initiated it
const getDirectMessageChatId = (userEmail: string, otherUserEmail: string): string => {
  const emails = [userEmail.toLowerCase(), otherUserEmail.toLowerCase()].sort();
  return `dm-${emails[0]}-${emails[1]}`;
};

// Generate a user-specific chatId for AI assistant conversations
// This ensures each user has a private conversation with the AI
const getAIAssistantChatId = (userEmail: string): string => {
  return `ai-assistant-${userEmail.toLowerCase()}`;
};

// Check if a chatId is for an AI assistant conversation
const isAIAssistantChatId = (chatId: string): boolean => {
  return chatId.startsWith('ai-assistant-');
};

export function Chatbot() {
  const { selectedProjects, clearSelection: clearSelectedProjects } = useSelectedProjects();
  const { selectedTasks, clearSelection: clearSelectedTasks } = useSelectedTasks();
  const { selectedTeams, clearSelection: clearSelectedTeams } = useSelectedTeams();
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { data: allDomainUsers = [] } = useUsers();
  const { user } = useAuth();
  
  // Calculate current user's full profile data once (has firstName/lastName)
  // AuthContext user only has email, not firstName/lastName
  const currentUserProfile = useMemo(() => {
    if (!user?.email) return null;
    return allDomainUsers.find(u => u.email?.toLowerCase() === user.email?.toLowerCase()) || null;
  }, [allDomainUsers, user?.email]);
  
  // Calculate current user's display info once for reuse
  const currentUserDisplayInfo = useMemo(() => {
    if (!currentUserProfile) {
      return {
        name: user?.email || "You",
        initials: user?.email?.charAt(0).toUpperCase() || "U",
        displayName: user?.email || "You",
      };
    }
    return {
      name: getUserDisplayName(currentUserProfile),
      initials: getUserInitials(currentUserProfile),
      displayName: getUserDisplayName(currentUserProfile),
    };
  }, [currentUserProfile, user?.email]);
  const [isOpen, setIsOpen] = useState(false);
  
  // Load last selected member from localStorage
  const getLastSelectedMember = useCallback((): string => {
    if (!user?.email) return "ai-assistant";
    try {
      const storageKey = `chat_lastSelectedMember_${user.email.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      return stored || "ai-assistant";
    } catch (error) {
      console.error('Failed to load last selected member:', error);
      return "ai-assistant";
    }
  }, [user?.email]);
  
  const [selectedMember, setSelectedMember] = useState<string>(() => {
    if (!user?.email) return "ai-assistant";
    try {
      const storageKey = `chat_lastSelectedMember_${user.email.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      return stored || "ai-assistant";
    } catch (error) {
      return "ai-assistant";
    }
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelMessages, setChannelMessages] = useState<Map<string, ChannelMessage[]>>(new Map());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filterType, setFilterType] = useState<"all" | "activities" | "tasks" | "comments">("all");
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map()); // chatId -> unread count
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Map<string, number>>(new Map()); // chatId -> last read timestamp
  const [allChatCaches, setAllChatCaches] = useState<Map<string, { messages: ChatMessage[], lastSync: number }>>(new Map()); // chatId -> cached messages
  const [cacheLoadedForSession, setCacheLoadedForSession] = useState(false); // Track if cache has been loaded for this session
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [incomingCallSignal, setIncomingCallSignal] = useState<CallSignal | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [callStatusFromSignal, setCallStatusFromSignal] = useState<CallStatus>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const previousChatIdRef = useRef<string | null>(null); // Track previous chatId to detect chat switches
  
  // WebRTC hook for call management - use shared context
  const {
    callStatus,
    isMuted: localIsMuted,
    toggleMute: localToggleMute,
    endCall: endWebRTCCall,
    currentCallId,
    setCurrentCallId,
  } = useWebRTCContext();
  
  // Mute state from active call (shared from VoiceCallButton)
  const [activeCallMuted, setActiveCallMuted] = useState(false);
  const [activeCallToggleMute, setActiveCallToggleMute] = useState<(() => void) | null>(null);
  
  // Use active call's mute state if available, otherwise use local
  const isMuted = activeCallToggleMute ? activeCallMuted : localIsMuted;
  const toggleMute = activeCallToggleMute || localToggleMute;
  
  // Use callStatus from WebRTC hook if active, otherwise use status from signaling service
  // If both are idle/ended, show idle
  const displayCallStatus: CallStatus = (callStatus !== 'idle' && callStatus !== 'ended') 
    ? callStatus 
    : (callStatusFromSignal !== 'idle' && callStatusFromSignal !== 'ended')
    ? callStatusFromSignal
    : 'idle';

  // Proper end call handler that updates signaling service
  const handleEndCall = useCallback(async () => {
    try {
      // Update signaling service to notify the other user
      if (currentCallId) {
        try {
          await callSignalingService.endCall(currentCallId);
        } catch (err) {
          console.error('Error ending call:', err);
          // Continue with cleanup even if update fails
        }
      }
      
      // Clean up WebRTC resources
      endWebRTCCall();
      setCurrentCallId(null);
      setIncomingCallSignal(null);
      setCallStatusFromSignal('idle'); // Reset call status to idle
      
    } catch (err) {
      console.error('Error ending call:', err);
      // Still clean up local resources even if there's an error
      endWebRTCCall();
      setCurrentCallId(null);
      setIncomingCallSignal(null);
      setCallStatusFromSignal('idle'); // Reset call status to idle
    }
  }, [currentCallId, endWebRTCCall]);

  // Helper functions for message caching
  const getCacheKey = (chatId: string) => {
    if (!user?.email) return null;
    return `chat_messages_${user.email.toLowerCase()}_${chatId}`;
  };

  const loadCachedMessages = (chatId: string): { messages: ChatMessage[], lastSync: number } | null => {
    const cacheKey = getCacheKey(chatId);
    if (!cacheKey) return null;
    
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.messages && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          return {
            messages: parsed.messages.map((msg: any) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
              citedContext: msg.citedContext || null, // Explicitly preserve citedContext
            })),
            lastSync: parsed.lastSync || 0,
          };
        }
      }
    } catch (error) {
      console.error('Failed to load cached messages:', error);
    }
    return null;
  };

  // Check if cache is stale (older than 30 seconds)
  const isCacheStale = (lastSync: number): boolean => {
    const CACHE_STALE_TIME = 30 * 1000; // 30 seconds
    return Date.now() - lastSync > CACHE_STALE_TIME;
  };

  const saveCachedMessages = (chatId: string, messages: ChatMessage[]) => {
    const cacheKey = getCacheKey(chatId);
    if (!cacheKey) return;
    
    const lastSync = Date.now();
    const cachedData = {
      messages: messages.map(msg => ({
        ...msg,
        timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
        citedContext: msg.citedContext || null, // Explicitly preserve citedContext
      })),
      lastSync,
    };
    
    try {
      const toCache = {
        messages: messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
          citedContext: msg.citedContext || null, // Explicitly preserve citedContext
        })),
        lastSync,
      };
      localStorage.setItem(cacheKey, JSON.stringify(toCache));
      
      // Update in-memory cache
      setAllChatCaches((prev) => {
        const newMap = new Map(prev);
        newMap.set(chatId, cachedData);
        return newMap;
      });
    } catch (error) {
      console.error('Failed to save cached messages:', error);
      // If storage is full, try to clear old caches
      try {
        clearOldMessageCaches();
        const limitedMessages = messages.slice(-100);
        const toCache = {
          messages: limitedMessages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
            citedContext: msg.citedContext || null, // Explicitly preserve citedContext
          })),
          lastSync,
        };
        localStorage.setItem(cacheKey, JSON.stringify(toCache));
        
        // Update in-memory cache with limited messages
        setAllChatCaches((prev) => {
          const newMap = new Map(prev);
          newMap.set(chatId, {
            messages: limitedMessages.map(msg => ({
              ...msg,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            })),
            lastSync,
          });
          return newMap;
        });
      } catch (e) {
        console.error('Failed to save even after clearing old caches:', e);
      }
    }
  };

  const clearOldMessageCaches = () => {
    if (!user?.email) return;
    const prefix = `chat_messages_${user.email.toLowerCase()}_`;
    const keysToRemove: string[] = [];
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      // Keep only the most recent 20 chat caches
      if (keysToRemove.length > 20) {
        const cacheData = keysToRemove.map(key => ({
          key,
          lastSync: JSON.parse(localStorage.getItem(key) || '{}').lastSync || 0,
        }));
        cacheData.sort((a, b) => b.lastSync - a.lastSync);
        const toRemove = cacheData.slice(20);
        toRemove.forEach(({ key }) => localStorage.removeItem(key));
      }
    } catch (error) {
      console.error('Failed to clear old message caches:', error);
    }
  };

  // Helper function to merge messages intelligently, preserving optimistic updates
  const mergeMessages = (
    existing: Message[], 
    incoming: ChatMessage[], 
    preserveOptimistic: boolean = true
  ): Message[] => {
    // Create a map of existing messages by ID
    const existingMap = new Map<string, Message>();
    existing.forEach(msg => {
      existingMap.set(msg.id, msg);
    });

    // Also create a map of optimistic messages by content+timestamp for matching
    // This helps match temp IDs to real IDs when Firestore confirms the message
    const optimisticMap = new Map<string, Message>();
    existing.forEach(msg => {
      if (msg.id.startsWith('temp-')) {
        // Use content + timestamp (within 5 seconds) as key to match optimistic messages
        const key = `${msg.content}|${msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()}`;
        optimisticMap.set(key, msg);
      }
    });

    // Process incoming messages
    incoming.forEach(incomingMsg => {
      const incomingId = incomingMsg.id;
      const existingMsg = existingMap.get(incomingId);
      
        // If message exists by ID, update it (prefer real ID over temp ID)
        if (existingMsg) {
          const isOptimistic = existingMsg.id.startsWith('temp-');
          if (!isOptimistic || !preserveOptimistic) {
            // Update with incoming message (it's from Firestore, so it's authoritative)
            existingMap.set(incomingId, {
              id: incomingId,
              role: incomingMsg.role as "user" | "assistant",
              content: incomingMsg.content,
              timestamp: incomingMsg.timestamp instanceof Date 
                ? incomingMsg.timestamp 
                : new Date(incomingMsg.timestamp),
              userId: incomingMsg.userId,
              citedContext: incomingMsg.citedContext || existingMsg.citedContext,
            });
          }
        } else {
          // Message doesn't exist by ID - check if it matches an optimistic message
          const incomingTime = incomingMsg.timestamp instanceof Date 
            ? incomingMsg.timestamp.getTime() 
            : new Date(incomingMsg.timestamp).getTime();
          const incomingContent = incomingMsg.content;
          
          // Try to find matching optimistic message (same content, timestamp within 10 seconds)
          let matchedOptimistic: Message | null = null;
          for (const [key, optimisticMsg] of optimisticMap.entries()) {
            const [content, timeStr] = key.split('|');
            const optimisticTime = parseInt(timeStr);
            
            // Match if content is same and timestamp is within 10 seconds
            if (content === incomingContent && 
                Math.abs(incomingTime - optimisticTime) < 10000) {
              matchedOptimistic = optimisticMsg;
              break;
            }
          }
          
          if (matchedOptimistic) {
            // Replace optimistic message with real one, preserve citedContext from optimistic if not in incoming
            existingMap.delete(matchedOptimistic.id);
            existingMap.set(incomingId, {
              id: incomingId,
              role: incomingMsg.role as "user" | "assistant",
              content: incomingMsg.content,
              timestamp: incomingMsg.timestamp instanceof Date 
                ? incomingMsg.timestamp 
                : new Date(incomingMsg.timestamp),
              userId: incomingMsg.userId,
              citedContext: incomingMsg.citedContext || matchedOptimistic.citedContext,
            });
          } else {
            // New message, add it
            existingMap.set(incomingId, {
              id: incomingId,
              role: incomingMsg.role as "user" | "assistant",
              content: incomingMsg.content,
              timestamp: incomingMsg.timestamp instanceof Date 
                ? incomingMsg.timestamp 
                : new Date(incomingMsg.timestamp),
              userId: incomingMsg.userId,
              citedContext: incomingMsg.citedContext,
            });
          }
        }
    });

    // Convert back to array and sort by timestamp
    const merged = Array.from(existingMap.values()).sort((a, b) => {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return aTime - bTime;
    });

    return merged;
  };

  // Helper function to merge channel messages intelligently
  const mergeChannelMessages = (
    existing: ChannelMessage[],
    incoming: ChatMessage[],
    projectIdOrTeamId: string,
    preserveOptimistic: boolean = true,
    isTeam: boolean = false
  ): ChannelMessage[] => {
    // Filter incoming messages for this project or team
    // Include both user messages and assistant messages (lean's responses)
    const channelMessages = incoming.filter(msg => {
      if (isTeam) {
        return (msg.role === 'user' || msg.role === 'assistant') && msg.teamId === projectIdOrTeamId;
      } else {
        return (msg.role === 'user' || msg.role === 'assistant') && msg.projectId === projectIdOrTeamId;
      }
    });

    // Create a map of existing messages by ID
    const existingMap = new Map<string, ChannelMessage>();
    existing.forEach(msg => {
      existingMap.set(msg.id, msg);
    });

    // Also create a map of optimistic messages by content+timestamp for matching
    const optimisticMap = new Map<string, ChannelMessage>();
    existing.forEach(msg => {
      if (msg.id.startsWith('temp-')) {
        const key = `${msg.content}|${msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()}`;
        optimisticMap.set(key, msg);
      }
    });

    // Process incoming messages
    channelMessages.forEach(incomingMsg => {
      const incomingId = incomingMsg.id;
      const existingMsg = existingMap.get(incomingId);
      
      // If message exists by ID, update it
      if (existingMsg) {
        const isOptimistic = existingMsg.id.startsWith('temp-');
        if (!isOptimistic || !preserveOptimistic) {
          // Update with incoming message
          existingMap.set(incomingId, {
            id: incomingId,
            memberName: incomingMsg.memberName || (incomingMsg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: incomingMsg.memberAvatar || (incomingMsg.role === 'assistant' ? 'AI' : 'U'),
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId || (incomingMsg.role === 'assistant' ? 'ai-assistant' : undefined),
            citedContext: incomingMsg.citedContext || existingMsg.citedContext,
          });
        }
      } else {
        // Message doesn't exist by ID - check if it matches an optimistic message
        const incomingTime = incomingMsg.timestamp instanceof Date 
          ? incomingMsg.timestamp.getTime() 
          : new Date(incomingMsg.timestamp).getTime();
        const incomingContent = incomingMsg.content;
        
        // Try to find matching optimistic message
        let matchedOptimistic: ChannelMessage | null = null;
        for (const [key, optimisticMsg] of optimisticMap.entries()) {
          const [content, timeStr] = key.split('|');
          const optimisticTime = parseInt(timeStr);
          
          // Match if content is same and timestamp is within 10 seconds
          if (content === incomingContent && 
              Math.abs(incomingTime - optimisticTime) < 10000) {
            matchedOptimistic = optimisticMsg;
            break;
          }
        }
        
        if (matchedOptimistic) {
          // Replace optimistic message with real one, preserve citedContext
          existingMap.delete(matchedOptimistic.id);
          existingMap.set(incomingId, {
            id: incomingId,
            memberName: incomingMsg.memberName || (incomingMsg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: incomingMsg.memberAvatar || (incomingMsg.role === 'assistant' ? 'AI' : 'U'),
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId || (incomingMsg.role === 'assistant' ? 'ai-assistant' : undefined),
            citedContext: incomingMsg.citedContext || matchedOptimistic.citedContext,
          });
        } else {
          // New message, add it
          existingMap.set(incomingId, {
            id: incomingId,
            memberName: incomingMsg.memberName || (incomingMsg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: incomingMsg.memberAvatar || (incomingMsg.role === 'assistant' ? 'AI' : 'U'),
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId || (incomingMsg.role === 'assistant' ? 'ai-assistant' : undefined),
            citedContext: incomingMsg.citedContext,
          });
        }
      }
    });

    // Convert back to array and sort by timestamp
    const merged = Array.from(existingMap.values()).sort((a, b) => {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return aTime - bTime;
    });

    return merged;
  };

  // Load lastReadTimestamps from localStorage on mount or when user changes
  useEffect(() => {
    if (!user?.email) return;
    
    try {
      const storageKey = `chat_lastReadTimestamps_${user.email.toLowerCase()}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        const timestampsMap = new Map<string, number>();
        Object.entries(parsed).forEach(([chatId, timestamp]) => {
          timestampsMap.set(chatId, timestamp as number);
        });
        setLastReadTimestamps(timestampsMap);
      }
    } catch (error) {
      console.error('Failed to load lastReadTimestamps from localStorage:', error);
    }
  }, [user?.email]);

  // Save lastReadTimestamps to localStorage whenever it changes
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

  // Save last selected member to localStorage whenever it changes
  useEffect(() => {
    if (!user?.email || !isOpen) return;
    
    try {
      const storageKey = `chat_lastSelectedMember_${user.email.toLowerCase()}`;
      localStorage.setItem(storageKey, selectedMember);
    } catch (error) {
      console.error('Failed to save last selected member to localStorage:', error);
    }
  }, [selectedMember, user?.email, isOpen]);

  // Restore last selected member when user changes
  useEffect(() => {
    if (!user?.email) return;
    const lastMember = getLastSelectedMember();
    setSelectedMember(lastMember);
  }, [user?.email, getLastSelectedMember]);

  // Get all domain users (excluding current user)
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

  // Helper function to get user display info from userId
  const getUserInfo = useCallback((userId?: string) => {
    if (!userId) return { name: "Unknown", initials: "U" };
    const foundUser = allDomainUsers.find(u => u.email?.toLowerCase() === userId.toLowerCase());
    if (foundUser) {
      return {
        name: getUserDisplayName(foundUser),
        initials: getUserInitials(foundUser),
      };
    }
    return { name: "Unknown", initials: "U" };
  }, [allDomainUsers]);
  
  // Check if selected member is a project channel
  const isProjectChannel = selectedMember.startsWith("project-");
  const selectedProjectId = isProjectChannel ? selectedMember.replace("project-", "") : null;
  const selectedProject = selectedProjectId 
    ? projects.find(p => p.name.toLowerCase().replace(/\s+/g, '-') === selectedProjectId)
    : null;
  
  // Check if selected member is a team channel
  const isTeamChannel = selectedMember.startsWith("team-");
  const selectedTeamId = isTeamChannel ? selectedMember.replace("team-", "") : null;
  const selectedTeam = selectedTeamId 
    ? userTeams.find(t => t.name.toLowerCase().replace(/\s+/g, '-') === selectedTeamId)
    : null;
  
  // Filter team members based on search query (search by name, role, or email)
  const filteredTeamMembers = memberSearchQuery.trim() === ""
    ? allTeamMembers
    : allTeamMembers.filter((member) => {
        const query = memberSearchQuery.toLowerCase();
        return (
          member.name.toLowerCase().includes(query) ||
          member.role.toLowerCase().includes(query) ||
          member.email?.toLowerCase().includes(query)
        );
      });

  // Filter projects based on search query
  const filteredProjects = memberSearchQuery.trim() === ""
    ? projects
    : projects.filter((project) =>
        project.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        project.description.toLowerCase().includes(memberSearchQuery.toLowerCase())
      );

  // Filter teams based on search query
  const filteredTeams = memberSearchQuery.trim() === ""
    ? userTeams
    : userTeams.filter((team) =>
        team.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        (team.description && team.description.toLowerCase().includes(memberSearchQuery.toLowerCase()))
      );

  const currentMember = selectedMember === "ai-assistant" 
    ? { id: "ai-assistant", name: "lean", role: "AI Project Manager", avatar: "AI" }
    : isProjectChannel && selectedProject
    ? { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" }
    : isTeamChannel && selectedTeam
    ? { id: selectedMember, name: selectedTeam.name, role: "Team Channel", avatar: "👥" }
    : allTeamMembers.find(m => m.id === selectedMember) || { id: "ai-assistant", name: "lean", role: "AI Project Manager", avatar: "AI" };

  // Check if AI Assistant matches search query
  const aiAssistantMatches = memberSearchQuery.trim() === "" || 
    "lean".includes(memberSearchQuery.toLowerCase()) ||
    "ai project manager".includes(memberSearchQuery.toLowerCase()) ||
    "project manager".includes(memberSearchQuery.toLowerCase());

  // Get mentionable users for the current channel
  const getMentionableUsers = useMemo(() => {
    const mentionable: TeamMember[] = [];
    
    // Always add lean (AI assistant)
    mentionable.push({ id: "lean", name: "lean", role: "AI Project Manager", avatar: "AI" });
    
    // Add channel-specific members
    if (isProjectChannel && selectedProject) {
      // Add project members
      selectedProject.members?.forEach(member => {
        const user = allDomainUsers.find(u => u.email === member.id || u.email === member.email);
        if (user) {
          mentionable.push({
            id: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: member.role,
            avatar: getUserInitials(`${user.firstName} ${user.lastName}`),
            email: user.email,
          });
        }
      });
    } else if (isTeamChannel && selectedTeam) {
      // Add team members (this would need to fetch team details)
      // For now, add all domain users from the team
      allTeamMembers.forEach(member => {
        if (!mentionable.find(m => m.id === member.id)) {
          mentionable.push(member);
        }
      });
    }
    
    return mentionable;
  }, [isProjectChannel, isTeamChannel, selectedProject, selectedTeam, allDomainUsers, allTeamMembers]);

  // Filter mentionable users based on query
  const filteredMentionUsers = useMemo(() => {
    if (!mentionQuery) return getMentionableUsers;
    const query = mentionQuery.toLowerCase();
    return getMentionableUsers.filter(user => 
      user.name.toLowerCase().includes(query) || 
      user.email?.toLowerCase().includes(query)
    );
  }, [getMentionableUsers, mentionQuery]);

  // Detect @ mentions in input
  const detectMention = useCallback((text: string, cursorPos: number) => {
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex === -1) {
      setShowMentionSuggestions(false);
      setSelectedMentionIndex(0);
      return;
    }
    
    // Check if there's a space before @ or it's at the start
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    if (charBeforeAt !== ' ' && lastAtIndex !== 0) {
      setShowMentionSuggestions(false);
      setSelectedMentionIndex(0);
      return;
    }
    
    // Get text after @ until cursor
    const afterAt = textBeforeCursor.substring(lastAtIndex + 1);
    
    // Check if there's a space in the text after @ (means mention was completed)
    if (afterAt.includes(' ')) {
      setShowMentionSuggestions(false);
      setSelectedMentionIndex(0);
      return;
    }
    
    setMentionQuery(afterAt);
    setMentionCursorPos(lastAtIndex);
    setSelectedMentionIndex(0);
    setShowMentionSuggestions(true);
  }, []);

  // Insert mention into input
  const insertMention = useCallback((user: TeamMember) => {
    const beforeMention = input.substring(0, mentionCursorPos);
    const afterCursor = input.substring(inputRef.current?.selectionStart || input.length);
    // Extract first name only (everything before the first space)
    const firstName = user.name.split(' ')[0];
    const newInput = `${beforeMention}@${firstName} ${afterCursor}`;
    setInput(newInput);
    setShowMentionSuggestions(false);
    setMentionQuery("");
    setSelectedMentionIndex(0);
    
    // Focus input and move cursor after mention
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = beforeMention.length + firstName.length + 2; // +2 for @ and space
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [input, mentionCursorPos]);

  // Handle keyboard navigation for mentions
  const handleMentionKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showMentionSuggestions || filteredMentionUsers.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedMentionIndex((prev) => 
        prev < filteredMentionUsers.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedMentionIndex((prev) => 
        prev > 0 ? prev - 1 : filteredMentionUsers.length - 1
      );
    } else if (e.key === 'Enter' && showMentionSuggestions) {
      e.preventDefault();
      const selectedUser = filteredMentionUsers[selectedMentionIndex];
      if (selectedUser) {
        insertMention(selectedUser);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowMentionSuggestions(false);
      setSelectedMentionIndex(0);
    }
  }, [showMentionSuggestions, filteredMentionUsers, selectedMentionIndex, insertMention]);

  // Render message content with highlighted mentions
  const renderMessageContent = useCallback((content: string) => {
    // Match @mentions - matches @username (single word) or @"Full Name" (with spaces in quotes)
    // Simple pattern: @word where word can contain letters, numbers, and underscores
    const mentionRegex = /@([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*?)(?=\s|$|[.,!?;:])/g;
    const parts: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      // Add text before mention
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }
      
      // Add highlighted mention
      const mentionName = match[1];
      parts.push(
        <span
          key={match.index}
          className="text-primary font-semibold"
        >
          @{mentionName}
        </span>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : content;
  }, []);

  // Play notification sound for received messages
  const playNotificationSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Create a pleasant notification sound (two-tone beep)
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.error('Failed to play notification sound:', error);
    }
  }, []);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      // Find the scroll container
      let scrollContainer: HTMLElement | null = messagesEndRef.current.parentElement;
      while (scrollContainer) {
        const style = window.getComputedStyle(scrollContainer);
        if (scrollContainer.scrollHeight > scrollContainer.clientHeight && 
            (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll')) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }
      
      if (scrollContainer) {
        // Set scroll position directly to bottom (no animation)
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      } else {
        // Fallback to scrollIntoView
        messagesEndRef.current.scrollIntoView({ behavior: "auto" });
      }
    }
  };

  const scrollToEarliestUnreadOrLatest = () => {
    // Determine current chat ID
    let chatId: string | null = null;
    if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
      chatId = selectedMember;
    } else if (selectedMember === "ai-assistant") {
      chatId = user?.email ? getAIAssistantChatId(user.email) : null;
    } else {
      if (selectedMember.includes('@')) {
        chatId = user?.email ? getDirectMessageChatId(user.email, selectedMember) : null;
      } else {
        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
        if (selectedMemberData?.email && user?.email) {
          chatId = getDirectMessageChatId(user.email, selectedMemberData.email);
        } else {
          chatId = selectedMember;
        }
      }
    }

    if (!chatId) {
      scrollToBottom();
      return;
    }

    const lastRead = lastReadTimestamps.get(chatId) || 0;
    let earliestUnreadElement: HTMLElement | null = null;
    let earliestUnreadTime: number | null = null;
    let latestMessageElement: HTMLElement | null = null;
    let latestMessageTime: number | null = null;

    // Find all message elements
    const messageElements = document.querySelectorAll('[data-message-id]');
    
    messageElements.forEach((element) => {
      const messageTimestamp = element.getAttribute('data-message-timestamp');
      const messageUserId = element.getAttribute('data-message-user-id');
      const messageRole = element.getAttribute('data-message-role');
      
      if (!messageTimestamp) return;
      
      const msgTime = parseInt(messageTimestamp, 10);
      const isAfterLastRead = msgTime > lastRead;
      
      // Determine if message is unread
      // For AI assistant, count assistant messages as unread; for others, count messages not from current user
      const isUnread = isAfterLastRead && (
        chatId === (user?.email ? getAIAssistantChatId(user.email) : null)
          ? messageRole === 'assistant' || (messageRole === 'user' && messageUserId?.toLowerCase() !== user?.email?.toLowerCase())
          : messageUserId?.toLowerCase() !== user?.email?.toLowerCase()
      );

      // Track latest message (by timestamp)
      if (latestMessageTime === null || msgTime > latestMessageTime) {
        latestMessageTime = msgTime;
        latestMessageElement = element as HTMLElement;
      }

      // Track earliest unread message (by timestamp)
      if (isUnread && (earliestUnreadTime === null || msgTime < earliestUnreadTime)) {
        earliestUnreadTime = msgTime;
        earliestUnreadElement = element as HTMLElement;
      }
    });

    // Scroll to earliest unread message, or latest message if no unread
    const targetElement = earliestUnreadElement || latestMessageElement;
    if (targetElement) {
      // Find the scroll container by traversing up the DOM tree
      let scrollContainer: HTMLElement | null = targetElement.parentElement;
      while (scrollContainer) {
        const style = window.getComputedStyle(scrollContainer);
        if (scrollContainer.scrollHeight > scrollContainer.clientHeight && 
            (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll')) {
          break;
        }
        scrollContainer = scrollContainer.parentElement;
      }
      
      if (scrollContainer) {
        // Calculate the position relative to the scroll container
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = targetElement.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top);
        
        // Set scroll position directly (no animation, instant jump)
        scrollContainer.scrollTop = scrollTop;
      } else {
        // Fallback to scrollIntoView if we can't find the container
        targetElement.scrollIntoView({ behavior: "auto", block: "start" });
      }
    } else {
      // Fallback to bottom if no messages found
      scrollToBottom();
    }
  };

  // Perform search through project activities when in project channel mode
  // Note: Team channels don't have search functionality yet (similar to project channels)
  useEffect(() => {
    if ((!isProjectChannel && !isTeamChannel) || (!selectedProject && !selectedTeam) || !memberSearchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    
    // For now, only project channels have search functionality
    if (!isProjectChannel || !selectedProject) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const query = memberSearchQuery.toLowerCase();
    const results: SearchResult[] = [];

    // Search through progress updates
    if (filterType === "all" || filterType === "activities") {
      selectedProject.progressUpdates.forEach((update) => {
        if (
          update.update.toLowerCase().includes(query) ||
          update.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: update.id,
            type: "update",
            title: `Progress Update by ${update.memberName}`,
            content: update.update,
            memberName: update.memberName,
            memberAvatar: update.memberAvatar,
            date: update.date,
          });
        }
      });
    }

    // Search through comments
    if (filterType === "all" || filterType === "comments") {
      selectedProject.comments.forEach((comment) => {
        if (
          comment.comment.toLowerCase().includes(query) ||
          comment.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: comment.id,
            type: "comment",
            title: `Comment by ${comment.memberName}`,
            content: comment.comment,
            memberName: comment.memberName,
            memberAvatar: comment.memberAvatar,
            date: comment.date,
          });
        }
      });
    }

    // Search through tasks
    if (filterType === "all" || filterType === "tasks") {
      selectedProject.tasks.forEach((task) => {
        const assigneeName = task.assignee || "Unassigned";
        if (
          task.title.toLowerCase().includes(query) ||
          assigneeName.toLowerCase().includes(query) ||
          task.status.toLowerCase().includes(query)
        ) {
          results.push({
            id: task.id,
            type: "task",
            title: task.title,
            content: `Status: ${task.status} | Assignee: ${assigneeName} | Due: ${task.dueDate}`,
            memberName: assigneeName,
            memberAvatar: task.assigneeAvatar || (assigneeName !== "Unassigned" ? assigneeName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?"),
            date: task.dueDate,
          });
        }
      });
    }

    // Search through channel messages
    if (filterType === "all" || filterType === "comments") {
      const projectMessages = channelMessages.get(selectedProjectId!) || [];
      projectMessages.forEach((message) => {
        if (
          message.content.toLowerCase().includes(query) ||
          message.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: message.id,
            type: "channel-message",
            title: `Channel message by ${message.memberName}`,
            content: message.content,
            memberName: message.memberName,
            memberAvatar: message.memberAvatar,
            date: message.timestamp.toLocaleDateString(),
          });
        }
      });
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aExact = a.content.toLowerCase() === query || a.title.toLowerCase() === query;
      const bExact = b.content.toLowerCase() === query || b.title.toLowerCase() === query;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    setSearchResults(results);
    setIsSearching(results.length > 0 || memberSearchQuery.trim().length > 0);
  }, [memberSearchQuery, isProjectChannel, selectedProject, filterType, selectedProjectId, channelMessages]);

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        scrollToEarliestUnreadOrLatest();
        if ((isProjectChannel || isTeamChannel) && isSearching) {
          memberSearchRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 100);
    }
  }, [messages, channelMessages, isOpen, selectedProjects, selectedTasks, selectedTeams, isProjectChannel, isTeamChannel, isSearching, selectedMember, user?.email, allTeamMembers, lastReadTimestamps, selectedProjectId, selectedTeamId]);

  // Calculate unread counts for all chats when chatbot opens or when user/projects/teams change
  useEffect(() => {
    if (!user || !user.email) return;

    const calculateUnreadCounts = async () => {
      const newUnreadCounts = new Map<string, number>();
      const allChatIds: string[] = [];

      // Add AI assistant chat
      allChatIds.push(getAIAssistantChatId(user.email));

      // Add all project channels
      projects.forEach((project) => {
        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`project-${projectId}`);
      });

      // Add all domain user direct message chats
      allTeamMembers.forEach((member) => {
        if (member.email) {
          const chatId = getDirectMessageChatId(user.email, member.email);
          allChatIds.push(chatId);
        }
      });

      // Calculate unread count for each chat
      // Use cache first to avoid unnecessary API calls for empty chats
      // Process requests in batches to avoid overwhelming the browser
      const BATCH_SIZE = 3; // Process 3 requests at a time
      const chatIdsToProcess = allChatIds.filter((chatId) => {
        // Pre-filter chats that can skip API calls based on cache
        const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
        const cacheIsRecent = cached && !isCacheStale(cached.lastSync);
        const cacheIsEmpty = cached && cached.messages.length === 0;
        
        // If cache shows empty and is recent, skip API call
        if (cacheIsRecent && cacheIsEmpty) {
          newUnreadCounts.set(chatId, 0);
          return false; // Skip this chat
        }
        return true; // Need to process this chat
      });

      // Process chats in batches
      for (let i = 0; i < chatIdsToProcess.length; i += BATCH_SIZE) {
        const batch = chatIdsToProcess.slice(i, i + BATCH_SIZE);
        
        await Promise.all(
          batch.map(async (chatId) => {
            try {
              // Only make API call if cache is stale or doesn't exist
              const firestoreMessages = await messagesService.getByChatId(chatId);
              const lastRead = lastReadTimestamps.get(chatId) || 0;

              const unreadCount = firestoreMessages.filter((msg) => {
                const msgTime =
                  msg.timestamp instanceof Date
                    ? msg.timestamp.getTime()
                    : new Date(msg.timestamp).getTime();
                const isAfterLastRead = msgTime > lastRead;
                // For AI assistant, count assistant messages as unread; for others, count messages not from current user
                const isUnread =
                  isAIAssistantChatId(chatId)
                    ? msg.role === "assistant" ||
                      (msg.role === "user" &&
                        msg.userId?.toLowerCase() !== user?.email?.toLowerCase())
                    : msg.userId?.toLowerCase() !== user?.email?.toLowerCase();
                return isAfterLastRead && isUnread;
              }).length;

              // Store unread count (0 or positive)
              newUnreadCounts.set(chatId, unreadCount);
            } catch (error) {
              // Silently fail - don't spam console with errors
              // Use cache as fallback if available
              const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
              if (cached && cached.messages.length === 0) {
                newUnreadCounts.set(chatId, 0);
              }
            }
          })
        );
        
        // Small delay between batches to prevent overwhelming the browser
        if (i + BATCH_SIZE < chatIdsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay between batches
        }
      }

      // Update unread counts, but don't overwrite if current chat is open (it should be 0)
      setUnreadCounts((prev) => {
        const merged = new Map(prev);
        newUnreadCounts.forEach((count, chatId) => {
            // Only update if this chat is not currently open (and chatbot is open)
            if (isOpen) {
              let currentChatId: string;
              if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
                currentChatId = selectedMember;
              } else if (selectedMember === "ai-assistant") {
                currentChatId = getAIAssistantChatId(user.email);
              } else {
                const selectedMemberData = allTeamMembers.find((m) => m.id === selectedMember);
                if (selectedMemberData?.email) {
                  currentChatId = getDirectMessageChatId(user.email, selectedMemberData.email);
                } else {
                  currentChatId = selectedMember;
                }
              }
            if (chatId !== currentChatId) {
              if (count > 0) {
                merged.set(chatId, count);
              } else {
                // Remove from map if count is 0
                merged.delete(chatId);
              }
            }
          } else {
            // Chatbot is closed, update all unread counts
            if (count > 0) {
              merged.set(chatId, count);
            } else {
              // Remove from map if count is 0
              merged.delete(chatId);
            }
          }
        });
        return merged;
      });
    };

    // Debounce the calculation to prevent rapid re-calculations
    const timeoutId = setTimeout(() => {
      calculateUnreadCounts();
    }, 300); // 300ms debounce delay

    return () => {
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, projects, userTeams, allTeamMembers, isOpen, selectedMember, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, lastReadTimestamps]);

  // Load all chat caches upfront - ONLY ONCE per session (on mount/login)
  useEffect(() => {
    if (!user || !user.email || cacheLoadedForSession) return;

    const loadAllChatCaches = () => {
      const allChatIds: string[] = [];
      const caches = new Map<string, { messages: ChatMessage[], lastSync: number }>();

      // Add AI assistant chat
      allChatIds.push(getAIAssistantChatId(user.email));

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

      // Load all caches in parallel
      allChatIds.forEach((chatId) => {
        const cached = loadCachedMessages(chatId);
        if (cached) {
          caches.set(chatId, cached);
        }
      });

      setAllChatCaches(caches);
      setCacheLoadedForSession(true); // Mark cache as loaded for this session
    };

    loadAllChatCaches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, projects, userTeams, allTeamMembers, cacheLoadedForSession]);

  // Background sync: Fetch new messages for all chats even when chat is closed
  useEffect(() => {
    if (!user || !user.email) return;

    const syncAllChats = async () => {
      const allChatIds: string[] = [];

      // Add AI assistant chat
      allChatIds.push(getAIAssistantChatId(user.email));

      // Add all project channels
      projects.forEach((project) => {
        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
        allChatIds.push(`project-${projectId}`);
      });

      // Add all team member direct message chats
      allTeamMembers.forEach((member) => {
        if (member.email) {
          const chatId = getDirectMessageChatId(user.email, member.email);
          allChatIds.push(chatId);
        }
      });

      // Sync each chat in the background
      await Promise.all(
        allChatIds.map(async (chatId) => {
          try {
            // Use pre-loaded cache if available, otherwise load from localStorage
            const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
            const hasCachedMessages = cached && cached.messages.length > 0;
            const cacheIsStale = cached ? isCacheStale(cached.lastSync) : true;

            // Only sync if cache is stale or doesn't exist
            // Skip if cache shows empty and is recent (avoid unnecessary API calls for empty chats)
            const cacheIsRecent = cached && !cacheIsStale;
            const cacheIsEmpty = cached && cached.messages.length === 0;
            
            // Skip API call if cache shows empty and is recent
            if (cacheIsRecent && cacheIsEmpty) {
              // Cache shows empty and is fresh - skip API call
              return;
            }
            
            // Only sync if cache is stale or doesn't exist
            if (!hasCachedMessages || cacheIsStale) {
              // Get the latest message timestamp from cache to fetch only new messages
              let afterTimestamp: Date | undefined;
              if (cached && cached.messages.length > 0) {
                const latestTimestamp = Math.max(
                  ...cached.messages.map(msg => 
                    msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
                  )
                );
                afterTimestamp = new Date(latestTimestamp);
              }

              // Fetch only new messages
              const newMessages = afterTimestamp 
                ? await messagesService.getByChatId(chatId, afterTimestamp)
                : await messagesService.getByChatId(chatId);

              // If we got new messages, merge with cache and save
              if (newMessages.length > 0 || !hasCachedMessages) {
                const messageMap = new Map<string, ChatMessage>();
                if (cached) {
                  cached.messages.forEach(msg => messageMap.set(msg.id, msg));
                }
                newMessages.forEach(msg => messageMap.set(msg.id, msg));

                const allMessages = Array.from(messageMap.values()).sort((a, b) => {
                  const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
                  const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
                  return aTime - bTime;
                });

                // Save to cache
                saveCachedMessages(chatId, allMessages);

                // Update unread counts if chat is not currently open
                // IMPORTANT: Never update state for active chats - only update cache and unread counts
                const isCurrentChat = isOpen && (
                  ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) && chatId === selectedMember ||
                  (!isProjectChannel && !isTeamChannel && selectedMember === chatId)
                );
                
                // For active chats, only update cache, don't touch state
                if (isCurrentChat) {
                  // Update cache but don't update state (state is managed by real-time listener)
                  saveCachedMessages(chatId, allMessages);
                  
                  // Update last read timestamp
                  if (allMessages.length > 0) {
                    const latestMessageTime = Math.max(
                      ...allMessages.map(msg => 
                        msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
                      )
                    );
                    setLastReadTimestamps((prev) => {
                      const newMap = new Map(prev);
                      newMap.set(chatId, latestMessageTime);
                      return newMap;
                    });
                  }
                  
                  // Clear unread count if viewing this chat
                  setUnreadCounts((prev) => {
                    const newMap = new Map(prev);
                    newMap.delete(chatId);
                    return newMap;
                  });
                  
                  // Don't update state - return early
                  return;
                }
                
                if (!isCurrentChat) {
                  const lastRead = lastReadTimestamps.get(chatId) || 0;
                  const unreadCount = allMessages.filter((msg) => {
                    const msgTime = msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime();
                    const isAfterLastRead = msgTime > lastRead;
                    const isUnread = isAIAssistantChatId(chatId)
                      ? msg.role === "assistant" || (msg.role === "user" && msg.userId?.toLowerCase() !== user?.email?.toLowerCase())
                      : msg.userId?.toLowerCase() !== user?.email?.toLowerCase();
                    return isAfterLastRead && isUnread;
                  }).length;

                  if (unreadCount > 0) {
                    setUnreadCounts((prev) => {
                      const newMap = new Map(prev);
                      newMap.set(chatId, unreadCount);
                      return newMap;
                    });
                    
                    // Play notification sound for new messages
                    playNotificationSound();
                  } else {
                    // Clear unread count if it's 0
                    setUnreadCounts((prev) => {
                      const newMap = new Map(prev);
                      newMap.delete(chatId);
                      return newMap;
                    });
                  }
                }
              } else if (hasCachedMessages) {
                // Even if no new messages, update cache timestamp to prevent unnecessary fetches
                saveCachedMessages(chatId, cached.messages);
                
                // If viewing this chat, make sure unread count is cleared
                const isCurrentChat = isOpen && (
                  ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) && chatId === selectedMember ||
                  (!isProjectChannel && !isTeamChannel && selectedMember === chatId)
                );
                if (isCurrentChat) {
                  // Clear unread count if viewing this chat
                  setUnreadCounts((prev) => {
                    const newMap = new Map(prev);
                    newMap.delete(chatId);
                    return newMap;
                  });
                }
              }
            }
          } catch (error) {
            // Silently fail for background sync
          }
        })
      );
    };

    // Initial sync - delay to avoid overwhelming the server
    const initialSyncTimer = setTimeout(() => {
      syncAllChats();
    }, 2000);

    // Set up periodic sync every 60 seconds (reduced from 30 to reduce load)
    const syncInterval = setInterval(syncAllChats, 60000);

    return () => {
      clearTimeout(initialSyncTimer);
      clearInterval(syncInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, projects, allTeamMembers, isOpen, selectedMember, isProjectChannel, lastReadTimestamps]);

  // Load messages from Firestore when chat changes
  useEffect(() => {
    if (!user || !isOpen || !user.email) return;

    let chatId: string;
    
    // Determine chatId
    if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
      chatId = selectedMember;
    } else if (selectedMember === "ai-assistant") {
      chatId = getAIAssistantChatId(user.email);
    } else {
      if (selectedMember.includes('@')) {
        chatId = getDirectMessageChatId(user.email, selectedMember);
      } else {
        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
        if (selectedMemberData?.email) {
          chatId = getDirectMessageChatId(user.email, selectedMemberData.email);
        } else {
          chatId = selectedMember; // Final fallback
        }
      }
    }

    // Clear messages when switching to a different chat
    const previousChatId = previousChatIdRef.current;
    const chatHasChanged = previousChatId !== null && previousChatId !== chatId;
    
    if (chatHasChanged) {
      // Chat has changed - clear old messages immediately
      if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
        // For project/team channels, we keep the Map structure but clear the specific channel
        // Actually, we should keep other channels' messages, so don't clear here
      } else {
        // For regular chats, clear messages immediately
        setMessages([]);
      }
    }
    // Update the ref to track current chatId
    previousChatIdRef.current = chatId;

    // Check if this is initial load (state is empty OR chat has changed)
    // When chat changes, we treat it as initial load since we just cleared messages
    const isInitialLoad = chatHasChanged || ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)
      ? (isProjectChannel && selectedProjectId && (!channelMessages.has(selectedProjectId) || channelMessages.get(selectedProjectId)?.length === 0)) ||
        (isTeamChannel && selectedTeamId && (!channelMessages.has(selectedTeamId) || channelMessages.get(selectedTeamId)?.length === 0))
      : messages.length === 0);
    
    // Load cached messages ONLY for initial load AND only if cache was loaded for this session
    // Once messages are loaded, rely on real-time listener only - NEVER load from cache again
    const cached = (isInitialLoad && cacheLoadedForSession) 
      ? (allChatCaches.get(chatId) || loadCachedMessages(chatId))
      : null;
    const hasCachedMessages = cached && cached.messages.length > 0;
    const cacheIsStale = cached ? isCacheStale(cached.lastSync) : true;
    
    // Only use cache for initial load - never after
    if (isInitialLoad && hasCachedMessages && cacheLoadedForSession) {
      // Show cached messages immediately without loading state
      setIsLoadingMessages(false);
      if (isProjectChannel && selectedProjectId) {
        const cachedChannelMsgs: ChannelMessage[] = cached.messages
          .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.projectId === selectedProjectId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            projectId: msg.projectId || selectedProjectId,
            userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
            citedContext: msg.citedContext,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedProjectId, cachedChannelMsgs);
          return newMap;
        });
      } else if (isTeamChannel && selectedTeamId) {
        const cachedChannelMsgs: ChannelMessage[] = cached.messages
          .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.teamId === selectedTeamId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            teamId: msg.teamId || selectedTeamId,
            userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
            citedContext: msg.citedContext,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedTeamId, cachedChannelMsgs);
          return newMap;
        });
      } else {
        const filteredCached = isAIAssistantChatId(chatId) 
          ? cached.messages 
          : cached.messages.filter(msg => msg.role === 'user');
        
        const cachedRegularMsgs: Message[] = filteredCached.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          userId: msg.userId,
          citedContext: msg.citedContext,
        }));
        
        if (cachedRegularMsgs.length > 0) {
          setMessages(cachedRegularMsgs);
        } else if (isAIAssistantChatId(chatId)) {
          setMessages([
            {
              id: "greeting",
              role: "assistant",
              content: "Hello! I'm lean, your AI Project Manager. How can I help you today?",
              timestamp: new Date(),
            },
          ]);
        } else {
          // For private chats with no messages, set empty array
          setMessages([]);
        }
      }
    } else if (isInitialLoad && !hasCachedMessages) {
      // Only show loading if we don't have cached messages and it's initial load
      setIsLoadingMessages(true);
    } else {
      // Not initial load - state already has messages, don't overwrite with cache
      setIsLoadingMessages(false);
    }

    // Fetch fresh messages from Firestore if:
    // 1. Not initial load (always fetch fresh after initial load)
    // 2. No cached messages available
    // 3. Cache is stale
    // 4. Cache shows empty (need to verify it's still empty)
    // After initial load, always fetch fresh - don't rely on cache
    const shouldFetch = !isInitialLoad || !hasCachedMessages || cacheIsStale || (hasCachedMessages && cached.messages.length === 0);
    
    if (shouldFetch) {
      // Fetch fresh messages from Firestore in the background
      const loadMessages = async () => {
        const cachedForError = hasCachedMessages; // Capture for error handling
        try {
          // Get the latest message timestamp from cache to fetch only new messages
          let afterTimestamp: Date | undefined;
          if (cached && cached.messages.length > 0) {
            const latestTimestamp = Math.max(
              ...cached.messages.map(msg => 
                msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
              )
            );
            afterTimestamp = new Date(latestTimestamp);
          }
          
          // If cache shows empty and is recent, skip API call for empty chats
          if (hasCachedMessages && cached.messages.length === 0 && !cacheIsStale) {
            // Cache shows empty and is fresh - don't make API call
            setIsLoadingMessages(false);
            return;
          }
          
          if (isProjectChannel && selectedProjectId) {
            // Load only new project channel messages
            const newMessages = afterTimestamp 
              ? await messagesService.getByChatId(chatId, afterTimestamp)
              : await messagesService.getByChatId(chatId);
            
            // Merge with cached messages (prefer new messages if there are duplicates)
            const messageMap = new Map<string, ChatMessage>();
            if (cached) {
              cached.messages.forEach(msg => messageMap.set(msg.id, msg));
            }
            newMessages.forEach(msg => messageMap.set(msg.id, msg));
          
          const allMessages = Array.from(messageMap.values()).sort((a, b) => {
            const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
            const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
            return aTime - bTime;
          });
          
          const channelMsgs: ChannelMessage[] = allMessages
            .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.projectId === selectedProjectId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
              memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              projectId: msg.projectId || selectedProjectId,
              userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
              citedContext: msg.citedContext,
            }));
          
          // Only update state if it's initial load (state is empty)
          // Otherwise, real-time listener will handle updates
          if (isInitialLoad) {
            setChannelMessages((prev) => {
              const newMap = new Map(prev);
              newMap.set(selectedProjectId, channelMsgs);
              return newMap;
            });
          }
          
          // Save to cache (after state update) - but don't reload from cache
          setTimeout(() => saveCachedMessages(chatId, allMessages), 0);
          
          // Calculate latest message time for read timestamp
          if (channelMsgs.length > 0) {
            const latestTime = Math.max(
              ...channelMsgs.map(msg => 
                msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
              )
            );
            setLastReadTimestamps((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, latestTime);
              return newMap;
            });
          }
          
          // Clear unread count for this chat (since we're viewing it)
          setUnreadCounts((prev) => {
            const newMap = new Map(prev);
            newMap.delete(chatId);
            return newMap;
          });
        } else if (isTeamChannel && selectedTeamId) {
          // Load only new team channel messages
          const newMessages = afterTimestamp 
            ? await messagesService.getByChatId(chatId, afterTimestamp)
            : await messagesService.getByChatId(chatId);
          
          // Merge with cached messages (prefer new messages if there are duplicates)
          const messageMap = new Map<string, ChatMessage>();
          if (cached) {
            cached.messages.forEach(msg => messageMap.set(msg.id, msg));
          }
          newMessages.forEach(msg => messageMap.set(msg.id, msg));
        
        const allMessages = Array.from(messageMap.values()).sort((a, b) => {
          const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
          const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
          return aTime - bTime;
        });
        
          const channelMsgs: ChannelMessage[] = allMessages
            .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.teamId === selectedTeamId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
              memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              teamId: msg.teamId || selectedTeamId,
              userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
              citedContext: msg.citedContext,
            }));
        
        // Only update state if it's initial load (state is empty)
        // Otherwise, real-time listener will handle updates
        if (isInitialLoad) {
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedTeamId, channelMsgs);
            return newMap;
          });
        }
          
          // Save to cache (after state update) - but don't reload from cache
          setTimeout(() => saveCachedMessages(chatId, allMessages), 0);
          
          // Calculate latest message time for read timestamp
          if (channelMsgs.length > 0) {
            const latestTime = Math.max(
              ...channelMsgs.map(msg => 
                msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
              )
            );
            setLastReadTimestamps((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, latestTime);
              return newMap;
            });
          }
          
          // Clear unread count for this chat (since we're viewing it)
          setUnreadCounts((prev) => {
            const newMap = new Map(prev);
            newMap.delete(chatId);
            return newMap;
          });
        } else {
          // Load only new regular messages (AI Assistant or team member)
          const newMessages = afterTimestamp 
            ? await messagesService.getByChatId(chatId, afterTimestamp)
            : await messagesService.getByChatId(chatId);
          
          // Merge with cached messages (prefer new messages if there are duplicates)
          const messageMap = new Map<string, ChatMessage>();
          if (cached) {
            cached.messages.forEach(msg => messageMap.set(msg.id, msg));
          }
          newMessages.forEach(msg => messageMap.set(msg.id, msg));
          
          const allMessages = Array.from(messageMap.values()).sort((a, b) => {
            const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
            const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
            return aTime - bTime;
          });
          
          // For team member chats, only show user messages (no assistant messages)
          // For AI Assistant, show both user and assistant messages
          const filteredMessages = isAIAssistantChatId(chatId) 
            ? allMessages 
            : allMessages.filter(msg => msg.role === 'user');
          
          const regularMsgs: Message[] = filteredMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            userId: msg.userId,
            citedContext: msg.citedContext,
          }));
          
          // Only update state if it's initial load (state is empty)
          // Otherwise, real-time listener will handle updates
          if (isInitialLoad) {
            if (regularMsgs.length === 0 && isAIAssistantChatId(chatId)) {
              setMessages([
                {
                  id: "greeting",
                  role: "assistant",
                  content: "Hello! I'm lean, your AI Project Manager. How can I help you today?",
                  timestamp: new Date(),
                },
              ]);
            } else if (regularMsgs.length === 0 && !isAIAssistantChatId(chatId)) {
              // For private chats with no messages, set empty array
              setMessages([]);
            } else {
              setMessages(regularMsgs);
            }
          }
          
          // Save to cache (after state update if initial load)
          setTimeout(() => saveCachedMessages(chatId, allMessages), 0);
          
          // Calculate latest message time for read timestamp
          if (regularMsgs.length > 0) {
            const latestTime = Math.max(
              ...regularMsgs.map(msg => 
                msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
              )
            );
            setLastReadTimestamps((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, latestTime);
              return newMap;
            });
          }
          
          // Clear unread count for this chat (since we're viewing it)
          setUnreadCounts((prev) => {
            const newMap = new Map(prev);
            newMap.delete(chatId);
            return newMap;
          });
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
        // On error, show greeting for AI Assistant (only if we don't have cached messages)
        if (!cachedForError && selectedMember === "ai-assistant" && !isProjectChannel) {
          setMessages([
            {
              id: "greeting",
              role: "assistant",
              content: "Hello! I'm lean, your AI Project Manager. How can I help you today?",
              timestamp: new Date(),
            },
          ]);
        }
      } finally {
        // Always set loading to false after fetch completes
        setIsLoadingMessages(false);
      }
    };

      // Add timeout to prevent hanging requests
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 10000); // 10 second timeout
      });

      Promise.race([loadMessages(), timeoutPromise]).catch((error) => {
        console.warn('Message fetch timed out or failed, using cached messages:', error);
        setIsLoadingMessages(false);
        // Keep using cached messages if fetch fails
      });
    }
  }, [selectedMember, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, user?.email, isOpen]);

    // Listen for incoming calls - works even when chat window is closed
    useEffect(() => {
      if (!user || !user.email) return;

      let chatId: string;
      
      // Determine chatId (same logic as above)
      if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
        chatId = selectedMember;
      } else if (selectedMember === "ai-assistant") {
        chatId = getAIAssistantChatId(user.email);
      } else {
        if (selectedMember.includes('@')) {
          chatId = getDirectMessageChatId(user.email, selectedMember);
        } else {
          const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
          if (selectedMemberData?.email) {
            chatId = getDirectMessageChatId(user.email, selectedMemberData.email);
          } else {
            chatId = selectedMember;
          }
        }
      }

      // Only listen for calls in DM chats (not AI assistant, project, or team channels)
      const isDM = chatId.startsWith('dm-');
      if (!isDM) {
        setIncomingCallSignal(null);
        return;
      }

      // Use Firestore real-time listeners for call signaling
      setCurrentChatId(chatId);
      
      const unsubscribe = callSignalingService.subscribeToCallSignals(chatId, (signal) => {
            
            if (!signal) {
              // No signal from Firestore - but don't immediately end the call
              // Check if WebRTC connection is still active first
              if (callStatus === 'idle' || callStatus === 'ended') {
                // WebRTC connection is already ended, safe to clear
                // BUT DON'T call endWebRTCCall() - it's already been called
                setIncomingCallSignal(null);
                setCurrentCallId(null);
                setCallStatusFromSignal('idle');
              } else if (callStatus === 'active' || callStatus === 'connecting' || callStatus === 'ringing') {
                // Call is still active according to WebRTC - don't clear
                // This might be a temporary Firestore issue or the signal hasn't arrived yet
                // Received null signal but call is still active, ignoring
                // Keep the call state as is - DON'T call endWebRTCCall()
              } else {
                // For other states, only clear if we don't have an active call ID
                if (!currentCallId) {
                  setIncomingCallSignal(null);
                  setCurrentCallId(null);
                  setCallStatusFromSignal('idle');
                  // DON'T call endWebRTCCall() - no active call to end
                }
              }
              return;
            }

            // Handle status updates for both caller and receiver
            // Only set currentCallId when we're actually starting/joining a call, not from 'ended' signals
            if (signal.status === 'ringing') {
              const isCallee = signal.calleeEmail.toLowerCase() === user.email?.toLowerCase();
              const isCaller = signal.callerEmail.toLowerCase() === user.email?.toLowerCase();
              
              // Set currentCallId only when we're actually in a call (ringing or active)
              if (isCallee || isCaller) {
                setCurrentCallId(signal.callId);
              }
              
              if (isCallee) {
                // Incoming call for this user
                setIncomingCallSignal(signal);
                setCallStatusFromSignal('ringing');
              } else if (isCaller) {
                // Outgoing call (we're the caller)
                setCallStatusFromSignal('ringing');
              } else {
                console.warn('⚠️ Call signal mismatch:', {
                  signalCallee: signal.calleeEmail,
                  signalCaller: signal.callerEmail,
                  currentUser: user.email,
                });
                setCallStatusFromSignal('ringing');
              }
            } else if (signal.status === 'active') {
              // Call is active - both users should see this
              // Set currentCallId if we're part of this call
              const isCallee = signal.calleeEmail.toLowerCase() === user.email?.toLowerCase();
              const isCaller = signal.callerEmail.toLowerCase() === user.email?.toLowerCase();
              if (isCallee || isCaller) {
                setCurrentCallId(signal.callId);
              }
              setIncomingCallSignal(null); // Clear incoming call signal if it was set
              setCallStatusFromSignal('active');
            } else if (signal.status === 'ended') {
              // Call ended - only clean up if we were actually in this call
              // Check the context's currentCallId (which is only set when we're in a call)
              // Don't set currentCallId from 'ended' signals - only check if it matches
              if (currentCallId === signal.callId && (callStatus === 'active' || callStatus === 'connecting' || callStatus === 'ringing')) {
                // We were in this call, so clean up
                setIncomingCallSignal(null);
                setCurrentCallId(null);
                setCallStatusFromSignal('idle');
                endWebRTCCall();
              } else {
                // This is a stale 'ended' signal for a call we're not in - just clear local state
                if (currentCallId === signal.callId) {
                  // It's our call ID but we're not in an active call - just clear refs
                  setCurrentCallId(null);
                  setIncomingCallSignal(null);
                  setCallStatusFromSignal('idle');
                }
                // Don't call endWebRTCCall() if we're not actually in a call
              }
            } else {
              // Unknown status - don't call endWebRTCCall(), just clear local state
              setIncomingCallSignal(null);
              setCallStatusFromSignal('idle');
            }
          });

      return () => {
        unsubscribe();
      };
    }, [user?.email, isOpen, selectedMember, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, allTeamMembers, endWebRTCCall, currentCallId, setCurrentCallId, callStatus, db, auth]);

    // Set up real-time listener in a separate effect to avoid conflicts
    useEffect(() => {
      if (!user || !isOpen || !user.email || isLoadingMessages || isSendingMessage) return;

    let chatId: string;
    
    // Determine chatId (same logic as above)
    if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
      chatId = selectedMember;
    } else if (selectedMember === "ai-assistant") {
      chatId = "ai-assistant";
    } else {
      if (selectedMember.includes('@')) {
        chatId = getDirectMessageChatId(user.email, selectedMember);
      } else {
        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
        if (selectedMemberData?.email) {
          chatId = getDirectMessageChatId(user.email, selectedMemberData.email);
        } else {
          chatId = selectedMember;
        }
      }
    }

    let unsubscribe: (() => void) | null = null;
    // Track if we've received the first update from the listener
    let isFirstListenerUpdate = true;
    
    // Set up listener immediately (no delay - this was causing messages to be missed)
    unsubscribe = messagesService.subscribeToMessages(chatId, (firestoreMessages) => {
      // Skip the very first update if we just loaded messages (to avoid duplicate processing)
      // But only skip if we're still loading initial messages
      if (isFirstListenerUpdate && isLoadingMessages) {
        isFirstListenerUpdate = false;
        // Wait a bit for initial load to complete, then process updates
        setTimeout(() => {
          isFirstListenerUpdate = false;
        }, 500);
        return;
      }
      
      // After initial load completes, process all updates normally
      isFirstListenerUpdate = false;
        
        // Don't process updates while sending a message (prevents race conditions)
        if (isSendingMessage) {
          return;
        }
        
        try {
          // Calculate unread count for this chat
          const lastRead = lastReadTimestamps.get(chatId) || 0;
          // Check if this is the currently open chat
          let currentChatId: string;
          if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
            currentChatId = selectedMember;
          } else if (selectedMember === "ai-assistant") {
            currentChatId = getAIAssistantChatId(user.email);
          } else {
            if (selectedMember.includes('@')) {
              currentChatId = getDirectMessageChatId(user.email, selectedMember);
            } else {
              const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
              if (selectedMemberData?.email) {
                currentChatId = getDirectMessageChatId(user.email, selectedMemberData.email);
              } else {
                currentChatId = selectedMember;
              }
            }
          }
          const isCurrentChat = chatId === currentChatId && isOpen;
          
          // Count unread messages (messages after last read timestamp and not from current user)
          // For AI assistant, also count assistant messages as unread
          const unreadCount = firestoreMessages.filter(msg => {
            const msgTime = msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime();
            const isAfterLastRead = msgTime > lastRead;
            // For AI assistant, count assistant messages as unread; for others, count messages not from current user
            const isUnread = chatId === "ai-assistant"
              ? msg.role === 'assistant' || (msg.role === 'user' && msg.userId?.toLowerCase() !== user?.email?.toLowerCase())
              : msg.userId?.toLowerCase() !== user?.email?.toLowerCase();
            return isAfterLastRead && isUnread;
          }).length;
          
          // Update unread count (only if not currently viewing this chat)
          if (!isCurrentChat) {
            setUnreadCounts((prev) => {
              const newMap = new Map(prev);
              if (unreadCount > 0) {
                newMap.set(chatId, unreadCount);
              } else {
                // Remove from map if count is 0
                newMap.delete(chatId);
              }
              return newMap;
            });
          } else if (isCurrentChat) {
            // If viewing this chat, mark all messages as read and clear unread count
            const latestMessageTime = firestoreMessages.length > 0
              ? Math.max(
                  ...firestoreMessages.map(msg => 
                    msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()
                  )
                )
              : Date.now();
            
            setLastReadTimestamps((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, latestMessageTime);
              return newMap;
            });
            
            // Clear unread count if viewing this chat - remove from map
            setUnreadCounts((prev) => {
              const newMap = new Map(prev);
              newMap.delete(chatId); // Remove from map instead of setting to 0
              return newMap;
            });
          }
          
          // Only update messages if this is the currently selected chat
          // This prevents messages from old chats from appearing when switching chats
          if (!isCurrentChat) {
            return; // Don't update messages for chats that are not currently selected
          }
          
          if (isProjectChannel && selectedProjectId) {
            // Merge project channel messages instead of replacing
            setChannelMessages((prev) => {
              const newMap = new Map(prev);
              const existing = newMap.get(selectedProjectId) || [];
              
              // Don't update if we have optimistic messages that haven't been confirmed yet
              const hasUnconfirmedOptimistic = existing.some(msg => 
                msg.id.startsWith('temp-') && 
                (msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()) > Date.now() - 5000
              );
              
              // Merge with existing messages, preserving optimistic updates
              const merged = mergeChannelMessages(existing, firestoreMessages, selectedProjectId, true);
              
              // Always update if we have optimistic messages (they need to be matched)
              // Otherwise only update if messages actually changed
              const existingIds = new Set(existing.map(m => m.id));
              const mergedIds = new Set(merged.map(m => m.id));
              
              if (hasUnconfirmedOptimistic || 
                  existingIds.size !== mergedIds.size || 
                  ![...existingIds].every(id => mergedIds.has(id)) ||
                  merged.length !== existing.length) {
                // Check if there are new messages from other users in project channel
                const newMessagesFromOthers = merged.filter(msg => 
                  !existingIds.has(msg.id) && 
                  msg.userId?.toLowerCase() !== user?.email?.toLowerCase()
                );
                
                // Play notification sound if there are new messages from others
                if (newMessagesFromOthers.length > 0 && isCurrentChat) {
                  playNotificationSound();
                }
                
                newMap.set(selectedProjectId, merged);
                // Save to cache when messages update (after state update)
                setTimeout(() => saveCachedMessages(chatId, firestoreMessages), 0);
                return newMap;
              }
              return prev;
            });
          } else if (isTeamChannel && selectedTeamId) {
            // Merge team channel messages instead of replacing
            setChannelMessages((prev) => {
              const newMap = new Map(prev);
              const existing = newMap.get(selectedTeamId) || [];
              
              // Don't update if we have optimistic messages that haven't been confirmed yet
              const hasUnconfirmedOptimistic = existing.some(msg => 
                msg.id.startsWith('temp-') && 
                (msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()) > Date.now() - 5000
              );
              
              // Merge with existing messages, preserving optimistic updates
              const merged = mergeChannelMessages(existing, firestoreMessages, selectedTeamId, false, true);
              
              // Always update if we have optimistic messages (they need to be matched)
              // Otherwise only update if messages actually changed
              const existingIds = new Set(existing.map(m => m.id));
              const mergedIds = new Set(merged.map(m => m.id));
              
              if (hasUnconfirmedOptimistic || 
                  existingIds.size !== mergedIds.size || 
                  ![...existingIds].every(id => mergedIds.has(id)) ||
                  merged.length !== existing.length) {
                // Check if there are new messages from other users in team channel
                const newMessagesFromOthers = merged.filter(msg => 
                  !existingIds.has(msg.id) && 
                  msg.userId?.toLowerCase() !== user?.email?.toLowerCase()
                );
                
                // Play notification sound if there are new messages from others
                if (newMessagesFromOthers.length > 0 && isCurrentChat) {
                  playNotificationSound();
                }
                
                newMap.set(selectedTeamId, merged);
                // Save to cache when messages update (after state update)
                setTimeout(() => saveCachedMessages(chatId, firestoreMessages), 0);
                return newMap;
              }
              return prev;
            });
          } else {
            // Merge regular messages instead of replacing, preserving optimistic updates
            setMessages((prev) => {
              // Don't update if we have optimistic messages that haven't been confirmed yet
              // This prevents overwriting messages that were just sent
              const hasUnconfirmedOptimistic = prev.some(msg => 
                msg.id.startsWith('temp-') && 
                (msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime()) > Date.now() - 5000
              );
              
              // If we have recent optimistic messages, be more careful about merging
              if (hasUnconfirmedOptimistic) {
                // For AI Assistant, show both user and assistant messages
                // For team member chats, only show user messages
                const filteredMessages = isAIAssistantChatId(chatId) 
                  ? firestoreMessages 
                  : firestoreMessages.filter(msg => msg.role === 'user');
                
                // Merge with existing messages, preserving optimistic updates
                const merged = mergeMessages(prev, filteredMessages, true);
                
                // Check if there are new messages from other users (not current user)
                const existingIds = new Set(prev.map(m => m.id));
                const newMessagesFromOthers = merged.filter(msg => 
                  !existingIds.has(msg.id) && 
                  (msg.role === 'assistant' || msg.userId?.toLowerCase() !== user?.email?.toLowerCase())
                );
                
                // Play notification sound if there are new messages from others
                if (newMessagesFromOthers.length > 0 && isCurrentChat) {
                  playNotificationSound();
                }
                
                // Always return merged if we have optimistic messages (they need to be matched)
                // Save to cache when messages update (after state update)
                setTimeout(() => saveCachedMessages(chatId, firestoreMessages), 0);
                return merged;
              }
              
              // Normal merge for confirmed messages
              const filteredMessages = isAIAssistantChatId(chatId) 
                ? firestoreMessages 
                : firestoreMessages.filter(msg => msg.role === 'user');
              
              // Merge with existing messages, preserving optimistic updates
              const merged = mergeMessages(prev, filteredMessages, true);
              
              // Only update if messages actually changed
              const existingIds = new Set(prev.map(m => m.id));
              const mergedIds = new Set(merged.map(m => m.id));
              
              if (existingIds.size !== mergedIds.size || 
                  ![...existingIds].every(id => mergedIds.has(id)) ||
                  merged.length !== prev.length) {
                // Check if there are new messages from other users (not current user)
                const newMessagesFromOthers = merged.filter(msg => 
                  !existingIds.has(msg.id) && 
                  (msg.role === 'assistant' || msg.userId?.toLowerCase() !== user?.email?.toLowerCase())
                );
                
                // Play notification sound if there are new messages from others
                if (newMessagesFromOthers.length > 0 && isCurrentChat) {
                  playNotificationSound();
                }
                
                // Save to cache when messages update (after state update)
                setTimeout(() => saveCachedMessages(chatId, firestoreMessages), 0);
                return merged;
              }
              return prev;
            });
          }
        } catch (error) {
          console.error('Error processing real-time message update:', error);
        }
      });

    // Cleanup
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMember, isProjectChannel, selectedProjectId, user?.email, isOpen, isLoadingMessages, allChatCaches]);

  // Check if "lean" is mentioned in a message
  const isLeanMentioned = useCallback((message: string): boolean => {
    const mentionRegex = /@lean\b/i;
    return mentionRegex.test(message);
  }, []);

  // Extract query from message, removing @lean mention
  const extractQueryFromMessage = useCallback((message: string): string => {
    // Remove @lean mentions (case-insensitive)
    return message.replace(/@lean\b/gi, '').trim();
  }, []);

  // Generate AI response for channel mentions
  const generateChannelAIResponse = async (
    query: string,
    chatId: string,
    channelContext?: { type: 'project' | 'team'; id: string; name: string; description?: string }
  ): Promise<string> => {
    if (!user?.email) {
      throw new Error('User must be authenticated to use AI assistant');
    }

    const isLocalDev = import.meta.env.DEV;
    const customToken = (window as any).__customToken;
    if (!isLocalDev && !customToken) {
      throw new Error('Authentication token not found. Please sign in again.');
    }

    // Build context from channel and selected items
    let citedContext = "";
    const contextParts: string[] = [];

    // Add channel context
    if (channelContext) {
      if (channelContext.type === 'project') {
        contextParts.push(`Channel Context: Project Channel - ${channelContext.name}`);
        if (channelContext.description) {
          contextParts.push(`Project Description: ${channelContext.description}`);
        }
      } else if (channelContext.type === 'team') {
        contextParts.push(`Channel Context: Team Channel - ${channelContext.name}`);
        if (channelContext.description) {
          contextParts.push(`Team Description: ${channelContext.description}`);
        }
      }
    }

    // Add selected projects, tasks, and teams if any
    if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
      if (selectedProjects.length > 0) {
        contextParts.push("Selected Projects:");
        selectedProjects.forEach((project) => {
          contextParts.push(`- ${project.name} (ID: ${project.id}): ${project.description}`);
          contextParts.push(`  Status: ${project.status}, Due: ${project.dueDate}`);
          contextParts.push(`  Team: ${project.team} members`);
          contextParts.push(`  Summary: ${project.summary.accomplishment}`);
          contextParts.push(`  Tasks: ${project.tasks.length} total (${project.tasks.filter(t => t.status === "completed").length} completed, ${project.tasks.filter(t => t.status === "in-progress").length} in progress)`);
        });
      }

      if (selectedTasks.length > 0) {
        contextParts.push("Selected Tasks:");
        selectedTasks.forEach((task) => {
          const assigneeName = task.assignee || "Unassigned";
          contextParts.push(`- ${task.title} (ID: ${task.id}): ${task.description}`);
          contextParts.push(`  Status: ${task.status}, Priority: ${task.priority}`);
          contextParts.push(`  Assignee: ${assigneeName}, Due: ${task.dueDate}`);
          contextParts.push(`  Project: ${task.project}`);
          contextParts.push(`  Progress Updates: ${task.progressUpdates.length}`);
        });
      }

      if (selectedTeams.length > 0) {
        contextParts.push("Selected Teams:");
        selectedTeams.forEach((team) => {
          contextParts.push(`- ${team.name} (ID: ${team.id}): ${team.description}`);
          contextParts.push(`  Members: ${team.members}, Projects: ${team.projects}`);
        });
      }
    }

    if (contextParts.length > 0) {
      citedContext = contextParts.join("\n");
    }

    // Determine API base URL and authentication method
    const API_BASE = isLocalDev ? 'http://0.0.0.0:8081' : '';
    const apiUrl = `${API_BASE}/api/ask`;

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isLocalDev) {
      try {
        const backendApiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
        const apiKeyResponse = await fetch(`${backendApiBase}/api/ask-api-key`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${customToken || ''}`,
          },
        });

        if (!apiKeyResponse.ok) {
          throw new Error('Failed to fetch API key from backend');
        }

        const apiKeyData = await apiKeyResponse.json();
        headers['X-API-Key'] = apiKeyData.apiKey;
      } catch (error) {
        console.error('Failed to fetch API key from backend, using fallback:', error);
        const fallbackKey = import.meta.env.VITE_ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
        headers['X-API-Key'] = fallbackKey;
      }
    } else {
      headers['Authorization'] = `Bearer ${customToken}`;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: user.email.toLowerCase(),
          query: query,
          session_id: chatId,
          cited_context: citedContext || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Handle different possible response formats
      if (typeof data === 'string') {
        return data;
      } else if (data.content) {
        return data.content;
      } else if (data.response) {
        return data.response;
      } else if (data.text) {
        return data.text;
      } else {
        console.warn('Unexpected API response format:', data);
        return JSON.stringify(data);
      }
    } catch (error) {
      console.error('Error calling ask API:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to generate response. Please try again.');
    }
  };

  const generateResponse = async (userMessage: string, chatId: string): Promise<string> => {
    if (!user?.email) {
      throw new Error('User must be authenticated to use AI assistant');
    }

    const isLocalDev = import.meta.env.DEV;
    
    // Get authentication token (only required for production)
    const customToken = (window as any).__customToken;
    if (!isLocalDev && !customToken) {
      throw new Error('Authentication token not found. Please sign in again.');
    }

    // Build context from selected projects, tasks, and teams for cited_context
    let citedContext = "";
    if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
      const contextParts: string[] = [];
      
      if (selectedProjects.length > 0) {
        contextParts.push("Selected Projects:");
        selectedProjects.forEach((project) => {
          contextParts.push(`- ${project.name} (ID: ${project.id}): ${project.description}`);
          contextParts.push(`  Status: ${project.status}, Due: ${project.dueDate}`);
          contextParts.push(`  Team: ${project.team} members`);
          contextParts.push(`  Summary: ${project.summary.accomplishment}`);
          contextParts.push(`  Tasks: ${project.tasks.length} total (${project.tasks.filter(t => t.status === "completed").length} completed, ${project.tasks.filter(t => t.status === "in-progress").length} in progress)`);
        });
      }

      if (selectedTasks.length > 0) {
        contextParts.push("Selected Tasks:");
        selectedTasks.forEach((task) => {
          const assigneeName = task.assignee || "Unassigned";
          contextParts.push(`- ${task.title} (ID: ${task.id}): ${task.description}`);
          contextParts.push(`  Status: ${task.status}, Priority: ${task.priority}`);
          contextParts.push(`  Assignee: ${assigneeName}, Due: ${task.dueDate}`);
          contextParts.push(`  Project: ${task.project}`);
          contextParts.push(`  Progress Updates: ${task.progressUpdates.length}`);
        });
      }

      if (selectedTeams.length > 0) {
        contextParts.push("Selected Teams:");
        selectedTeams.forEach((team) => {
          contextParts.push(`- ${team.name} (ID: ${team.id}): ${team.description}`);
          contextParts.push(`  Members: ${team.members}, Projects: ${team.projects}`);
        });
      }

      citedContext = contextParts.join("\n");
    }

    // Determine API base URL and authentication method
    // For local dev, use the ask API endpoint directly (http://0.0.0.0:8081)
    // For production, use relative path (will be proxied through ingress)
    const API_BASE = isLocalDev ? 'http://0.0.0.0:8081' : '';
    const apiUrl = `${API_BASE}/api/ask`;

    // Prepare headers - use X-API-Key for local dev, Bearer token for production
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isLocalDev) {
      // For local development, fetch API key from backend Secret Manager
      try {
        const backendApiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
        const apiKeyResponse = await fetch(`${backendApiBase}/api/ask-api-key`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${customToken || ''}`,
          },
        });

        if (!apiKeyResponse.ok) {
          throw new Error('Failed to fetch API key from backend');
        }

        const apiKeyData = await apiKeyResponse.json();
        headers['X-API-Key'] = apiKeyData.apiKey;
      } catch (error) {
        console.error('Failed to fetch API key from backend, using fallback:', error);
        // Fallback to environment variable or default for local dev
        const fallbackKey = import.meta.env.VITE_ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
        headers['X-API-Key'] = fallbackKey;
      }
    } else {
      // For production, use Bearer token
      headers['Authorization'] = `Bearer ${customToken}`;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: user.email.toLowerCase(),
          query: userMessage,
          session_id: chatId, // Use chatId as session_id for conversation continuity
          cited_context: citedContext || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Extract response content from API response
      // The API returns an object with 'content' field based on the leanworks-app implementation
      if (data.error) {
        throw new Error(data.error);
      }

      // Handle different possible response formats
      if (typeof data === 'string') {
        return data;
      } else if (data.content) {
        return data.content;
      } else if (data.response) {
        return data.response;
      } else if (data.text) {
        return data.text;
      } else {
        // Fallback: try to stringify the response
        console.warn('Unexpected API response format:', data);
        return JSON.stringify(data);
      }
    } catch (error) {
      console.error('Error calling ask API:', error);
      // Return a user-friendly error message
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to generate response. Please try again.');
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !user || isSendingMessage) return;

    const messageContent = input.trim();
    setInput("");
    setIsSendingMessage(true);

    // Handle project channel messages
    if (isProjectChannel && selectedProjectId) {
      // Use pre-calculated current user display info
      const currentUserInfo = getUserInfo(user.email?.toLowerCase());
      const userDisplayName = currentUserDisplayInfo.displayName;
      const userInitials = currentUserDisplayInfo.initials;
      
      // Capture cited context before clearing (for display purposes)
      const citedContext = (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) ? {
        projects: selectedProjects.length > 0 ? [...selectedProjects] : undefined,
        tasks: selectedTasks.length > 0 ? [...selectedTasks] : undefined,
        teams: selectedTeams.length > 0 ? [...selectedTeams] : undefined,
      } : undefined;
      
      // Create message and add to state immediately (optimistic update)
      const tempChannelMessage: ChannelMessage = {
        id: `temp-channel-${Date.now()}`,
        memberName: userDisplayName,
        memberAvatar: userInitials,
        content: messageContent,
        timestamp: new Date(),
        projectId: selectedProjectId,
        userId: user.email?.toLowerCase(),
        citedContext,
      };

      // Add message to state immediately for instant feedback
      setChannelMessages((prev) => {
        const projectMessages = prev.get(selectedProjectId) || [];
        const newMap = new Map(prev);
        newMap.set(selectedProjectId, [...projectMessages, tempChannelMessage]);
        return newMap;
      });

      // Save to Firestore and update with saved data
      try {
        const savedMessage = await messagesService.create({
          chatId: selectedMember,
          role: 'user',
          content: messageContent,
          projectId: selectedProjectId,
          citedContext: citedContext,
        });

        const savedChannelMessage: ChannelMessage = {
          id: savedMessage.id,
          memberName: savedMessage.memberName || userDisplayName,
          memberAvatar: savedMessage.memberAvatar || userInitials,
          content: savedMessage.content,
          timestamp: savedMessage.timestamp instanceof Date ? savedMessage.timestamp : new Date(savedMessage.timestamp),
          projectId: selectedProjectId,
          userId: savedMessage.userId || user.email?.toLowerCase(),
          citedContext: savedMessage.citedContext || citedContext,
        };

        // Update the message in state with saved data
        setChannelMessages((prev) => {
          const projectMessages = prev.get(selectedProjectId) || [];
          const newMap = new Map(prev);
          const updatedMessages = projectMessages.map(msg => 
            msg.id === tempChannelMessage.id ? savedChannelMessage : msg
          );
          newMap.set(selectedProjectId, updatedMessages);
          
          // Update cache after state update
          const chatId = selectedMember;
          setTimeout(() => {
            const allMessages = updatedMessages.map(msg => ({
              id: msg.id,
              chatId: chatId,
              role: 'user' as const,
              content: msg.content,
              timestamp: msg.timestamp,
              projectId: msg.projectId,
              userId: msg.userId,
              memberName: msg.memberName,
              memberAvatar: msg.memberAvatar,
              citedContext: msg.citedContext,
            }));
            saveCachedMessages(chatId, allMessages);
          }, 0);
          
          return newMap;
        });
        
        // Clear cited context immediately after sending message with cited context
        if (citedContext) {
          clearSelectedProjects();
          clearSelectedTasks();
          clearSelectedTeams();
        }
        
        setIsSendingMessage(false);

        // Check if lean is mentioned and generate AI response
        if (isLeanMentioned(messageContent)) {
          const query = extractQueryFromMessage(messageContent);
          if (query) {
            // Generate AI response asynchronously (don't block UI)
            generateChannelAIResponse(
              query,
              selectedMember,
              selectedProject ? {
                type: 'project',
                id: selectedProject.id,
                name: selectedProject.name,
                description: selectedProject.description,
              } : undefined
            ).then((aiResponse) => {
              // Create AI assistant message for the channel
              const aiChannelMessage: ChannelMessage = {
                id: `temp-ai-${Date.now()}`,
                memberName: "lean",
                memberAvatar: "AI",
                content: aiResponse,
                timestamp: new Date(),
                projectId: selectedProjectId,
                userId: "ai-assistant",
              };

              // Add AI message to state
              setChannelMessages((prev) => {
                const projectMessages = prev.get(selectedProjectId) || [];
                const newMap = new Map(prev);
                newMap.set(selectedProjectId, [...projectMessages, aiChannelMessage]);
                return newMap;
              });

              // Save AI response to Firestore
              messagesService.create({
                chatId: selectedMember,
                role: 'assistant',
                content: aiResponse,
                projectId: selectedProjectId,
                memberName: "lean",
                memberAvatar: "AI",
              }).then((savedAIMessage) => {
                const savedAIChannelMessage: ChannelMessage = {
                  id: savedAIMessage.id,
                  memberName: savedAIMessage.memberName || "lean",
                  memberAvatar: savedAIMessage.memberAvatar || "AI",
                  content: savedAIMessage.content,
                  timestamp: savedAIMessage.timestamp instanceof Date ? savedAIMessage.timestamp : new Date(savedAIMessage.timestamp),
                  projectId: selectedProjectId,
                  userId: savedAIMessage.userId || "ai-assistant",
                };

                // Update AI message in state with saved data
                setChannelMessages((prev) => {
                  const projectMessages = prev.get(selectedProjectId) || [];
                  const newMap = new Map(prev);
                  const updatedMessages = projectMessages.map(msg => 
                    msg.id === aiChannelMessage.id ? savedAIChannelMessage : msg
                  );
                  newMap.set(selectedProjectId, updatedMessages);
                  return newMap;
                });
              }).catch((error) => {
                console.error('Failed to save AI channel message:', error);
                // Remove optimistic AI message if save failed
                setChannelMessages((prev) => {
                  const projectMessages = prev.get(selectedProjectId) || [];
                  const newMap = new Map(prev);
                  newMap.set(selectedProjectId, projectMessages.filter(msg => msg.id !== aiChannelMessage.id));
                  return newMap;
                });
              });
            }).catch((error) => {
              console.error('Failed to generate AI response for channel:', error);
            });
          }
        }
      } catch (error) {
        console.error('Failed to save channel message:', error);
        // Remove the optimistic message if save failed
        setChannelMessages((prev) => {
          const projectMessages = prev.get(selectedProjectId) || [];
          const newMap = new Map(prev);
          newMap.set(selectedProjectId, projectMessages.filter(msg => msg.id !== tempChannelMessage.id));
          return newMap;
        });
        setIsSendingMessage(false);
      }
      return;
    }

    // Handle team channel messages
    if (isTeamChannel && selectedTeamId) {
      // Use pre-calculated current user display info
      const userDisplayName = currentUserDisplayInfo.displayName;
      const userInitials = currentUserDisplayInfo.initials;
      
      // Capture cited context before clearing (for display purposes)
      const citedContext = (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) ? {
        projects: selectedProjects.length > 0 ? [...selectedProjects] : undefined,
        tasks: selectedTasks.length > 0 ? [...selectedTasks] : undefined,
        teams: selectedTeams.length > 0 ? [...selectedTeams] : undefined,
      } : undefined;
      
      // Create message and add to state immediately (optimistic update)
      const tempChannelMessage: ChannelMessage = {
        id: `temp-channel-${Date.now()}`,
        memberName: userDisplayName,
        memberAvatar: userInitials,
        content: messageContent,
        timestamp: new Date(),
        teamId: selectedTeamId,
        userId: user.email?.toLowerCase(),
        citedContext,
      };

      // Add message to state immediately for instant feedback
      setChannelMessages((prev) => {
        const teamMessages = prev.get(selectedTeamId) || [];
        const newMap = new Map(prev);
        newMap.set(selectedTeamId, [...teamMessages, tempChannelMessage]);
        return newMap;
      });

      // Save to Firestore and update with saved data
      try {
        const savedMessage = await messagesService.create({
          chatId: selectedMember,
          role: 'user',
          content: messageContent,
          teamId: selectedTeamId,
          citedContext: citedContext,
        });

        const savedChannelMessage: ChannelMessage = {
          id: savedMessage.id,
          memberName: savedMessage.memberName || userDisplayName,
          memberAvatar: savedMessage.memberAvatar || userInitials,
          content: savedMessage.content,
          timestamp: savedMessage.timestamp 
            ? (savedMessage.timestamp instanceof Date ? savedMessage.timestamp : new Date(savedMessage.timestamp))
            : new Date(),
          teamId: selectedTeamId,
          userId: savedMessage.userId || user.email?.toLowerCase(),
          citedContext: savedMessage.citedContext || citedContext,
        };

        // Update the message in state with saved data
        setChannelMessages((prev) => {
          const teamMessages = prev.get(selectedTeamId) || [];
          const newMap = new Map(prev);
          const updatedMessages = teamMessages.map(msg => 
            msg.id === tempChannelMessage.id ? savedChannelMessage : msg
          );
          newMap.set(selectedTeamId, updatedMessages);
          
          // Update cache after state update
          const chatId = selectedMember;
          setTimeout(() => {
            const allMessages = updatedMessages.map(msg => ({
              id: msg.id,
              chatId: chatId,
              role: 'user' as const,
              content: msg.content,
              timestamp: msg.timestamp,
              teamId: msg.teamId,
              userId: msg.userId,
              memberName: msg.memberName,
              memberAvatar: msg.memberAvatar,
              citedContext: msg.citedContext,
            }));
            saveCachedMessages(chatId, allMessages);
          }, 0);
          
          return newMap;
        });
        
        // Clear cited context immediately after sending message with cited context
        if (citedContext) {
          clearSelectedProjects();
          clearSelectedTasks();
          clearSelectedTeams();
        }
        
        setIsSendingMessage(false);

        // Check if lean is mentioned and generate AI response
        if (isLeanMentioned(messageContent)) {
          const query = extractQueryFromMessage(messageContent);
          if (query) {
            // Generate AI response asynchronously (don't block UI)
            generateChannelAIResponse(
              query,
              selectedMember,
              selectedTeam ? {
                type: 'team',
                id: selectedTeam.id,
                name: selectedTeam.name,
                description: selectedTeam.description,
              } : undefined
            ).then((aiResponse) => {
              // Create AI assistant message for the channel
              const aiChannelMessage: ChannelMessage = {
                id: `temp-ai-${Date.now()}`,
                memberName: "lean",
                memberAvatar: "AI",
                content: aiResponse,
                timestamp: new Date(),
                teamId: selectedTeamId,
                userId: "ai-assistant",
              };

              // Add AI message to state
              setChannelMessages((prev) => {
                const teamMessages = prev.get(selectedTeamId) || [];
                const newMap = new Map(prev);
                newMap.set(selectedTeamId, [...teamMessages, aiChannelMessage]);
                return newMap;
              });

              // Save AI response to Firestore
              messagesService.create({
                chatId: selectedMember,
                role: 'assistant',
                content: aiResponse,
                teamId: selectedTeamId,
                memberName: "lean",
                memberAvatar: "AI",
              }).then((savedAIMessage) => {
                const savedAIChannelMessage: ChannelMessage = {
                  id: savedAIMessage.id,
                  memberName: savedAIMessage.memberName || "lean",
                  memberAvatar: savedAIMessage.memberAvatar || "AI",
                  content: savedAIMessage.content,
                  timestamp: savedAIMessage.timestamp instanceof Date ? savedAIMessage.timestamp : new Date(savedAIMessage.timestamp),
                  teamId: selectedTeamId,
                  userId: savedAIMessage.userId || "ai-assistant",
                };

                // Update AI message in state with saved data
                setChannelMessages((prev) => {
                  const teamMessages = prev.get(selectedTeamId) || [];
                  const newMap = new Map(prev);
                  const updatedMessages = teamMessages.map(msg => 
                    msg.id === aiChannelMessage.id ? savedAIChannelMessage : msg
                  );
                  newMap.set(selectedTeamId, updatedMessages);
                  return newMap;
                });
              }).catch((error) => {
                console.error('Failed to save AI channel message:', error);
                // Remove optimistic AI message if save failed
                setChannelMessages((prev) => {
                  const teamMessages = prev.get(selectedTeamId) || [];
                  const newMap = new Map(prev);
                  newMap.set(selectedTeamId, teamMessages.filter(msg => msg.id !== aiChannelMessage.id));
                  return newMap;
                });
              });
            }).catch((error) => {
              console.error('Failed to generate AI response for channel:', error);
            });
          }
        }
      } catch (error) {
        console.error('Failed to save team channel message:', error);
        // Remove the optimistic message if save failed
        setChannelMessages((prev) => {
          const teamMessages = prev.get(selectedTeamId) || [];
          const newMap = new Map(prev);
          newMap.set(selectedTeamId, teamMessages.filter(msg => msg.id !== tempChannelMessage.id));
          return newMap;
        });
        setIsSendingMessage(false);
      }
      return;
    }

    // Handle AI Assistant or team member messages
    // Determine the correct chatId
    let chatId: string;
    if (selectedMember === "ai-assistant") {
      chatId = getAIAssistantChatId(user.email);
    } else {
      // For team member chats, generate consistent chatId from both users' emails
      // selectedMember is now the email (since we changed ID to email)
      // Check if it looks like an email, otherwise fallback
      if (selectedMember.includes('@') && user.email) {
        chatId = getDirectMessageChatId(user.email, selectedMember);
      } else {
        // Fallback: try to find member by ID
        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
        if (selectedMemberData?.email && user.email) {
          chatId = getDirectMessageChatId(user.email, selectedMemberData.email);
        } else {
          chatId = selectedMember; // Final fallback
        }
      }
    }

    // Capture cited context before clearing (for display purposes)
    const citedContext = (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) ? {
      projects: selectedProjects.length > 0 ? [...selectedProjects] : undefined,
      tasks: selectedTasks.length > 0 ? [...selectedTasks] : undefined,
      teams: selectedTeams.length > 0 ? [...selectedTeams] : undefined,
    } : undefined;

    // Create message object and add to state immediately (optimistic update)
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: messageContent,
      timestamp: new Date(),
      userId: user.email?.toLowerCase(),
      citedContext,
    };

    // Add message to state immediately for instant feedback
    setMessages((prev) => [...prev, userMessage]);

    // Save user message to Firestore and update with saved data
    try {
      const savedUserMessage = await messagesService.create({
        chatId: chatId,
        role: 'user',
        content: messageContent,
        citedContext: citedContext,
      });
      
      // Update the message in state with saved data
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === userMessage.id 
            ? {
                ...msg,
                id: savedUserMessage.id,
                timestamp: savedUserMessage.timestamp instanceof Date ? savedUserMessage.timestamp : new Date(savedUserMessage.timestamp),
                userId: savedUserMessage.userId || user.email?.toLowerCase(),
                citedContext: savedUserMessage.citedContext || citedContext,
              }
            : msg
        );
        
        // Update cache after state update
        setTimeout(() => {
          const allMessages = updated.map(msg => ({
            id: msg.id,
            chatId: chatId,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            userId: msg.userId,
            citedContext: msg.citedContext,
          }));
          saveCachedMessages(chatId, allMessages);
        }, 0);
        
        return updated;
      });
      setIsSendingMessage(false);
    } catch (error) {
      console.error('Failed to save user message:', error);
      // Remove the optimistic message if save failed
      setMessages((prev) => prev.filter(msg => msg.id !== userMessage.id));
      setIsSendingMessage(false);
    }

    // Only generate AI response for AI Assistant chat
    if (selectedMember === "ai-assistant") {
    setIsLoading(true);

      // Capture selection state before API call to ensure we clear the correct selections
      const hadSelections = selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0;

      try {
        const response = await generateResponse(userMessage.content, chatId);
        
        // Clear cited context immediately after sending message with cited context
        if (hadSelections) {
          clearSelectedProjects();
          clearSelectedTasks();
          clearSelectedTeams();
        }
        
        // Create assistant message and add to state immediately (optimistic update)
        const assistantMessage: Message = {
          id: `temp-assistant-${Date.now()}`,
          role: "assistant",
          content: response,
          timestamp: new Date(),
        };

        // Add assistant message to state immediately
        setMessages((prev) => [...prev, assistantMessage]);

        // Save assistant response to Firestore and update with saved data
        try {
          const savedAssistantMessage = await messagesService.create({
            chatId: chatId,
            role: 'assistant',
            content: response,
          });
          
          // Update the message in state with saved data
          setMessages((prev) => {
            const updated = prev.map(msg => 
              msg.id === assistantMessage.id 
                ? {
                    ...msg,
                    id: savedAssistantMessage.id,
                    timestamp: savedAssistantMessage.timestamp instanceof Date ? savedAssistantMessage.timestamp : new Date(savedAssistantMessage.timestamp),
                  }
                : msg
            );
            
            // Update cache after state update
            setTimeout(() => {
              const allMessages = updated.map(msg => ({
                id: msg.id,
                chatId: chatId,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                userId: msg.userId,
                citedContext: msg.citedContext,
              }));
              saveCachedMessages(chatId, allMessages);
            }, 0);
            
            return updated;
          });
        } catch (error) {
          console.error('Failed to save assistant message:', error);
          // Remove the optimistic message if save failed
          setMessages((prev) => prev.filter(msg => msg.id !== assistantMessage.id));
        }
      } catch (error) {
        console.error('Failed to generate response:', error);
        
        // Show error message to user
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error 
            ? `I apologize, but I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`
            : 'I apologize, but I encountered an error while processing your request. Please try again.',
          timestamp: new Date(),
        };
        
        setMessages((prev) => [...prev, errorMessage]);
        
        // Save error message to Firestore for record keeping
        try {
          await messagesService.create({
            chatId: chatId,
            role: 'assistant',
            content: errorMessage.content,
          });
        } catch (saveError) {
          console.error('Failed to save error message:', saveError);
        }
      } finally {
        setIsLoading(false);
        setIsSendingMessage(false);
      }
    }
    // For team member chats, just save the message (no AI response)
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 pointer-events-none">
        <Button
          onClick={() => {
            setIsOpen(!isOpen);
            // When opening, restore the last selected member
            if (!isOpen) {
              const lastMember = getLastSelectedMember();
              setSelectedMember(lastMember);
            }
          }}
          className={cn(
            "h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 relative pointer-events-auto bg-black/70 text-white hover:bg-black/80",
            isOpen ? "scale-0 opacity-0" : "scale-100 opacity-100"
          )}
          size="icon"
        >
        <MessageCircle className="h-6 w-6" />
        {/* Unread indicator - red dot */}
        {Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0) > 0 && (
          <span className="absolute top-0 right-0 h-3 w-3 bg-red-500 rounded-full border-2 border-background" />
        )}
        </Button>
      </div>

      {/* Chat Window - Slack-like Layout */}
      <div
        className={cn(
          "fixed bottom-6 right-6 z-50 bg-background border rounded-lg shadow-2xl transition-all duration-300 flex flex-col",
          isOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none",
          "w-[900px] h-[700px] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-3rem)]"
        )}
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Sidebar */}
          <div className="w-64 border-r bg-muted/30 flex flex-col flex-shrink-0">
            {/* Sidebar Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-lg">Chat</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  // Save current selected member before closing
                  if (user?.email) {
                    try {
                      const storageKey = `chat_lastSelectedMember_${user.email.toLowerCase()}`;
                      localStorage.setItem(storageKey, selectedMember);
                    } catch (error) {
                      console.error('Failed to save last selected member:', error);
                    }
                  }
                  setIsOpen(false);
                }}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search Bar */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={memberSearchRef}
                  type="text"
                  placeholder="Search..."
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>

            {/* Sidebar Content */}
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {/* AI Assistant Section */}
                {aiAssistantMatches && (
                  <div className="px-2 py-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                      AI Project Manager
                    </div>
                    <button
                      onClick={() => {
                        setSelectedMember("ai-assistant");
                        setMemberSearchQuery("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors relative",
                        selectedMember === "ai-assistant"
                          ? "bg-primary text-primary-foreground"
                          : (unreadCounts.get(getAIAssistantChatId(user.email)) || 0) > 0
                          ? "bg-primary/10 hover:bg-primary/20"
                          : "hover:bg-muted"
                      )}
                    >
                      <Avatar className="h-4 w-4 flex-shrink-0">
                        <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                        <AvatarFallback className="bg-primary text-primary-foreground text-[8px]">
                          L
                        </AvatarFallback>
                      </Avatar>
                      <span className={cn(
                        (unreadCounts.get(getAIAssistantChatId(user.email)) || 0) > 0 && selectedMember !== "ai-assistant" && "font-semibold"
                      )}>lean</span>
                      {(unreadCounts.get(getAIAssistantChatId(user.email)) || 0) > 0 && selectedMember !== "ai-assistant" && (
                        <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                      )}
                    </button>
                  </div>
                )}

                {/* Separator between AI Assistant and Channels */}
                {(aiAssistantMatches || filteredProjects.length > 0 || filteredTeams.length > 0 || filteredTeamMembers.length > 0) && (
                  <Separator className="my-2" />
                )}

                {/* Channels Section */}
                <div className="px-2 py-1.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Channels
                  </div>
                  <div className="space-y-1">
                    {filteredProjects.length > 0 || filteredTeams.length > 0 ? (
                      <>
                        {filteredProjects.map((project) => {
                          const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
                          const projectChatId = `project-${projectId}`;
                          const projectUnreadCount = unreadCounts.get(projectChatId) || 0;
                          const isSelected = selectedMember === projectChatId;
                          return (
                            <button
                              key={project.id}
                              onClick={() => {
                                setSelectedMember(projectChatId);
                                setMemberSearchQuery("");
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group relative",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : projectUnreadCount > 0
                                  ? "bg-primary/10 hover:bg-primary/20"
                                  : "hover:bg-muted"
                              )}
                            >
                              <Hash className="h-4 w-4 flex-shrink-0" />
                              <span className={cn(
                                "flex-1 text-left truncate",
                                projectUnreadCount > 0 && !isSelected && "font-semibold"
                              )}>{project.name}</span>
                              {projectUnreadCount > 0 && !isSelected && (
                                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                              )}
                            </button>
                          );
                        })}
                        {filteredTeams.map((team) => {
                          const teamId = team.name.toLowerCase().replace(/\s+/g, '-');
                          const teamChatId = `team-${teamId}`;
                          const teamUnreadCount = unreadCounts.get(teamChatId) || 0;
                          const isSelected = selectedMember === teamChatId;
                          return (
                            <button
                              key={`team-${teamId}`}
                              onClick={() => {
                                setSelectedMember(teamChatId);
                                setMemberSearchQuery("");
                              }}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group relative",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : teamUnreadCount > 0
                                  ? "bg-primary/10 hover:bg-primary/20"
                                  : "hover:bg-muted"
                              )}
                            >
                              <Users className="h-4 w-4 flex-shrink-0" />
                              <span className={cn(
                                "flex-1 text-left truncate",
                                teamUnreadCount > 0 && !isSelected && "font-semibold"
                              )}>{team.name}</span>
                              {teamUnreadCount > 0 && !isSelected && (
                                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                              )}
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No channels
                      </div>
                    )}
                  </div>
                </div>

                {/* Team Members Section */}
                {(filteredProjects.length > 0 || filteredTeams.length > 0 || filteredTeamMembers.length > 0) && (
                  <Separator className="my-2" />
                )}

                {/* Users Section */}
                <div className="px-2 py-1.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Direct Messages
                  </div>
                  <div className="space-y-1">
                    {filteredTeamMembers.length > 0 ? (
                      filteredTeamMembers.map((member) => {
                        const memberChatId = user?.email && member.email 
                          ? getDirectMessageChatId(user.email, member.email)
                          : member.id;
                        const memberUnreadCount = unreadCounts.get(memberChatId) || 0;
                        const isSelected = selectedMember === member.id;
                        return (
                          <button
                            key={member.id}
                            onClick={() => {
                              setSelectedMember(member.id);
                              setMemberSearchQuery("");
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors relative",
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : memberUnreadCount > 0
                                ? "bg-primary/10 hover:bg-primary/20"
                                : "hover:bg-muted"
                            )}
                          >
                            <Avatar className="h-6 w-6 flex-shrink-0">
                              <AvatarFallback className={`text-xs ${getAvatarColor((member.email || member.id)?.toLowerCase())}`}>
                                {member.avatar}
                              </AvatarFallback>
                            </Avatar>
                            <span className={cn(
                              "flex-1 text-left truncate",
                              memberUnreadCount > 0 && !isSelected && "font-semibold"
                            )}>{member.name}</span>
                            {memberUnreadCount > 0 && !isSelected && (
                              <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No users found
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b bg-primary/5">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  {selectedMember === "ai-assistant" ? (
                    <>
                      <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        L
                      </AvatarFallback>
                    </>
                  ) : (
                    <AvatarFallback className={cn(
                      "text-primary-foreground",
                      (isProjectChannel || isTeamChannel) 
                        ? "bg-primary/10" 
                        : getAvatarColor(currentMember.id?.toLowerCase()) // Use id (which is email for team members)
                    )}>
                      {isProjectChannel ? (
                        <Hash className="h-4 w-4 text-primary" />
                      ) : isTeamChannel ? (
                        <Users className="h-4 w-4 text-primary" />
                      ) : (
                        <span className="text-xs">{currentMember.avatar}</span>
                      )}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <h3 className="font-semibold text-sm truncate">{currentMember.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedMember === "ai-assistant" ? "AI Project Manager" : isProjectChannel ? "Project Channel" : isTeamChannel ? "Team Channel" : "Direct Message"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Show call button only for DM chats */}
                {!isProjectChannel && !isTeamChannel && selectedMember !== "ai-assistant" && currentMember.id !== "ai-assistant" && (
                  <>
                    {(() => {
                      // Get the other user's email for DM chats
                      let otherUserEmail = '';
                      let otherUserName = currentMember.name;
                      let otherUserAvatar = currentMember.avatar;

                      if (selectedMember.includes('@')) {
                        otherUserEmail = selectedMember;
                        const otherUser = allDomainUsers.find(u => u.email === selectedMember);
                        if (otherUser) {
                          otherUserName = `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim() || otherUser.email;
                          otherUserAvatar = `${otherUser.firstName?.charAt(0) || ''}${otherUser.lastName?.charAt(0) || ''}`.toUpperCase() || otherUser.email.charAt(0).toUpperCase();
                        }
                      } else {
                        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
                        if (selectedMemberData?.email) {
                          otherUserEmail = selectedMemberData.email;
                          otherUserName = selectedMemberData.name;
                          otherUserAvatar = selectedMemberData.avatar;
                        }
                      }

                      if (!otherUserEmail || !user?.email) return null;

                      const chatId = getDirectMessageChatId(user.email, otherUserEmail);
                      
                      return (
                        <VoiceCallButton
                          chatId={chatId}
                          otherUserEmail={otherUserEmail}
                          otherUserName={otherUserName}
                          otherUserAvatar={otherUserAvatar}
                          externalCallStatus={displayCallStatus}
                          externalCallId={currentCallId}
                          onEndCall={handleEndCall}
                          onMuteStateChange={(muted, toggle) => {
                            setActiveCallMuted(muted);
                            setActiveCallToggleMute(() => toggle);
                          }}
                        />
                      );
                    })()}
                    {/* Show mute button during active call (end call is handled by VoiceCallButton) */}
                    {(displayCallStatus === 'active' || displayCallStatus === 'connecting') && (
                      <Button
                        variant={isMuted ? "destructive" : "outline"}
                        size="sm"
                        onClick={toggleMute}
                        title={isMuted ? "Unmute microphone" : "Mute microphone"}
                      >
                        {isMuted ? (
                          <>
                            <MicOff className="h-4 w-4 mr-2" />
                            Unmute
                          </>
                        ) : (
                          <>
                            <Mic className="h-4 w-4 mr-2" />
                            Mute
                          </>
                        )}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 min-w-0">
              <div className="p-4 space-y-4 overflow-x-hidden w-full min-w-0">
          {/* Loading indicator */}
          {isLoadingMessages && (
            <div className="flex items-center justify-center py-8">
              <div className="flex gap-1">
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          
          {/* Search Results for Project Channels */}
          {!isLoadingMessages && isProjectChannel && isSearching && memberSearchQuery.trim() && (
            <div className="space-y-3 mb-4">
              <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Search className="h-4 w-4" />
                {searchResults.length > 0 
                  ? `Found ${searchResults.length} result${searchResults.length > 1 ? 's' : ''}`
                  : "No results found"}
              </div>
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="p-3 rounded-lg bg-muted/50 border border-border hover:bg-muted transition-colors cursor-pointer"
                  onClick={() => {
                    setMemberSearchQuery("");
                    setIsSearching(false);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {result.type === "update" && <Activity className="h-3 w-3" />}
                      {result.type === "comment" && <MessageSquare className="h-3 w-3" />}
                      {result.type === "task" && <CheckSquare className="h-3 w-3" />}
                      {result.type === "channel-message" && <Hash className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-medium text-sm">{result.title}</p>
                        <Badge variant="outline" className="text-xs">
                          {result.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{result.date}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{result.content}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className={`text-xs ${getAvatarColor(result.memberName)}`}>
                            {result.memberAvatar}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground">{result.memberName}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Team Channel Messages */}
          {!isLoadingMessages && isTeamChannel && !isSearching && selectedTeamId && (
            <>
              {(() => {
                const teamMessages = channelMessages.get(selectedTeamId) || [];
                if (teamMessages.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <Users className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">{selectedTeam?.name} Channel</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation with your team. Your messages will be visible to all team members.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-4">
                    {teamMessages.map((message) => {
                      // Check if message is from lean
                      const isLean = message.memberName === "lean" || message.userId === "ai-assistant";
                      // Determine if message is from current user (lean messages are always left-aligned)
                      const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
                      
                      // Get actual user info for display
                      const userInfo = message.userId ? getUserInfo(message.userId) : { name: message.memberName || "Unknown", initials: message.memberAvatar || "U" };
                      // For sent messages, use pre-calculated current user display info
                      const displayName = isSent 
                        ? currentUserDisplayInfo.displayName
                        : (isLean ? "lean" : userInfo.name);
                      const displayInitials = isSent 
                        ? currentUserDisplayInfo.initials
                        : (isLean ? "L" : userInfo.initials);
                      
                      return (
                        <div
                          key={message.id}
                          data-message-id={message.id}
                          data-message-timestamp={message.timestamp instanceof Date ? message.timestamp.getTime() : new Date(message.timestamp).getTime()}
                          data-message-user-id={message.userId || ''}
                          data-message-role={isLean ? 'assistant' : 'user'}
                          className={cn(
                            "flex gap-3",
                            isSent ? "justify-end" : "justify-start"
                          )}
                        >
                          {/* Avatar for received messages (other users) */}
                          {!isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              {isLean ? (
                                <>
                                  <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                                  <AvatarFallback className="bg-muted-foreground/20 text-foreground">
                                    L
                                  </AvatarFallback>
                                </>
                              ) : (
                                <AvatarFallback className={getAvatarColor(message.userId?.toLowerCase())}>
                                  {displayInitials}
                                </AvatarFallback>
                              )}
                            </Avatar>
                          )}
                          
                          {/* Message bubble */}
                          <div className={cn(
                            "flex flex-col min-w-0 max-w-[75%]",
                            isSent && "ml-auto"
                          )}>
                            {!isSent && (
                              <div className="flex items-center gap-2 mb-1 px-1">
                                <p className="font-medium text-sm">{displayName}</p>
                                <span className="text-xs text-muted-foreground">
                                  {message.timestamp.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                            <div className="rounded-lg px-4 py-2 bg-muted border border-border break-words">
                              {/* Display cited context for channel messages */}
                              {message.citedContext && (
                                <div className="mb-2 pb-2 border-b border-border/50">
                                  {message.citedContext.projects && message.citedContext.projects.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                      <FolderOpen className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary">Cited Projects:</span>
                                      {message.citedContext.projects.map((project) => (
                                        <Badge key={project.id} variant="secondary" className="text-xs">
                                          {project.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {message.citedContext.tasks && message.citedContext.tasks.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                      <CheckSquare className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary">Cited Tasks:</span>
                                      {message.citedContext.tasks.map((task) => (
                                        <Badge key={task.id} variant="secondary" className="text-xs">
                                          {task.title}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {message.citedContext.teams && message.citedContext.teams.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Users className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary">Cited Teams:</span>
                                      {message.citedContext.teams.map((team) => (
                                        <Badge key={team.id} variant="secondary" className="text-xs">
                                          {team.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              <p className="text-sm whitespace-pre-wrap font-medium text-foreground break-words">
                                {renderMessageContent(message.content)}
                              </p>
                              <p className="text-xs mt-1 opacity-60">
                                {message.timestamp.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                          
                          {/* Avatar for sent messages (current user) */}
                          {isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className={getAvatarColor(isSent ? user?.email?.toLowerCase() : message.userId?.toLowerCase())}>
                                {displayInitials}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}

          {/* Project Channel Messages */}
          {!isLoadingMessages && isProjectChannel && !isSearching && selectedProjectId && (
            <>
              {(() => {
                const projectMessages = channelMessages.get(selectedProjectId) || [];
                if (projectMessages.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <Hash className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">{selectedProject?.name} Channel</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation about this project. Your messages will be linked to project activities.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-4 w-full min-w-0 max-w-full">
                    {projectMessages.map((message) => {
                      // Check if message is from lean
                      const isLean = message.memberName === "lean" || message.userId === "ai-assistant";
                      // Determine if message is from current user (lean messages are always left-aligned)
                      const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
                      
                      // Get actual user info for display
                      const userInfo = message.userId ? getUserInfo(message.userId) : { name: message.memberName || "Unknown", initials: message.memberAvatar || "U" };
                      // For sent messages, use pre-calculated current user display info
                      const displayName = isSent 
                        ? currentUserDisplayInfo.displayName
                        : (isLean ? "lean" : userInfo.name);
                      const displayInitials = isSent 
                        ? currentUserDisplayInfo.initials
                        : (isLean ? "L" : userInfo.initials);
                      
                      return (
                        <div
                          key={message.id}
                          data-message-id={message.id}
                          data-message-timestamp={message.timestamp instanceof Date ? message.timestamp.getTime() : new Date(message.timestamp).getTime()}
                          data-message-user-id={message.userId || ''}
                          data-message-role={isLean ? 'assistant' : 'user'}
                          className={cn(
                            "flex gap-3 w-full min-w-0 max-w-full",
                            isSent ? "justify-end" : "justify-start"
                          )}
                        >
                          {/* Avatar for received messages (other users) */}
                          {!isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              {isLean ? (
                                <>
                                  <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                                  <AvatarFallback className="bg-muted-foreground/20 text-foreground">
                                    L
                                  </AvatarFallback>
                                </>
                              ) : (
                                <AvatarFallback className={getAvatarColor(message.userId?.toLowerCase())}>
                                  {displayInitials}
                                </AvatarFallback>
                              )}
                            </Avatar>
                          )}
                          
                          {/* Message bubble */}
                          <div className={cn(
                            "flex flex-col min-w-0 shrink",
                            isSent ? "max-w-[75%] ml-auto" : "max-w-[75%]"
                          )}>
                            {!isSent && (
                              <div className="flex items-center gap-2 mb-1 px-1">
                                <p className="font-medium text-sm">{displayName}</p>
                                <span className="text-xs text-muted-foreground">
                                  {message.timestamp.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                            <div className="rounded-lg px-4 py-2 bg-muted border border-border break-words min-w-0 w-full overflow-x-hidden" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                              {/* Display cited context for channel messages */}
                              {message.citedContext && (
                                <div className="mb-2 pb-2 border-b border-border/50 w-full min-w-0">
                                  {message.citedContext.projects && message.citedContext.projects.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap mb-1.5 min-w-0 w-full">
                                      <FolderOpen className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">Cited Projects:</span>
                                      {message.citedContext.projects.map((project) => (
                                        <Badge key={project.id} variant="secondary" className="text-xs">
                                          {project.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {message.citedContext.tasks && message.citedContext.tasks.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap mb-1.5 min-w-0 w-full">
                                      <CheckSquare className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">Cited Tasks:</span>
                                      {message.citedContext.tasks.map((task) => (
                                        <Badge key={task.id} variant="secondary" className="text-xs">
                                          {task.title}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  {message.citedContext.teams && message.citedContext.teams.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap min-w-0 w-full">
                                      <Users className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="text-xs font-medium text-primary flex-shrink-0 whitespace-nowrap">Cited Teams:</span>
                                      {message.citedContext.teams.map((team) => (
                                        <Badge key={team.id} variant="secondary" className="text-xs">
                                          {team.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              <p className="text-sm whitespace-pre-wrap font-medium text-foreground break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                {renderMessageContent(message.content)}
                              </p>
                              <p className="text-xs mt-1 opacity-60">
                                {message.timestamp.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                          
                          {/* Avatar for sent messages (current user) */}
                          {isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className={getAvatarColor(isSent ? user?.email?.toLowerCase() : message.userId?.toLowerCase())}>
                                {displayInitials}
                              </AvatarFallback>
                            </Avatar>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}

          {/* Regular Messages (AI Assistant or Team Members) */}
          {!isLoadingMessages && !isProjectChannel && !isTeamChannel && messages.map((message) => {
            // Check if message is from lean (assistant role)
            const isLean = message.role === "assistant";
            // Determine if message is from current user (sent) or other user (received)
            // Lean messages are always left-aligned (received)
            const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
            
            // For team member chats, if it's not from current user, it's received
            const isTeamMemberChat = selectedMember !== "ai-assistant" && !isProjectChannel;
            const isReceived = isTeamMemberChat && !isSent && message.role === "user";
            
            // Get actual user info for display - always use current user data for sent messages
            // For received messages, try to get from current user list, fallback to message data
            let displayInitials: string;
            if (isSent) {
              // Use pre-calculated current user display info
              displayInitials = currentUserDisplayInfo.initials;
            } else if (isLean) {
              displayInitials = "L";
            } else {
              // For received messages, always use current user data from allDomainUsers
              // This ensures avatar matches the user's current profile
              const userInfo = message.userId ? getUserInfo(message.userId) : null;
              if (userInfo && userInfo.initials) {
                displayInitials = userInfo.initials;
              } else {
                // Fallback: try to get from allTeamMembers (which uses current user data)
                const teamMember = allTeamMembers.find(m => m.email?.toLowerCase() === message.userId?.toLowerCase());
                if (teamMember) {
                  displayInitials = teamMember.avatar;
                } else {
                  // Last resort: use message data (might be stale)
                  displayInitials = message.memberAvatar || "U";
                }
              }
            }
            
            return (
              <div
                key={message.id}
                data-message-id={message.id}
                data-message-timestamp={message.timestamp instanceof Date ? message.timestamp.getTime() : new Date(message.timestamp).getTime()}
                data-message-user-id={message.userId || ''}
                data-message-role={message.role}
                className={cn(
                  "flex gap-3 w-full",
                  isSent ? "justify-end" : "justify-start"
                )}
              >
                {/* Avatar for received messages (assistant or other team member) */}
                {!isSent && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    {isLean ? (
                      <>
                        <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          L
                        </AvatarFallback>
                      </>
                    ) : (
                      <AvatarFallback className={getAvatarColor(message.userId)}>
                        {displayInitials || <User className="h-4 w-4" />}
                      </AvatarFallback>
                    )}
                  </Avatar>
                )}
                
                {/* Avatar for sent messages - always use current user's profile data */}
                {isSent && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarFallback className={getAvatarColor(user?.email?.toLowerCase())}>
                      {displayInitials || <User className="h-4 w-4" />}
                    </AvatarFallback>
                  </Avatar>
                )}
                
                {/* Message bubble wrapper */}
                <div className={cn(
                  "flex flex-col min-w-0 max-w-[75%]",
                  isSent && "ml-auto"
                )}>
                  {/* Message bubble */}
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2 bg-muted border border-border break-words"
                    )}
                  >
                  {/* Display cited context for user messages */}
                  {message.role === "user" && message.citedContext && (
                    <div className="mb-2 pb-2 border-b border-border/50">
                      {message.citedContext.projects && message.citedContext.projects.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <FolderOpen className="h-3 w-3 text-primary flex-shrink-0" />
                          <span className="text-xs font-medium text-primary">Cited Projects:</span>
                          {message.citedContext.projects.map((project) => (
                            <Badge key={project.id} variant="secondary" className="text-xs">
                              {project.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {message.citedContext.tasks && message.citedContext.tasks.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <CheckSquare className="h-3 w-3 text-primary flex-shrink-0" />
                          <span className="text-xs font-medium text-primary">Cited Tasks:</span>
                          {message.citedContext.tasks.map((task) => (
                            <Badge key={task.id} variant="secondary" className="text-xs">
                              {task.title}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {message.citedContext.teams && message.citedContext.teams.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Users className="h-3 w-3 text-primary flex-shrink-0" />
                          <span className="text-xs font-medium text-primary">Cited Teams:</span>
                          {message.citedContext.teams.map((team) => (
                            <Badge key={team.id} variant="secondary" className="text-xs">
                              {team.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                    <p className="text-sm whitespace-pre-wrap font-medium text-foreground break-words">
                      {renderMessageContent(message.content)}
                    </p>
                    <p className="text-xs mt-1 opacity-60">
                      {message.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                
                {/* Avatar for sent messages */}
                {isSent && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarFallback className={getAvatarColor(user?.email?.toLowerCase())}>
                      {displayInitials || <User className="h-4 w-4" />}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}
          {!isLoadingMessages && isLoading && !isProjectChannel && !isTeamChannel && (
            <div className="flex gap-3 justify-start">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  L
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-lg px-4 py-2">
                <div className="flex gap-1">
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t bg-background">
              {/* Cited Projects Section */}
              {selectedProjects.length > 0 && (
                <div className="px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FolderOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="text-xs font-medium text-primary">Cited Projects:</span>
                    {selectedProjects.map((project) => (
                      <Badge key={project.id} variant="secondary" className="text-xs">
                        {project.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {/* Cited Tasks Section */}
              {selectedTasks.length > 0 && (
                <div className="px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="text-xs font-medium text-primary">Cited Tasks:</span>
                    {selectedTasks.map((task) => (
                      <Badge key={task.id} variant="secondary" className="text-xs">
                        {task.title}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {/* Cited Teams Section */}
              {selectedTeams.length > 0 && (
                <div className="px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Users className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="text-xs font-medium text-primary">Cited Teams:</span>
                    {selectedTeams.map((team) => (
                      <Badge key={team.name} variant="secondary" className="text-xs">
                        {team.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="p-4 relative">
                {/* Mention Suggestions Dropdown */}
                {showMentionSuggestions && filteredMentionUsers.length > 0 && (isProjectChannel || isTeamChannel) && (
                  <div className="absolute bottom-full left-4 right-4 mb-2 bg-popover border rounded-md shadow-lg z-50 max-h-60 overflow-auto">
                    <div className="p-2">
                      <div className="text-xs font-semibold text-muted-foreground px-2 mb-1">Mention</div>
                      <div className="space-y-0.5">
                        {filteredMentionUsers.map((user, index) => (
                          <div
                            key={user.id}
                            onClick={() => insertMention(user)}
                            onMouseEnter={() => setSelectedMentionIndex(index)}
                            className={cn(
                              "flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
                              index === selectedMentionIndex 
                                ? "bg-primary text-primary-foreground" 
                                : ""
                            )}
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className="text-xs">
                                {user.avatar}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{user.name}</div>
                              <div className={cn(
                                "text-xs truncate",
                                index === selectedMentionIndex 
                                  ? "text-primary-foreground/80" 
                                  : "text-muted-foreground"
                              )}>{user.role}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      const cursorPos = e.target.selectionStart || 0;
                      if (isProjectChannel || isTeamChannel) {
                        detectMention(e.target.value, cursorPos);
                      }
                    }}
                    onKeyDown={(e) => {
                      handleMentionKeyDown(e);
                    }}
                    onKeyPress={handleKeyPress}
                    onClick={(e) => {
                      // Detect mention on click (cursor position change)
                      const cursorPos = (e.target as HTMLInputElement).selectionStart || 0;
                      if (isProjectChannel || isTeamChannel) {
                        detectMention(input, cursorPos);
                      }
                    }}
                    placeholder={
                      isProjectChannel || isTeamChannel 
                        ? "Type @ to mention someone..." 
                        : "Type your message..."
                    }
                    disabled={isLoading}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                {isProjectChannel && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Messages in this channel are linked to project activities
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Incoming Call Dialog */}
      {incomingCallSignal && incomingCallSignal.status === 'ringing' && (() => {
        // Determine chatId for the incoming call
        let dialogChatId = '';
        if ((isProjectChannel && selectedProjectId) || (isTeamChannel && selectedTeamId)) {
          dialogChatId = selectedMember;
        } else if (selectedMember === "ai-assistant") {
          dialogChatId = user?.email ? getAIAssistantChatId(user.email) : '';
        } else {
          if (selectedMember.includes('@')) {
            dialogChatId = user?.email ? getDirectMessageChatId(user.email, selectedMember) : '';
          } else {
            const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
            if (selectedMemberData?.email && user?.email) {
              dialogChatId = getDirectMessageChatId(user.email, selectedMemberData.email);
            } else {
              dialogChatId = selectedMember;
            }
          }
        }
        
        return (
          <IncomingCallDialog
            callSignal={incomingCallSignal}
            chatId={dialogChatId || incomingCallSignal.chatId}
            callerName={(() => {
              const caller = allDomainUsers.find(u => u.email === incomingCallSignal.callerEmail);
              if (caller) {
                return `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || caller.email;
              }
              return incomingCallSignal.callerEmail;
            })()}
            callerAvatar={(() => {
              const caller = allDomainUsers.find(u => u.email === incomingCallSignal.callerEmail);
              if (caller) {
                return `${caller.firstName?.charAt(0) || ''}${caller.lastName?.charAt(0) || ''}`.toUpperCase() || incomingCallSignal.callerEmail.charAt(0).toUpperCase();
              }
              return incomingCallSignal.callerEmail.charAt(0).toUpperCase();
            })()}
            onMuteStateChange={(muted, toggle) => {
              setActiveCallMuted(muted);
              setActiveCallToggleMute(() => toggle);
            }}
            onAccept={() => {
              setIncomingCallSignal(null);
            }}
            onReject={async () => {
              // Clean up incoming call signal
              setIncomingCallSignal(null);
              // End the call (this will also update signaling service)
              await handleEndCall();
            }}
          />
        );
      })()}
    </>
  );
}

