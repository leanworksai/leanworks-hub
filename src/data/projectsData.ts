export interface ProjectMember {
  id: string; // Email address of the member
  email?: string; // Email address (may be same as id)
  name: string;
  role: string;
  avatar: string;
}

export interface Task {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "completed";
  assigneeId?: string; // User ID (email address) - display name is fetched from users table
  assignee?: string; // Display name of the assignee (used directly without joining users table)
  assigneeAvatar?: string; // Optional: cached avatar initials, can be derived from user name
  dueDate: string;
  reason?: string; // Reason/context for the task (displayed similar to progress summary for projects)
}

export interface ProgressUpdate {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  update: string;
}

export interface Comment {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  comment: string;
}

export interface Project {
  id: string; // Unique identifier
  name: string;
  description: string;
  detailedDescription: string;
  status: string;
  team: number;
  dueDate?: string;
  createdDate: string;
  statusColor: string;
  ownerEmail?: string; // Email of the project owner/creator
  members: ProjectMember[];
  tasks: Task[];
  progressUpdates: ProgressUpdate[];
  comments: Comment[];
  summary: {
    accomplishment: string;
    decision: string;
    risk: string;
    direction: string;
  };
}
