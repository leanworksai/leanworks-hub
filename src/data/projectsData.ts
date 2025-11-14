export interface ProjectMember {
  id: string; // Email address of the member
  name: string;
  role: string;
  avatar: string;
}

export interface Task {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "completed";
  assignee: string;
  dueDate: string;
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
  dueDate: string;
  createdDate: string;
  statusColor: string;
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
