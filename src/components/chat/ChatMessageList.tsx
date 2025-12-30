import { ReactNode, useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./ChatMessage";
import { DateSeparator } from "./DateSeparator";
import { Message, ChannelMessage, LikedByUser } from "./types";
import { useUserTimezone } from "@/hooks/useUserTimezone";

const MESSAGE_LOAD_INCREMENT = 20;

export interface ChatMessageListProps {
  messages: (Message | ChannelMessage)[];
  visibleCount: number;
  onLoadMore: (increment: number) => void;
  currentUserEmail: string;
  onToggleLike: (messageId: string, currentLikes: string[]) => void;
  getLikedByUsers: (likes: string[]) => LikedByUser[];
  getUserDisplayInfo: (message: Message | ChannelMessage) => {
    isSent: boolean;
    isLean: boolean;
    displayName: string;
    displayInitials: string;
  };
  onImageError?: (e: React.SyntheticEvent<HTMLImageElement>, imageUrls: string[], idx: number) => void;
  emptyState?: ReactNode;
  isLoading?: boolean;
  loadingIndicator?: ReactNode;
  className?: string;
  onDraftResponse?: (messageId: string) => void;
  isGeneratingDraft?: boolean;
  generatingDraftMessageId?: string | null;
  hideContext?: boolean;
}

export interface ChatMessageListRef {
  scrollToBottom: () => void;
}

export const ChatMessageList = forwardRef<ChatMessageListRef, ChatMessageListProps>(({
  messages,
  visibleCount,
  onLoadMore,
  currentUserEmail,
  onToggleLike,
  getLikedByUsers,
  getUserDisplayInfo,
  onImageError,
  emptyState,
  isLoading,
  loadingIndicator,
  className,
  onDraftResponse,
  isGeneratingDraft = false,
  generatingDraftMessageId = null,
  hideContext = false,
}, ref) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userTimezone = useUserTimezone();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useImperativeHandle(ref, () => ({
    scrollToBottom,
  }));

  // Auto-scroll on new messages
  useEffect(() => {
    // Small delay to ensure DOM is updated
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const totalMessages = messages.length;
  const visibleMessages = messages.slice(-visibleCount);
  const hasMoreMessages = totalMessages > visibleCount;

  // Helper function to get date string for a message (in user's timezone)
  const getMessageDateString = (message: Message | ChannelMessage): string => {
    const timestamp = message.timestamp instanceof Date 
      ? message.timestamp 
      : new Date(message.timestamp);
    
    // Get date string in user's timezone
    const dateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: userTimezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(timestamp);
    
    return dateStr;
  };

  // Messages with date separators
  const messagesWithSeparators = useMemo(() => {
    if (visibleMessages.length === 0) {
      return [];
    }

    const result: ReactNode[] = [];
    let lastDate: string | null = null;

    visibleMessages.forEach((message, index) => {
      const messageDate = getMessageDateString(message);
      const timestamp = message.timestamp instanceof Date 
        ? message.timestamp 
        : new Date(message.timestamp);
      
      // Add date separator before first message or when date changed
      if (index === 0 || (lastDate !== null && lastDate !== messageDate)) {
        result.push(
          <DateSeparator 
            key={`date-separator-${message.id}-${index}`}
            date={timestamp}
            timezone={userTimezone}
          />
        );
      }
      
      // Add the message
      const { isSent, isLean, displayName, displayInitials } = getUserDisplayInfo(message);
      result.push(
        <ChatMessage
          key={message.id}
          message={message}
          isSent={isSent}
          isLean={isLean}
          displayName={displayName}
          displayInitials={displayInitials}
          currentUserEmail={currentUserEmail}
          onToggleLike={onToggleLike}
          getLikedByUsers={getLikedByUsers}
          onImageError={onImageError}
          onDraftResponse={onDraftResponse}
          isGeneratingDraft={isGeneratingDraft && generatingDraftMessageId === message.id}
          hideContext={hideContext}
        />
      );
      
      lastDate = messageDate;
    });

    return result;
  }, [visibleMessages, userTimezone, getUserDisplayInfo, currentUserEmail, onToggleLike, getLikedByUsers, onImageError, onDraftResponse, isGeneratingDraft, generatingDraftMessageId, hideContext]);

  if (messages.length === 0 && emptyState) {
    return (
      <ScrollArea className={className}>
        <div className="p-4 space-y-4 min-h-0 flex-1">
          {emptyState}
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className={className}>
      <div className="p-4 space-y-4 min-h-0 flex-1">
        {/* Load more button */}
        {hasMoreMessages && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => onLoadMore(Math.min(MESSAGE_LOAD_INCREMENT, totalMessages - visibleCount))}
              className="text-sm text-muted-foreground hover:text-foreground px-4 py-2 rounded-md hover:bg-muted transition-colors"
            >
              Load {Math.min(MESSAGE_LOAD_INCREMENT, totalMessages - visibleCount)} older messages
            </button>
          </div>
        )}

        {/* Messages with date separators */}
        {messagesWithSeparators}

        {/* Loading indicator */}
        {isLoading && loadingIndicator}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
});

ChatMessageList.displayName = "ChatMessageList";

