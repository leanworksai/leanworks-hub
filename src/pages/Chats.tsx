import { TeamChatSidebar } from "@/components/TeamChatSidebar";
import { TeamChatConversation } from "@/components/TeamChatConversation";
import { useState, useEffect } from "react";
import { useTeamChats } from "@/hooks/useTeamChats";

export default function Chats() {
  const [selectedChat, setSelectedChat] = useState<{ chatId: string; selectedMember: string } | null>(null);
  const { setSelectedChat: setSelectedChatInHook } = useTeamChats();

  // Handle chat selection from TeamChatSidebar
  const handleSelectChat = (chatId: string, selectedMember: string) => {
    setSelectedChat({ chatId, selectedMember });
    setSelectedChatInHook(chatId); // Update the hook's selectedChat to trigger unread count clearing
  };

  // Listen for team chat open events (from other parts of the app)
  useEffect(() => {
    const handleOpenTeamChat = (event: CustomEvent<{ chatId: string; selectedMember: string }>) => {
      setSelectedChat({ chatId: event.detail.chatId, selectedMember: event.detail.selectedMember });
      setSelectedChatInHook(event.detail.chatId); // Update the hook's selectedChat to trigger unread count clearing
    };
    
    window.addEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    return () => {
      window.removeEventListener('openTeamChat', handleOpenTeamChat as EventListener);
    };
  }, [setSelectedChatInHook]);

  return (
    <div className="flex h-[calc(100vh-4rem-2rem)] max-h-[calc(100vh-4rem-2rem)] overflow-hidden -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 -mb-4 sm:-mb-6">
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
  );
}

