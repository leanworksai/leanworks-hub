import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle, X, Send, Bot, User, FolderOpen, CheckSquare, ChevronDown, Search, Users, Hash, Activity, Filter, MessageSquare } from "lucide-react";
import { cn, getUserById, getUserDisplayName, getUserInitials } from "@/lib/utils";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Project } from "@/data/projectsData";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import { messagesService, type ChatMessage } from "@/services/firestore";
import { useAuth } from "@/contexts/AuthContext";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  userId?: string;
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

export function Chatbot() {
  const { selectedProjects } = useSelectedProjects();
  const { selectedTasks } = useSelectedTasks();
  const { selectedTeams } = useSelectedTeams();
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { data: allDomainUsers = [] } = useUsers();
  const { user } = useAuth();
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const previousChatIdRef = useRef<string | null>(null); // Track previous chatId to detect chat switches

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
      })),
      lastSync,
    };
    
    try {
      const toCache = {
        messages: messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
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
          // Replace optimistic message with real one
          existingMap.delete(matchedOptimistic.id);
          existingMap.set(incomingId, {
            id: incomingId,
            role: incomingMsg.role as "user" | "assistant",
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            userId: incomingMsg.userId,
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
    const channelMessages = incoming.filter(msg => {
      if (isTeam) {
        return msg.role === 'user' && msg.teamId === projectIdOrTeamId;
      } else {
        return msg.role === 'user' && msg.projectId === projectIdOrTeamId;
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
            memberName: incomingMsg.memberName || 'You',
            memberAvatar: incomingMsg.memberAvatar || 'U',
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId,
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
          // Replace optimistic message with real one
          existingMap.delete(matchedOptimistic.id);
          existingMap.set(incomingId, {
            id: incomingId,
            memberName: incomingMsg.memberName || 'You',
            memberAvatar: incomingMsg.memberAvatar || 'U',
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId,
          });
        } else {
          // New message, add it
          existingMap.set(incomingId, {
            id: incomingId,
            memberName: incomingMsg.memberName || 'You',
            memberAvatar: incomingMsg.memberAvatar || 'U',
            content: incomingMsg.content,
            timestamp: incomingMsg.timestamp instanceof Date 
              ? incomingMsg.timestamp 
              : new Date(incomingMsg.timestamp),
            ...(isTeam ? { teamId: projectIdOrTeamId } : { projectId: projectIdOrTeamId }),
            userId: incomingMsg.userId,
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
    ? { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" }
    : isProjectChannel && selectedProject
    ? { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" }
    : isTeamChannel && selectedTeam
    ? { id: selectedMember, name: selectedTeam.name, role: "Team Channel", avatar: "👥" }
    : allTeamMembers.find(m => m.id === selectedMember) || { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" };

  // Check if AI Assistant matches search query
  const aiAssistantMatches = memberSearchQuery.trim() === "" || 
    "ai assistant".includes(memberSearchQuery.toLowerCase()) ||
    "assistant".includes(memberSearchQuery.toLowerCase());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        scrollToBottom();
        if ((isProjectChannel || isTeamChannel) && isSearching) {
          memberSearchRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 100);
    }
  }, [messages, channelMessages, isOpen, selectedProjects, selectedTasks, selectedTeams, isProjectChannel, isTeamChannel, isSearching]);

  // Calculate unread counts for all chats when chatbot opens or when user/projects/teams change
  useEffect(() => {
    if (!user || !user.email) return;

    const calculateUnreadCounts = async () => {
      const newUnreadCounts = new Map<string, number>();
      const allChatIds: string[] = [];

      // Add AI assistant chat
      allChatIds.push("ai-assistant");

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
      await Promise.all(
        allChatIds.map(async (chatId) => {
          try {
            // Check cache first - if chat is empty in cache and cache is recent, skip API call
            const cached = allChatCaches.get(chatId) || loadCachedMessages(chatId);
            const cacheIsRecent = cached && !isCacheStale(cached.lastSync);
            const cacheIsEmpty = cached && cached.messages.length === 0;
            
            // If cache shows empty and is recent, skip API call and set count to 0
            if (cacheIsRecent && cacheIsEmpty) {
              newUnreadCounts.set(chatId, 0);
              return;
            }
            
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
                chatId === "ai-assistant"
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
                currentChatId = "ai-assistant";
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

    calculateUnreadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, projects, userTeams, allTeamMembers, isOpen, selectedMember, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, lastReadTimestamps]);

  // Load all chat caches upfront - ONLY ONCE per session (on mount/login)
  useEffect(() => {
    if (!user || !user.email || cacheLoadedForSession) return;

    const loadAllChatCaches = () => {
      const allChatIds: string[] = [];
      const caches = new Map<string, { messages: ChatMessage[], lastSync: number }>();

      // Add AI assistant chat
      allChatIds.push("ai-assistant");

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
      allChatIds.push("ai-assistant");

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
                    const isUnread = chatId === "ai-assistant"
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
            // Silently fail for background sync - don't spam console
            console.debug(`Background sync failed for chat ${chatId}:`, error);
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
      chatId = "ai-assistant";
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
          .filter(msg => msg.role === 'user' && msg.projectId === selectedProjectId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || 'You',
            memberAvatar: msg.memberAvatar || 'U',
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            projectId: msg.projectId || selectedProjectId,
            userId: msg.userId,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedProjectId, cachedChannelMsgs);
          return newMap;
        });
      } else if (isTeamChannel && selectedTeamId) {
        const cachedChannelMsgs: ChannelMessage[] = cached.messages
          .filter(msg => msg.role === 'user' && msg.teamId === selectedTeamId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || 'You',
            memberAvatar: msg.memberAvatar || 'U',
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            teamId: msg.teamId || selectedTeamId,
            userId: msg.userId,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedTeamId, cachedChannelMsgs);
          return newMap;
        });
      } else {
        const filteredCached = chatId === "ai-assistant" 
          ? cached.messages 
          : cached.messages.filter(msg => msg.role === 'user');
        
        const cachedRegularMsgs: Message[] = filteredCached.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          userId: msg.userId,
        }));
        
        if (cachedRegularMsgs.length > 0) {
          setMessages(cachedRegularMsgs);
        } else if (chatId === "ai-assistant") {
          setMessages([
            {
              id: "greeting",
              role: "assistant",
              content: "Hello! I'm your AI assistant. How can I help you today?",
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
            .filter(msg => msg.role === 'user' && msg.projectId === selectedProjectId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || 'You',
              memberAvatar: msg.memberAvatar || 'U',
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              projectId: msg.projectId || selectedProjectId,
              userId: msg.userId,
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
          .filter(msg => msg.role === 'user' && msg.teamId === selectedTeamId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || 'You',
            memberAvatar: msg.memberAvatar || 'U',
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            teamId: msg.teamId || selectedTeamId,
            userId: msg.userId,
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
          const filteredMessages = chatId === "ai-assistant" 
            ? allMessages 
            : allMessages.filter(msg => msg.role === 'user');
          
          const regularMsgs: Message[] = filteredMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            userId: msg.userId,
          }));
          
          // Only update state if it's initial load (state is empty)
          // Otherwise, real-time listener will handle updates
          if (isInitialLoad) {
            if (regularMsgs.length === 0 && chatId === "ai-assistant") {
              setMessages([
                {
                  id: "greeting",
                  role: "assistant",
                  content: "Hello! I'm your AI assistant. How can I help you today?",
                  timestamp: new Date(),
                },
              ]);
            } else if (regularMsgs.length === 0 && chatId !== "ai-assistant") {
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
              content: "Hello! I'm your AI assistant. How can I help you today?",
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
    let isInitialLoad = true;
    
    // Set up listener after a delay to ensure initial load is complete
    const timer = setTimeout(() => {
      unsubscribe = messagesService.subscribeToMessages(chatId, (firestoreMessages) => {
        // Skip first update since we just loaded messages
        if (isInitialLoad) {
          isInitialLoad = false;
          return;
        }
        
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
            currentChatId = "ai-assistant";
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
                const filteredMessages = chatId === "ai-assistant" 
                  ? firestoreMessages 
                  : firestoreMessages.filter(msg => msg.role === 'user');
                
                // Merge with existing messages, preserving optimistic updates
                const merged = mergeMessages(prev, filteredMessages, true);
                
                // Always return merged if we have optimistic messages (they need to be matched)
                // Save to cache when messages update (after state update)
                setTimeout(() => saveCachedMessages(chatId, firestoreMessages), 0);
                return merged;
              }
              
              // Normal merge for confirmed messages
              const filteredMessages = chatId === "ai-assistant" 
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
    }, 2000);

    // Cleanup
    return () => {
      clearTimeout(timer);
      if (unsubscribe) {
        unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMember, isProjectChannel, selectedProjectId, user?.email, isOpen, isLoadingMessages, allChatCaches]);

  const generateResponse = async (userMessage: string): Promise<string> => {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    const lowerMessage = userMessage.toLowerCase();

    // Build context from selected projects
    let contextInfo = "";
    if (selectedProjects.length > 0) {
      contextInfo = "\n\n[Context - Selected Projects:]\n";
      selectedProjects.forEach((project) => {
        contextInfo += `- ${project.name}: ${project.description}\n`;
        contextInfo += `  Status: ${project.status}, Due: ${project.dueDate}\n`;
        contextInfo += `  Team: ${project.team} members\n`;
        contextInfo += `  Summary: ${project.summary.accomplishment}\n`;
        contextInfo += `  Tasks: ${project.tasks.length} total (${project.tasks.filter(t => t.status === "completed").length} completed, ${project.tasks.filter(t => t.status === "in-progress").length} in progress)\n`;
      });
    }

    // Build context from selected tasks
    let tasksContextInfo = "";
    if (selectedTasks.length > 0) {
      tasksContextInfo = "\n\n[Context - Selected Tasks:]\n";
      selectedTasks.forEach((task) => {
        const assigneeName = task.assignee || "Unassigned";
        tasksContextInfo += `- ${task.title}: ${task.description}\n`;
        tasksContextInfo += `  Status: ${task.status}, Priority: ${task.priority}\n`;
        tasksContextInfo += `  Assignee: ${assigneeName}, Due: ${task.dueDate}\n`;
        tasksContextInfo += `  Project: ${task.project}\n`;
        tasksContextInfo += `  Progress Updates: ${task.progressUpdates.length}\n`;
      });
    }

    // Build context from selected teams
    let teamsContextInfo = "";
    if (selectedTeams.length > 0) {
      teamsContextInfo = "\n\n[Context - Selected Teams:]\n";
      selectedTeams.forEach((team) => {
        teamsContextInfo += `- ${team.name}: ${team.description}\n`;
        teamsContextInfo += `  Members: ${team.members}, Projects: ${team.projects}\n`;
      });
    }

    // Simple response logic - can be replaced with actual AI API
    if (lowerMessage.includes("hello") || lowerMessage.includes("hi") || lowerMessage.includes("hey")) {
      let greeting = "Hello! I'm here to help you with any questions about your projects, tasks, or team. What would you like to know?";
      if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
        const parts = [];
        if (selectedProjects.length > 0) {
          parts.push(`${selectedProjects.length} project(s): ${selectedProjects.map(p => p.name).join(", ")}`);
        }
        if (selectedTasks.length > 0) {
          parts.push(`${selectedTasks.length} task(s): ${selectedTasks.map(t => t.title).join(", ")}`);
        }
        if (selectedTeams.length > 0) {
          parts.push(`${selectedTeams.length} team(s): ${selectedTeams.map(t => t.name).join(", ")}`);
        }
        greeting += `\n\nI can see you have ${parts.join(" and ")} selected. Feel free to ask me anything about them!`;
      }
      return greeting;
    }

    if (lowerMessage.includes("project")) {
      let response = "I can help you with project-related questions. You can view all your projects on the Projects page, and see detailed information including tasks, team members, and progress updates for each project.";
      if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nYou can ask me specific questions about any of these selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("task")) {
      let response = "Tasks are displayed on the Tasks page where you can see all tasks with their progress updates. Each task shows status, priority, assignee, and a timeline of progress updates. You can filter tasks by status or priority.";
      if (selectedTasks.length > 0) {
        response += tasksContextInfo;
        response += "\nI can provide details about any of these selected tasks!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can provide details about tasks in your selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("team")) {
      let response = "Teams are managed on the Teams page. You can see team members, their roles, and team details. Teams are associated with projects and help organize collaboration.";
      if (selectedTeams.length > 0) {
        response += teamsContextInfo;
        response += "\nI can provide details about any of these selected teams!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can tell you about the teams working on your selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("help") || lowerMessage.includes("what can you do")) {
      let response = "I can help you with:\n• Questions about projects and their status\n• Information about tasks and progress\n• Team and collaboration queries\n• General navigation and feature questions\n\nJust ask me anything!";
      if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
        if (selectedProjects.length > 0) {
          response += contextInfo;
        }
        if (selectedTasks.length > 0) {
          response += tasksContextInfo;
        }
        if (selectedTeams.length > 0) {
          response += teamsContextInfo;
        }
        response += "\n\nI have context about your selected items, so I can provide more specific answers!";
      }
      return response;
    }

    if (lowerMessage.includes("status") || lowerMessage.includes("progress")) {
      let response = "You can check project status on the Projects page, and task progress on the Tasks page. Each task shows detailed progress updates in a timeline format, making it easy to track what's happening.";
      if (selectedTasks.length > 0) {
        response += tasksContextInfo;
        response += "\nAsk me about the status or progress of any selected task!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nAsk me about the status or progress of any selected project!";
      }
      return response;
    }

    if (lowerMessage.includes("due date") || lowerMessage.includes("deadline")) {
      let response = "Due dates are displayed for both projects and tasks. On the Projects page, you'll see project due dates. On the Tasks page, each task shows its due date along with other details.";
      if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can tell you about the deadlines for your selected projects!";
      }
      return response;
    }

    // Default response with context
    let defaultResponse = `I understand you're asking about "${userMessage}". While I'm a helpful assistant, I'm currently set up to answer questions about your projects, tasks, teams, and general navigation. Could you rephrase your question, or would you like to know more about a specific feature?`;
    if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
      if (selectedProjects.length > 0) {
        defaultResponse += contextInfo;
      }
      if (selectedTasks.length > 0) {
        defaultResponse += tasksContextInfo;
      }
      if (selectedTeams.length > 0) {
        defaultResponse += teamsContextInfo;
      }
      defaultResponse += "\n\nI have information about your selected items that might help answer your question!";
    }
    return defaultResponse;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !user || isSendingMessage) return;

    const messageContent = input.trim();
    setInput("");
    setIsSendingMessage(true);

    // Handle project channel messages
    if (isProjectChannel && selectedProjectId) {
      // Create message and add to state immediately (optimistic update)
      const tempChannelMessage: ChannelMessage = {
        id: `temp-channel-${Date.now()}`,
        memberName: "You",
        memberAvatar: "U",
        content: messageContent,
        timestamp: new Date(),
        projectId: selectedProjectId,
        userId: user.email?.toLowerCase(),
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
        });

        const savedChannelMessage: ChannelMessage = {
          id: savedMessage.id,
          memberName: savedMessage.memberName || "You",
          memberAvatar: savedMessage.memberAvatar || "U",
          content: savedMessage.content,
          timestamp: savedMessage.timestamp instanceof Date ? savedMessage.timestamp : new Date(savedMessage.timestamp),
          projectId: selectedProjectId,
          userId: savedMessage.userId || user.email?.toLowerCase(),
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
            }));
            saveCachedMessages(chatId, allMessages);
          }, 0);
          
          return newMap;
        });
        setIsSendingMessage(false);
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
      // Create message and add to state immediately (optimistic update)
      const tempChannelMessage: ChannelMessage = {
        id: `temp-channel-${Date.now()}`,
        memberName: "You",
        memberAvatar: "U",
        content: messageContent,
        timestamp: new Date(),
        teamId: selectedTeamId,
        userId: user.email?.toLowerCase(),
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
        });

        const savedChannelMessage: ChannelMessage = {
          id: savedMessage.id,
          memberName: savedMessage.memberName || "You",
          memberAvatar: savedMessage.memberAvatar || "U",
          content: savedMessage.content,
          timestamp: savedMessage.timestamp instanceof Date ? savedMessage.timestamp : new Date(savedMessage.timestamp),
          teamId: selectedTeamId,
          userId: savedMessage.userId || user.email?.toLowerCase(),
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
            }));
            saveCachedMessages(chatId, allMessages);
          }, 0);
          
          return newMap;
        });
        setIsSendingMessage(false);
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
      chatId = "ai-assistant";
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

    // Create message object and add to state immediately (optimistic update)
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: messageContent,
      timestamp: new Date(),
      userId: user.email?.toLowerCase(),
    };

    // Add message to state immediately for instant feedback
    setMessages((prev) => [...prev, userMessage]);

    // Save user message to Firestore and update with saved data
    try {
      const savedUserMessage = await messagesService.create({
        chatId: chatId,
        role: 'user',
        content: messageContent,
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

      try {
        const response = await generateResponse(userMessage.content);
        
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
            "h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 relative pointer-events-auto",
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
                      AI Assistant
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
                          : (unreadCounts.get("ai-assistant") || 0) > 0
                          ? "bg-primary/10 hover:bg-primary/20"
                          : "hover:bg-muted"
                      )}
                    >
                      <Bot className="h-4 w-4 flex-shrink-0" />
                      <span className={cn(
                        (unreadCounts.get("ai-assistant") || 0) > 0 && selectedMember !== "ai-assistant" && "font-semibold"
                      )}>AI Assistant</span>
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
                              key={`project-${projectId}`}
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
                              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : memberUnreadCount > 0
                                ? "bg-primary/10 hover:bg-primary/20"
                                : "hover:bg-muted"
                            )}
                          >
                            <Avatar className="h-6 w-6 flex-shrink-0">
                              <AvatarFallback className="text-xs">
                                {member.avatar}
                              </AvatarFallback>
                            </Avatar>
                            <span className={cn(
                              "flex-1 text-left truncate",
                              memberUnreadCount > 0 && !isSelected && "font-semibold"
                            )}>{member.name}</span>
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
                  <AvatarFallback className={cn(
                    "text-primary-foreground",
                    selectedMember === "ai-assistant" ? "bg-primary" : (isProjectChannel || isTeamChannel) ? "bg-primary/10" : "bg-muted"
                  )}>
                    {selectedMember === "ai-assistant" ? (
                      <Bot className="h-4 w-4" />
                    ) : isProjectChannel ? (
                      <Hash className="h-4 w-4 text-primary" />
                    ) : isTeamChannel ? (
                      <Users className="h-4 w-4 text-primary" />
                    ) : (
                      <span className="text-xs">{currentMember.avatar}</span>
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0">
                  <h3 className="font-semibold text-sm truncate">{currentMember.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedMember === "ai-assistant" ? "AI Assistant" : isProjectChannel ? "Project Channel" : isTeamChannel ? "Team Channel" : "Direct Message"}
                  </p>
                </div>
              </div>
            </div>

            {/* Search Bar for Project Channels */}
            {isProjectChannel && (
              <div className="border-b bg-background p-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={memberSearchRef}
                      placeholder="Search activities, tasks, comments..."
                      value={memberSearchQuery}
                      onChange={(e) => {
                        setMemberSearchQuery(e.target.value);
                      }}
                      className="pl-9"
                    />
                  </div>
                  <Select value={filterType} onValueChange={(value: any) => setFilterType(value)}>
                    <SelectTrigger className="w-[140px]">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="activities">Activities</SelectItem>
                      <SelectItem value="tasks">Tasks</SelectItem>
                      <SelectItem value="comments">Comments</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Messages Area */}
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
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
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
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
                      // Determine if message is from current user
                      const isSent = message.userId?.toLowerCase() === user?.email?.toLowerCase();
                      
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "flex gap-3",
                            isSent ? "justify-end" : "justify-start"
                          )}
                        >
                          {/* Avatar for received messages (other users) */}
                          {!isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className="bg-muted-foreground/20 text-foreground">
                                {message.memberAvatar}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          
                          {/* Message bubble */}
                          <div className="flex flex-col min-w-0 max-w-[80%]">
                            {!isSent && (
                              <div className="flex items-center gap-2 mb-1 px-1">
                                <p className="font-medium text-sm">{message.memberName}</p>
                                <span className="text-xs text-muted-foreground">
                                  {message.timestamp.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                            <div
                              className={cn(
                                "rounded-lg px-4 py-2",
                                isSent
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted-foreground/10 border border-border"
                              )}
                            >
                              <p className={cn(
                                "text-sm whitespace-pre-wrap",
                                isSent ? "text-primary-foreground" : "text-foreground"
                              )}>
                                {message.content}
                              </p>
                              <p className={cn(
                                "text-xs mt-1",
                                isSent ? "opacity-80" : "opacity-60"
                              )}>
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
                              <AvatarFallback className="bg-primary text-primary-foreground">
                                {message.memberAvatar}
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
                  <div className="space-y-4">
                    {projectMessages.map((message) => {
                      // Determine if message is from current user
                      const isSent = message.userId?.toLowerCase() === user?.email?.toLowerCase();
                      
                      return (
                        <div
                          key={message.id}
                          className={cn(
                            "flex gap-3",
                            isSent ? "justify-end" : "justify-start"
                          )}
                        >
                          {/* Avatar for received messages (other users) */}
                          {!isSent && (
                            <Avatar className="h-8 w-8 flex-shrink-0">
                              <AvatarFallback className="bg-muted-foreground/20 text-foreground">
                                {message.memberAvatar}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          
                          {/* Message bubble */}
                          <div className="flex flex-col min-w-0 max-w-[80%]">
                            {!isSent && (
                              <div className="flex items-center gap-2 mb-1 px-1">
                                <p className="font-medium text-sm">{message.memberName}</p>
                                <span className="text-xs text-muted-foreground">
                                  {message.timestamp.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                            <div
                              className={cn(
                                "rounded-lg px-4 py-2",
                                isSent
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted-foreground/10 border border-border"
                              )}
                            >
                              <p className={cn(
                                "text-sm whitespace-pre-wrap",
                                isSent ? "text-primary-foreground" : "text-foreground"
                              )}>
                                {message.content}
                              </p>
                              <p className={cn(
                                "text-xs mt-1",
                                isSent ? "opacity-80" : "opacity-60"
                              )}>
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
                              <AvatarFallback className="bg-primary text-primary-foreground">
                                {message.memberAvatar}
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
            // Determine if message is from current user (sent) or other user (received)
            const isSent = message.role === "assistant" 
              ? false // Assistant messages are always received
              : message.userId?.toLowerCase() === user?.email?.toLowerCase();
            
            // For team member chats, if it's not from current user, it's received
            const isTeamMemberChat = selectedMember !== "ai-assistant" && !isProjectChannel;
            const isReceived = isTeamMemberChat && !isSent && message.role === "user";
            
            return (
              <div
                key={message.id}
                className={cn(
                  "flex gap-3",
                  isSent ? "justify-end" : "justify-start"
                )}
              >
                {/* Avatar for received messages (assistant or other team member) */}
                {!isSent && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarFallback className={cn(
                      message.role === "assistant" 
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted-foreground/20 text-foreground"
                    )}>
                      {message.role === "assistant" ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                )}
                
                {/* Message bubble */}
                <div
                  className={cn(
                    "rounded-lg px-4 py-2 max-w-[80%]",
                    isSent
                      ? "bg-primary text-primary-foreground"
                      : message.role === "assistant"
                      ? "bg-muted"
                      : "bg-muted-foreground/10 border border-border"
                  )}
                >
                  <p className={cn(
                    "text-sm whitespace-pre-wrap",
                    isSent ? "text-primary-foreground" : "text-foreground"
                  )}>
                    {message.content}
                  </p>
                  <p className={cn(
                    "text-xs mt-1",
                    isSent ? "opacity-80" : "opacity-60"
                  )}>
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                
                {/* Avatar for sent messages */}
                {isSent && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}
          {!isLoadingMessages && isLoading && !isProjectChannel && !isTeamChannel && (
            <div className="flex gap-3 justify-start">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  <Bot className="h-4 w-4" />
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
                      <Badge key={project.name} variant="secondary" className="text-xs">
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
              <div className="p-4">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={isProjectChannel ? "Type a message in the project channel..." : "Type your message..."}
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
    </>
  );
}

