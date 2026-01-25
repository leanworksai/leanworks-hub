import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Hash, Users, ChevronLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn, getAvatarColor, getUserDisplayName, getUserInitials } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import { useUserProjects } from "@/hooks/useProjects";
import { useUserTeams } from "@/hooks/useTeams";
import { messagesService, imageUploadService, subscriptionService, getAuthToken, type ChatMessage } from "@/services/api";
import { useChatId, getDirectMessageChatId } from "@/hooks/useChatId";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { useOrg } from "@/contexts/OrgContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { usePageContext } from "@/contexts/PageContext";
import { useSelectedTextContext } from "@/contexts/SelectedTextContext";
import { VoiceCallButton } from "./VoiceCall";
import { useWebRTCContext } from "@/contexts/WebRTCContext";
import type { Message, ChannelMessage, LikedByUser, TeamMember } from "@/components/chat/types";
import { buildCitedContext } from "@/lib/citedContext";

interface TeamChatWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string | null;
  selectedMember: string;
}

export function TeamChatWindow({ open, onOpenChange, chatId, selectedMember }: TeamChatWindowProps) {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { hasCredits, creditsRemaining, creditsLimit } = useSubscription();
  const { toast } = useToast();
  const { data: allDomainUsers = [] } = useUsers();
  const userMap = useUserMap();
  const { data: projects = [] } = useUserProjects();
  const { data: userTeams = [] } = useUserTeams();
  const { selectedProjects, toggleProject, clearSelection: clearSelectedProjects } = useSelectedProjects();
  const { selectedTasks, toggleTask, clearSelection: clearSelectedTasks } = useSelectedTasks();
  const { selectedDocs, toggleDoc, clearSelection: clearSelectedDocs } = useSelectedDocs();
  const { selectedTextPosition, clearSelectedText } = useSelectedTextContext();
  const { callStatus, currentCallId } = useWebRTCContext();
  const { contextType, contextRef, clearContext } = usePageContext();

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

  // Get current member info - return null if member not found (don't default to Unknown)
  const currentMember = useMemo(() => {
    if (isProjectChannel && selectedProject) {
      return { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" };
    } else if (isTeamChannel && selectedTeam) {
      return { id: selectedMember, name: selectedTeam.name, role: "Team Channel", avatar: "👥" };
    } else {
      // For DMs, only return member if found - don't default to Unknown
      return allTeamMembers.find(m => m.id === selectedMember) || null;
    }
  }, [isProjectChannel, isTeamChannel, selectedProject, selectedTeam, selectedMember, allTeamMembers]);

  // Get current user display info
  const currentUserProfile = useMemo(() => {
    if (!user?.email) return null;
    const userEntry = userMap.get(user.email.toLowerCase());
    if (userEntry) {
      return {
        email: userEntry.email,
        firstName: userEntry.firstName,
        lastName: userEntry.lastName,
      };
    }
    return null;
  }, [userMap, user?.email]);

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

  // Load messages when chat opens or changes
  useEffect(() => {
    if (!open || !chatId || !user?.email) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const firestoreMessages = await messagesService.getByChatId(chatId);
        
        if (isProjectChannel && selectedProjectId) {
          const channelMsgs: ChannelMessage[] = firestoreMessages
            .filter(msg => 
              !msg.chatId.startsWith('ai-assistant-') && 
              (msg.role === 'user' || msg.role === 'assistant') && 
              msg.projectId === selectedProjectId
            )
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
              implicitContext: msg.implicitContext,
            }));
          
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedProjectId, channelMsgs);
            return newMap;
          });
        } else if (isTeamChannel && selectedTeamId) {
          const channelMsgs: ChannelMessage[] = firestoreMessages
            .filter(msg => 
              !msg.chatId.startsWith('ai-assistant-') && 
              (msg.role === 'user' || msg.role === 'assistant') && 
              msg.teamId === selectedTeamId
            )
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
              implicitContext: msg.implicitContext,
            }));
          
          setChannelMessages((prev) => {
            const newMap = new Map(prev);
            newMap.set(selectedTeamId, channelMsgs);
            return newMap;
          });
        } else {
          // Direct message - only show user messages, exclude AI assistant chat messages
          const regularMsgs: Message[] = firestoreMessages
            .filter(msg => msg.role === 'user' && !msg.chatId.startsWith('ai-assistant-'))
            .map(msg => ({
              id: msg.id,
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
              userId: msg.userId,
              imageUrls: msg.imageUrls,
              likes: Array.isArray(msg.likes) ? msg.likes : [],
              citedContext: msg.citedContext,
              implicitContext: msg.implicitContext,
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
          .filter(msg => 
            !msg.chatId.startsWith('ai-assistant-') && 
            (msg.role === 'user' || msg.role === 'assistant') && 
            msg.projectId === selectedProjectId
          )
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
          .filter(msg => 
            !msg.chatId.startsWith('ai-assistant-') && 
            (msg.role === 'user' || msg.role === 'assistant') && 
            msg.teamId === selectedTeamId
          )
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
        // Direct message - only show user messages, exclude AI assistant chat messages
        const regularMsgs: Message[] = newMessages
          .filter(msg => msg.role === 'user' && !msg.chatId.startsWith('ai-assistant-'))
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
  }, [open, chatId, user?.email, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId]);

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
  const generateChannelAIResponse = useCallback(async (
    query: string,
    chatId: string,
    channelContext?: { type: 'project' | 'team'; id: string; name: string; description?: string }
  ): Promise<string> => {
    if (!user?.email) {
      throw new Error('User must be authenticated to use AI assistant');
    }

    const isLocalDev = import.meta.env.DEV;
    // Get authentication token (with fallback to localStorage)
    const customToken = await getAuthToken();
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

    // Add selected projects, tasks, teams, and docs if any
    if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedDocs.length > 0) {
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

      if (selectedDocs.length > 0) {
        contextParts.push("Selected Docs:");
        selectedDocs.forEach((doc) => {
          // Remove HTML tags for context
          const textContent = doc.content.replace(/<[^>]*>/g, '').substring(0, 500);
          contextParts.push(`- ${doc.title} (ID: ${doc.id})`);
          contextParts.push(`  Content: ${textContent}${doc.content.length > 500 ? '...' : ''}`);
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
        if (import.meta.env.DEV) {
          console.error('Failed to fetch API key from backend:', error);
        }
        const fallbackKey = import.meta.env.VITE_ASK_API_KEY;
        if (fallbackKey) {
          headers['X-API-Key'] = fallbackKey;
        } else {
          throw new Error('API key not available');
        }
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
          org_slug: currentOrg?.slug || currentOrg?.name || '',
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
  }, [user?.email, currentOrg, selectedProjects, selectedTasks, selectedDocs]);

  // Handle sending messages
  const handleSend = useCallback(async (messageContent: string, imageUrls: string[] = []) => {
    if ((!messageContent.trim() && imageUrls.length === 0) || !user || !chatId || isSendingMessage) return;

    // Check if user has credits available for @lean mentions in team/group channels
    if ((isProjectChannel || isTeamChannel) && messageContent.includes('@lean') && !hasCredits) {
      const limitText = creditsLimit !== null ? `${creditsLimit} credits` : 'credits';
      toast({
        title: "AI Credits Exhausted",
        description: `You've used all your daily AI credits (${limitText}/day). Credits reset daily. Upgrade to Pro for unlimited credits.`,
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
    const citedContext = buildCitedContext({
      selectedProjects,
      selectedTasks,
      selectedDocs,
      selectedTextPosition,
      contextType,
      contextRef,
      includeImplicitDoc: true,
    });

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
        clearSelectedDocs();
        if (selectedTextPosition) {
          clearSelectedText();
        }
      }

      setIsSendingMessage(false);

      // Check if lean is mentioned and generate AI response for project channels (credit-based)
      if (isProjectChannel && selectedProjectId && isLeanMentioned(messageContent)) {
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
          ).then(async (aiResponse) => {
            // Increment AI usage credit (1 credit per response)
            try {
              await subscriptionService.incrementAiUsage();
            } catch (error: any) {
              console.error('Failed to increment AI usage:', error);
              // If limit reached, show error but don't block the response
              if (error.message?.includes('limit reached')) {
                toast({
                  title: "AI Usage Limit Reached",
                  description: error.message || "You've reached your daily AI usage limit.",
                  variant: "destructive",
                });
              }
            }
            
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
            }).catch((error) => {
              console.error('Failed to save AI response:', error);
            });
          }).catch((error) => {
            console.error('Failed to generate AI response:', error);
            toast({
              title: "AI Response Failed",
              description: error.message || "Failed to generate AI response. Please try again.",
              variant: "destructive",
            });
          });
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      toast({
        title: "Failed to send message",
        description: "Please try again.",
        variant: "destructive",
      });
      setIsSendingMessage(false);
    }
  }, [user, chatId, isSendingMessage, isProjectChannel, isTeamChannel, selectedProjectId, selectedTeamId, selectedMember, selectedImages, imagePreviewUrls, selectedProjects, selectedTasks, selectedDocs, currentUserDisplayInfo, hasCredits, creditsLimit, toast, clearSelectedProjects, clearSelectedTasks, clearSelectedDocs, isLeanMentioned, extractQueryFromMessage, generateChannelAIResponse, selectedProject]);

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
    
    // Add lean (AI assistant) - available to all users (credit-based)
    mentionable.push({ id: "lean", name: "lean", role: "", avatar: "/logo.png" });
    
    // Add channel-specific members
    if (isProjectChannel && selectedProject) {
      // Add project members
      selectedProject.members?.forEach(member => {
        const memberEmail = (member.id || member.email)?.toLowerCase();
        const userEntry = memberEmail ? userMap.get(memberEmail) : null;
        if (userEntry) {
          const name = userEntry.displayName;
          const avatar = userEntry.initials;
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
  }, [isProjectChannel, isTeamChannel, isDM, selectedProject, selectedTeam, allDomainUsers, allTeamMembers, selectedMember]);

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
    const userEntry = userMap.get(userId.toLowerCase());
    if (userEntry) {
      return {
        name: userEntry.displayName,
        initials: userEntry.initials,
      };
    }
    return { name: "Unknown", initials: "U" };
  }, [userMap]);

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
    // For ChannelMessage: check memberName (case-insensitive), userId, or role
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

  if (!chatId) return null;

  // Don't show chat if member is not found (for DMs) - return null to not render anything
  if (!isProjectChannel && !isTeamChannel && !currentMember) {
    return null;
  }

  // At this point, currentMember is guaranteed to be non-null for DMs (we returned early if null)
  // For project/team channels, currentMember is always set
  const member = currentMember!;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[600px] p-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className={cn(
                "text-primary-foreground",
                (isProjectChannel || isTeamChannel) 
                  ? "bg-primary/10" 
                  : getAvatarColor(member.id?.toLowerCase())
              )}>
                {isProjectChannel ? (
                  <Hash className="h-4 w-4 text-primary" />
                ) : isTeamChannel ? (
                  <Users className="h-4 w-4 text-primary" />
                ) : (
                  <span className="text-xs">{member.avatar}</span>
                )}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <h3 className="font-semibold text-sm truncate">{member.name}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {isProjectChannel ? "Project Channel" : isTeamChannel ? "Team Channel" : "Direct Message"}
              </p>
            </div>
          </div>
          <VoiceCallButton
            chatId={chatId}
            otherUserEmail={selectedMember.includes('@') ? selectedMember : allTeamMembers.find(m => m.id === selectedMember)?.email || ''}
            otherUserName={member.name}
            otherUserAvatar={member.avatar}
            isGroupCall={isProjectChannel || isTeamChannel}
            groupMembers={isProjectChannel ? (selectedProject?.members?.map(m => ({ email: m.email || m.id || '', name: m.name })) || []) : (isTeamChannel ? allTeamMembers.map(m => ({ email: m.email, name: m.name })) : [])}
          />
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0">
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

        {/* Input Area - Optimized single container */}
        <div className="flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
          />
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
            selectedDocs={selectedDocs}
            selectedText={selectedTextPosition ? {
              id: `selected-text-${selectedTextPosition.docId}-${selectedTextPosition.startOffset}`,
              // Show preview in UI (truncate to 100 chars), full text is saved via selectedTexts.
              text: selectedTextPosition.text
                ? (selectedTextPosition.text.length > 100
                    ? selectedTextPosition.text.substring(0, 100) + '...'
                    : selectedTextPosition.text)
                : "Text selection from document",
              docId: selectedTextPosition.docId,
            } : null}
            onRemoveSelectedText={clearSelectedText}
            implicitContext={contextRef && contextType ? `Current ${contextType}: ${contextRef.title} (ID: ${contextRef.id})` : undefined}
            onRemoveImplicitContext={clearContext}
            onRemoveProject={toggleProject}
            onRemoveTask={toggleTask}
            onRemoveDoc={toggleDoc}
            placeholder="Type your message..."
            showMentions={isProjectChannel || isTeamChannel}
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
      </SheetContent>
    </Sheet>
  );
}
