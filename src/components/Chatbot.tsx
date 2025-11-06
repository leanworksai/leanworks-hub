import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageCircle, X, Send, Bot, User, FolderOpen, CheckSquare, ChevronDown, Search, Users, Hash, Activity, Filter, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTeamData } from "@/data/teamsData";
import { projects, Project } from "@/data/projectsData";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  email?: string;
}

interface ChannelMessage {
  id: string;
  memberName: string;
  memberAvatar: string;
  content: string;
  timestamp: Date;
  projectId: string;
}

interface SearchResult {
  id: string;
  type: "activity" | "task" | "comment" | "update" | "channel-message";
  title: string;
  content: string;
  memberName: string;
  memberAvatar: string;
  date: string;
}

// Get all team members from teams data
const getAllTeamMembers = (): TeamMember[] => {
  const teamData = getTeamData();
  const memberMap = new Map<string, TeamMember>();
  
  Object.values(teamData).forEach((team) => {
    team.members.forEach((member) => {
      if (!memberMap.has(member.name)) {
        memberMap.set(member.name, {
          id: member.name.toLowerCase().replace(/\s+/g, '-'),
          name: member.name,
          role: member.role,
          avatar: member.avatar,
          email: member.email,
        });
      }
    });
  });
  
  return Array.from(memberMap.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export function Chatbot() {
  const { selectedProjects } = useSelectedProjects();
  const { selectedTasks } = useSelectedTasks();
  const { selectedTeams } = useSelectedTeams();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<string>("ai-assistant");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm your AI assistant. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [channelMessages, setChannelMessages] = useState<Map<string, ChannelMessage[]>>(new Map());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [filterType, setFilterType] = useState<"all" | "activities" | "tasks" | "comments">("all");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);

  const allTeamMembers = getAllTeamMembers();
  
  // Check if selected member is a project channel
  const isProjectChannel = selectedMember.startsWith("project-");
  const selectedProjectId = isProjectChannel ? selectedMember.replace("project-", "") : null;
  const selectedProject = selectedProjectId 
    ? projects.find(p => p.name.toLowerCase().replace(/\s+/g, '-') === selectedProjectId)
    : null;
  
  // Filter team members based on search query
  const filteredTeamMembers = memberSearchQuery.trim() === ""
    ? allTeamMembers
    : allTeamMembers.filter((member) =>
        member.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        member.role.toLowerCase().includes(memberSearchQuery.toLowerCase())
      );

  // Filter projects based on search query
  const filteredProjects = memberSearchQuery.trim() === ""
    ? projects
    : projects.filter((project) =>
        project.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
        project.description.toLowerCase().includes(memberSearchQuery.toLowerCase())
      );

  const currentMember = selectedMember === "ai-assistant" 
    ? { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" }
    : isProjectChannel && selectedProject
    ? { id: selectedMember, name: selectedProject.name, role: "Project Channel", avatar: "#" }
    : allTeamMembers.find(m => m.id === selectedMember) || { id: "ai-assistant", name: "AI Assistant", role: "Assistant", avatar: "AI" };

  // Check if AI Assistant matches search query
  const aiAssistantMatches = memberSearchQuery.trim() === "" || 
    "ai assistant".includes(memberSearchQuery.toLowerCase()) ||
    "assistant".includes(memberSearchQuery.toLowerCase());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Perform search through project activities when in project channel mode
  useEffect(() => {
    if (!isProjectChannel || !selectedProject || !memberSearchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const query = memberSearchQuery.toLowerCase();
    const results: SearchResult[] = [];

    // Search through progress updates
    if (filterType === "all" || filterType === "activities") {
      selectedProject.progressUpdates.forEach((update) => {
        if (
          update.update.toLowerCase().includes(query) ||
          update.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: update.id,
            type: "update",
            title: `Progress Update by ${update.memberName}`,
            content: update.update,
            memberName: update.memberName,
            memberAvatar: update.memberAvatar,
            date: update.date,
          });
        }
      });
    }

    // Search through comments
    if (filterType === "all" || filterType === "comments") {
      selectedProject.comments.forEach((comment) => {
        if (
          comment.comment.toLowerCase().includes(query) ||
          comment.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: comment.id,
            type: "comment",
            title: `Comment by ${comment.memberName}`,
            content: comment.comment,
            memberName: comment.memberName,
            memberAvatar: comment.memberAvatar,
            date: comment.date,
          });
        }
      });
    }

    // Search through tasks
    if (filterType === "all" || filterType === "tasks") {
      selectedProject.tasks.forEach((task) => {
        if (
          task.title.toLowerCase().includes(query) ||
          task.assignee.toLowerCase().includes(query) ||
          task.status.toLowerCase().includes(query)
        ) {
          results.push({
            id: task.id,
            type: "task",
            title: task.title,
            content: `Status: ${task.status} | Assignee: ${task.assignee} | Due: ${task.dueDate}`,
            memberName: task.assignee,
            memberAvatar: task.assignee.charAt(0).toUpperCase(),
            date: task.dueDate,
          });
        }
      });
    }

    // Search through channel messages
    if (filterType === "all" || filterType === "comments") {
      const projectMessages = channelMessages.get(selectedProjectId!) || [];
      projectMessages.forEach((message) => {
        if (
          message.content.toLowerCase().includes(query) ||
          message.memberName.toLowerCase().includes(query)
        ) {
          results.push({
            id: message.id,
            type: "channel-message",
            title: `Channel message by ${message.memberName}`,
            content: message.content,
            memberName: message.memberName,
            memberAvatar: message.memberAvatar,
            date: message.timestamp.toLocaleDateString(),
          });
        }
      });
    }

    // Sort by relevance
    results.sort((a, b) => {
      const aExact = a.content.toLowerCase() === query || a.title.toLowerCase() === query;
      const bExact = b.content.toLowerCase() === query || b.title.toLowerCase() === query;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    setSearchResults(results);
    setIsSearching(results.length > 0 || memberSearchQuery.trim().length > 0);
  }, [memberSearchQuery, isProjectChannel, selectedProject, filterType, selectedProjectId, channelMessages]);

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        scrollToBottom();
        if (isProjectChannel && isSearching) {
          memberSearchRef.current?.focus();
        } else {
          inputRef.current?.focus();
        }
      }, 100);
    }
  }, [messages, channelMessages, isOpen, selectedProjects, selectedTasks, selectedTeams, isProjectChannel, isSearching]);

  // Clear messages when switching between different chat types
  useEffect(() => {
    if (selectedMember === "ai-assistant") {
      // Restore AI Assistant greeting when switching back to AI Assistant (only if messages are empty)
      setMessages((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: "1",
              role: "assistant",
              content: "Hello! I'm your AI assistant. How can I help you today?",
              timestamp: new Date(),
            },
          ];
        }
        return prev;
      });
    } else if (!isProjectChannel) {
      // Clear messages when switching to a team member (not project channel)
      setMessages([]);
    }
    // Don't clear messages when switching between project channels or team members
  }, [selectedMember, isProjectChannel]);

  const generateResponse = async (userMessage: string): Promise<string> => {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    const lowerMessage = userMessage.toLowerCase();

    // Build context from selected projects
    let contextInfo = "";
    if (selectedProjects.length > 0) {
      contextInfo = "\n\n[Context - Selected Projects:]\n";
      selectedProjects.forEach((project) => {
        contextInfo += `- ${project.name}: ${project.description}\n`;
        contextInfo += `  Status: ${project.status}, Due: ${project.dueDate}\n`;
        contextInfo += `  Team: ${project.team} members\n`;
        contextInfo += `  Summary: ${project.summary.accomplishment}\n`;
        contextInfo += `  Tasks: ${project.tasks.length} total (${project.tasks.filter(t => t.status === "completed").length} completed, ${project.tasks.filter(t => t.status === "in-progress").length} in progress)\n`;
      });
    }

    // Build context from selected tasks
    let tasksContextInfo = "";
    if (selectedTasks.length > 0) {
      tasksContextInfo = "\n\n[Context - Selected Tasks:]\n";
      selectedTasks.forEach((task) => {
        tasksContextInfo += `- ${task.title}: ${task.description}\n`;
        tasksContextInfo += `  Status: ${task.status}, Priority: ${task.priority}\n`;
        tasksContextInfo += `  Assignee: ${task.assignee}, Due: ${task.dueDate}\n`;
        tasksContextInfo += `  Project: ${task.project}\n`;
        tasksContextInfo += `  Progress Updates: ${task.progressUpdates.length}\n`;
      });
    }

    // Build context from selected teams
    let teamsContextInfo = "";
    if (selectedTeams.length > 0) {
      teamsContextInfo = "\n\n[Context - Selected Teams:]\n";
      selectedTeams.forEach((team) => {
        teamsContextInfo += `- ${team.name}: ${team.description}\n`;
        teamsContextInfo += `  Members: ${team.members}, Projects: ${team.projects}\n`;
      });
    }

    // Simple response logic - can be replaced with actual AI API
    if (lowerMessage.includes("hello") || lowerMessage.includes("hi") || lowerMessage.includes("hey")) {
      let greeting = "Hello! I'm here to help you with any questions about your projects, tasks, or team. What would you like to know?";
      if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
        const parts = [];
        if (selectedProjects.length > 0) {
          parts.push(`${selectedProjects.length} project(s): ${selectedProjects.map(p => p.name).join(", ")}`);
        }
        if (selectedTasks.length > 0) {
          parts.push(`${selectedTasks.length} task(s): ${selectedTasks.map(t => t.title).join(", ")}`);
        }
        if (selectedTeams.length > 0) {
          parts.push(`${selectedTeams.length} team(s): ${selectedTeams.map(t => t.name).join(", ")}`);
        }
        greeting += `\n\nI can see you have ${parts.join(" and ")} selected. Feel free to ask me anything about them!`;
      }
      return greeting;
    }

    if (lowerMessage.includes("project")) {
      let response = "I can help you with project-related questions. You can view all your projects on the Projects page, and see detailed information including tasks, team members, and progress updates for each project.";
      if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nYou can ask me specific questions about any of these selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("task")) {
      let response = "Tasks are displayed on the Tasks page where you can see all tasks with their progress updates. Each task shows status, priority, assignee, and a timeline of progress updates. You can filter tasks by status or priority.";
      if (selectedTasks.length > 0) {
        response += tasksContextInfo;
        response += "\nI can provide details about any of these selected tasks!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can provide details about tasks in your selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("team")) {
      let response = "Teams are managed on the Teams page. You can see team members, their roles, and team details. Teams are associated with projects and help organize collaboration.";
      if (selectedTeams.length > 0) {
        response += teamsContextInfo;
        response += "\nI can provide details about any of these selected teams!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can tell you about the teams working on your selected projects!";
      }
      return response;
    }

    if (lowerMessage.includes("help") || lowerMessage.includes("what can you do")) {
      let response = "I can help you with:\n• Questions about projects and their status\n• Information about tasks and progress\n• Team and collaboration queries\n• General navigation and feature questions\n\nJust ask me anything!";
      if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
        if (selectedProjects.length > 0) {
          response += contextInfo;
        }
        if (selectedTasks.length > 0) {
          response += tasksContextInfo;
        }
        if (selectedTeams.length > 0) {
          response += teamsContextInfo;
        }
        response += "\n\nI have context about your selected items, so I can provide more specific answers!";
      }
      return response;
    }

    if (lowerMessage.includes("status") || lowerMessage.includes("progress")) {
      let response = "You can check project status on the Projects page, and task progress on the Tasks page. Each task shows detailed progress updates in a timeline format, making it easy to track what's happening.";
      if (selectedTasks.length > 0) {
        response += tasksContextInfo;
        response += "\nAsk me about the status or progress of any selected task!";
      } else if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nAsk me about the status or progress of any selected project!";
      }
      return response;
    }

    if (lowerMessage.includes("due date") || lowerMessage.includes("deadline")) {
      let response = "Due dates are displayed for both projects and tasks. On the Projects page, you'll see project due dates. On the Tasks page, each task shows its due date along with other details.";
      if (selectedProjects.length > 0) {
        response += contextInfo;
        response += "\nI can tell you about the deadlines for your selected projects!";
      }
      return response;
    }

    // Default response with context
    let defaultResponse = `I understand you're asking about "${userMessage}". While I'm a helpful assistant, I'm currently set up to answer questions about your projects, tasks, teams, and general navigation. Could you rephrase your question, or would you like to know more about a specific feature?`;
    if (selectedProjects.length > 0 || selectedTasks.length > 0 || selectedTeams.length > 0) {
      if (selectedProjects.length > 0) {
        defaultResponse += contextInfo;
      }
      if (selectedTasks.length > 0) {
        defaultResponse += tasksContextInfo;
      }
      if (selectedTeams.length > 0) {
        defaultResponse += teamsContextInfo;
      }
      defaultResponse += "\n\nI have information about your selected items that might help answer your question!";
    }
    return defaultResponse;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // Handle project channel messages
    if (isProjectChannel && selectedProjectId) {
      const newChannelMessage: ChannelMessage = {
        id: `channel-${Date.now()}`,
        memberName: "You", // In a real app, this would be the current user
        memberAvatar: "U",
        content: input.trim(),
        timestamp: new Date(),
        projectId: selectedProjectId,
      };

      setChannelMessages((prev) => {
        const projectMessages = prev.get(selectedProjectId) || [];
        const newMap = new Map(prev);
        newMap.set(selectedProjectId, [...projectMessages, newChannelMessage]);
        return newMap;
      });
      setInput("");
      return;
    }

    // Handle AI Assistant or team member messages
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await generateResponse(userMessage.content);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I apologize, but I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300",
          isOpen ? "scale-0 opacity-0" : "scale-100 opacity-100"
        )}
        size="icon"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {/* Chat Window */}
      <Card
        className={cn(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-md h-[600px] flex flex-col shadow-2xl transition-all duration-300 border",
          isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4 pointer-events-none"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-primary/5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className={cn(
                "text-primary-foreground",
                selectedMember === "ai-assistant" ? "bg-primary" : isProjectChannel ? "bg-primary/10" : "bg-muted"
              )}>
                {selectedMember === "ai-assistant" ? (
                  <Bot className="h-4 w-4" />
                ) : isProjectChannel ? (
                  <Hash className="h-4 w-4 text-primary" />
                ) : (
                  <span className="text-xs">{currentMember.avatar}</span>
                )}
              </AvatarFallback>
            </Avatar>
            <Select 
              value={selectedMember} 
              onValueChange={(value) => {
                setSelectedMember(value);
                setMemberSearchQuery(""); // Clear search when selection is made
              }}
              onOpenChange={(open) => {
                if (open) {
                  // Focus search input when dropdown opens
                  setTimeout(() => {
                    memberSearchRef.current?.focus();
                  }, 100);
                } else {
                  // Clear search when dropdown closes
                  setMemberSearchQuery("");
                }
              }}
            >
              <SelectTrigger className="w-auto min-w-[180px] h-auto border-none bg-transparent shadow-none hover:bg-transparent focus:ring-0 p-0 cursor-pointer">
                <SelectValue>
                  <div className="flex flex-col items-start">
                    <h3 className="font-semibold text-sm">{currentMember.name}</h3>
                    <p className="text-xs text-muted-foreground">Online</p>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[400px] p-0">
                {/* Search Input */}
                <div className="flex items-center border-b px-3 py-2 sticky top-0 bg-background z-10">
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    ref={memberSearchRef}
                    type="text"
                    placeholder="Search team members or projects..."
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="flex h-8 w-full rounded-md bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {/* AI Assistant - always shown if matches search or no search */}
                  {aiAssistantMatches && (
                    <SelectItem value="ai-assistant" className="py-2">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 flex-shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-medium">AI Assistant</span>
                          <span className="text-xs text-muted-foreground">Assistant</span>
                        </div>
                      </div>
                    </SelectItem>
                  )}
                  {/* Project Channels */}
                  {filteredProjects.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                        Project Channels
                      </div>
                      {filteredProjects.map((project) => {
                        const projectId = project.name.toLowerCase().replace(/\s+/g, '-');
                        return (
                          <SelectItem key={`project-${projectId}`} value={`project-${projectId}`} className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <Hash className="h-3 w-3 text-primary" />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-medium truncate">{project.name}</span>
                                <span className="text-xs text-muted-foreground truncate">Project Channel</span>
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                  {/* Team Members */}
                  {filteredTeamMembers.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                        Team Members
                      </div>
                      {filteredTeamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id} className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-medium">{member.avatar}</span>
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium truncate">{member.name}</span>
                              <span className="text-xs text-muted-foreground truncate">{member.role}</span>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {memberSearchQuery.trim() !== "" && filteredTeamMembers.length === 0 && filteredProjects.length === 0 && !aiAssistantMatches && (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No results found
                    </div>
                  )}
                </div>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search Bar for Project Channels */}
        {isProjectChannel && (
          <div className="border-b bg-background p-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={memberSearchRef}
                  placeholder="Search activities, tasks, comments..."
                  value={memberSearchQuery}
                  onChange={(e) => {
                    setMemberSearchQuery(e.target.value);
                  }}
                  className="pl-9"
                />
              </div>
              <Select value={filterType} onValueChange={(value: any) => setFilterType(value)}>
                <SelectTrigger className="w-[140px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="activities">Activities</SelectItem>
                  <SelectItem value="tasks">Tasks</SelectItem>
                  <SelectItem value="comments">Comments</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Messages */}
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Search Results for Project Channels */}
          {isProjectChannel && isSearching && memberSearchQuery.trim() && (
            <div className="space-y-3 mb-4">
              <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Search className="h-4 w-4" />
                {searchResults.length > 0 
                  ? `Found ${searchResults.length} result${searchResults.length > 1 ? 's' : ''}`
                  : "No results found"}
              </div>
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="p-3 rounded-lg bg-muted/50 border border-border hover:bg-muted transition-colors cursor-pointer"
                  onClick={() => {
                    setMemberSearchQuery("");
                    setIsSearching(false);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {result.type === "update" && <Activity className="h-3 w-3" />}
                      {result.type === "comment" && <MessageSquare className="h-3 w-3" />}
                      {result.type === "task" && <CheckSquare className="h-3 w-3" />}
                      {result.type === "channel-message" && <Hash className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-medium text-sm">{result.title}</p>
                        <Badge variant="outline" className="text-xs">
                          {result.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{result.date}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{result.content}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {result.memberAvatar}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground">{result.memberName}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Project Channel Messages */}
          {isProjectChannel && !isSearching && selectedProjectId && (
            <>
              {(() => {
                const projectMessages = channelMessages.get(selectedProjectId) || [];
                if (projectMessages.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <Hash className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">{selectedProject?.name} Channel</h3>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Start a conversation about this project. Your messages will be linked to project activities.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-4">
                    {projectMessages.map((message) => (
                      <div key={message.id} className="flex gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {message.memberAvatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm">{message.memberName}</p>
                            <span className="text-xs text-muted-foreground">
                              {message.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <div className="bg-muted rounded-lg px-4 py-2">
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* Regular Messages (AI Assistant or Team Members) */}
          {!isProjectChannel && messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "rounded-lg px-4 py-2 max-w-[80%]",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className="text-xs opacity-70 mt-1">
                  {message.timestamp.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {message.role === "user" && (
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="bg-muted">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          {isLoading && !isProjectChannel && (
            <div className="flex gap-3 justify-start">
              <Avatar className="h-8 w-8 flex-shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-lg px-4 py-2">
                <div className="flex gap-1">
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>

        {/* Input */}
        <div className="border-t bg-background">
          {/* Cited Projects Section */}
          {selectedProjects.length > 0 && (
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <FolderOpen className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-medium text-primary">Cited Projects:</span>
                {selectedProjects.map((project) => (
                  <Badge key={project.name} variant="secondary" className="text-xs">
                    {project.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Cited Tasks Section */}
          {selectedTasks.length > 0 && (
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-medium text-primary">Cited Tasks:</span>
                {selectedTasks.map((task) => (
                  <Badge key={task.id} variant="secondary" className="text-xs">
                    {task.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Cited Teams Section */}
          {selectedTeams.length > 0 && (
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Users className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span className="text-xs font-medium text-primary">Cited Teams:</span>
                {selectedTeams.map((team) => (
                  <Badge key={team.name} variant="secondary" className="text-xs">
                    {team.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="p-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isProjectChannel ? "Type a message in the project channel..." : "Type your message..."}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {isProjectChannel && (
              <p className="text-xs text-muted-foreground mt-2">
                Messages in this channel are linked to project activities
              </p>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

