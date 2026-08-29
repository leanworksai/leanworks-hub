import { useMemo } from "react";
import { TeamMember } from "@/components/chat/types";

// Generate a consistent chatId for direct messages between two users
// This ensures both users see the same conversation regardless of who initiated it
export function getDirectMessageChatId(userEmail: string, otherUserEmail: string): string {
  const emails = [userEmail.toLowerCase(), otherUserEmail.toLowerCase()].sort();
  return `dm-${emails[0]}-${emails[1]}`;
}

// Generate a user-specific chatId for AI assistant conversations
// This ensures each user has a private conversation with the AI
export function getAIAssistantChatId(userEmail: string): string {
  return `ai-assistant-${userEmail.toLowerCase()}`;
}

// Check if a chatId is for an AI assistant conversation
export function isAIAssistantChatId(chatId: string): boolean {
  return chatId.startsWith('ai-assistant-');
}

// Check if a chatId is for a project channel
export function isProjectChannelId(chatId: string): boolean {
  return chatId.startsWith('project-');
}

// Check if a chatId is for a team channel
export function isTeamChannelId(chatId: string): boolean {
  return chatId.startsWith('team-');
}

// Check if a chatId is for a direct message
export function isDirectMessageId(chatId: string): boolean {
  return chatId.startsWith('dm-');
}

export type ChatType = 'ai-assistant' | 'project' | 'team' | 'dm';

export function getChatType(chatId: string): ChatType {
  if (isAIAssistantChatId(chatId)) return 'ai-assistant';
  if (isProjectChannelId(chatId)) return 'project';
  if (isTeamChannelId(chatId)) return 'team';
  return 'dm';
}

interface UseChatIdParams {
  selectedMember: string;
  userEmail: string | undefined | null;
  allTeamMembers: TeamMember[];
}

interface UseChatIdResult {
  chatId: string | null;
  isProjectChannel: boolean;
  isTeamChannel: boolean;
  isAIAssistant: boolean;
  isDM: boolean;
  selectedProjectId: string | null;
  selectedTeamId: string | null;
  chatType: ChatType | null;
}

/**
 * Hook to determine the correct chat ID based on the selected member
 * Centralizes the logic that was previously repeated 10+ times in Chatbot.tsx
 */
export function useChatId({
  selectedMember,
  userEmail,
  allTeamMembers,
}: UseChatIdParams): UseChatIdResult {
  return useMemo(() => {
    if (!userEmail) {
      return {
        chatId: null,
        isProjectChannel: false,
        isTeamChannel: false,
        isAIAssistant: false,
        isDM: false,
        selectedProjectId: null,
        selectedTeamId: null,
        chatType: null,
      };
    }

    const isProjectChannel = selectedMember.startsWith("project-");
    const isTeamChannel = selectedMember.startsWith("team-");
    const isAIAssistant = selectedMember === "ai-assistant";
    
    const selectedProjectId = isProjectChannel 
      ? selectedMember.replace("project-", "") 
      : null;
    const selectedTeamId = isTeamChannel 
      ? selectedMember.replace("team-", "") 
      : null;

    let chatId: string;

    if (isProjectChannel || isTeamChannel) {
      // For project/team channels, the chatId is the selectedMember itself
      chatId = selectedMember;
    } else if (isAIAssistant) {
      chatId = getAIAssistantChatId(userEmail);
    } else {
      // Direct message
      if (selectedMember.includes('@')) {
        // selectedMember is already an email
        chatId = getDirectMessageChatId(userEmail, selectedMember);
      } else {
        // selectedMember is a user ID, need to find their email
        const selectedMemberData = allTeamMembers.find(m => m.id === selectedMember);
        if (selectedMemberData?.email) {
          chatId = getDirectMessageChatId(userEmail, selectedMemberData.email);
        } else {
          // Fallback to using selectedMember directly
          chatId = selectedMember;
        }
      }
    }

    const isDM = chatId.startsWith('dm-');
    const chatType = getChatType(chatId);

    return {
      chatId,
      isProjectChannel,
      isTeamChannel,
      isAIAssistant,
      isDM,
      selectedProjectId,
      selectedTeamId,
      chatType,
    };
  }, [selectedMember, userEmail, allTeamMembers]);
}

