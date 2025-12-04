import { User } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn, getAvatarColor } from "@/lib/utils";
import { LikeButton } from "./LikeButton";
import { CitedContextBadges } from "./CitedContextBadges";
import { Message, ChannelMessage, LikedByUser, CitedContext } from "./types";

// Render message content with highlighted mentions and clickable links
function renderMessageContent(content: string): (string | JSX.Element)[] | string {
  // Match @mentions
  const mentionRegex = /@([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*?)(?=\s|$|[.,!?;:])/g;
  
  // Match URLs
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}[^\s]*)/gi;
  
  const parts: (string | JSX.Element)[] = [];
  const matches: Array<{ type: 'mention' | 'url'; index: number; length: number; content: string; url?: string }> = [];
  
  // Find all mentions
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    matches.push({
      type: 'mention',
      index: match.index,
      length: match[0].length,
      content: match[0],
    });
  }
  
  // Find all URLs
  while ((match = urlRegex.exec(content)) !== null) {
    const overlapsWithMention = matches.some(m => 
      m.type === 'mention' && 
      match.index < m.index + m.length && 
      match.index + match[0].length > m.index
    );
    
    if (!overlapsWithMention) {
      let url = match[0];
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      matches.push({
        type: 'url',
        index: match.index,
        length: match[0].length,
        content: match[0],
        url: url,
      });
    }
  }
  
  matches.sort((a, b) => a.index - b.index);
  
  let lastIndex = 0;
  let keyCounter = 0;
  
  matches.forEach((match) => {
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        parts.push(textBefore);
      }
    }
    
    if (match.type === 'mention') {
      const mentionName = match.content.substring(1);
      parts.push(
        <span
          key={`mention-${keyCounter++}`}
          className="text-primary font-semibold"
        >
          @{mentionName}
        </span>
      );
    } else if (match.type === 'url') {
      parts.push(
        <a
          key={`url-${keyCounter++}`}
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-700 break-all"
        >
          {match.content}
        </a>
      );
    }
    
    lastIndex = match.index + match.length;
  });
  
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }
  
  return parts.length > 0 ? parts : content;
}

export interface ChatMessageProps {
  message: Message | ChannelMessage;
  isSent: boolean;
  isLean: boolean;
  displayName: string;
  displayInitials: string;
  currentUserEmail: string;
  onToggleLike: (messageId: string, currentLikes: string[]) => void;
  getLikedByUsers: (likes: string[]) => LikedByUser[];
  onImageError?: (e: React.SyntheticEvent<HTMLImageElement>, imageUrls: string[], idx: number) => void;
  showSenderInfo?: boolean;
}

export function ChatMessage({
  message,
  isSent,
  isLean,
  displayName,
  displayInitials,
  currentUserEmail,
  onToggleLike,
  getLikedByUsers,
  onImageError,
  showSenderInfo = true,
}: ChatMessageProps) {
  const timestamp = message.timestamp instanceof Date 
    ? message.timestamp 
    : new Date(message.timestamp);
  
  const userId = 'userId' in message ? message.userId : undefined;
  const role = 'role' in message ? message.role : (isLean ? 'assistant' : 'user');
  
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>, imageUrls: string[], idx: number) => {
    if (onImageError) {
      onImageError(e, imageUrls, idx);
    } else {
      const target = e.target as HTMLImageElement;
      target.style.display = 'none';
    }
  };

  return (
    <div
      data-message-id={message.id}
      data-message-timestamp={timestamp.getTime()}
      data-message-user-id={userId || ''}
      data-message-role={role}
      className={cn(
        "flex gap-3 w-full min-w-0 max-w-full group",
        isSent ? "justify-end" : "justify-start"
      )}
    >
      {/* Avatar for received messages */}
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
            <AvatarFallback className={getAvatarColor(userId?.toLowerCase())}>
              {displayInitials || <User className="h-4 w-4" />}
            </AvatarFallback>
          )}
        </Avatar>
      )}
      
      {/* Message bubble wrapper */}
      <div className={cn(
        "flex flex-col min-w-0 shrink relative",
        isSent ? "max-w-[75%] ml-auto" : "max-w-[75%]"
      )}>
        {/* Sender info for received messages */}
        {!isSent && showSenderInfo && (
          <div className="flex items-center gap-2 mb-1 px-1">
            <p className="font-medium text-sm">{displayName}</p>
            <span className="text-xs text-muted-foreground">
              {timestamp.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
        
        {/* Like button with likes */}
        <LikeButton
          likes={message.likes || []}
          currentUserEmail={currentUserEmail}
          onToggle={() => onToggleLike(message.id, message.likes || [])}
          getLikedByUsers={getLikedByUsers}
          position={isSent ? "left" : "right"}
          showOnHover={false}
        />
        
        {/* Like button on hover (no likes yet) */}
        {(!message.likes || message.likes.length === 0) && (
          <LikeButton
            likes={[]}
            currentUserEmail={currentUserEmail}
            onToggle={() => onToggleLike(message.id, message.likes || [])}
            getLikedByUsers={getLikedByUsers}
            position={isSent ? "left" : "right"}
            showOnHover={true}
          />
        )}
        
        {/* Message bubble */}
        <div 
          className="rounded-lg px-4 py-2 bg-muted border border-border break-words min-w-0 w-full overflow-x-hidden"
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        >
          {/* Cited context */}
          {message.citedContext && (
            <CitedContextBadges 
              citedContext={message.citedContext}
              className="mb-2 pb-2 border-b border-border/50 w-full min-w-0"
            />
          )}
          
          {/* Message content */}
          <p 
            className="text-sm whitespace-pre-wrap font-medium text-foreground break-words"
            style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
          >
            {renderMessageContent(message.content)}
          </p>
          
          {/* Images */}
          {message.imageUrls && message.imageUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.imageUrls.map((imageUrl, idx) => (
                <a
                  key={idx}
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={imageUrl}
                    alt={`Image ${idx + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="max-w-[200px] max-h-[200px] object-cover rounded-md border cursor-pointer hover:opacity-90 transition-opacity"
                    onError={(e) => handleImageError(e, message.imageUrls || [], idx)}
                  />
                </a>
              ))}
            </div>
          )}
          
          {/* Timestamp for sent messages or at bottom */}
          <p className="text-xs mt-1 opacity-60">
            {timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
      
      {/* Avatar for sent messages */}
      {isSent && (
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarFallback className={getAvatarColor(currentUserEmail.toLowerCase())}>
            {displayInitials || <User className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

