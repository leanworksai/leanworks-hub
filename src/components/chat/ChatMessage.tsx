import React from "react";
import { User, Phone } from "lucide-react";
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
  onDraftResponse,
  isGeneratingDraft = false,
  hideContext = false,
}: ChatMessageProps) {
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
          {!hideContext && message.citedContext && (
            <CitedContextBadges 
              citedContext={message.citedContext}
              className="mb-2 pb-2 border-b border-border/50 w-full min-w-0"
            />
          )}
          
          {/* Message content */}
          {(() => {
            // Check if this is a call notification message
            const callMatch = message.content.match(/\[CALL:([^:]+):([^\]]+)\]/);
            if (callMatch) {
              const [, callId, roomName] = callMatch;
              const displayContent = message.content.replace(/\[CALL:[^\]]+\]/, '').trim();
              return (
                <div className="space-y-2">
                  <p 
                    className="text-sm whitespace-pre-wrap font-medium text-foreground break-words"
                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                  >
                    {renderMessageContent(displayContent)}
                  </p>
                  <CallJoinButton callId={callId} roomName={roomName} />
                </div>
              );
            }
            return (
              <p 
                className="text-sm whitespace-pre-wrap font-medium text-foreground break-words"
                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                {renderMessageContent(message.content)}
              </p>
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
          
          {/* Timestamp for sent messages or at bottom */}
          <p className="text-xs mt-1 opacity-60">
            {formatTimeInTimezone(timestamp, userTimezone)}
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

