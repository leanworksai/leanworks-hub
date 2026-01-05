import React from "react";
import { User, Phone, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, getAvatarColor } from "@/lib/utils";
import { LikeButton } from "./LikeButton";
import { CitedContextBadges } from "./CitedContextBadges";
import { Message, ChannelMessage, LikedByUser, CitedContext } from "./types";
import { useWebRTCContext } from "@/contexts/WebRTCContext";
import { useAuth } from "@/contexts/AuthContext";
import { callSignalingService, type CallSignal } from "@/services/api";
import { db } from "@/lib/firebase-client";
import { getCurrentOrgSlug } from "@/services/api";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatTimeInTimezone } from "@/lib/dateTimeUtils";

// Parse cited context from message content
function parseCitedContext(content: string): { citedContext: CitedContext | null; cleanContent: string } {
  const citedContextRegex = /<cited_context>([\s\S]*?)<\/cited_context>/i;
  const match = content.match(citedContextRegex);
  
  if (!match) {
    return { citedContext: null, cleanContent: content };
  }
  
  const citedContextText = match[1].trim();
  const cleanContent = content.replace(citedContextRegex, '').trim();
  
  const citedContext: CitedContext = {};
  
  // Helper function to parse items from a section
  const parseItems = (text: string): Array<{ id: string; name: string }> => {
    const items: Array<{ id: string; name: string }> = [];
    // Match pattern: - Title (ID: uuid)
    // The title can contain any characters except the sequence " (ID:"
    const itemRegex = /-\s*([^(]+?)\s*\(ID:\s*([a-f0-9-]+)\)/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      items.push({
        id: match[2],
        name: match[1].trim(),
      });
    }
    return items;
  };
  
  // Parse Selected Docs
  const docsMatch = citedContextText.match(/Selected Docs:\s*([\s\S]*?)(?=Selected (?:Projects|Tasks|Teams):|$)/i);
  if (docsMatch) {
    const docs = parseItems(docsMatch[1]).map(item => ({ id: item.id, title: item.name }));
    if (docs.length > 0) {
      citedContext.docs = docs;
    }
  }
  
  // Parse Selected Projects
  const projectsMatch = citedContextText.match(/Selected Projects:\s*([\s\S]*?)(?=Selected (?:Docs|Tasks|Teams):|$)/i);
  if (projectsMatch) {
    const projects = parseItems(projectsMatch[1]).map(item => ({ id: item.id, name: item.name }));
    if (projects.length > 0) {
      citedContext.projects = projects;
    }
  }
  
  // Parse Selected Tasks
  const tasksMatch = citedContextText.match(/Selected Tasks:\s*([\s\S]*?)(?=Selected (?:Docs|Projects|Teams):|$)/i);
  if (tasksMatch) {
    const tasks = parseItems(tasksMatch[1]).map(item => ({ id: item.id, title: item.name }));
    if (tasks.length > 0) {
      citedContext.tasks = tasks;
    }
  }
  
  // Parse Selected Teams
  const teamsMatch = citedContextText.match(/Selected Teams:\s*([\s\S]*?)(?=Selected (?:Docs|Projects|Tasks):|$)/i);
  if (teamsMatch) {
    const teams = parseItems(teamsMatch[1]).map(item => ({ id: item.id, name: item.name }));
    if (teams.length > 0) {
      citedContext.teams = teams;
    }
  }
  
  const hasAnyContext = citedContext.docs || citedContext.projects || citedContext.tasks || citedContext.teams;
  
  return {
    citedContext: hasAnyContext ? citedContext : null,
    cleanContent,
  };
}

// Helper function to extract domain from URL
function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname.replace('www.', '');
  } catch {
    // If URL parsing fails, try to extract domain manually
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/);
    return match ? match[1] : url;
  }
}

// Helper function to truncate URL for display
function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url;
  const domain = getDomainFromUrl(url);
  if (domain.length >= maxLength - 3) {
    return domain.substring(0, maxLength - 3) + '...';
  }
  return domain + '...';
}

// Render message content with highlighted mentions and clickable links
function renderMessageContent(
  content: string, 
  isAIChatTheme: boolean = false, 
  isSent: boolean = false,
  getUserDisplayName?: (email: string) => string | null
): (string | JSX.Element)[] | string {
  // Match @mentions - supports both @username and @user@example.com formats
  // Improved email pattern: more robust validation
  const mentionRegex = /@([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*?|[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)(?=\s|$|[.,!?;:])/g;
  
  // Match URLs - improved regex to catch more URL patterns
  const urlRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}[^\s<>"']*)/gi;
  
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
      // Remove trailing punctuation that might not be part of the URL
      url = url.replace(/[.,!?;:]+$/, '');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      matches.push({
        type: 'url',
        index: match.index,
        length: match[0].length,
        content: match[0].replace(/[.,!?;:]+$/, ''), // Store original without trailing punctuation
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
      const mentionValue = match.content.substring(1); // Remove @
      // Check if it's an email format and try to get display name
      let displayName = mentionValue;
      if (mentionValue.includes('@') && getUserDisplayName) {
        const userDisplayName = getUserDisplayName(mentionValue);
        if (userDisplayName) {
          displayName = userDisplayName;
        }
      }
      parts.push(
        <span
          key={`mention-${keyCounter++}`}
          className="text-primary font-semibold"
        >
          @{displayName}
        </span>
      );
    } else if (match.type === 'url') {
      const displayUrl = truncateUrl(match.content);
      const domain = getDomainFromUrl(match.url || match.content);
      
      // Different styling for AI chat theme
      const linkClasses = isAIChatTheme
        ? isSent
          ? "inline-flex items-center gap-1.5 text-white/90 hover:text-white underline decoration-white/50 hover:decoration-white transition-colors font-medium"
          : "inline-flex items-center gap-1.5 text-purple-600 hover:text-purple-700 underline decoration-purple-300 hover:decoration-purple-500 transition-colors font-medium"
        : "inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 underline decoration-blue-300 hover:decoration-blue-500 transition-colors font-medium";
      
      parts.push(
        <a
          key={`url-${keyCounter++}`}
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(linkClasses, "break-all")}
          title={match.url}
        >
          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate max-w-[200px]" title={match.url}>
            {displayUrl}
          </span>
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

// Component to render "Join Call" button for call notification messages
function CallJoinButton({ callId, roomName }: { callId: string; roomName: string }) {
  const { answerCall, callStatus, setCurrentCallId, currentCallId } = useWebRTCContext();
  const { user } = useAuth();
  const [isJoining, setIsJoining] = React.useState(false);
  const [callStatusFromFirestore, setCallStatusFromFirestore] = React.useState<'ringing' | 'active' | 'ended' | null>(null);

  // Subscribe to call status from Firestore
  React.useEffect(() => {
    if (!callId || !db || !user?.email) return;

    const checkCallStatus = async () => {
      try {
        const { doc, getDoc, onSnapshot } = await import('firebase/firestore');
        const orgSlug = getCurrentOrgSlug();
        if (!orgSlug) return;

        const callRef = doc(db, `orgs/${orgSlug}/calls`, callId);
        
        // Check immediately, but retry if document doesn't exist (might be a timing issue)
        let callDoc = await getDoc(callRef);
        if (callDoc.exists()) {
          const data = callDoc.data();
          setCallStatusFromFirestore(data.status || 'ringing');
        } else {
          // Document doesn't exist yet - might be a timing issue
          // Retry once after a short delay before assuming it's ended
          await new Promise(resolve => setTimeout(resolve, 500));
          callDoc = await getDoc(callRef);
          if (callDoc.exists()) {
            const data = callDoc.data();
            setCallStatusFromFirestore(data.status || 'ringing');
          } else {
            // Still doesn't exist after retry - only then assume ended
            // But don't set it immediately, let the listener handle it
            setCallStatusFromFirestore(null);
          }
        }

        // Subscribe to real-time updates
        const unsubscribe = onSnapshot(callRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setCallStatusFromFirestore(data.status || 'ringing');
          } else {
            // Only mark as ended if we've confirmed the document doesn't exist
            // and it's not just a cache issue (check if it's from server)
            if (!snapshot.metadata.fromCache) {
              // This is a server snapshot confirming the document doesn't exist
            setCallStatusFromFirestore('ended');
            }
            // If it's from cache and empty, don't update status (might be stale cache)
          }
        }, (error) => {
          console.error('Error subscribing to call status:', error);
        });

        return unsubscribe;
      } catch (err) {
        console.error('Error checking call status:', err);
        return () => {}; // Return empty cleanup function
      }
    };

    let unsubscribe: (() => void) | undefined;
    checkCallStatus().then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [callId, user?.email]);

  const handleJoinCall = async () => {
    if (callStatus !== 'idle') {
      return; // Already in a call
    }

    try {
      setIsJoining(true);
      const participantName = user?.email || 'User';
      await answerCall(roomName, participantName);
      // Set the call ID so the button updates to "Leave"
      setCurrentCallId(callId);
      console.log('Joined call from message', { callId, roomName });
    } catch (err) {
      console.error('Error joining call from message:', err);
      alert('Failed to join call. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  // Check if call has ended (only if we've confirmed it from Firestore)
  const isCallEnded = callStatusFromFirestore === 'ended';
  
  // Check if user is already in this call
  const isInCall = callStatus !== 'idle' && callStatus !== 'ended' && currentCallId === callId;
  
  // Don't show "Call ended" if status is null (still checking) or if call is active/ringing
  if (isCallEnded && callStatusFromFirestore !== null) {
    return (
      <div className="mt-2 text-xs text-muted-foreground italic">
        Call ended
      </div>
    );
  }

  if (isInCall) {
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        You're in this call
      </div>
    );
  }

  return (
    <Button
      size="sm"
      onClick={handleJoinCall}
      disabled={isJoining}
      className="mt-2"
    >
      <Phone className="h-4 w-4 mr-2" />
      {isJoining ? 'Joining...' : 'Join Call'}
    </Button>
  );
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
  onDraftResponse?: (messageId: string) => void;
  isGeneratingDraft?: boolean;
  hideContext?: boolean;
  theme?: "default" | "ai-chat"; // Theme for styling - only "ai-chat" gets special styling
  getUserDisplayName?: (email: string) => string | null; // Function to get user display name from email
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
  getUserDisplayName,
  onImageError,
  showSenderInfo = true,
  onDraftResponse,
  isGeneratingDraft = false,
  hideContext = false,
  theme = "default",
}: ChatMessageProps) {
  const isAIChatTheme = theme === "ai-chat";
  const timestamp = message.timestamp instanceof Date 
    ? message.timestamp 
    : new Date(message.timestamp);
  
  const userId = 'userId' in message ? message.userId : undefined;
  const role = 'role' in message ? message.role : (isLean ? 'assistant' : 'user');
  const userTimezone = useUserTimezone();
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  
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
        "justify-start"
      )}
    >
      {/* Avatar for all messages (left side) */}
      <Avatar className={cn(
        "flex-shrink-0",
        isLean && isAIChatTheme ? "h-9 w-9 ring-2 ring-purple-200/50" : "h-8 w-8"
      )}>
        {isLean ? (
          <>
            <AvatarImage src="/logo.png" alt="lean" className="object-contain" />
            <AvatarFallback className={cn(
              isAIChatTheme 
                ? "bg-gradient-to-br from-purple-500 to-indigo-500 text-white font-semibold"
                : "bg-muted-foreground/20 text-foreground"
            )}>
              L
            </AvatarFallback>
          </>
        ) : isSent ? (
          <AvatarFallback className={getAvatarColor(currentUserEmail.toLowerCase())}>
            {displayInitials || <User className="h-4 w-4" />}
          </AvatarFallback>
        ) : (
          <AvatarFallback className={getAvatarColor(userId?.toLowerCase())}>
            {displayInitials || <User className="h-4 w-4" />}
          </AvatarFallback>
        )}
      </Avatar>
      
      {/* Message bubble wrapper */}
      <div className={cn(
        "flex flex-col min-w-0 shrink relative",
        "max-w-[75%]"
      )}>
        {/* Sender info for received messages */}
        {!isSent && showSenderInfo && (
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <p className={cn(
              "font-medium text-sm",
              isLean && isAIChatTheme ? "text-black" : "text-foreground"
            )}>
              {displayName}
            </p>
            <span className={cn(
              "text-xs",
              isLean && isAIChatTheme ? "text-black/70" : "text-muted-foreground"
            )}>
              {formatTimeInTimezone(timestamp, userTimezone)}
            </span>
          </div>
        )}
        {/* Sender info for sent messages */}
        {isSent && showSenderInfo && (
          <div className="flex items-center gap-2 mb-1.5 px-1">
            <p className={cn(
              "font-medium text-sm",
              isAIChatTheme ? "text-black" : "text-foreground"
            )}>
              {displayName}
            </p>
            <span className={cn(
              "text-xs",
              isAIChatTheme ? "text-black/70" : "text-muted-foreground"
            )}>
              {formatTimeInTimezone(timestamp, userTimezone)}
            </span>
          </div>
        )}
        
        {/* Like button with likes */}
        <LikeButton
          likes={message.likes || []}
          currentUserEmail={currentUserEmail}
          onToggle={() => onToggleLike(message.id, message.likes || [])}
          getLikedByUsers={getLikedByUsers}
          position="right"
          showOnHover={false}
        />
        
        {/* Like button on hover (no likes yet) */}
        {(!message.likes || message.likes.length === 0) && (
          <LikeButton
            likes={[]}
            currentUserEmail={currentUserEmail}
            onToggle={() => onToggleLike(message.id, message.likes || [])}
            getLikedByUsers={getLikedByUsers}
            position="right"
            showOnHover={true}
          />
        )}
        
        {/* Message bubble */}
        <div 
          className={cn(
            "px-4 py-2 break-words min-w-0 w-full overflow-x-hidden transition-all",
            isAIChatTheme
              ? cn(
                  "rounded-2xl shadow-sm",
                  isSent 
                    ? "bg-gradient-to-br from-purple-500 to-indigo-500 text-white rounded-tr-sm py-3" 
                    : isLean
                    ? "bg-white/90 backdrop-blur-sm border border-purple-200/60 rounded-tl-sm py-3"
                    : "bg-muted border border-border rounded-lg"
                )
              : "rounded-lg bg-muted border border-border"
          )}
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        >
          {(() => {
            // Parse cited context from message content
            const { citedContext: parsedCitedContext, cleanContent } = parseCitedContext(message.content);
            // Use parsed cited context if available, otherwise fall back to message.citedContext
            const displayCitedContext = parsedCitedContext || message.citedContext;
            
            // Check if this is a call notification message
            const callMatch = cleanContent.match(/\[CALL:([^:]+):([^\]]+)\]/);
            const displayContent = callMatch 
              ? cleanContent.replace(/\[CALL:[^\]]+\]/, '').trim()
              : cleanContent;
            
            // Check if we have any cited context to display
            const hasCitedContext = displayCitedContext && (
              (displayCitedContext.projects && displayCitedContext.projects.length > 0) ||
              (displayCitedContext.tasks && displayCitedContext.tasks.length > 0) ||
              (displayCitedContext.teams && displayCitedContext.teams.length > 0) ||
              (displayCitedContext.docs && displayCitedContext.docs.length > 0)
            );
            
            return (
              <>
                {/* Cited context */}
                {!hideContext && hasCitedContext && displayCitedContext && (
                  <CitedContextBadges 
                    citedContext={displayCitedContext}
                    className="mb-3 w-full min-w-0"
                    theme={theme}
                  />
                )}
                
                {/* Message content */}
                {callMatch ? (
                  <div className="space-y-2">
                    <p 
                      className={cn(
                        "text-sm whitespace-pre-wrap font-medium break-words",
                        isAIChatTheme && isSent ? "text-white" : "text-foreground"
                      )}
                      style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                    >
                      {renderMessageContent(displayContent, isAIChatTheme, isSent, getUserDisplayName)}
                    </p>
                    <CallJoinButton callId={callMatch[1]} roomName={callMatch[2]} />
                  </div>
                ) : (
                  <p 
                    className={cn(
                      "text-sm whitespace-pre-wrap break-words font-medium text-foreground",
                      isAIChatTheme && isSent && "text-white leading-relaxed",
                      isAIChatTheme && isLean && !isSent && "leading-relaxed"
                    )}
                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                  >
                    {renderMessageContent(displayContent, isAIChatTheme, isSent)}
                  </p>
                )}
              </>
            );
          })()}
          
          {/* Images */}
          {message.imageUrls && message.imageUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.imageUrls.map((imageUrl, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedImage(imageUrl)}
                  className="block cursor-pointer"
                >
                  <img
                    src={imageUrl}
                    alt={`Image ${idx + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="max-w-[200px] max-h-[200px] object-cover rounded-md border hover:opacity-90 transition-opacity"
                    onError={(e) => handleImageError(e, message.imageUrls || [], idx)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Image Modal */}
      <Dialog open={selectedImage !== null} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 bg-background/95 border">
          {selectedImage && (
            <div className="flex items-center justify-center w-full h-full">
              <img
                src={selectedImage}
                alt="Full size image"
                className="max-w-full max-h-[90vh] w-auto h-auto object-contain rounded-md"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

