export interface TaskProgressUpdate {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  update: string;
  type?: "progress" | "blocker" | "milestone" | "question";
}

export interface TaskComment {
  id: string;
  memberName: string;
  memberAvatar: string;
  date: string;
  comment: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "review" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";
  assignee?: string;
  assigneeAvatar?: string;
  project?: string;
  projectId?: string;
  teams?: string[]; // Teams that can see this task (for tasks without projects)
  createdBy?: string; // Email of the user who created the task
  dueDate: string;
  createdDate: string;
  createdAt?: number; // Timestamp in milliseconds for sorting
  estimatedHours?: number;
  actualHours?: number;
  tags: string[];
  progressUpdates: TaskProgressUpdate[];
  comments: TaskComment[];
}

