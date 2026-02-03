import React from "react";
import { User, ExternalLink } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, getAvatarColor } from "@/lib/utils";
import { LikeButton } from "./LikeButton";
import { CitedContextBadges } from "./CitedContextBadges";
import { ImplicitContextBadge } from "./ImplicitContextBadge";
import { Message, ChannelMessage, LikedByUser, CitedContext } from "./types";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatTimeInTimezone } from "@/lib/dateTimeUtils";
import { marked } from "marked";

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
  const docsMatch = citedContextText.match(/Selected Docs:\s*([\s\S]*?)(?=Selected (?:Projects|Tasks|Teams|Text):|$)/i);
  if (docsMatch) {
    const docs = parseItems(docsMatch[1]).map(item => ({ id: item.id, title: item.name }));
    if (docs.length > 0) {
      citedContext.docs = docs;
    }
  }
  
  // Parse Selected Projects
  const projectsMatch = citedContextText.match(/Selected Projects:\s*([\s\S]*?)(?=Selected (?:Docs|Tasks|Teams|Text):|$)/i);
  if (projectsMatch) {
    const projects = parseItems(projectsMatch[1]).map(item => ({ id: item.id, name: item.name }));
    if (projects.length > 0) {
      citedContext.projects = projects;
    }
  }
  
  // Parse Selected Tasks
  const tasksMatch = citedContextText.match(/Selected Tasks:\s*([\s\S]*?)(?=Selected (?:Docs|Projects|Teams|Text):|$)/i);
  if (tasksMatch) {
    const tasks = parseItems(tasksMatch[1]).map(item => ({ id: item.id, title: item.name }));
    if (tasks.length > 0) {
      citedContext.tasks = tasks;
    }
  }
  
  // Parse Selected Teams
  const teamsMatch = citedContextText.match(/Selected Teams:\s*([\s\S]*?)(?=Selected (?:Docs|Projects|Tasks|Text):|$)/i);
  if (teamsMatch) {
    const teams = parseItems(teamsMatch[1]).map(item => ({ id: item.id, name: item.name }));
    if (teams.length > 0) {
      citedContext.teams = teams;
    }
  }
  
  // Parse Selected Text
  const selectedTextMatch = citedContextText.match(/Selected Text:\s*([\s\S]*?)(?=Selected (?:Docs|Projects|Tasks|Teams):|$)/i);
  if (selectedTextMatch) {
    const selectedTexts: Array<{ id: string; text: string; docId?: string }> = [];
    const textContent = selectedTextMatch[1].trim();
    
    // Try to parse as items with IDs first (format: - Text (ID: doc-id))
    const items = parseItems(textContent);
    if (items.length > 0) {
      // Extract docId from the ID if it's a doc ID
      selectedTexts.push(...items.map(item => ({
        id: item.id,
        // Truncate text for display (preview only)
        text: item.name.length > 100 ? item.name.substring(0, 100) + '...' : item.name,
        docId: item.id, // Assume the ID is the docId for selected text
      })));
    } else if (textContent) {
      // If no items found, treat the whole text as a single selected text
      // Truncate if too long for display (preview only)
      const displayText = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent;
      selectedTexts.push({
        id: `selected-text-${Date.now()}`,
        text: displayText,
      });
    }
    
    if (selectedTexts.length > 0) {
      citedContext.selectedTexts = selectedTexts;
    }
  }
  
  const hasAnyContext = citedContext.docs || citedContext.projects || citedContext.tasks || citedContext.teams || citedContext.selectedTexts;
  
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

// Configure marked for safe HTML output
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

// Check if content has markdown formatting
function hasMarkdownFormatting(content: string): boolean {
  // Check for common markdown patterns
  const markdownPatterns = [
    /\*\*[^*]+\*\*/, // Bold **text**
    /\*[^*]+\*/, // Italic *text*
    /__[^_]+__/, // Bold __text__
    /_[^_]+_/, // Italic _text_
    /`[^`]+`/, // Inline code `code`
    /```[\s\S]*?```/, // Code blocks
    /^#{1,6}\s/m, // Headers
    /^\s*[-*+]\s/m, // Unordered lists
    /^\s*\d+\.\s/m, // Ordered lists
    /\[.+\]\(.+\)/, // Links [text](url)
    /^\s*>/m, // Blockquotes
    /~~[^~]+~~/, // Strikethrough
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
}

// Render message content with markdown support and highlighted mentions
function renderMessageContent(
  content: string, 
  isAIChatTheme: boolean = false, 
  isSent: boolean = false,
  getUserDisplayName?: (email: string) => string | null
): JSX.Element | string {
  // First, process @mentions to create styled spans
  const mentionRegex = /@([a-zA-Z0-9_]+(?:\s+[a-zA-Z0-9_]+)*?|[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)(?=\s|$|[.,!?;:])/g;
  
  // Replace mentions with styled HTML spans
  let processedContent = content.replace(mentionRegex, (match) => {
    const mentionValue = match.substring(1); // Remove @
    let displayName = mentionValue;
    if (mentionValue.includes('@') && getUserDisplayName) {
      const userDisplayName = getUserDisplayName(mentionValue);
      if (userDisplayName) {
        displayName = userDisplayName;
      }
    }
    return `<span class="text-primary font-semibold">@${displayName}</span>`;
  });
  
  // Check if content has markdown formatting
  const shouldParseMarkdown = hasMarkdownFormatting(processedContent);
  
  if (shouldParseMarkdown) {
    // Parse markdown to HTML
    const htmlContent = marked.parse(processedContent, { async: false }) as string;
    
    // Determine the wrapper classes based on theme
    const wrapperClasses = cn(
      "prose prose-sm max-w-none break-words min-w-0",
      // Dark mode support
      "dark:prose-invert",
      // Customize prose for chat context
      "prose-p:my-1 prose-p:leading-relaxed prose-p:break-words",
      "prose-headings:my-2 prose-headings:font-semibold prose-headings:break-words",
      "prose-ul:my-1 prose-ol:my-1",
      "prose-li:my-0.5 prose-li:break-words",
      "prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:break-words",
      "prose-pre:my-2 prose-pre:p-3 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:overflow-x-auto prose-pre:max-w-full prose-pre:min-w-0",
      "prose-blockquote:my-2 prose-blockquote:border-l-primary prose-blockquote:pl-4 prose-blockquote:break-words",
      "prose-a:text-primary prose-a:underline prose-a:decoration-primary/50 hover:prose-a:decoration-primary prose-a:break-words",
      // Theme-specific overrides
      isAIChatTheme && isSent && "prose-invert prose-p:text-white prose-headings:text-white prose-strong:text-white prose-code:bg-white/20 prose-code:text-white prose-pre:bg-white/10 prose-a:text-white/90 hover:prose-a:text-white prose-blockquote:border-white/50 prose-blockquote:text-white/90 prose-li:text-white",
    );
    
    return (
      <div 
        className={wrapperClasses}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  }
  
  // If no markdown, fall back to the original plain text rendering with URL detection
  const urlRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}[^\s<>"']*)/gi;
  
  const parts: (string | JSX.Element)[] = [];
  const mentionMatches: Array<{ index: number; length: number; content: string }> = [];
  const urlMatches: Array<{ index: number; length: number; content: string; url: string }> = [];
  
  // Find all mentions in original content
  let match;
  const mentionRegexCopy = new RegExp(mentionRegex.source, mentionRegex.flags);
  while ((match = mentionRegexCopy.exec(content)) !== null) {
    mentionMatches.push({
      index: match.index,
      length: match[0].length,
      content: match[0],
    });
  }
  
  // Find all URLs
  while ((match = urlRegex.exec(content)) !== null) {
    const overlapsWithMention = mentionMatches.some(m => 
      match!.index < m.index + m.length && 
      match!.index + match![0].length > m.index
    );
    
    if (!overlapsWithMention) {
      let url = match[0];
      url = url.replace(/[.,!?;:]+$/, '');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      urlMatches.push({
        index: match.index,
        length: match[0].length,
        content: match[0].replace(/[.,!?;:]+$/, ''),
        url: url,
      });
    }
  }
  
  // Combine and sort all matches
  const allMatches = [
    ...mentionMatches.map(m => ({ ...m, type: 'mention' as const })),
    ...urlMatches.map(m => ({ ...m, type: 'url' as const })),
  ].sort((a, b) => a.index - b.index);
  
  let lastIndex = 0;
  let keyCounter = 0;
  
  allMatches.forEach((matchItem) => {
    if (matchItem.index > lastIndex) {
      const textBefore = content.substring(lastIndex, matchItem.index);
      if (textBefore) {
        parts.push(textBefore);
      }
    }
    
    if (matchItem.type === 'mention') {
      const mentionValue = matchItem.content.substring(1);
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
    } else if (matchItem.type === 'url') {
      const displayUrl = truncateUrl(matchItem.content);
      
      const linkClasses = isAIChatTheme
        ? isSent
          ? "inline-flex items-center gap-1.5 text-white/90 hover:text-white underline decoration-white/50 hover:decoration-white transition-colors font-medium"
          : "inline-flex items-center gap-1.5 text-purple-600 hover:text-purple-700 underline decoration-purple-300 hover:decoration-purple-500 transition-colors font-medium"
        : "inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 underline decoration-blue-300 hover:decoration-blue-500 transition-colors font-medium";
      
      parts.push(
        <a
          key={`url-${keyCounter++}`}
          href={matchItem.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(linkClasses, "break-all")}
          title={matchItem.url}
        >
          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate max-w-[200px]" title={matchItem.url}>
            {displayUrl}
          </span>
        </a>
      );
    }
    
    lastIndex = matchItem.index + matchItem.length;
  });
  
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }
  
  return parts.length > 0 ? <>{parts}</> : content;
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
  const timestamp = (() => {
    if (message.timestamp instanceof Date) {
      return isNaN(message.timestamp.getTime()) ? new Date() : message.timestamp;
    } else {
      const parsed = new Date(message.timestamp);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    }
  })();
  
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
            // Prioritize message.citedContext (from database) over parsed content (which might contain errors)
            // Only use parsed context if message.citedContext doesn't exist
            const displayCitedContext = message.citedContext || parsedCitedContext;
            
            const displayContent = cleanContent;
            
            // Check if we have any cited context to display
            const hasCitedContext = displayCitedContext && (
              (displayCitedContext.projects && displayCitedContext.projects.length > 0) ||
              (displayCitedContext.tasks && displayCitedContext.tasks.length > 0) ||
              (displayCitedContext.teams && displayCitedContext.teams.length > 0) ||
              (displayCitedContext.docs && displayCitedContext.docs.length > 0) ||
              (displayCitedContext.selectedTexts && displayCitedContext.selectedTexts.length > 0)
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
                
                {/* Implicit context */}
                {!hideContext && message.implicitContext && (
                  <ImplicitContextBadge 
                    implicitContext={message.implicitContext}
                    className="mb-3 w-full min-w-0"
                    theme={theme}
                  />
                )}
                
                {/* Message content */}
                <div
                  className={cn(
                    "text-sm break-words font-medium text-foreground",
                    isAIChatTheme && isSent && "text-white leading-relaxed",
                    isAIChatTheme && isLean && !isSent && "leading-relaxed"
                  )}
                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                >
                  {renderMessageContent(displayContent, isAIChatTheme, isSent)}
                </div>
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

