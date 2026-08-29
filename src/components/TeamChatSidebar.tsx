import { Hash, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getAvatarColor } from "@/lib/utils";
import { useTeamChats } from "@/hooks/useTeamChats";
import { getDirectMessageChatId } from "@/hooks/useChatId";
import { useAuth } from "@/contexts/AuthContext";

interface TeamChatSidebarProps {
  onSelectChat: (chatId: string, selectedMember: string) => void;
}

export function TeamChatSidebar({ onSelectChat }: TeamChatSidebarProps) {
  const { user } = useAuth();
  const { selectedChat, setSelectedChat, unreadCounts, allTeamMembers, projects, teams } = useTeamChats();

  const handleSelectChat = (chatId: string, selectedMember: string) => {
    setSelectedChat(chatId);
    onSelectChat(chatId, selectedMember);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Chat List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {/* Channels Section */}
          {(projects.length > 0 || teams.length > 0) && (
            <div className="px-2 py-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                Projects
              </div>
              <div className="space-y-1">
                {projects.length > 0 || teams.length > 0 ? (
                  <>
                    {projects.map((project) => {
                      const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
                      const projectChatId = `project-${projectId}`;
                      const projectUnreadCount = unreadCounts.get(projectChatId) || 0;
                      const isSelected = selectedChat === projectChatId;
                      return (
                        <button
                          key={project.id}
                          onClick={() => handleSelectChat(projectChatId, projectChatId)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group relative",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : projectUnreadCount > 0
                              ? "bg-primary/10 hover:bg-primary/20"
                              : "hover:bg-muted"
                          )}
                        >
                          <Hash className="h-4 w-4 flex-shrink-0" />
                          <span className={cn(
                            "flex-1 text-left truncate",
                            projectUnreadCount > 0 && !isSelected && "font-semibold"
                          )}>{project.name}</span>
                          {projectUnreadCount > 0 && !isSelected && (
                            <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                          )}
                        </button>
                      );
                    })}
                    {teams.map((team) => {
                      const teamId = team.name.toLowerCase().replace(/\s+/g, '-');
                      const teamChatId = `team-${teamId}`;
                      const teamUnreadCount = unreadCounts.get(teamChatId) || 0;
                      const isSelected = selectedChat === teamChatId;
                      return (
                        <button
                          key={`team-${teamId}`}
                          onClick={() => handleSelectChat(teamChatId, teamChatId)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors group relative",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : teamUnreadCount > 0
                              ? "bg-primary/10 hover:bg-primary/20"
                              : "hover:bg-muted"
                          )}
                        >
                          <Users className="h-4 w-4 flex-shrink-0" />
                          <span className={cn(
                            "flex-1 text-left truncate",
                            teamUnreadCount > 0 && !isSelected && "font-semibold"
                          )}>{team.name}</span>
                          {teamUnreadCount > 0 && !isSelected && (
                            <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                          )}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No channels
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Direct Messages Section */}
          {(projects.length > 0 || teams.length > 0 || allTeamMembers.length > 0) && (
            <Separator className="my-2" />
          )}

          <div className="px-2 py-1.5">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
              Contacts
            </div>
            <div className="space-y-1">
              {allTeamMembers.length > 0 ? (
                allTeamMembers.map((member) => {
                  const memberChatId = user?.email && member.email 
                    ? getDirectMessageChatId(user.email, member.email)
                    : member.id;
                  const memberUnreadCount = unreadCounts.get(memberChatId) || 0;
                  const isSelected = selectedChat === memberChatId;
                  return (
                    <button
                      key={member.id}
                      onClick={() => handleSelectChat(memberChatId, member.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors relative",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : memberUnreadCount > 0
                          ? "bg-primary/10 hover:bg-primary/20"
                          : "hover:bg-muted"
                      )}
                    >
                      <Avatar className="h-6 w-6 flex-shrink-0">
                        <AvatarFallback className={`text-xs ${getAvatarColor((member.email || member.id)?.toLowerCase())}`}>
                          {member.avatar}
                        </AvatarFallback>
                      </Avatar>
                      <span className={cn(
                        "flex-1 text-left truncate",
                        memberUnreadCount > 0 && !isSelected && "font-semibold"
                      )}>{member.name}</span>
                      {memberUnreadCount > 0 && !isSelected && (
                        <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-background" />
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No users found
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

