import { Project } from "@/data/projectsData";
import { Task } from "@/data/tasksData";
import { Team } from "@/data/teamsData";
import { Doc } from "@/data/docsData";

export interface CitedContext {
  projects?: Project[];
  tasks?: Task[];
  teams?: Team[];
  docs?: Doc[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  userId?: string;
  imageUrls?: string[];
  likes?: string[];
  citedContext?: CitedContext;
  memberName?: string;
  memberAvatar?: string;
}

export interface ChannelMessage {
  id: string;
  memberName: string;
  memberAvatar: string;
  content: string;
  timestamp: Date;
  projectId?: string;
  teamId?: string;
  userId?: string;
  imageUrls?: string[];
  likes?: string[];
  citedContext?: CitedContext;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  email?: string;
}

export interface LikedByUser {
  email: string;
  name: string;
  initials: string;
}

export type ChatType = 'dm' | 'ai-assistant' | 'project' | 'team';

