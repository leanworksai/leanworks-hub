import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle, X, Send, Bot, User, FolderOpen, CheckSquare, ChevronDown, Search, Users, Hash, Activity, Filter, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Project } from "@/data/projectsData";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { useQueries } from "@tanstack/react-query";
import { teamsService, messagesService } from "@/services/firestore";
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
  projectId: string;
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

// Get team members from user's teams
const getUserTeamMembers = (userTeams: Array<{ name: string }>, teamDetails: Array<{ data?: { members: Array<{ name: string; role: string; email: string; avatar: string }> } }>): TeamMember[] => {
  const memberMap = new Map<string, TeamMember>();
  
  userTeams.forEach((team) => {
    const teamDetailQuery = teamDetails.find(
      (query) => query.data?.name === team.name
    );
    const teamDetail = teamDetailQuery?.data;
    
    if (teamDetail?.members) {
      teamDetail.members.forEach((member) => {
        // Use email as unique identifier to avoid duplicates
        const key = member.email.toLowerCase();
        if (!memberMap.has(key)) {
          memberMap.set(key, {
            id: member.email.toLowerCase(), // Use email as ID for consistent chatId generation
            name: member.name,
            role: member.role,
            avatar: member.avatar,
            email: member.email,
          });
        }
      });
    }
  });
  
  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
};

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
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>("ai-assistant");
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelMessages, setChannelMessages] = useState<Map<string, ChannelMessage[]>>(new Map());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filterType, setFilterType] = useState<"all" | "activities" | "tasks" | "comments">("all");
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map()); // chatId -> unread count
  const [lastReadTimestamps, setLastReadTimestamps] = useState<Map<string, number>>(new Map()); // chatId -> last read timestamp
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);

  // Fetch team details for all user teams
  const teamDetailsQueries = useQueries({
    queries: userTeams.length > 0
      ? userTeams.map((team) => ({
          queryKey: ['teams', team.name],
          queryFn: () => teamsService.getById(team.name),
          enabled: !!team.name,
          staleTime: 1000 * 60 * 5,
        }))
      : [],
  });

  // Get team members from user's teams (memoized to prevent infinite loops)
  const allTeamMembers = useMemo(() => {
    return getUserTeamMembers(userTeams, teamDetailsQueries);
  }, [userTeams, teamDetailsQueries]);
  
  // Check if selected member is a project channel
  const isProjectChannel = selectedMember.startsWith("project-");
  const selectedProjectId = isProjectChannel ? selectedMember.replace("project-", "") : null;
  const selectedProject = selectedProjectId 
    ? projects.find(p => p.name.toLowerCase().replace(/\s+/g, '-') === selectedProjectId)
    : null;
  
  // Filter team members based on search query
  const filteredTeamMembers = memberSearchQuery.trim() === ""
    ? allTeamMembers
    : allTeamMembers.filter((member) =>
        member.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        member.role.toLowerCase().includes(memberSearchQuery.toLowerCase())
      );

  // Filter projects based on search query
  const filteredProjects = memberSearchQuery.trim() === ""
    ? projects
    : projects.filter((project) =>
        project.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        project.description.toLowerCase().includes(memberSearchQuery.toLowerCase())
      );

  const currentMember = selectedMember === "ai-assistant" 
    ? { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" }
    : isProjectChannel && selectedProject
    ? { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" }
    : allTeamMembers.find(m => m.id === selectedMember) || { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" };

  // Check if AI Assistant matches search query
  const aiAssistantMatches = memberSearchQuery.trim() === "" || 
    "ai assistant".includes(memberSearchQuery.toLowerCase()) ||
    "assistant".includes(memberSearchQuery.toLowerCase());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Perform search through project activities when in project channel mode
  useEffect(() => {
    if (!isProjectChannel || !selectedProject || !memberSearchQuery.trim()) {
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
        if (
          task.title.toLowerCase().includes(query) ||
          task.assignee.toLowerCase().includes(query) ||
          task.status.toLowerCase().includes(query)
        ) {
          results.push({
            id: task.id,
            type: "task",
            title: task.title,
            content: `Status: ${task.status} | Assignee: ${task.assignee} | Due: ${task.dueDate}`,
            memberName: task.assignee,
            memberAvatar: task.assignee.charAt(0).toUpperCase(),
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
        if (isProjectChannel && isSearching) {
          memberSearchRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 100);
    }
  }, [messages, channelMessages, isOpen, selectedProjects, selectedTasks, selectedTeams, isProjectChannel, isSearching]);

  // Load messages from Firestore when chat changes
  useEffect(() => {
    if (!user || !isOpen || !user.email) return;

    let chatId: string;
    
    // Determine chatId
    if (isProjectChannel && selectedProjectId) {
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

    setIsLoadingMessages(true);

    // Initial load
    const loadMessages = async () => {
      try {
        if (isProjectChannel && selectedProjectId) {
          // Load project channel messages
          const firestoreMessages = await messagesService.getByChatId(chatId);
          const channelMsgs: ChannelMessage[] = firestoreMessages
            .filter(msg => msg.role === 'user' && msg.projectId === selectedProjectId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || 'You',
              memberAvatar: msg.memberAvatar || 'U',
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              projectId: msg.projectId || selectedProjectId,
            }));
          
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedProjectId, channelMsgs);
            return newMap;
          });
        } else {
          // Load regular messages (AI Assistant or team member)
          const firestoreMessages = await messagesService.getByChatId(chatId);
          
          // For team member chats, only show user messages (no assistant messages)
          // For AI Assistant, show both user and assistant messages
          const filteredMessages = chatId === "ai-assistant" 
            ? firestoreMessages 
            : firestoreMessages.filter(msg => msg.role === 'user');
          
          const regularMsgs: Message[] = filteredMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            userId: msg.userId,
          }));
          
          // If no messages and it's AI Assistant, add greeting
          if (regularMsgs.length === 0 && chatId === "ai-assistant") {
            setMessages([
              {
                id: "greeting",
                role: "assistant",
                content: "Hello! I'm your AI assistant. How can I help you today?",
                timestamp: new Date(),
              },
            ]);
          } else {
            setMessages(regularMsgs);
          }
        }
        
        // Mark messages as read when opening chat
        const now = Date.now();
        setLastReadTimestamps((prev) => {
          const newMap = new Map(prev);
          newMap.set(chatId, now);
          return newMap;
        });
        // Clear unread count for this chat (since we're viewing it)
        setUnreadCounts((prev) => {
          const newMap = new Map(prev);
          newMap.set(chatId, 0);
          return newMap;
        });
      } catch (error) {
        console.error('Failed to load messages:', error);
        // On error, show greeting for AI Assistant
        if (selectedMember === "ai-assistant" && !isProjectChannel) {
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
        setIsLoadingMessages(false);
      }
    };

    loadMessages();
  }, [selectedMember, isProjectChannel, selectedProjectId, user?.email, isOpen]);

  // Set up real-time listener in a separate effect to avoid conflicts
  useEffect(() => {
    if (!user || !isOpen || !user.email || isLoadingMessages) return;

    let chatId: string;
    
    // Determine chatId (same logic as above)
    if (isProjectChannel && selectedProjectId) {
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
        
        try {
          // Calculate unread count for this chat
          const lastRead = lastReadTimestamps.get(chatId) || 0;
          // Check if this is the currently open chat
          let currentChatId: string;
          if (isProjectChannel && selectedProjectId) {
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
          const unreadCount = firestoreMessages.filter(msg => {
            const msgTime = msg.timestamp instanceof Date ? msg.timestamp.getTime() : new Date(msg.timestamp).getTime();
            const isAfterLastRead = msgTime > lastRead;
            const isNotFromCurrentUser = msg.userId?.toLowerCase() !== user?.email?.toLowerCase();
            return isAfterLastRead && isNotFromCurrentUser;
          }).length;
          
          // Update unread count (only if not currently viewing this chat)
          if (!isCurrentChat && unreadCount > 0) {
            setUnreadCounts((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, unreadCount);
              return newMap;
            });
          } else if (isCurrentChat) {
            // Clear unread count if viewing this chat
            setUnreadCounts((prev) => {
              const newMap = new Map(prev);
              newMap.set(chatId, 0);
              return newMap;
            });
          }
          
          if (isProjectChannel && selectedProjectId) {
            // Update project channel messages
            const channelMsgs: ChannelMessage[] = firestoreMessages
              .filter(msg => msg.role === 'user' && msg.projectId === selectedProjectId)
              .map(msg => ({
                id: msg.id,
                memberName: msg.memberName || 'You',
                memberAvatar: msg.memberAvatar || 'U',
                content: msg.content,
                timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
                projectId: msg.projectId || selectedProjectId,
              }));
            
            setChannelMessages((prev) => {
              const newMap = new Map(prev);
              const existing = newMap.get(selectedProjectId) || [];
              const existingIds = new Set(existing.map(m => m.id));
              const newIds = new Set(channelMsgs.map(m => m.id));
              
              // Only update if messages actually changed
              if (existingIds.size !== newIds.size || 
                  ![...existingIds].every(id => newIds.has(id))) {
                newMap.set(selectedProjectId, channelMsgs);
                return newMap;
              }
              return prev;
            });
          } else {
            // Update regular messages
            const filteredMessages = chatId === "ai-assistant" 
              ? firestoreMessages 
              : firestoreMessages.filter(msg => msg.role === 'user');
            
            const regularMsgs: Message[] = filteredMessages.map(msg => ({
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              userId: msg.userId,
            }));
            
            // Only update if messages actually changed
            setMessages((prev) => {
              const existingIds = new Set(prev.map(m => m.id));
              const newIds = new Set(regularMsgs.map(m => m.id));
              const hasNewMessages = regularMsgs.some(msg => !existingIds.has(msg.id));
              const hasRemovedMessages = prev.some(msg => !newIds.has(msg.id));
              
              if (hasNewMessages || hasRemovedMessages || regularMsgs.length !== prev.length) {
                if (regularMsgs.length > 0 || chatId !== "ai-assistant") {
                  return regularMsgs;
                }
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
  }, [selectedMember, isProjectChannel, selectedProjectId, user?.email, isOpen, isLoadingMessages]);

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
        tasksContextInfo += `- ${task.title}: ${task.description}\n`;
        tasksContextInfo += `  Status: ${task.status}, Priority: ${task.priority}\n`;
        tasksContextInfo += `  Assignee: ${task.assignee}, Due: ${task.dueDate}\n`;
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
    if (!input.trim() || isLoading || !user) return;

    const messageContent = input.trim();
    setInput("");

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
        };

        // Update the message in state with saved data
        setChannelMessages((prev) => {
          const projectMessages = prev.get(selectedProjectId) || [];
          const newMap = new Map(prev);
          const updatedMessages = projectMessages.map(msg => 
            msg.id === tempChannelMessage.id ? savedChannelMessage : msg
          );
          newMap.set(selectedProjectId, updatedMessages);
          return newMap;
        });
      } catch (error) {
        console.error('Failed to save channel message:', error);
        // Remove the optimistic message if save failed
        setChannelMessages((prev) => {
          const projectMessages = prev.get(selectedProjectId) || [];
          const newMap = new Map(prev);
          newMap.set(selectedProjectId, projectMessages.filter(msg => msg.id !== tempChannelMessage.id));
          return newMap;
        });
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
      setMessages((prev) => prev.map(msg => 
        msg.id === userMessage.id 
          ? {
              ...msg,
              id: savedUserMessage.id,
              timestamp: savedUserMessage.timestamp instanceof Date ? savedUserMessage.timestamp : new Date(savedUserMessage.timestamp),
              userId: savedUserMessage.userId || user.email?.toLowerCase(),
            }
          : msg
      ));
    } catch (error) {
      console.error('Failed to save user message:', error);
      // Remove the optimistic message if save failed
      setMessages((prev) => prev.filter(msg => msg.id !== userMessage.id));
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
          setMessages((prev) => prev.map(msg => 
            msg.id === assistantMessage.id 
              ? {
                  ...msg,
                  id: savedAssistantMessage.id,
                  timestamp: savedAssistantMessage.timestamp instanceof Date ? savedAssistantMessage.timestamp : new Date(savedAssistantMessage.timestamp),
                }
              : msg
          ));
        } catch (error) {
          console.error('Failed to save assistant message:', error);
          // Remove the optimistic message if save failed
          setMessages((prev) => prev.filter(msg => msg.id !== assistantMessage.id));
        }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I apologize, but I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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
      <div className="absolute bottom-6 left-0 right-0 flex justify-center z-50 pointer-events-none">
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 relative pointer-events-auto",
            isOpen ? "scale-0 opacity-0" : "scale-100 opacity-100"
          )}
          size="icon"
        >
        <MessageCircle className="h-6 w-6" />
        {/* Unread indicator */}
        {Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0) > 0 && (
          <span className="absolute top-0 right-0 h-4 w-4 bg-red-500 rounded-full border-2 border-background flex items-center justify-center">
            <span className="text-[10px] text-white font-bold">
              {Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0) > 99 
                ? '99+' 
                : Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0)}
            </span>
          </span>
        )}
        </Button>
      </div>

      {/* Chat Window */}
      <Card
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-md h-[600px] flex flex-col shadow-2xl transition-all duration-300 border",
          isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4 pointer-events-none"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-primary/5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className={cn(
                "text-primary-foreground",
                selectedMember === "ai-assistant" ? "bg-primary" : isProjectChannel ? "bg-primary/10" : "bg-muted"
              )}>
                {selectedMember === "ai-assistant" ? (
                  <Bot className="h-4 w-4" />
                ) : isProjectChannel ? (
                  <Hash className="h-4 w-4 text-primary" />
                ) : (
                  <span className="text-xs">{currentMember.avatar}</span>
                )}
              </AvatarFallback>
            </Avatar>
            <Select 
              value={selectedMember} 
              onValueChange={(value) => {
                setSelectedMember(value);
                setMemberSearchQuery(""); // Clear search when selection is made
              }}
              onOpenChange={(open) => {
                if (open) {
                  // Focus search input when dropdown opens
                  setTimeout(() => {
                    memberSearchRef.current?.focus();
                  }, 100);
                } else {
                  // Clear search when dropdown closes
                  setMemberSearchQuery("");
                }
              }}
            >
              <SelectTrigger className="w-auto min-w-[180px] h-auto border-none bg-transparent shadow-none hover:bg-transparent focus:ring-0 p-0 cursor-pointer">
                <SelectValue>
                  <div className="flex flex-col items-start">
                    <h3 className="font-semibold text-sm">{currentMember.name}</h3>
                    <p className="text-xs text-muted-foreground">Online</p>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[400px] p-0">
                {/* Search Input */}
                <div className="flex items-center border-b px-3 py-2 sticky top-0 bg-background z-10">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    ref={memberSearchRef}
                    type="text"
                    placeholder="Search team members or projects..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {/* AI Assistant - always shown if matches search or no search */}
                  {aiAssistantMatches && (
                    <SelectItem value="ai-assistant" className="py-2">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 flex-shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">AI Assistant</span>
                          <span className="text-xs text-muted-foreground">Assistant</span>
                        </div>
                      </div>
                    </SelectItem>
                  )}
                  {/* Project Channels */}
                  {filteredProjects.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                        Project Channels
                      </div>
                      {filteredProjects.map((project) => {
                        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
                        const projectChatId = `project-${projectId}`;
                        const projectUnreadCount = unreadCounts.get(projectChatId) || 0;
                        return (
                          <SelectItem key={`project-${projectId}`} value={`project-${projectId}`} className="py-2">
                            <div className="flex items-center gap-2 w-full">
                              <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 relative">
                                <Hash className="h-3 w-3 text-primary" />
                                {projectUnreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border border-background" />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{project.name}</span>
                                  {projectUnreadCount > 0 && (
                                    <span className="h-2 w-2 bg-red-500 rounded-full flex-shrink-0" />
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground truncate">Project Channel</span>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                  {/* Team Members */}
                  {filteredTeamMembers.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                        Team Members
                      </div>
                      {filteredTeamMembers.map((member) => {
                        // Get chatId for this member to check unread count
                        const memberChatId = user?.email && member.email 
                          ? getDirectMessageChatId(user.email, member.email)
                          : member.id;
                        const memberUnreadCount = unreadCounts.get(memberChatId) || 0;
                        return (
                          <SelectItem key={member.id} value={member.id} className="py-2">
                            <div className="flex items-center gap-2 w-full">
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 relative">
                                <span className="text-xs font-medium">{member.avatar}</span>
                                {memberUnreadCount > 0 && (
                                  <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border border-background" />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium truncate">{member.name}</span>
                                  {memberUnreadCount > 0 && (
                                    <span className="h-2 w-2 bg-red-500 rounded-full flex-shrink-0" />
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground truncate">{member.role}</span>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                  {memberSearchQuery.trim() !== "" && filteredTeamMembers.length === 0 && filteredProjects.length === 0 && !aiAssistantMatches && (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No results found
                    </div>
                  )}
                </div>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
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

        {/* Messages */}
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    {projectMessages.map((message) => (
                      <div key={message.id} className="flex gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {message.memberAvatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm">{message.memberName}</p>
                            <span className="text-xs text-muted-foreground">
                              {message.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="bg-muted rounded-lg px-4 py-2">
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* Regular Messages (AI Assistant or Team Members) */}
          {!isLoadingMessages && !isProjectChannel && messages.map((message) => {
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
          {!isLoadingMessages && isLoading && !isProjectChannel && (
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
        </CardContent>

        {/* Input */}
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
      </Card>
    </>
  );
}

