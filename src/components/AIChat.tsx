import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { X, Trash2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import { messagesService, imageUploadService, subscriptionService, type ChatMessage } from "@/services/api";
import { getAIAssistantChatId } from "@/hooks/useChatId";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { useOrg } from "@/contexts/OrgContext";
import { usePageContext } from "@/contexts/PageContext";
import { useSelectedTextContext } from "@/contexts/SelectedTextContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { buildCitedContext } from "@/lib/citedContext";
import { useAIChat } from "@/hooks/useAIChat";
import { useIsMobile } from "@/hooks/use-mobile";
import { getUserDisplayName, getUserInitials } from "@/lib/utils";
import { trackAIChat, trackError, trackMessageLike, trackImageUpload, trackImageRemove, trackContextRemove, trackDraftResponse, trackFirstFeatureUse } from "@/lib/analytics";
import { getUserSignupDate, getDaysSinceSignup } from "@/lib/first-time-tracker";
import type { Message, LikedByUser } from "@/components/chat/types";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { StreamingMessage } from "@/components/chat/StreamingMessage";

export function AIChat() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { hasCredits, creditsRemaining, creditsLimit } = useSubscription();
  const { toast } = useToast();
  const { data: allDomainUsers = [] } = useUsers();
  const userMap = useUserMap();
  const { isOpen, setIsOpen, chatId } = useAIChat();
  const isMobile = useIsMobile();
  const location = useLocation();
  const { selectedProjects, toggleProject, clearSelection: clearSelectedProjects } = useSelectedProjects();
  const { selectedTasks, toggleTask, clearSelection: clearSelectedTasks } = useSelectedTasks();
  const { selectedDocs, toggleDoc, clearSelection: clearSelectedDocs } = useSelectedDocs();
  const { contextType, contextRef, clearContext } = usePageContext();
  const { selectedTextPosition, clearSelectedText } = useSelectedTextContext();

  // State declarations - must come before hooks that use them
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);

  // Streaming chat hook - call this FIRST before using streamingState in effects
  const { streamingState, startStreaming, stopStreaming, resetState: resetStreamingState } = useStreamingChat({
    onComplete: async (content, dataSources) => {
      console.log('✨ Streaming complete from hook', { 
        contentLength: content?.length,
        contentPreview: content?.substring(0, 100),
      });
      
      // Signal that streaming is done - the useEffect will handle saving
      setStreamingComplete(true);
    },
    onError: (error) => {
      console.error('Streaming error:', error);
      toast({
        title: "Streaming Error",
        description: error,
        variant: "destructive",
      });
      setIsLoading(false);
      setIsSendingMessage(false);
    },
  });

  // Additional state declarations
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [pendingLikeOperations, setPendingLikeOperations] = useState<Set<string>>(new Set());
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Message[]>([]); // Ref to track latest messages for building message window
  const previousPathnameRef = useRef<string>(location.pathname);

  // Get current user display info
  const currentUserProfile = useMemo(() => {
    if (!user?.email) return null;
    const userEntry = userMap.get(user.email.toLowerCase());
    return userEntry ? {
      email: userEntry.email,
      firstName: userEntry.firstName,
      lastName: userEntry.lastName,
    } : null;
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

  const saveCachedMessages = useCallback((chatId: string, messages: ChatMessage[]) => {
    const cacheKey = getCacheKey(chatId);
    if (!cacheKey) return;

    const lastSync = Date.now();
    try {
      const toCache = {
        messages: messages.map(msg => ({
          ...msg,
          timestamp: (() => {
            if (msg.timestamp instanceof Date) {
              return isNaN(msg.timestamp.getTime()) ? new Date().toISOString() : msg.timestamp.toISOString();
            } else if (msg.timestamp) {
              const parsed = new Date(msg.timestamp);
              return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
            }
            return new Date().toISOString();
          })(),
          citedContext: msg.citedContext || null,
        })),
        lastSync,
      };
      localStorage.setItem(cacheKey, JSON.stringify(toCache));
    } catch (error) {
      console.error('Failed to save cached messages:', error);
    }
  }, [getCacheKey]);

  // useEffect to save streaming responses to Firestore (after saveCachedMessages is defined)
  useEffect(() => {
    if (!streamingComplete || streamingState.isStreaming) {
      return;
    }

    console.log('📤 useEffect: Streaming complete detected, saving message...');
    
    const saveMessage = async () => {
      if (!chatId || !streamingState.content) {
        console.warn('⚠️ Cannot save: missing chatId or content', { chatId, hasContent: !!streamingState.content });
        setStreamingComplete(false);
        setIsLoading(false);
        setIsSendingMessage(false);
        return;
      }

      try {
        console.log('📝 Saving assistant message to Firestore...');
        const savedAssistantMessage = await messagesService.create({
          chatId: chatId,
          role: 'assistant',
          content: streamingState.content,
        });
        
        console.log('✅ Message saved successfully:', {
          messageId: savedAssistantMessage.id,
          contentLength: savedAssistantMessage.content?.length,
        });
        
        // Add to messages list
        setMessages((prev) => {
          const updated = [...prev, {
            id: savedAssistantMessage.id,
            role: "assistant",
            content: streamingState.content,
            timestamp: savedAssistantMessage.timestamp instanceof Date ? savedAssistantMessage.timestamp : new Date(savedAssistantMessage.timestamp),
            likes: [],
          }];
          console.log('✅ Messages updated in state');
          return updated;
        });
        
        // Save to cache
        saveCachedMessages(chatId, [...messagesRef.current, {
          id: savedAssistantMessage.id,
          chatId: chatId,
          role: 'assistant',
          content: streamingState.content,
          timestamp: savedAssistantMessage.timestamp,
          userId: user?.email?.toLowerCase() || '',
          likes: [],
        }]);
      } catch (error) {
        console.error('❌ Failed to save message:', error);
        toast({
          title: "Save Failed",
          description: error instanceof Error ? error.message : 'Failed to save message',
          variant: "destructive",
        });
      } finally {
        setStreamingComplete(false);
        setIsLoading(false);
        setIsSendingMessage(false);
      }
    };

    saveMessage();
  }, [streamingComplete, streamingState.isStreaming, streamingState.content, chatId, user?.email, saveCachedMessages, toast, messagesRef]);

  // Load messages when chat opens
  useEffect(() => {
    if (!isOpen || !chatId || !user?.email) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      
      // Try to load from cache first
      const cached = loadCachedMessages(chatId);
      if (cached && cached.messages.length > 0) {
        if (import.meta.env.DEV) {
          console.log('💾 [AIChat] Loading from cache', {
            chatId,
            messageCount: cached.messages.length,
            firstMessage: cached.messages[0] ? {
              id: cached.messages[0].id,
              role: cached.messages[0].role,
              content: cached.messages[0].content?.substring(0, 50),
            } : null,
            lastMessage: cached.messages[cached.messages.length - 1] ? {
              id: cached.messages[cached.messages.length - 1].id,
              role: cached.messages[cached.messages.length - 1].role,
              content: cached.messages[cached.messages.length - 1].content?.substring(0, 50),
            } : null,
          });
        }
        
        const cachedMsgs: Message[] = cached.messages.map(msg => ({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          userId: msg.userId,
          imageUrls: msg.imageUrls,
          likes: Array.isArray(msg.likes) ? msg.likes : [],
          citedContext: msg.citedContext,
        }));
        
        if (cachedMsgs.length === 0) {
          setMessages([{
            id: "greeting",
            role: "assistant",
            content: "Hi! I'm Lean. I can answer any questions and help you take actions across your workspace. What would you like to know or do?",
            timestamp: new Date(),
          }]);
        } else {
          if (import.meta.env.DEV) {
            console.log('💾 [AIChat] Setting messages from cache', {
              count: cachedMsgs.length,
              isLoadingMessages,
              currentMessagesLength: messages.length,
            });
          }
          setMessages(cachedMsgs);
        }
        setIsLoadingMessages(false);
      }

      try {
        const firestoreMessages = await messagesService.getByChatId(chatId);
        
        const regularMsgs: Message[] = firestoreMessages.map(msg => ({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          userId: msg.userId,
          imageUrls: msg.imageUrls,
          likes: Array.isArray(msg.likes) ? msg.likes : [],
          citedContext: msg.citedContext,
        }));
        
        if (regularMsgs.length === 0) {
          setMessages([{
            id: "greeting",
            role: "assistant",
            content: "Hi! I'm Lean. I can answer any questions and help you take actions across your workspace. What would you like to know or do?",
            timestamp: new Date(),
          }]);
        } else {
          setMessages(regularMsgs);
          saveCachedMessages(chatId, firestoreMessages);
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
        if (messages.length === 0) {
          setMessages([{
            id: "greeting",
            role: "assistant",
            content: "Hi! I'm Lean. I can answer any questions and help you take actions across your workspace. What would you like to know or do?",
            timestamp: new Date(),
          }]);
        }
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();

    // Subscribe to real-time updates
    const unsubscribe = messagesService.subscribeViaFirestore(chatId, (newMessages) => {
      const regularMsgs: Message[] = newMessages.map(msg => ({
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
      saveCachedMessages(chatId, newMessages);
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, chatId, user?.email, loadCachedMessages, saveCachedMessages]);

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Generate AI response - takes current message and chatId
  const generateResponse = useCallback(async (
    message: string,  // Just the current message
    chatId: string,
    citedContext?: { projects?: any[]; tasks?: any[]; docs?: any[]; selectedTexts?: Array<{ id: string; text: string; docId?: string }>; selectedTextPosition?: { docId: string; startOffset: number; endOffset: number; text?: string } }  // citedContext with all context merged into same structures
  ): Promise<string> => {
    // Debug: Log what we received (dev only)
    if (import.meta.env.DEV) {
      console.log('🔍 [AIChat] generateResponse called with:', {
        hasCitedContext: !!citedContext,
        citedContext,
        hasSelectedTextPosition: !!(citedContext && (citedContext as any).selectedTextPosition),
        selectedTextPreview: citedContext && (citedContext as any).selectedTexts?.[0]?.text?.substring(0, 50),
      });
    }
    
    // Use chatId as sessionId for conversation continuity
    // This ensures the AI service maintains context within the conversation
    const response = await messagesService.generateResponse({
      chatId,
      message,
      sessionId: chatId, // Conversation-scoped session ID
      citedContext,
    });

    return response.response || response.content;
  }, []); // No dependencies - pure function

  // Handle sending messages
  const handleSend = useCallback(async (messageContent: string, imageUrls: string[] = []) => {
    // Debug: Log at the very start (dev only)
    if (import.meta.env.DEV) {
      console.log('🚀 [AIChat] handleSend called:', {
        messageContent: messageContent.substring(0, 50),
        hasSelectedTextPosition: !!selectedTextPosition,
        selectedTextPosition,
        selectedProjects: selectedProjects.length,
        selectedTasks: selectedTasks.length,
        selectedDocs: selectedDocs.length,
      });
    }
    
    if ((!messageContent.trim() && imageUrls.length === 0) || !user || !chatId || isSendingMessage) {
      if (import.meta.env.DEV) {
        console.log('⚠️ [AIChat] handleSend early return');
      }
      return;
    }

    // Check if user has credits available
    if (!hasCredits) {
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
        // Track successful image upload
        trackImageUpload(chatId, selectedImages.length, true);
      } catch (error: any) {
        console.error('Failed to upload images:', error);
        // Track failed image upload
        trackImageUpload(chatId, selectedImages.length, false);
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
    
    // Debug: Log selectedTextPosition when message is being sent (dev only)
    if (import.meta.env.DEV) {
      console.log('📝 [AIChat] selectedTextPosition at message send:', {
        selectedTextPosition,
        hasSelectedTextPosition: !!selectedTextPosition,
        hasText: !!selectedTextPosition?.text,
        textLength: selectedTextPosition?.text?.length,
        textPreview: selectedTextPosition?.text?.substring(0, 100),
      });
    }
    
    
    // Filter out items that are already in implicit context to avoid duplicates
    // Keep current doc in cited context so selected text + doc are not treated as duplicates.
    let filteredProjects = selectedProjects;
    let filteredTasks = selectedTasks;
    let filteredDocs = selectedDocs;
    
    if (contextRef && contextType) {
      if (contextType === 'project') {
        filteredProjects = selectedProjects.filter(p => p.id !== contextRef.id);
      } else if (contextType === 'task') {
        filteredTasks = selectedTasks.filter(t => t.id !== contextRef.id);
      }
    }

    const citedContext = buildCitedContext({
      selectedProjects: filteredProjects,
      selectedTasks: filteredTasks,
      selectedDocs: filteredDocs,
      selectedTextPosition,
      contextType,
      contextRef,
      includeImplicitDoc: true,
    });

    // Debug logging for contexts (dev only)
    if (import.meta.env.DEV && citedContext) {
      console.log('📋 [AIChat] Building citedContext:', {
        projects: citedContext.projects?.length || 0,
        tasks: citedContext.tasks?.length || 0,
        docs: citedContext.docs?.length || 0,
        selectedTexts: citedContext.selectedTexts?.length || 0,
        hasSelectedText: !!citedContext.selectedTexts?.length,
      });
    }

    // Create user message
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: messageContent,
      timestamp: new Date(),
      userId: user.email?.toLowerCase(),
      imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
      citedContext,
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const savedUserMessage = await messagesService.create({
        chatId: chatId,
        role: 'user',
        content: messageContent,
        citedContext,
        imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
      });
      
      let updatedMessages: Message[] = [];
      setMessages((prev) => {
        updatedMessages = prev.map(msg => 
          msg.id === userMessage.id 
            ? {
                ...msg,
                id: savedUserMessage.id,
                timestamp: savedUserMessage.timestamp instanceof Date ? savedUserMessage.timestamp : new Date(savedUserMessage.timestamp),
                userId: savedUserMessage.userId || user.email?.toLowerCase(),
                imageUrls: savedUserMessage.imageUrls || finalImageUrls.length > 0 ? finalImageUrls : undefined,
                citedContext: citedContext || savedUserMessage.citedContext,
              }
            : msg
        );
        // Update ref immediately to ensure we have latest messages
        messagesRef.current = updatedMessages;
        saveCachedMessages(chatId, updatedMessages.map(msg => ({
          id: msg.id,
          chatId: chatId,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          userId: msg.userId,
          imageUrls: msg.imageUrls,
          citedContext: msg.citedContext,
        })));
        return updatedMessages;
      });

      // Generate AI response using streaming
      setIsLoading(true);
      
      // Capture selectedTextPosition early to avoid any timing issues
      const currentSelectedTextPosition = selectedTextPosition;
      const hadSelections = selectedProjects.length > 0 || selectedTasks.length > 0 || selectedDocs.length > 0 || !!currentSelectedTextPosition;

      try {
        // Filter out items that are already in implicit context to avoid duplicates
        let filteredProjectsForAPI = selectedProjects;
        let filteredTasksForAPI = selectedTasks;
        let filteredDocsForAPI = selectedDocs;
        
        if (contextRef && contextType) {
          if (contextType === 'project') {
            filteredProjectsForAPI = selectedProjects.filter(p => p.id !== contextRef.id);
          } else if (contextType === 'task') {
            filteredTasksForAPI = selectedTasks.filter(t => t.id !== contextRef.id);
          }
        }

        const citedContextForAPI = buildCitedContext({
          selectedProjects: filteredProjectsForAPI,
          selectedTasks: filteredTasksForAPI,
          selectedDocs: filteredDocsForAPI,
          selectedTextPosition: currentSelectedTextPosition,
          contextType,
          contextRef,
          includeImplicitDoc: true,
        });
        
        if (import.meta.env.DEV) {
          console.log('🌊 [AIChat] Starting streaming response:', {
            chatId,
            messageLength: messageContent.length,
            citedContext: citedContextForAPI,
          });
        }

        // Reset streaming state before starting
        resetStreamingState();

        // Start streaming
        await startStreaming({
          chatId,
          message: messageContent,
          citedContext: citedContextForAPI,
          orgId: currentOrg?.id,
          orgSlug: currentOrg?.slug,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
        });
        
        // Increment AI usage credit (1 credit per response)
        try {
          await subscriptionService.incrementAiUsage();
        } catch (error: any) {
          console.error('Failed to increment AI usage:', error);
          if (error.message?.includes('limit reached')) {
            toast({
              title: "AI Usage Limit Reached",
              description: error.message || "You've reached your daily AI usage limit.",
              variant: "destructive",
            });
          }
        }
        
        // Clear selections after streaming completes
        if (hadSelections) {
          clearSelectedProjects();
          clearSelectedTasks();
          clearSelectedDocs();
          if (selectedTextPosition) {
            clearSelectedText();
          }
        }
      } catch (error) {
        console.error('Failed to start streaming:', error);
        
        trackError(
          'ai_chat_error',
          error instanceof Error ? error.message : 'Unknown error',
          {
            chat_id: chatId,
            message_length: messageContent.length,
          }
        );
        
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error 
            ? `I apologize, but I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`
            : 'I apologize, but I encountered an error while processing your request. Please try again.',
          timestamp: new Date(),
        };
        
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
        setIsSendingMessage(false);
      }
    } catch (error) {
      console.error('Failed to save user message:', error);
      setMessages((prev) => prev.filter(msg => msg.id !== userMessage.id));
      setIsSendingMessage(false);
    }
  }, [user, chatId, isSendingMessage, selectedImages, imagePreviewUrls, selectedProjects, selectedTasks, selectedDocs, selectedTextPosition, currentUserDisplayInfo, hasCredits, creditsLimit, toast, clearSelectedProjects, clearSelectedTasks, clearSelectedDocs, startStreaming, resetStreamingState, saveCachedMessages, contextType, contextRef, clearSelectedText, currentOrg]);

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
    
    URL.revokeObjectURL(imagePreviewUrls[index]);
    
    setSelectedImages(newImages);
    setImagePreviewUrls(newPreviewUrls);
    
    // Track image removal
    if (chatId) {
      trackImageRemove(chatId);
    }
  }, [selectedImages, imagePreviewUrls, chatId]);

  // Handle like toggle
  const handleToggleLike = useCallback(async (messageId: string, currentLikes: string[] = []) => {
    if (!user?.email) return;
    
    const userEmailLower = user.email.toLowerCase();
    const isLiked = currentLikes.includes(userEmailLower);
    
    // Find the message to get its role
    const message = messages.find(msg => msg.id === messageId);
    const messageRole = message?.role || 'assistant';
    
    setPendingLikeOperations((prev) => new Set(prev).add(messageId));
    
    const optimisticLikes = isLiked
      ? currentLikes.filter((email: string) => email !== userEmailLower)
      : [...currentLikes, userEmailLower];
    
    setMessages((prev) => 
      prev.map((msg) => 
        msg.id === messageId 
          ? { ...msg, likes: optimisticLikes }
          : msg
      )
    );
    
    // Track like/unlike action
    trackMessageLike(messageId, isLiked ? 'unlike' : 'like', messageRole as 'user' | 'assistant');
    
    try {
      const result = await messagesService.toggleLike(messageId);
      
      setPendingLikeOperations((prev) => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
      
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId 
            ? { ...msg, likes: result.likes }
            : msg
        )
      );
    } catch (error) {
      console.error('Failed to toggle like:', error);
      
      setPendingLikeOperations((prev) => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
      
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === messageId 
            ? { ...msg, likes: currentLikes }
            : msg
        )
      );
    }
  }, [user?.email, messages]);

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

  const getMessageDisplayInfo = useCallback((message: Message) => {
    const isLean = message.role === "assistant";
    const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
    
    let displayName: string;
    let displayInitials: string;
    
    if (isSent) {
      displayName = "You";
      displayInitials = currentUserDisplayInfo.initials;
    } else if (isLean) {
      displayName = "lean";
      displayInitials = "L";
    } else {
      const userInfo = message.userId ? getUserInfo(message.userId) : null;
      if (userInfo) {
        displayName = userInfo.name;
        displayInitials = userInfo.initials;
      } else {
        displayName = "Unknown";
        displayInitials = "U";
      }
    }
    
    return { isSent, isLean, displayName, displayInitials };
  }, [user?.email, currentUserDisplayInfo, getUserInfo]);

  // Handle clear chat history
  const handleClearHistory = useCallback(async () => {
    if (!chatId || !user?.email || isClearingHistory) return;

    // Confirm with user
    if (!confirm('Are you sure you want to clear all chat history? This action cannot be undone.')) {
      return;
    }

    setIsClearingHistory(true);
    try {
      // Clear messages from backend
      await messagesService.clearChatHistory(chatId);
      
      // Clear local cache
      const cacheKey = getCacheKey(chatId);
      if (cacheKey) {
        localStorage.removeItem(cacheKey);
      }
      
      // Reset messages state to show greeting
      setMessages([{
        id: "greeting",
        role: "assistant",
        content: "Hi! I'm Lean. I can answer any questions and help you take actions across your workspace. What would you like to know or do?",
        timestamp: new Date(),
      }]);
      
      toast({
        title: "Chat history cleared",
        description: "All messages have been removed. The conversation summary has also been reset.",
        variant: "default",
      });
    } catch (error) {
      console.error('Failed to clear chat history:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to clear chat history. Please try again.',
        variant: "destructive",
      });
    } finally {
      setIsClearingHistory(false);
    }
  }, [chatId, user?.email, isClearingHistory, getCacheKey, toast]);

  // Listen for toggle chat event
  useEffect(() => {
    const handleToggleChat = () => {
      setIsOpen(prev => {
        const newIsOpen = !prev;
        if (newIsOpen) {
          trackAIChat('open', { source: 'header_button' });
          // Track first-time AI chat usage
          (async () => {
            const signupDate = await getUserSignupDate();
            const daysSinceSignup = getDaysSinceSignup(signupDate);
            trackFirstFeatureUse('ai_chat', daysSinceSignup);
          })();
        } else {
          trackAIChat('close', { source: 'header_button' });
        }
        return newIsOpen;
      });
    };

    const handleOpenChat = () => {
      setIsOpen(true);
      // Tracking is already done in the sidebar component
    };
    
    // Use handleOpenChat for 'openAIChat' event so it doesn't close if already open
    window.addEventListener('openAIChat', handleOpenChat as EventListener);
    window.addEventListener('toggleChat', handleToggleChat as EventListener); // Keep for backward compatibility
    window.addEventListener('openChatWithAI', handleOpenChat as EventListener);
    
    return () => {
      window.removeEventListener('openAIChat', handleOpenChat as EventListener);
      window.removeEventListener('toggleChat', handleToggleChat as EventListener);
      window.removeEventListener('openChatWithAI', handleOpenChat as EventListener);
    };
  }, [isOpen, toast]);

  // Close AI chat when navigating to a different page
  useEffect(() => {
    // Only close if pathname actually changed (not on initial mount)
    if (isOpen && location.pathname !== previousPathnameRef.current) {
      setIsOpen(false);
      trackAIChat('close', { source: 'navigation' });
    }
    previousPathnameRef.current = location.pathname;
  }, [location.pathname, isOpen, setIsOpen]);

  // Lock body scroll on mobile when chat is open
  useEffect(() => {
    if (isOpen && isMobile) {
      // Save the current overflow style
      const originalOverflow = document.body.style.overflow;
      const originalPosition = document.body.style.position;
      const originalWidth = document.body.style.width;
      
      // Lock body scroll
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      
      return () => {
        // Restore original styles
        document.body.style.overflow = originalOverflow;
        document.body.style.position = originalPosition;
        document.body.style.width = originalWidth;
      };
    }
  }, [isOpen, isMobile]);

  if (!chatId) return null;

  if (!isOpen) return null;

  return (
    <div className={cn(
      "fixed top-16 h-[calc(100dvh-4rem)] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]",
      // Mobile: overlay entire screen under header
      "left-0 right-0 w-full z-[60]",
      // Desktop: right side panel - higher z-index than sticky toolbar (z-50)
      "sm:right-0 sm:left-auto sm:w-96 sm:z-[60] sm:pb-0",
      // Modern gradient background with subtle border
      "bg-gradient-to-br from-purple-50 via-indigo-50/30 to-purple-50",
      "border-l border-purple-200/60",
      "shadow-2xl shadow-purple-500/10",
      "backdrop-blur-sm"
    )}>
      {/* Header gradient accent */}
      <div className="h-1 bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-500 flex-shrink-0" />
      
      {/* Header with clear button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-purple-200/60 bg-white/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
            <AvatarFallback className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-semibold text-xs">
              L
            </AvatarFallback>
          </Avatar>
          <h2 className="text-sm font-semibold text-gray-900">Lean</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearHistory}
          disabled={isClearingHistory || messages.length <= 1}
          className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Clear chat history"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-6 space-y-6">
          {isLoadingMessages && (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-2">
                  <div className="h-2.5 w-2.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2.5 w-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2.5 w-2.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <p className="text-sm text-muted-foreground">Loading conversation...</p>
              </div>
            </div>
          )}
          
          {!isLoadingMessages && (
            <ChatMessageList
              messages={messages}
              visibleCount={visibleMessageCount}
              onLoadMore={(increment) => setVisibleMessageCount(prev => prev + increment)}
              currentUserEmail={user?.email?.toLowerCase() || ''}
              onToggleLike={handleToggleLike}
              getLikedByUsers={getLikedByUsers}
              getUserDisplayInfo={getMessageDisplayInfo}
              theme="ai-chat"
              emptyState={
                <div className="flex flex-col items-center justify-center h-full text-center py-12 px-4">
                  <div className="mb-6">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                      <AvatarFallback className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-semibold">
                        L
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <h3 className="text-xl font-semibold mb-3 text-gray-900">
                    Hi! I'm Lean
                  </h3>
                  <p className="text-sm text-gray-700 max-w-md leading-relaxed mb-6">
                    I can answer any questions and help you take actions across your workspace. Ask me anything!
                  </p>
                  
                  {/* Examples Section */}
                  <div className="w-full max-w-md space-y-3 mb-6">
                    <div className="text-left">
                      <p className="text-xs font-medium text-gray-500 mb-2 px-1">Try asking me:</p>
                      <div className="space-y-2">
                        <div className="bg-white/80 backdrop-blur-sm border border-purple-100 rounded-lg p-3 text-left hover:border-purple-200 transition-colors">
                          <p className="text-xs text-gray-600 font-medium mb-1">💬 Questions</p>
                          <p className="text-xs text-gray-500">"What's the status of my Q4 projects?"</p>
                        </div>
                        <div className="bg-white/80 backdrop-blur-sm border border-indigo-100 rounded-lg p-3 text-left hover:border-indigo-200 transition-colors">
                          <p className="text-xs text-gray-600 font-medium mb-1">⚡ Actions</p>
                          <p className="text-xs text-gray-500">"Create a task for reviewing the budget proposal"</p>
                        </div>
                        <div className="bg-white/80 backdrop-blur-sm border border-purple-100 rounded-lg p-3 text-left hover:border-purple-200 transition-colors">
                          <p className="text-xs text-gray-600 font-medium mb-1">📊 Analysis</p>
                          <p className="text-xs text-gray-500">"Show me overdue tasks across all projects"</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Capabilities Tags */}
                  <div className="flex flex-wrap gap-2 justify-center">
                    <span className="text-xs px-3 py-1.5 bg-purple-100/50 text-purple-700 rounded-full border border-purple-200/50">
                      💡 Answer questions
                    </span>
                    <span className="text-xs px-3 py-1.5 bg-indigo-100/50 text-indigo-700 rounded-full border border-indigo-200/50">
                      ⚡ Take actions
                    </span>
                    <span className="text-xs px-3 py-1.5 bg-purple-100/50 text-purple-700 rounded-full border border-purple-200/50">
                      📊 Analyze data
                    </span>
                  </div>
                </div>
              }
              className="flex-1 min-h-0"
              hideContext={false}
            />
          )}
          {/* Show streaming message when streaming */}
          {streamingState.isStreaming && (
            <StreamingMessage streamingState={streamingState} theme="ai-chat" />
          )}
          {/* Show loading animation only when loading but not streaming */}
          {isLoading && !streamingState.isStreaming && (
            <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
              <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-purple-200/50">
                <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-semibold">
                  L
                </AvatarFallback>
              </Avatar>
              <div className="bg-white/80 backdrop-blur-sm border border-purple-200/60 rounded-2xl rounded-tl-sm px-5 py-3 shadow-sm">
                <div className="flex gap-1.5">
                  <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area - Single optimized container */}
      <div className="flex-shrink-0">
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
          disabled={isSendingMessage || !hasCredits}
          isLoading={isSendingMessage}
          uploadingImages={uploadingImages}
          imagePreviewUrls={imagePreviewUrls}
          onImageSelect={handleImageSelect}
          onImageRemove={handleImageRemove}
          selectedProjects={selectedProjects}
          selectedTasks={selectedTasks}
          selectedDocs={selectedDocs}
          onRemoveImplicitContext={() => {
            trackContextRemove('implicit-context', contextRef?.id || '');
            clearContext();
          }}
          selectedText={selectedTextPosition ? {
            id: `selected-text-${selectedTextPosition.docId}-${selectedTextPosition.startOffset}`,
            // Show preview in UI (truncate to 100 chars), but full text is sent to API via selectedTextPosition
            text: selectedTextPosition.text 
              ? (selectedTextPosition.text.length > 100 
                  ? selectedTextPosition.text.substring(0, 100) + '...' 
                  : selectedTextPosition.text)
              : "Text selection from document",
            docId: selectedTextPosition.docId,
          } : null}
          onRemoveSelectedText={() => {
            trackContextRemove('selected-text', selectedTextPosition?.docId || '');
            clearSelectedText();
          }}
          onRemoveProject={(project) => {
            trackContextRemove('project', project.id);
            toggleProject(project);
          }}
          onRemoveTask={(task) => {
            trackContextRemove('task', task.id);
            toggleTask(task);
          }}
          onRemoveDoc={(doc) => {
            trackContextRemove('doc', doc.id);
            toggleDoc(doc);
          }}
          placeholder="Ask lean anything..."
          hideContext={false}
          theme="purple"
        />
      </div>
    </div>
  );
}
