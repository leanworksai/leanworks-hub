import { TeamChatSidebar } from "@/components/TeamChatSidebar";
import { TeamChatConversation } from "@/components/TeamChatConversation";
import { useState, useEffect, useRef } from "react";
import { useTeamChats } from "@/hooks/useTeamChats";
import { useIsMobile } from "@/hooks/use-mobile";
import { Users, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getAIAssistantChatId } from "@/hooks/useChatId";

type MobileTab = "contacts" | "messages";

export default function Chats() {
  const { user } = useAuth();
  const [selectedChat, setSelectedChat] = useState<{ chatId: string; selectedMember: string } | null>(null);
  const { setSelectedChat: setSelectedChatInHook } = useTeamChats();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<MobileTab>("contacts");

  // Open AI chat by default when user first visits the page
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (user?.email && !selectedChat && !hasInitializedRef.current) {
      const chatId = getAIAssistantChatId(user.email);
      setSelectedChat({ chatId, selectedMember: "ai-assistant" });
      setSelectedChatInHook(chatId);
      hasInitializedRef.current = true;
      if (isMobile) {
        setActiveTab("messages");
      }
    }
  }, [user?.email, selectedChat, setSelectedChatInHook, isMobile]);

  // Handle chat selection from TeamChatSidebar
  const handleSelectChat = (chatId: string, selectedMember: string) => {
    setSelectedChat({ chatId, selectedMember });
    setSelectedChatInHook(chatId); // Update the hook's selectedChat to trigger unread count clearing
    // On mobile, switch to messages tab when a chat is selected
    if (isMobile) {
      setActiveTab("messages");
    }
  };

  // Listen for team chat open events (from other parts of the app)
  useEffect(() => {
    const handleOpenTeamChat = (event: CustomEvent<{ chatId: string; selectedMember: string }>) => {
      setSelectedChat({ chatId: event.detail.chatId, selectedMember: event.detail.selectedMember });
      setSelectedChatInHook(event.detail.chatId); // Update the hook's selectedChat to trigger unread count clearing
      // On mobile, switch to messages tab when a chat is opened
      if (isMobile) {
        setActiveTab("messages");
      }
    };
    
    window.addEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    return () => {
      window.removeEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    };
  }, [setSelectedChatInHook, isMobile]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem-2rem)] max-h-[calc(100vh-4rem-2rem)] overflow-hidden -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 -mb-4 sm:-mb-6">
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
          {selectedChat ? (
            <TeamChatConversation 
              chatId={selectedChat.chatId} 
              selectedMember={selectedChat.selectedMember} 
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold mb-2">Select a chat to start messaging</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a conversation from the sidebar to view and send messages.
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
              {selectedChat ? (
                <TeamChatConversation 
                  chatId={selectedChat.chatId} 
                  selectedMember={selectedChat.selectedMember} 
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center max-w-md">
                    <h3 className="text-lg font-semibold mb-2">Select a chat to start messaging</h3>
                    <p className="text-sm text-muted-foreground">
                      Choose a conversation from the contacts tab to view and send messages.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <div className="sm:hidden border-t bg-background z-50">
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

