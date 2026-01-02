import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Hash, Users, MessageSquare, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, getAvatarColor, getUserDisplayName, getUserInitials } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUsers } from "@/hooks/useUsers";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { messagesService, imageUploadService, type ChatMessage } from "@/services/api";
import { useChatId, getDirectMessageChatId } from "@/hooks/useChatId";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { ContextBadges } from "@/components/ContextBadges";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { useOrg } from "@/contexts/OrgContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { VoiceCallButton } from "./VoiceCall";
import { useWebRTCContext } from "@/contexts/WebRTCContext";
import type { Message, ChannelMessage, LikedByUser, TeamMember } from "@/components/chat/types";

interface TeamChatConversationProps {
  chatId: string | null;
  selectedMember: string;
}

export function TeamChatConversation({ chatId, selectedMember }: TeamChatConversationProps) {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { isFreePlan } = useSubscription();
  const { toast } = useToast();
  const { data: allDomainUsers = [] } = useUsers();
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { selectedProjects, toggleProject, clearSelection: clearSelectedProjects } = useSelectedProjects();
  const { selectedTasks, toggleTask, clearSelection: clearSelectedTasks } = useSelectedTasks();
  const { selectedTeams, toggleTeam, clearSelection: clearSelectedTeams } = useSelectedTeams();
  const { selectedDocs, toggleDoc, clearSelection: clearSelectedDocs } = useSelectedDocs();
  const { callStatus, currentCallId } = useWebRTCContext();

  const [messages, setMessages] = useState<Message[]>([]);
  const [channelMessages, setChannelMessages] = useState<Map<string, ChannelMessage[]>>(new Map());
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [pendingLikeOperations, setPendingLikeOperations] = useState<Set<string>>(new Set());
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get team members
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
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allDomainUsers, user?.email]);

  // Use useChatId to determine chat type
  const { 
    isProjectChannel, 
    isTeamChannel, 
    isDM,
    selectedProjectId, 
    selectedTeamId 
  } = useChatId({
    selectedMember,
    userEmail: user?.email,
    allTeamMembers,
  });

  const selectedProject = selectedProjectId 
    ? projects.find(p => p.name.toLowerCase().replace(/\s+/g, '-') === selectedProjectId)
    : null;
  const selectedTeam = selectedTeamId 
    ? userTeams.find(t => t.name.toLowerCase().replace(/\s+/g, '-') === selectedTeamId)
    : null;

  // Get current member info
  const currentMember = useMemo(() => {
    if (isProjectChannel && selectedProject) {
      return { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" };
    } else if (isTeamChannel && selectedTeam) {
      return { id: selectedMember, name: selectedTeam.name, role: "Team Channel", avatar: "👥" };
    } else {
      return allTeamMembers.find(m => m.id === selectedMember) || { id: selectedMember, name: "Unknown", role: "", avatar: "U" };
    }
  }, [isProjectChannel, isTeamChannel, selectedProject, selectedTeam, selectedMember, allTeamMembers]);

  // Get current user display info
  const currentUserProfile = useMemo(() => {
    if (!user?.email) return null;
    return allDomainUsers.find(u => u.email?.toLowerCase() === user.email?.toLowerCase()) || null;
  }, [allDomainUsers, user?.email]);

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

  // Load messages when chat changes
  useEffect(() => {
    if (!chatId || !user?.email) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const firestoreMessages = await messagesService.getByChatId(chatId);
        
        if (isProjectChannel && selectedProjectId) {
          const channelMsgs: ChannelMessage[] = firestoreMessages
            .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.projectId === selectedProjectId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
              memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              projectId: msg.projectId || selectedProjectId,
              userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
              imageUrls: msg.imageUrls,
              likes: Array.isArray(msg.likes) ? msg.likes : [],
              citedContext: msg.citedContext,
            }));
          
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedProjectId, channelMsgs);
            return newMap;
          });
        } else if (isTeamChannel && selectedTeamId) {
          const channelMsgs: ChannelMessage[] = firestoreMessages
            .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.teamId === selectedTeamId)
            .map(msg => ({
              id: msg.id,
              memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
              memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              teamId: msg.teamId || selectedTeamId,
              userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
              imageUrls: msg.imageUrls,
              likes: Array.isArray(msg.likes) ? msg.likes : [],
              citedContext: msg.citedContext,
            }));
          
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedTeamId, channelMsgs);
            return newMap;
          });
        } else {
          // Direct message - only show user messages
          const regularMsgs: Message[] = firestoreMessages
            .filter(msg => msg.role === 'user')
            .map(msg => ({
              id: msg.id,
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              userId: msg.userId,
              imageUrls: msg.imageUrls,
              likes: Array.isArray(msg.likes) ? msg.likes : [],
              citedContext: msg.citedContext,
            }));
          
          setMessages(regularMsgs);
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    // Subscribe to real-time updates
    const unsubscribe = messagesService.subscribeViaFirestore(chatId, (newMessages) => {
      if (isProjectChannel && selectedProjectId) {
        const channelMsgs: ChannelMessage[] = newMessages
          .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.projectId === selectedProjectId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            projectId: msg.projectId || selectedProjectId,
            userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
            imageUrls: msg.imageUrls,
            likes: Array.isArray(msg.likes) ? msg.likes : [],
            citedContext: msg.citedContext,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedProjectId, channelMsgs);
          return newMap;
        });
      } else if (isTeamChannel && selectedTeamId) {
        const channelMsgs: ChannelMessage[] = newMessages
          .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && msg.teamId === selectedTeamId)
          .map(msg => ({
            id: msg.id,
            memberName: msg.memberName || (msg.role === 'assistant' ? 'lean' : 'You'),
            memberAvatar: msg.memberAvatar || (msg.role === 'assistant' ? 'AI' : 'U'),
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            teamId: msg.teamId || selectedTeamId,
            userId: msg.userId || (msg.role === 'assistant' ? 'ai-assistant' : undefined),
            imageUrls: msg.imageUrls,
            likes: Array.isArray(msg.likes) ? msg.likes : [],
            citedContext: msg.citedContext,
          }));
        
        setChannelMessages((prev) => {
          const newMap = new Map(prev);
          newMap.set(selectedTeamId, channelMsgs);
          return newMap;
        });
      } else {
        const regularMsgs: Message[] = newMessages
          .filter(msg => msg.role === 'user')
          .map(msg => ({
            id: msg.id,
            role: msg.role as "user" | "assistant",
            content: msg.content,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
            userId: msg.userId,
            imageUrls: msg.imageUrls,
            likes: Array.isArray(msg.likes) ? msg.likes : [],
            citedContext: msg.citedContext,
          }));
        
        setMessages(regularMsgs);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [chatId, user?.email, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId]);

  // Handle sending messages
  const handleSend = useCallback(async (messageContent: string, imageUrls: string[] = []) => {
    if ((!messageContent.trim() && imageUrls.length === 0) || !user || !chatId || isSendingMessage) return;

    // Block @lean mentions in team/group channels for free tier users
    if (isFreePlan && (isProjectChannel || isTeamChannel) && messageContent.includes('@lean')) {
      toast({
        title: "Upgrade Required",
        description: "Mentioning Lean in team/group channels is available on Standard and Pro plans. Upgrade to unlock this feature.",
        variant: "default",
      });
      return;
    }

    setIsSendingMessage(true);
    setUploadingImages(true);

    // Upload images if any
    let uploadedImageUrls: string[] = [];
    if (selectedImages.length > 0) {
      try {
        const uploadPromises = selectedImages.map(file => 
          imageUploadService.uploadImage(chatId, file)
        );
        uploadedImageUrls = await Promise.all(uploadPromises);
      } catch (error: any) {
        console.error('Failed to upload images:', error);
        toast({
          title: "Upload Failed",
          description: error.message || 'Failed to upload images. Please try again.',
          variant: "destructive",
        });
        setUploadingImages(false);
        setIsSendingMessage(false);
        return;
      }
    }
    setUploadingImages(false);
    
    // Clear selected images
    imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
    setSelectedImages([]);
    setImagePreviewUrls([]);

    const finalImageUrls = uploadedImageUrls.length > 0 ? uploadedImageUrls : imageUrls;
    const citedContext = (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0 || selectedDocs.length > 0) ? {
      projects: selectedProjects.length > 0 ? [...selectedProjects] : undefined,
      tasks: selectedTasks.length > 0 ? [...selectedTasks] : undefined,
      teams: selectedTeams.length > 0 ? [...selectedTeams] : undefined,
      docs: selectedDocs.length > 0 ? [...selectedDocs] : undefined,
    } : undefined;

    try {
      if (isProjectChannel && selectedProjectId) {
        const userDisplayName = currentUserDisplayInfo.displayName;
        const userInitials = currentUserDisplayInfo.initials;

        await messagesService.create({
          chatId: selectedMember,
          role: 'user',
          content: messageContent,
          projectId: selectedProjectId,
          citedContext: citedContext,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
        });
      } else if (isTeamChannel && selectedTeamId) {
        const userDisplayName = currentUserDisplayInfo.displayName;
        const userInitials = currentUserDisplayInfo.initials;

        await messagesService.create({
          chatId: selectedMember,
          role: 'user',
          content: messageContent,
          teamId: selectedTeamId,
          citedContext: citedContext,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
        });
      } else {
        // Direct message
        await messagesService.create({
          chatId: chatId,
          role: 'user',
          content: messageContent,
          citedContext: citedContext,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
        });
      }

      // Clear cited context after sending
      if (citedContext) {
        clearSelectedProjects();
        clearSelectedTasks();
        clearSelectedTeams();
        clearSelectedDocs();
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      toast({
        title: "Failed to send message",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingMessage(false);
    }
  }, [user, chatId, isSendingMessage, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, selectedMember, selectedImages, imagePreviewUrls, selectedProjects, selectedTasks, selectedTeams, selectedDocs, currentUserDisplayInfo, isFreePlan, toast, clearSelectedProjects, clearSelectedTasks, clearSelectedTeams, clearSelectedDocs]);

  // Handle image selection
  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newImages = [...selectedImages, ...files];
    setSelectedImages(newImages);
    
    const newPreviewUrls = newImages.map(file => URL.createObjectURL(file));
    setImagePreviewUrls(newPreviewUrls);
  }, [selectedImages]);

  const handleImageRemove = useCallback((index: number) => {
    const newImages = selectedImages.filter((_, i) => i !== index);
    const newPreviewUrls = imagePreviewUrls.filter((_, i) => i !== index);
    
    // Revoke URL for removed image
    URL.revokeObjectURL(imagePreviewUrls[index]);
    
    setSelectedImages(newImages);
    setImagePreviewUrls(newPreviewUrls);
  }, [selectedImages, imagePreviewUrls]);

  // Get mentionable users for the current channel
  const getMentionableUsers = useMemo(() => {
    const mentionable: TeamMember[] = [];
    
    // Add lean (AI assistant) only for paid plans
    if (!isFreePlan) {
      mentionable.push({ id: "lean", name: "lean", role: "", avatar: "/logo.png" });
    }
    
    // Add channel-specific members
    if (isProjectChannel && selectedProject) {
      // Add project members
      selectedProject.members?.forEach(member => {
        const user = allDomainUsers.find(u => u.email === member.id || u.email === member.email);
        if (user) {
          const firstName = user.firstName || '';
          const lastName = user.lastName || '';
          const name = `${firstName} ${lastName}`.trim() || user.email || '';
          const avatar = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || 'U';
          mentionable.push({
            id: user.email || '',
            name: name,
            role: member.role || user.jobTitle || 'User',
            avatar: avatar,
            email: user.email,
          });
        }
      });
    } else if (isTeamChannel && selectedTeam) {
      // Add all team members
      allTeamMembers.forEach(member => {
        if (!mentionable.find(m => m.id === member.id)) {
          mentionable.push(member);
        }
      });
    } else if (isDM) {
      // For DMs, add the other person
      const otherMember = allTeamMembers.find(m => m.id === selectedMember);
      if (otherMember) {
        mentionable.push(otherMember);
      }
    }
    
    return mentionable;
  }, [isProjectChannel, isTeamChannel, isDM, selectedProject, selectedTeam, allDomainUsers, allTeamMembers, selectedMember, isFreePlan]);

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
    setSelectedMentionIndex(0);
    setShowMentionSuggestions(true);
  }, []);

  // Handle mention selection
  const handleMentionSelect = useCallback((user: TeamMember) => {
    // Mention insertion is handled by ChatInput component
    setShowMentionSuggestions(false);
    setMentionQuery("");
    setSelectedMentionIndex(0);
  }, []);

  // Handle like toggle
  const handleToggleLike = useCallback(async (messageId: string, currentLikes: string[] = []) => {
    if (!user?.email) return;
    
    const userEmailLower = user.email.toLowerCase();
    const isLiked = currentLikes.includes(userEmailLower);
    
    setPendingLikeOperations((prev) => new Set(prev).add(messageId));
    
    const optimisticLikes = isLiked
      ? currentLikes.filter((email: string) => email !== userEmailLower)
      : [...currentLikes, userEmailLower];
    
    // Optimistic update
    setMessages((prev) => 
      prev.map((msg) => 
        msg.id === messageId 
          ? { ...msg, likes: optimisticLikes }
          : msg
      )
    );
    
    setChannelMessages((prev) => {
      const updated = new Map(prev);
      prev.forEach((messages, chatId) => {
        const updatedMessages = messages.map((msg) =>
          msg.id === messageId
            ? { ...msg, likes: optimisticLikes }
            : msg
        );
        updated.set(chatId, updatedMessages);
      });
      return updated;
    });
    
    try {
      const result = await messagesService.toggleLike(messageId);
      
      setPendingLikeOperations((prev) => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
      
      // Update with server response
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId 
            ? { ...msg, likes: result.likes }
            : msg
        )
      );
      
      setChannelMessages((prev) => {
        const updated = new Map(prev);
        prev.forEach((messages, chatId) => {
          const updatedMessages = messages.map((msg) =>
            msg.id === messageId
              ? { ...msg, likes: result.likes }
              : msg
          );
          updated.set(chatId, updatedMessages);
        });
        return updated;
      });
    } catch (error) {
      console.error('Failed to toggle like:', error);
      
      setPendingLikeOperations((prev) => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
      
      // Revert on error
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId 
            ? { ...msg, likes: currentLikes }
            : msg
        )
      );
      
      setChannelMessages((prev) => {
        const updated = new Map(prev);
        prev.forEach((messages, chatId) => {
          const updatedMessages = messages.map((msg) =>
            msg.id === messageId
              ? { ...msg, likes: currentLikes }
              : msg
          );
          updated.set(chatId, updatedMessages);
        });
        return updated;
      });
    }
  }, [user?.email]);

  // Helper functions for message display
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

  const getLikedByUsers = useCallback((likes: string[] = []): LikedByUser[] => {
    return likes.map(email => {
      const userInfo = getUserInfo(email);
      return {
        email,
        name: userInfo.name,
        initials: userInfo.initials,
      };
    });
  }, [getUserInfo]);

  const getMessageDisplayInfo = useCallback((message: Message | ChannelMessage) => {
    const isChannelMessage = 'memberName' in message;
    // Check if message is from lean/AI assistant
    // For ChannelMessage: check memberName, userId, or role
    // For regular Message: check role
    const isLean = isChannelMessage 
      ? (message.memberName?.toLowerCase() === "lean" || 
         message.userId === "ai-assistant" || 
         (message as any).role === "assistant")
      : (message as Message).role === "assistant";
    
    const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
    
    let displayName: string;
    let displayInitials: string;
    
    if (isSent) {
      displayName = currentUserDisplayInfo.displayName;
      displayInitials = currentUserDisplayInfo.initials;
    } else if (isLean) {
      displayName = "lean";
      displayInitials = "L";
    } else {
      const userInfo = message.userId ? getUserInfo(message.userId) : null;
      if (userInfo) {
        displayName = userInfo.name;
        displayInitials = userInfo.initials;
      } else if (isChannelMessage) {
        displayName = message.memberName || "Unknown";
        displayInitials = message.memberAvatar || "U";
      } else {
        displayName = "Unknown";
        displayInitials = "U";
      }
    }
    
    return { isSent, isLean, displayName, displayInitials };
  }, [user?.email, currentUserDisplayInfo, getUserInfo]);

  // Get messages to display
  const displayMessages = useMemo(() => {
    if (isProjectChannel && selectedProjectId) {
      return channelMessages.get(selectedProjectId) || [];
    } else if (isTeamChannel && selectedTeamId) {
      return channelMessages.get(selectedTeamId) || [];
    } else {
      return messages;
    }
  }, [isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, channelMessages, messages]);

  if (!chatId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold mb-2">Select a chat to start messaging</h3>
          <p className="text-sm text-muted-foreground">
            Choose a conversation from the sidebar to view and send messages.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden min-h-0 max-h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarFallback className={cn(
              "text-primary-foreground",
              (isProjectChannel || isTeamChannel) 
                ? "bg-primary/10" 
                : getAvatarColor(currentMember.id?.toLowerCase())
            )}>
              {isProjectChannel ? (
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
            <p className="text-xs text-muted-foreground truncate">
              {isProjectChannel ? "Project Channel" : isTeamChannel ? "Team Channel" : "Direct Message"}
            </p>
          </div>
        </div>
        {!isProjectChannel && !isTeamChannel && (
          <VoiceCallButton
            chatId={chatId}
            otherUserEmail={selectedMember.includes('@') ? selectedMember : allTeamMembers.find(m => m.id === selectedMember)?.email || ''}
            otherUserName={currentMember.name}
            otherUserAvatar={currentMember.avatar}
          />
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-4 space-y-4">
          {isLoadingMessages && (
            <div className="flex items-center justify-center py-8">
              <div className="flex gap-1">
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          
          {!isLoadingMessages && (
            <ChatMessageList
              messages={displayMessages}
              visibleCount={visibleMessageCount}
              onLoadMore={(increment) => setVisibleMessageCount(prev => prev + increment)}
              currentUserEmail={user?.email?.toLowerCase() || ''}
              onToggleLike={handleToggleLike}
              getLikedByUsers={getLikedByUsers}
              getUserDisplayInfo={getMessageDisplayInfo}
              emptyState={
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  {isProjectChannel ? (
                    <>
                      <Hash className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">{selectedProject?.name} Channel</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation about this project. Your messages will be linked to project activities.
                      </p>
                    </>
                  ) : isTeamChannel ? (
                    <>
                      <Users className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">{selectedTeam?.name} Channel</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation with your team. Your messages will be visible to all team members.
                      </p>
                    </>
                  ) : (
                    <>
                      <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Direct Message</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation with {currentMember.name}.
                      </p>
                    </>
                  )}
                </div>
              }
              className="flex-1 min-h-0"
              hideContext={false}
            />
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="flex-shrink-0">
        <ChatInput
          onSend={handleSend}
          disabled={isSendingMessage}
          isLoading={isSendingMessage}
          uploadingImages={uploadingImages}
          imagePreviewUrls={imagePreviewUrls}
          onImageSelect={handleImageSelect}
          onImageRemove={handleImageRemove}
          selectedProjects={selectedProjects}
          selectedTasks={selectedTasks}
          selectedTeams={selectedTeams}
          selectedDocs={selectedDocs}
          onRemoveProject={toggleProject}
          onRemoveTask={toggleTask}
          onRemoveTeam={toggleTeam}
          onRemoveDoc={toggleDoc}
          placeholder="Type your message..."
          showMentions={isProjectChannel || isTeamChannel || isDM}
          mentionUsers={getMentionableUsers}
          onMentionDetect={detectMention}
          showMentionSuggestions={showMentionSuggestions}
          filteredMentionUsers={filteredMentionUsers}
          selectedMentionIndex={selectedMentionIndex}
          onMentionSelect={handleMentionSelect}
          onMentionIndexChange={setSelectedMentionIndex}
          onMentionClose={() => {
            setShowMentionSuggestions(false);
            setMentionQuery("");
            setSelectedMentionIndex(0);
          }}
        />
      </div>
    </div>
  );
}

