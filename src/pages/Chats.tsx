import { TeamChatSidebar } from "@/components/TeamChatSidebar";
import { TeamChatConversation } from "@/components/TeamChatConversation";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTeamChats } from "@/hooks/useTeamChats";
import { useIsMobile } from "@/hooks/use-mobile";
import { Users, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { getAIAssistantChatId, isAIAssistantChatId, isProjectChannelId, isTeamChannelId, isDirectMessageId, getDirectMessageChatId } from "@/hooks/useChatId";

type MobileTab = "contacts" | "messages";

// Helper functions for localStorage - scoped per organization
const getLastSelectedChatKey = (userEmail: string, orgId: string) => {
  return `last_selected_chat_${userEmail.toLowerCase()}_${orgId}`;
};

const saveLastSelectedChat = (userEmail: string, orgId: string, chatId: string, selectedMember: string) => {
  try {
    const key = getLastSelectedChatKey(userEmail, orgId);
    localStorage.setItem(key, JSON.stringify({ chatId, selectedMember }));
  } catch (error) {
    console.error('Failed to save last selected chat:', error);
  }
};

const loadLastSelectedChat = (userEmail: string, orgId: string): { chatId: string; selectedMember: string } | null => {
  try {
    const key = getLastSelectedChatKey(userEmail, orgId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load last selected chat:', error);
  }
  return null;
};

export default function Chats() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const [selectedChat, setSelectedChat] = useState<{ chatId: string; selectedMember: string } | null>(null);
  const { setSelectedChat: setSelectedChatInHook, allTeamMembers, projects, teams } = useTeamChats();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<MobileTab>("contacts");
  const hasInitializedRef = useRef(false);
  const previousOrgIdRef = useRef<string | null>(null);

  // Validate if a chat still exists
  const validateChatExists = useCallback((chatId: string, selectedMember: string): boolean => {
    if (isAIAssistantChatId(chatId)) {
      return true; // AI chat always exists
    }
    
    if (isProjectChannelId(chatId)) {
      // If we have projects loaded, validate; otherwise assume valid for now
      if (projects.length > 0) {
        const projectId = selectedMember.replace("project-", "");
        return projects.some(p => p.name.toLowerCase().replace(/\s+/g, '-') === projectId);
      }
      return true; // Data not loaded yet, assume valid
    }
    
    if (isTeamChannelId(chatId)) {
      // If we have teams loaded, validate; otherwise assume valid for now
      if (teams.length > 0) {
        const teamId = selectedMember.replace("team-", "");
        return teams.some(t => t.name.toLowerCase().replace(/\s+/g, '-') === teamId);
      }
      return true; // Data not loaded yet, assume valid
    }
    
    if (isDirectMessageId(chatId)) {
      // For DMs, we need to be more strict - if we have members loaded, validate
      // If no members are loaded yet, we can't validate, so return false to be safe
      if (allTeamMembers.length === 0) {
        // No members loaded - if this is a DM, it's likely invalid
        return false;
      }
      
      // For DMs, check if the other user still exists
      if (selectedMember.includes('@')) {
        return allTeamMembers.some(m => m.email?.toLowerCase() === selectedMember.toLowerCase());
      } else {
        return allTeamMembers.some(m => m.id === selectedMember);
      }
    }
    
    return false;
  }, [projects, teams, allTeamMembers]);

  // Reset selected chat when organization changes
  useEffect(() => {
    const previousOrgId = previousOrgIdRef.current;
    const currentOrgId = currentOrg?.id || null;
    
    // If org changed, clear selected chat and reset initialization
    if (previousOrgId !== null && previousOrgId !== currentOrgId) {
      setSelectedChat(null);
      hasInitializedRef.current = false;
    }
    
    previousOrgIdRef.current = currentOrgId;
  }, [currentOrg?.id]);

  // Restore last selected chat on mount or when org changes
  useEffect(() => {
    if (!user?.email || !currentOrg?.id || hasInitializedRef.current || selectedChat) return;
    
    const lastChat = loadLastSelectedChat(user.email, currentOrg.id);
    
    // Always try to restore last chat (validation is best-effort)
    // If chat doesn't exist, UI will handle it gracefully
    if (lastChat) {
      // Validate if we have the data, otherwise assume valid
      const isValid = validateChatExists(lastChat.chatId, lastChat.selectedMember);
      
      if (isValid) {
        // Restore last chat
        setSelectedChat(lastChat);
        setSelectedChatInHook(lastChat.chatId);
        hasInitializedRef.current = true;
        if (isMobile) {
          setActiveTab("messages");
        }
        return;
      } else {
        // Invalid chat - clear it from storage
        if (user?.email && currentOrg?.id) {
          const key = getLastSelectedChatKey(user.email, currentOrg.id);
          localStorage.removeItem(key);
        }
      }
    }
    
    // Only fallback to AI chat if there are other members, projects, or teams
    // If there are no other members, don't set a default chat (show nothing)
    const hasOtherMembers = allTeamMembers.length > 0;
    const hasProjectsOrTeams = projects.length > 0 || teams.length > 0;
    
    if (hasOtherMembers || hasProjectsOrTeams) {
      // Fallback to AI chat if no valid last chat but there are other members/projects/teams
      const chatId = getAIAssistantChatId(user.email);
      setSelectedChat({ chatId, selectedMember: "ai-assistant" });
      setSelectedChatInHook(chatId);
      hasInitializedRef.current = true;
      if (isMobile) {
        setActiveTab("messages");
      }
    } else {
      // No other members, projects, or teams - don't set a default chat
      hasInitializedRef.current = true;
    }
  }, [user?.email, currentOrg?.id, allTeamMembers, projects, teams, setSelectedChatInHook, isMobile, selectedChat]);

  // Check if a chat is valid to display (not Unknown when there are no members)
  const isChatValidToDisplay = useCallback((chatId: string, selectedMember: string): boolean => {
    // If it's a direct message and there are no other members, it's invalid
    if (isDirectMessageId(chatId) && allTeamMembers.length === 0) {
      return false;
    }
    
    // For DMs, also check that the member actually exists in allTeamMembers
    if (isDirectMessageId(chatId) && allTeamMembers.length > 0) {
      const memberExists = selectedMember.includes('@')
        ? allTeamMembers.some(m => m.email?.toLowerCase() === selectedMember.toLowerCase())
        : allTeamMembers.some(m => m.id === selectedMember);
      
      if (!memberExists) {
        return false;
      }
    }
    
    // Validate the chat exists
    return validateChatExists(chatId, selectedMember);
  }, [allTeamMembers, validateChatExists]);

  // Validate and clear invalid chats after data loads
  useEffect(() => {
    if (!selectedChat || !user?.email || !currentOrg?.id) return;
    
    // Re-validate the current chat after data loads
    const isValid = isChatValidToDisplay(selectedChat.chatId, selectedChat.selectedMember);
    
    if (!isValid) {
      // Chat is invalid - clear it
      setSelectedChat(null);
      setSelectedChatInHook(null);
      
      // Clear from storage
      const key = getLastSelectedChatKey(user.email, currentOrg.id);
      localStorage.removeItem(key);
    }
  }, [selectedChat, allTeamMembers, projects, teams, user?.email, currentOrg?.id, setSelectedChatInHook, isChatValidToDisplay]);


  // Handle chat selection from TeamChatSidebar
  const handleSelectChat = (chatId: string, selectedMember: string) => {
    // Only set chat if it's valid
    if (!isChatValidToDisplay(chatId, selectedMember)) {
      setSelectedChat(null);
      setSelectedChatInHook(null);
      return;
    }
    
    setSelectedChat({ chatId, selectedMember });
    setSelectedChatInHook(chatId); // Update the hook's selectedChat to trigger unread count clearing
    
    // Save to localStorage (scoped per organization)
    if (user?.email && currentOrg?.id) {
      saveLastSelectedChat(user.email, currentOrg.id, chatId, selectedMember);
    }
    
    // On mobile, switch to messages tab when a chat is selected
    if (isMobile) {
      setActiveTab("messages");
    }
  };

  // Listen for team chat open events (from other parts of the app)
  useEffect(() => {
    const handleOpenTeamChat = (event: CustomEvent<{ chatId: string; selectedMember: string }>) => {
      const { chatId, selectedMember } = event.detail;
      setSelectedChat({ chatId, selectedMember });
      setSelectedChatInHook(chatId); // Update the hook's selectedChat to trigger unread count clearing
      
      // Save to localStorage (scoped per organization)
      if (user?.email && currentOrg?.id) {
        saveLastSelectedChat(user.email, currentOrg.id, chatId, selectedMember);
      }
      
      // On mobile, switch to messages tab when a chat is opened
      if (isMobile) {
        setActiveTab("messages");
      }
    };
    
    window.addEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    return () => {
      window.removeEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    };
  }, [setSelectedChatInHook, isMobile, user?.email, currentOrg?.id]);

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] overflow-hidden -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 -mb-4 sm:-mb-6">
      {/* Desktop: Side-by-side layout */}
      <div className="hidden sm:flex flex-1 overflow-hidden min-h-0">
        <div className="w-64 border-r bg-muted/30 flex flex-col flex-shrink-0 h-full">
          <div className="p-4 border-b flex-shrink-0">
            <h2 className="font-semibold text-lg">Chats</h2>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <TeamChatSidebar onSelectChat={handleSelectChat} />
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-full border-l">
          {selectedChat && isChatValidToDisplay(selectedChat.chatId, selectedChat.selectedMember) ? (
            <TeamChatConversation 
              chatId={selectedChat.chatId} 
              selectedMember={selectedChat.selectedMember} 
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold mb-2">Select a chat to start messaging</h3>
                <p className="text-sm text-muted-foreground">
                  {allTeamMembers.length === 0 && projects.length === 0 && teams.length === 0
                    ? "There are no members, projects, or teams in this organization to chat with."
                    : "Choose a conversation from the sidebar to view and send messages."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: Tab-based layout */}
      <div className="flex sm:hidden flex-1 flex-col overflow-hidden min-h-0">
        {/* Tab Content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {activeTab === "contacts" ? (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="p-4 border-b flex-shrink-0">
                <h2 className="font-semibold text-lg">Chats</h2>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <TeamChatSidebar onSelectChat={handleSelectChat} />
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col overflow-hidden">
              {selectedChat && isChatValidToDisplay(selectedChat.chatId, selectedChat.selectedMember) ? (
                <TeamChatConversation 
                  chatId={selectedChat.chatId} 
                  selectedMember={selectedChat.selectedMember} 
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <h3 className="text-lg font-semibold mb-2">Select a chat to start messaging</h3>
                    <p className="text-sm text-muted-foreground">
                      {allTeamMembers.length === 0 && projects.length === 0 && teams.length === 0
                        ? "There are no members, projects, or teams in this organization to chat with."
                        : "Choose a conversation from the contacts tab to view and send messages."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <div className="sm:hidden border-t bg-background z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            <button
              onClick={() => setActiveTab("contacts")}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-2 transition-colors",
                activeTab === "contacts"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Users className="h-4 w-4" />
              <span className="text-[10px] font-medium">Contacts</span>
            </button>
            <button
              onClick={() => setActiveTab("messages")}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-2 transition-colors",
                activeTab === "messages"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <MessageSquare className="h-4 w-4" />
              <span className="text-[10px] font-medium">Messages</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

