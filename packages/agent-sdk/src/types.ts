/**
 * LeanWorks Agent SDK — Type Definitions
 */

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  orgId: string;
  timeout?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeType: string;
  projectId: string | null;
  projectName: string | null;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  comments?: Comment[];
}

export interface Comment {
  id: string;
  memberName: string;
  authorType: string;
  comment: string;
  date: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  ownerEmail: string;
  dueDate: string | null;
  createdAt: string;
  members?: { email: string; role: string }[];
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string;
  endDate: string;
  totalBudget: number;
  currency: string;
  spentToDate: number;
  healthScore: number;
  healthTrend: string;
  objectives?: Objective[];
  milestones?: Milestone[];
}

export interface Objective {
  id: string;
  text: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: string;
}

export interface Milestone {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  description: string | null;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  agentType: string;
  status: string;
  capabilities: any[];
  totalTasksCompleted: number;
  averageResponseTimeMs: number | null;
}

export interface Subscription {
  id: string;
  eventPattern: string;
  filterCriteria: Record<string, any>;
  deliveryMethod: 'webhook' | 'sse';
  webhookUrl: string | null;
  isActive: boolean;
}

export interface PlatformEvent {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  orgId: string;
  actorType: string;
  actorId: string;
  payload: Record<string, any>;
  mentions: string[];
  timestamp: string;
}

export interface TeamMember {
  email: string;
  name: string;
  jobTitle: string | null;
  role: string;
}
