// Generate a user-specific chatId for AI assistant conversations
// This ensures each user has a private conversation with the AI
export function getAIAssistantChatId(userEmail: string): string {
  return `ai-assistant-${userEmail.toLowerCase()}`;
}

// Check if a chatId is for an AI assistant conversation
export function isAIAssistantChatId(chatId: string): boolean {
  return chatId.startsWith('ai-assistant-');
}

