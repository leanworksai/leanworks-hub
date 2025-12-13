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
  assigneeId?: string; // User ID (email address) - display name is fetched from users table
  assignee?: string; // Display name of the assignee (used directly without joining users table)
  assigneeAvatar?: string; // Optional: cached avatar initials, can be derived from user name
  project?: string;
  projectId?: string;
  teams?: string[]; // Teams that can see this task (for tasks without projects)
  createdBy?: string; // Email of the user who created the task
  dueDate?: string;
  createdDate: string;
  createdAt?: number; // Timestamp in milliseconds for sorting
  estimatedHours?: number;
  actualHours?: number;
  tags: string[];
  progressUpdates: TaskProgressUpdate[];
  comments: TaskComment[];
  reason?: string; // Reason/context for the task (displayed similar to progress summary for projects)
}

