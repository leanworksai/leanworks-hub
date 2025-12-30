import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, Bot } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUsers } from "@/hooks/useUsers";
import { messagesService, imageUploadService, type ChatMessage } from "@/services/api";
import { getAIAssistantChatId } from "@/hooks/useChatId";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { useSelectedDocs } from "@/contexts/SelectedDocsContext";
import { useOrg } from "@/contexts/OrgContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { useAIChat } from "@/hooks/useAIChat";
import { useIsMobile } from "@/hooks/use-mobile";
import { getUserDisplayName, getUserInitials } from "@/lib/utils";
import { trackAIChat, trackError } from "@/lib/analytics";
import type { Message, LikedByUser } from "@/components/chat/types";

export function AIChat() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { isFreePlan } = useSubscription();
  const { toast } = useToast();
  const { data: allDomainUsers = [] } = useUsers();
  const { isOpen, setIsOpen, chatId } = useAIChat();
  const isMobile = useIsMobile();
  const { selectedProjects, toggleProject, clearSelection: clearSelectedProjects } = useSelectedProjects();
  const { selectedTasks, toggleTask, clearSelection: clearSelectedTasks } = useSelectedTasks();
  const { selectedTeams, toggleTeam, clearSelection: clearSelectedTeams } = useSelectedTeams();
  const { selectedDocs, toggleDoc, clearSelection: clearSelectedDocs } = useSelectedDocs();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(50);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [pendingLikeOperations, setPendingLikeOperations] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
          citedContext: msg.citedContext || null,
        })),
        lastSync,
      };
      localStorage.setItem(cacheKey, JSON.stringify(toCache));
    } catch (error) {
      console.error('Failed to save cached messages:', error);
    }
  }, [getCacheKey]);

  // Load messages when chat opens
  useEffect(() => {
    if (!isOpen || !chatId || !user?.email) return;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      
      // Try to load from cache first
      const cached = loadCachedMessages(chatId);
      if (cached && cached.messages.length > 0) {
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
            content: "Hello! I'm lean. How can I help you today?",
            timestamp: new Date(),
          }]);
        } else {
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
            content: "Hello! I'm lean. How can I help you today?",
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
            content: "Hello! I'm lean. How can I help you today?",
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

  // Generate AI response
  const generateResponse = useCallback(async (query: string, chatId: string): Promise<string> => {
    const messageWindow = messages.slice(-10).map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp.toISOString(),
      citedContext: msg.citedContext,
      imageUrls: msg.imageUrls,
    }));

    const response = await messagesService.generateResponse({
      messageWindow,
      chatId,
    });

    return response.response || response.content;
  }, [messages]);

  // Handle sending messages
  const handleSend = useCallback(async (messageContent: string, imageUrls: string[] = []) => {
    if ((!messageContent.trim() && imageUrls.length === 0) || !user || !chatId || isSendingMessage) return;

    if (isFreePlan) {
      toast({
        title: "Upgrade Required",
        description: "Chat with Lean is available on Standard and Pro plans. Upgrade to unlock this feature.",
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
        citedContext: citedContext,
        imageUrls: finalImageUrls.length > 0 ? finalImageUrls : undefined,
      });
      
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === userMessage.id 
            ? {
                ...msg,
                id: savedUserMessage.id,
                timestamp: savedUserMessage.timestamp instanceof Date ? savedUserMessage.timestamp : new Date(savedUserMessage.timestamp),
                userId: savedUserMessage.userId || user.email?.toLowerCase(),
                imageUrls: savedUserMessage.imageUrls || finalImageUrls.length > 0 ? finalImageUrls : undefined,
                citedContext: savedUserMessage.citedContext || citedContext,
              }
            : msg
        );
        saveCachedMessages(chatId, updated.map(msg => ({
          id: msg.id,
          chatId: chatId,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          userId: msg.userId,
          imageUrls: msg.imageUrls,
          citedContext: msg.citedContext,
        })));
        return updated;
      });

      // Generate AI response
      setIsLoading(true);
      const hadSelections = selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0 || selectedDocs.length > 0;

      try {
        const response = await generateResponse(messageContent, chatId);
        
        if (hadSelections) {
          clearSelectedProjects();
          clearSelectedTasks();
          clearSelectedTeams();
          clearSelectedDocs();
        }
        
        const assistantMessage: Message = {
          id: `temp-assistant-${Date.now()}`,
          role: "assistant",
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        try {
          const savedAssistantMessage = await messagesService.create({
            chatId: chatId,
            role: 'assistant',
            content: response,
          });
          
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
            saveCachedMessages(chatId, updated.map(msg => ({
              id: msg.id,
              chatId: chatId,
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp,
              userId: msg.userId,
              imageUrls: msg.imageUrls,
              citedContext: msg.citedContext,
            })));
            return updated;
          });
        } catch (error) {
          console.error('Failed to save assistant message:', error);
          setMessages((prev) => prev.filter(msg => msg.id !== assistantMessage.id));
        }
      } catch (error) {
        console.error('Failed to generate response:', error);
        
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
  }, [user, chatId, isSendingMessage, selectedImages, imagePreviewUrls, selectedProjects, selectedTasks, selectedTeams, selectedDocs, currentUserDisplayInfo, isFreePlan, toast, clearSelectedProjects, clearSelectedTasks, clearSelectedTeams, clearSelectedDocs, generateResponse, saveCachedMessages]);

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
  }, [selectedImages, imagePreviewUrls]);

  // Handle like toggle
  const handleToggleLike = useCallback(async (messageId: string, currentLikes: string[] = []) => {
    if (!user?.email) return;
    
    const userEmailLower = user.email.toLowerCase();
    const isLiked = currentLikes.includes(userEmailLower);
    
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

  const getMessageDisplayInfo = useCallback((message: Message) => {
    const isLean = message.role === "assistant";
    const isSent = !isLean && message.userId?.toLowerCase() === user?.email?.toLowerCase();
    
    let displayName: string;
    let displayInitials: string;
    
    if (isSent) {
      displayName = "You";
      displayInitials = "";
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

  // Listen for toggle chat event
  useEffect(() => {
    const handleToggleChat = () => {
      if (isFreePlan) {
        toast({
          title: "Feature unavailable",
          description: "Chat with Lean is available on Standard and Pro plans. Upgrade to unlock this feature.",
          variant: "default",
        });
        return;
      }
      setIsOpen(prev => !prev);
      if (!isOpen) {
        trackAIChat('open', { source: 'header_button' });
      } else {
        trackAIChat('close', { source: 'header_button' });
      }
    };

    const handleOpenChat = () => {
      if (isFreePlan) {
        toast({
          title: "Feature unavailable",
          description: "Chat with Lean is available on Standard and Pro plans. Upgrade to unlock this feature.",
          variant: "default",
        });
        return;
      }
      setIsOpen(true);
      // Tracking is already done in the sidebar component
    };
    
    window.addEventListener('openAIChat', handleToggleChat as EventListener);
    window.addEventListener('toggleChat', handleToggleChat as EventListener); // Keep for backward compatibility
    window.addEventListener('openChatWithAI', handleOpenChat as EventListener);
    
    return () => {
      window.removeEventListener('openAIChat', handleToggleChat as EventListener);
      window.removeEventListener('toggleChat', handleToggleChat as EventListener);
      window.removeEventListener('openChatWithAI', handleOpenChat as EventListener);
    };
  }, [isOpen, isFreePlan, toast]);

  if (!chatId) return null;

  if (!isOpen) return null;

  return (
    <div className={cn(
      "fixed top-16 h-[calc(100vh-4rem)] flex flex-col shadow-lg overflow-hidden",
      // Mobile: overlay entire screen under header
      "left-0 right-0 w-full z-[60]",
      // Desktop: right side panel
      "sm:right-0 sm:left-auto sm:w-96 sm:z-30",
      "border-l border-purple-200 bg-purple-50"
    )}>
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden bg-purple-50">
        <div className="p-4 space-y-4">
          {isLoadingMessages && (
            <div className="flex items-center justify-center py-8">
              <div className="flex gap-1">
                <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
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
              emptyState={
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Bot className="h-12 w-12 text-purple-500 mb-4" />
                  <h3 className="text-lg font-semibold mb-2 text-purple-900">Chat with lean</h3>
                  <p className="text-sm text-purple-700/70 max-w-sm">
                    Ask me anything about your projects, tasks, or team. I'm here to help!
                  </p>
                </div>
              }
              className="flex-1 min-h-0"
              hideContext={true}
            />
          )}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
                <AvatarFallback className="bg-purple-500 text-white">
                  L
                </AvatarFallback>
              </Avatar>
              <div className="bg-purple-100 border border-purple-200 rounded-lg px-4 py-2">
                <div className="flex gap-1">
                  <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="bg-purple-50 border-t border-purple-200 flex-shrink-0">
        <div>
          {imagePreviewUrls.length > 0 && (
            <div className="mb-2 flex gap-2 flex-wrap">
              {imagePreviewUrls.map((url, index) => (
                <div key={index} className="relative group">
                  <img
                    src={url}
                    alt={`Preview ${index + 1}`}
                    className="h-16 w-16 object-cover rounded-md border"
                  />
                  <button
                    onClick={() => handleImageRemove(index)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-100 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
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
            disabled={isSendingMessage || isFreePlan}
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
            placeholder="Ask lean anything..."
            hideContext={true}
            theme="purple"
          />
        </div>
      </div>
    </div>
  );
}

