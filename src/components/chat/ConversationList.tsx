import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { messagesService } from "@/services/api";
import { getAIAssistantChatId, getDirectMessageChatId, isAIAssistantChatId, isProjectChannelId, isTeamChannelId, isDirectMessageId } from "@/hooks/useChatId";
import { formatDateInTimezone } from "@/lib/dateTimeUtils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { Bot, Hash, Users } from "lucide-react";

interface Conversation {
  chatId: string;
  lastMessage: string;
  lastMessageTimestamp: string;
  lastMessageRole: string;
  lastMessageUserId: string | null;
}

interface ConversationListProps {
  userEmail: string;
  allTeamMembers: Array<{ id: string; name: string; email?: string; avatar?: string }>;
  projects: Array<{ id: string; name: string }>;
  onSelectConversation: (chatId: string, selectedMember: string) => void;
  className?: string;
}

export function ConversationList({
  userEmail,
  allTeamMembers,
  projects,
  onSelectConversation,
  className,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const userTimezone = useUserTimezone();

  useEffect(() => {
    const loadConversations = async () => {
      try {
        setIsLoading(true);
        const recent = await messagesService.getRecentConversations(50);
        setConversations(recent);
      } catch (error) {
        console.error('Failed to load recent conversations:', error);
        setConversations([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadConversations();
  }, [userEmail]);

  const getConversationDisplayInfo = (chatId: string) => {
    if (isAIAssistantChatId(chatId)) {
      return {
        name: "Lean AI Assistant",
        avatar: "AI",
        icon: Bot,
        selectedMember: "ai-assistant",
      };
    }

    if (isProjectChannelId(chatId)) {
      const projectId = chatId.replace('project-', '');
      const project = projects.find(p => p.name.toLowerCase().replace(/\s+/g, '-') === projectId);
      return {
        name: project?.name || projectId,
        avatar: "#",
        icon: Hash,
        selectedMember: chatId,
      };
    }

    if (isTeamChannelId(chatId)) {
      const channelId = chatId.replace('team-', '');
      return {
        name: channelId || 'Channel',
        avatar: "👥",
        icon: Users,
        selectedMember: chatId,
      };
    }

    if (isDirectMessageId(chatId)) {
      // Extract emails from DM chatId (format: dm-{email1}-{email2} where emails are sorted)
      // Since emails are sorted and separated by a single hyphen, we can find the split point
      // by looking for the pattern: domain extension (like .com) followed by hyphen
      const dmPart = chatId.replace('dm-', '');
      
      // Find the hyphen that separates the two emails
      // Look for pattern: .{tld}- where tld is typically 2-4 characters
      const domainPattern = /\.([a-z]{2,4})-/i;
      const match = dmPart.match(domainPattern);
      
      if (match && match.index !== undefined) {
        // Found the separator hyphen after the first email's domain
        const splitIndex = match.index + match[0].length - 1; // Position of the hyphen
        const email1 = dmPart.substring(0, splitIndex);
        const email2 = dmPart.substring(splitIndex + 1);
        const otherUserEmail = email1.toLowerCase() === userEmail.toLowerCase() 
          ? email2 
          : email1;
        
        const otherUser = allTeamMembers.find(m => m.email?.toLowerCase() === otherUserEmail.toLowerCase());
        return {
          name: otherUser?.name || otherUserEmail,
          avatar: otherUser?.avatar || otherUserEmail.charAt(0).toUpperCase(),
          icon: null,
          selectedMember: otherUser?.id || otherUserEmail,
        };
      }
      
      // Fallback: try to find the other user's email by checking all team members
      for (const member of allTeamMembers) {
        if (member.email && chatId.toLowerCase().includes(member.email.toLowerCase()) 
            && member.email.toLowerCase() !== userEmail.toLowerCase()) {
          return {
            name: member.name,
            avatar: member.avatar || member.email.charAt(0).toUpperCase(),
            icon: null,
            selectedMember: member.id,
          };
        }
      }
    }

    return {
      name: "Unknown",
      avatar: "?",
      icon: null,
      selectedMember: chatId,
    };
  };

  const formatLastMessageTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return formatDateInTimezone(date, userTimezone, "MMM d");
    } catch {
      return "";
    }
  };

  const truncateMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + "...";
  };

  if (isLoading) {
    return (
      <ScrollArea className={className}>
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-md animate-pulse">
              <div className="h-10 w-10 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  if (conversations.length === 0) {
    return (
      <ScrollArea className={className}>
        <div className="p-4 text-center text-muted-foreground">
          <p>No recent conversations</p>
        </div>
      </ScrollArea>
    );
  }

  // Filter out "Unknown" conversations when there are no valid members to match them to
  const filteredConversations = conversations.filter((conv) => {
    const displayInfo = getConversationDisplayInfo(conv.chatId);
    // If it's an "Unknown" conversation and there are no other team members, filter it out
    if (displayInfo.name === "Unknown" && allTeamMembers.length === 0) {
      return false;
    }
    return true;
  });

  if (filteredConversations.length === 0) {
    return (
      <ScrollArea className={className}>
        <div className="p-4 text-center text-muted-foreground">
          <p>No recent conversations</p>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className={className}>
      <div className="p-2 space-y-1">
        {filteredConversations.map((conv) => {
          const displayInfo = getConversationDisplayInfo(conv.chatId);
          const Icon = displayInfo.icon;

          return (
            <button
              key={conv.chatId}
              onClick={() => onSelectConversation(conv.chatId, displayInfo.selectedMember)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 rounded-md text-left",
                "hover:bg-muted transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              )}
            >
              <Avatar className="h-10 w-10 flex-shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {Icon ? (
                    <Icon className="h-5 w-5" />
                  ) : (
                    displayInfo.avatar
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-medium text-sm truncate">{displayInfo.name}</p>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatLastMessageTime(conv.lastMessageTimestamp)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {truncateMessage(conv.lastMessage)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

