/**
 * Mock Express server for demo mode
 * Serves all mock data via REST endpoints without requiring external services
 */

import express from 'express';
import cors from 'cors';
import { DEMO_USERS, getDemoUserByEmail } from './data/users.js';
import { DEMO_ORGANIZATION, DEMO_ORG_MEMBERS } from './data/organizations.js';
import { DEMO_PROJECTS, DEMO_PROJECT_MEMBERS, DEMO_PROJECT_COMMENTS } from './data/projects.js';
import { DEMO_TASKS, DEMO_TASK_COMMENTS } from './data/tasks.js';
import { DEMO_PLANS, DEMO_PLAN_OBJECTIVES, DEMO_PLAN_BUDGET_CATEGORIES, DEMO_PLAN_RESOURCE_ALLOCATIONS, DEMO_PLAN_MILESTONES } from './data/plans.js';
import { DEMO_AI_AGENTS, DEMO_AI_AGENT_TEAMS, DEMO_AI_AGENT_TEAM_MEMBERS, DEMO_TASK_AI_ASSIGNMENTS, DEMO_AI_AGENT_ACTIVITIES } from './data/ai-agents.js';
import { DEMO_DOCS } from './data/docs.js';
import { DEMO_INTEGRATIONS } from './data/integrations.js';
import { DEMO_TASK_PROGRESS_UPDATES, DEMO_PROJECT_PROGRESS_SUMMARIES } from './data/progress.js';
import { generateTagsFromTitle, suggestAssigneeFromContext, getAssigneeName, generateChatResponseFromContext, generateScrumTaskDraft } from './mock-ai-service.js';

const app = express();
const PORT = 3001;

// In-memory data store for mutations
let inMemoryData = {
  projects: JSON.parse(JSON.stringify(DEMO_PROJECTS)),
  tasks: JSON.parse(JSON.stringify(DEMO_TASKS)),
  plans: JSON.parse(JSON.stringify(DEMO_PLANS)),
  projectComments: JSON.parse(JSON.stringify(DEMO_PROJECT_COMMENTS)),
  taskComments: JSON.parse(JSON.stringify(DEMO_TASK_COMMENTS)),
};

// Demo notifications (in-memory)
let inMemoryNotifications = [
  {
    id: 'notif-001',
    userEmail: 'demo@example.com',
    orgId: DEMO_ORGANIZATION.id,
    type: 'info',
    title: 'Welcome to Demo Mode',
    message: 'You are viewing demo data. Changes will not persist after restart.',
    status: 'unread',
    metadata: {},
    actionUrl: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    readAt: null,
    dismissedAt: null,
  },
  {
    id: 'notif-002',
    userEmail: 'demo@example.com',
    orgId: DEMO_ORGANIZATION.id,
    type: 'success',
    title: 'Plan Updated',
    message: 'Q1 2026 Product Initiative is on track.',
    status: 'unread',
    metadata: { planId: 'plan-001' },
    actionUrl: '/plans/plan-001',
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    readAt: null,
    dismissedAt: null,
  },
];

// Demo subscription status (in-memory)
let inMemorySubscription = {
  plan: 'pro',
  status: 'active',
  currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
  aiUsageLimit: null,
  aiUsageRemaining: null,
  aiUsageResetDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

// Demo chat messages (in-memory)
let inMemoryChatMessages: any[] = [];

const buildDemoUserProfile = (email = 'demo@example.com') => {
  const user = DEMO_USERS.find(u => u.email === email) || DEMO_USERS[0];
  return {
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    jobTitle: user.job_title,
    timezone: user.timezone,
    responsibilities: user.responsibilities,
    emailVerified: user.email_verified,
    subscriptionPlan: user.subscription_plan,
    aiDailyUsage: user.ai_daily_usage,
    aiUsageResetDate: user.ai_usage_reset_date,
    trialEndsAt: user.trial_ends_at || null,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    avatar: user.avatar || null,
  };
};

const buildDemoOrg = () => {
  const members = DEMO_ORG_MEMBERS;
  return {
    id: DEMO_ORGANIZATION.id,
    name: DEMO_ORGANIZATION.name,
    slug: DEMO_ORGANIZATION.slug,
    type: DEMO_ORGANIZATION.type,
    role: 'owner',
    description: DEMO_ORGANIZATION.description || '',
    avatar: DEMO_ORGANIZATION.avatar || '',
    isOwner: true,
    createdAt: DEMO_ORGANIZATION.created_at,
    joinedAt: members.find(m => m.user_email === 'demo@example.com')?.joined_at || DEMO_ORGANIZATION.created_at,
    memberCount: members.length,
  };
};

const buildDemoOrgMembers = () => {
  return DEMO_ORG_MEMBERS.map(member => {
    const user = DEMO_USERS.find(u => u.email === member.user_email);
    const firstName = user?.first_name || '';
    const lastName = user?.last_name || '';
    return {
      email: member.user_email,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim() || member.user_email,
      role: member.role,
      jobTitle: user?.job_title || '',
      joinedAt: member.joined_at,
    };
  });
};

const normalizeObjectiveStatus = (status) => {
  if (status === 'on_track' || status === 'on-track') return 'on-track';
  return status;
};

const getUserDisplayName = (email) => {
  if (!email) return '';
  const user = DEMO_USERS.find(u => u.email === email);
  if (!user) return email;
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || email;
};

const getUserAvatar = (email) => {
  const user = DEMO_USERS.find(u => u.email === email);
  return user?.avatar || null;
};

const getProjectStatusColor = (status) => {
  switch (status) {
    case 'planning':
      return 'bg-blue-500';
    case 'active':
      return 'bg-green-500';
    case 'on-hold':
      return 'bg-yellow-500';
    case 'completed':
      return 'bg-gray-500';
    default:
      return 'bg-gray-500';
  }
};

const buildTaskResponse = (task, { includeComments = true, includeProgress = true } = {}) => {
  const taskComments = includeComments
    ? inMemoryData.taskComments
        .filter(c => c.task_id === task.id)
        .map(c => ({
          id: c.id,
          memberName: c.member_name,
          memberAvatar: c.member_avatar || null,
          date: c.date,
          comment: c.comment,
        }))
    : [];

  const taskProgressUpdates = includeProgress
    ? DEMO_TASK_PROGRESS_UPDATES
        .filter(u => u.associatedTasks && u.associatedTasks.includes(task.id))
        .map(u => ({
          id: u.id,
          memberName: u.userName,
          memberAvatar: getUserAvatar(u.userId),
          date: u.dateId,
          update: u.updateText,
          type: 'progress',
        }))
    : [];

  return {
    id: task.id,
    title: task.title,
    description: task.description || '',
    status: task.status,
    priority: task.priority,
    assigneeId: task.assignee_id ?? task.assigneeId,
    assignee: task.assignee_name ?? task.assigneeName ?? task.assignee,
    assigneeAvatar: task.assignee_avatar ?? task.assigneeAvatar ?? null,
    project: task.project_name ?? task.project ?? '',
    projectId: task.project_id ?? task.projectId ?? null,
    createdBy: task.created_by ?? task.createdBy ?? '',
    visibility: task.visibility ?? 'all_members',
    visibleToMembers: task.visible_to_members ?? task.visibleToMembers ?? [],
    dueDate: task.due_date ?? task.dueDate ?? null,
    createdDate: task.created_date ?? task.createdDate ?? (task.created_at ? task.created_at.split('T')[0] : ''),
    createdAt: task.created_at ? new Date(task.created_at).getTime() : Date.now(),
    estimatedHours: task.estimated_hours ?? task.estimatedHours ?? null,
    actualHours: task.actual_hours ?? task.actualHours ?? null,
    tags: task.tags ?? [],
    progressUpdates: taskProgressUpdates,
    comments: taskComments,
    reason: task.reason ?? null,
  };
};

const buildProjectResponse = (project) => {
  const members = DEMO_PROJECT_MEMBERS
    .filter(m => m.project_id === project.id)
    .map(m => ({
      id: m.user_email,
      email: m.user_email,
      name: getUserDisplayName(m.user_email),
      role: m.role || 'member',
      avatar: m.avatar || getUserAvatar(m.user_email) || '',
    }));

  const tasks = inMemoryData.tasks
    .filter(t => (t.project_id ?? t.projectId) === project.id)
    .map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assigneeId: t.assignee_id ?? t.assigneeId,
      assignee: t.assignee_name ?? t.assigneeName ?? t.assignee,
      assigneeAvatar: t.assignee_avatar ?? t.assigneeAvatar ?? null,
      dueDate: t.due_date ?? t.dueDate ?? null,
      reason: t.reason ?? null,
    }));

  const progressUpdates = DEMO_PROJECT_PROGRESS_SUMMARIES
    .filter(s => s.projectId === project.id)
    .map(s => ({
      id: `summary-${s.projectId}-${s.dateId}`,
      memberName: 'AI Insights',
      memberAvatar: '',
      date: s.dateId,
      update: s.updateSummary,
    }));

  const comments = inMemoryData.projectComments
    .filter(c => c.project_id === project.id)
    .map(c => ({
      id: c.id,
      memberName: c.member_name,
      memberAvatar: c.member_avatar || '',
      date: c.date,
      comment: c.comment,
    }));

  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    detailedDescription: project.description || '',
    status: project.status,
    memberCount: members.length,
    dueDate: project.due_date ?? project.dueDate ?? null,
    createdDate: project.created_at ? project.created_at.split('T')[0] : '',
    statusColor: getProjectStatusColor(project.status),
    ownerEmail: project.owner_email ?? project.ownerEmail ?? '',
    visibility: project.visibility ?? 'all_members',
    visibleToMembers: project.visible_to_members ?? project.visibleToMembers ?? [],
    planId: project.plan_id ?? project.planId ?? null,
    budgetAllocated: project.budget_allocated ?? project.budgetAllocated ?? null,
    members,
    tasks,
    progressUpdates,
    comments,
    summary: {
      accomplishment: 'Key milestones completed on schedule.',
      decision: 'Continue current delivery cadence and focus on critical path.',
      risk: 'Resource load is approaching capacity.',
      direction: 'Maintain momentum and monitor burn rate.',
    },
  };
};

const buildPlanResponse = (plan) => {
  const objectives = DEMO_PLAN_OBJECTIVES
    .filter(o => o.plan_id === plan.id)
    .map(o => ({
      id: o.id,
      text: o.text,
      targetValue: o.target_value ?? o.targetValue,
      currentValue: o.current_value ?? o.currentValue,
      unit: o.unit,
      dueDate: o.due_date ?? o.dueDate,
      status: normalizeObjectiveStatus(o.status),
    }));

  const budgetCategories = DEMO_PLAN_BUDGET_CATEGORIES
    .filter(b => b.plan_id === plan.id)
    .map(b => ({
      id: b.id,
      name: b.name,
      allocatedAmount: b.allocated_amount ?? b.allocatedAmount,
      spentAmount: b.spent_amount ?? b.spentAmount,
      projectId: b.project_id ?? b.projectId ?? null,
    }));

  const resourceAllocations = DEMO_PLAN_RESOURCE_ALLOCATIONS
    .filter(r => r.plan_id === plan.id)
    .map(r => ({
      id: r.id,
      userId: r.user_email ?? r.userId,
      userEmail: r.user_email ?? r.userEmail,
      userName: r.user_name ?? r.userName,
      planId: plan.id,
      projectId: r.project_id ?? r.projectId ?? null,
      allocationPercentage: r.allocation_percentage ?? r.allocationPercentage,
      startDate: r.start_date ?? r.startDate,
      endDate: r.end_date ?? r.endDate,
      role: r.role || '',
      hourlyRate: r.hourly_rate ?? r.hourlyRate ?? null,
      normalizedHours: r.normalized_hours ?? r.normalizedHours ?? null,
    }));

  const milestones = DEMO_PLAN_MILESTONES
    .filter(m => m.plan_id === plan.id)
    .map(m => ({
      id: m.id,
      name: m.name,
      dueDate: m.due_date ?? m.dueDate,
      status: m.status,
      description: m.description || '',
    }));

  const projectIds = Array.from(new Set(
    budgetCategories.map(b => b.projectId).filter(Boolean)
  ));

  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    objectives,
    totalBudget: plan.total_budget ?? plan.totalBudget,
    currency: plan.currency || 'USD',
    budgetCategories,
    spentToDate: plan.spent_to_date ?? plan.spentToDate ?? 0,
    startDate: plan.start_date ?? plan.startDate,
    endDate: plan.end_date ?? plan.endDate,
    projectIds,
    resourceAllocations,
    milestones,
    status: plan.status,
    healthScore: plan.health_score ?? plan.healthScore ?? 80,
    healthTrend: plan.health_trend ?? plan.healthTrend ?? 'stable',
    ownerEmail: plan.owner_email ?? plan.ownerEmail,
    ownerName: plan.owner_name ?? plan.ownerName ?? 'Demo User',
    teamSize: plan.team_size ?? plan.teamSize ?? 6,
    createdAt: plan.created_at ?? plan.createdAt ?? new Date().toISOString(),
    updatedAt: plan.updated_at ?? plan.updatedAt ?? new Date().toISOString(),
    recentActivity: [],
  };
};

// Middleware
app.use(cors());
app.use(express.json());

// Add mock latency for realism
app.use((req, res, next) => {
  const latency = Math.random() * 150 + 50; // 50-200ms
  setTimeout(next, latency);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'demo', timestamp: new Date().toISOString() });
});

// ============ User & Auth Endpoints ============

app.get('/api/user/profile', (req, res) => {
  res.json(buildDemoUserProfile());
});

app.get('/api/users/profile', (req, res) => {
  res.json(buildDemoUserProfile());
});

app.put('/api/users/profile', (req, res) => {
  const profile = {
    ...buildDemoUserProfile(),
    ...req.body,
    updatedAt: new Date().toISOString(),
  };
  res.json(profile);
});

app.delete('/api/users/me', (req, res) => {
  res.json({ success: true, message: 'Account deleted (demo mode)' });
});

app.get('/api/users', (req, res) => {
  const users = DEMO_USERS.map(u => ({
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    jobTitle: u.job_title,
    responsibilities: u.responsibilities,
    timezone: u.timezone,
    avatar: u.avatar || null,
  }));
  res.json(users);
});

// ============ Organization Endpoints ============

app.get('/api/organizations', (req, res) => {
  res.json([buildDemoOrg()]);
});

app.get('/api/organizations/:orgId', (req, res) => {
  res.json(buildDemoOrg());
});

app.get('/api/organizations/:orgId/members', (req, res) => {
  res.json(buildDemoOrgMembers());
});

// Org endpoints used by OrgContext
app.get('/api/orgs', (req, res) => {
  res.json([buildDemoOrg()]);
});

app.get('/api/orgs/:orgId', (req, res) => {
  res.json({ ...buildDemoOrg(), members: buildDemoOrgMembers() });
});

app.post('/api/orgs', (req, res) => {
  const org = {
    ...buildDemoOrg(),
    id: `org-${Date.now()}`,
    name: req.body?.name || 'New Demo Org',
    description: req.body?.description || '',
    createdAt: new Date().toISOString(),
  };
  res.json(org);
});

app.put('/api/orgs/:orgId', (req, res) => {
  res.json({ ...buildDemoOrg(), ...req.body, updatedAt: new Date().toISOString() });
});

app.delete('/api/orgs/:orgId', (req, res) => {
  res.json({ success: true });
});

app.post('/api/orgs/:orgId/leave', (req, res) => {
  res.json({ success: true });
});

app.get('/api/orgs/invitations', (req, res) => {
  res.json([]);
});

app.post('/api/orgs/invitations/:invitationId/accept', (req, res) => {
  res.json(buildDemoOrg());
});

app.post('/api/orgs/invitations/:invitationId/decline', (req, res) => {
  res.json({ success: true });
});

app.post('/api/orgs/:orgId/invite', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/orgs/:orgId/members/:memberEmail', (req, res) => {
  res.json({ success: true });
});

// ============ Project Endpoints ============

app.get('/api/projects', (req, res) => {
  const { status, search } = req.query;
  let projects = inMemoryData.projects;

  if (status) {
    projects = projects.filter(p => p.status === status);
  }

  if (search) {
    const searchTerm = (search as string).toLowerCase();
    projects = projects.filter(p => p.name.toLowerCase().includes(searchTerm));
  }

  res.json(projects.map(buildProjectResponse));
});

app.get('/api/projects/:projectId', (req, res) => {
  const project = inMemoryData.projects.find(p => p.id === req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(buildProjectResponse(project));
});

app.post('/api/projects', (req, res) => {
  const newProject = {
    id: `proj-${Date.now()}`,
    ...req.body,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  inMemoryData.projects.push(newProject);
  res.json(newProject);
});

app.put('/api/projects/:projectId', (req, res) => {
  const index = inMemoryData.projects.findIndex(p => p.id === req.params.projectId);
  if (index === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  inMemoryData.projects[index] = {
    ...inMemoryData.projects[index],
    ...req.body,
    updated_at: new Date().toISOString(),
  };
  res.json(inMemoryData.projects[index]);
});

app.delete('/api/projects/:projectId', (req, res) => {
  const index = inMemoryData.projects.findIndex(p => p.id === req.params.projectId);
  if (index === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  inMemoryData.projects.splice(index, 1);
  res.json({ success: true });
});

// ============ Task Endpoints ============

app.get('/api/tasks', (req, res) => {
  const { projectId, status, assignee, search } = req.query;
  let tasks = inMemoryData.tasks;

  if (projectId) {
    tasks = tasks.filter(t => t.project_id === projectId);
  }

  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }

  if (assignee) {
    tasks = tasks.filter(t => t.assignee_id === assignee);
  }

  if (search) {
    const searchTerm = (search as string).toLowerCase();
    tasks = tasks.filter(t => t.title.toLowerCase().includes(searchTerm));
  }

  // Add latest progress update for each task
  const tasksWithProgress = tasks.map(t => {
    const progressUpdates = DEMO_TASK_PROGRESS_UPDATES.filter(u => u.associatedTasks && u.associatedTasks.includes(t.id));
    progressUpdates.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return {
      ...buildTaskResponse(t, { includeComments: false, includeProgress: true }),
      latestProgress: progressUpdates.length > 0 ? progressUpdates[0] : null,
    };
  });

  res.json(tasksWithProgress);
});

app.get('/api/tasks/:taskId', (req, res) => {
  const task = inMemoryData.tasks.find(t => t.id === req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json(buildTaskResponse(task, { includeComments: true, includeProgress: true }));
});

app.get('/api/tasks/project/:projectId', (req, res) => {
  const tasks = inMemoryData.tasks
    .filter(t => (t.project_id ?? t.projectId) === req.params.projectId)
    .map(t => buildTaskResponse(t, { includeComments: false, includeProgress: true }));
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const newTask = {
    id: `task-${Date.now()}`,
    ...req.body,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  inMemoryData.tasks.push(newTask);
  res.json(newTask);
});

app.put('/api/tasks/:taskId', (req, res) => {
  const index = inMemoryData.tasks.findIndex(t => t.id === req.params.taskId);
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  inMemoryData.tasks[index] = {
    ...inMemoryData.tasks[index],
    ...req.body,
    updated_at: new Date().toISOString(),
  };
  res.json(inMemoryData.tasks[index]);
});

app.delete('/api/tasks/:taskId', (req, res) => {
  const index = inMemoryData.tasks.findIndex(t => t.id === req.params.taskId);
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }

  inMemoryData.tasks.splice(index, 1);
  res.json({ success: true });
});

// ============ Plan Endpoints ============

app.get('/api/plans', (req, res) => {
  const { status, search } = req.query;
  let plans = inMemoryData.plans;

  if (status) {
    plans = plans.filter(p => p.status === status);
  }

  if (search) {
    const searchTerm = (search as string).toLowerCase();
    plans = plans.filter(p => p.name.toLowerCase().includes(searchTerm));
  }

  res.json(plans.map(buildPlanResponse));
});

app.get('/api/plans/:planId', (req, res) => {
  const plan = inMemoryData.plans.find(p => p.id === req.params.planId);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.json(buildPlanResponse(plan));
});

app.post('/api/plans', (req, res) => {
  const newPlan = {
    id: `plan-${Date.now()}`,
    ...req.body,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  inMemoryData.plans.push(newPlan);
  res.json(buildPlanResponse(newPlan));
});

app.put('/api/plans/:planId', (req, res) => {
  const index = inMemoryData.plans.findIndex(p => p.id === req.params.planId);
  if (index === -1) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  inMemoryData.plans[index] = {
    ...inMemoryData.plans[index],
    ...req.body,
    updated_at: new Date().toISOString(),
  };
  res.json(buildPlanResponse(inMemoryData.plans[index]));
});

app.delete('/api/plans/:planId', (req, res) => {
  const index = inMemoryData.plans.findIndex(p => p.id === req.params.planId);
  if (index === -1) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  inMemoryData.plans.splice(index, 1);
  res.json({ success: true });
});

// ============ AI Agent Endpoints ============

app.get('/api/ai-agents', (req, res) => {
  res.json(DEMO_AI_AGENTS);
});

app.get('/api/ai-agents/:agentId', (req, res) => {
  const agent = DEMO_AI_AGENTS.find(a => a.id === req.params.agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const assignments = DEMO_TASK_AI_ASSIGNMENTS.filter(a => a.agent_id === agent.id);
  const activities = DEMO_AI_AGENT_ACTIVITIES.filter(a => a.agent_id === agent.id);

  res.json({
    ...agent,
    assignments,
    activities,
  });
});

app.get('/api/ai-agent-teams', (req, res) => {
  res.json(DEMO_AI_AGENT_TEAMS);
});

app.get('/api/ai-agent-teams/:teamId', (req, res) => {
  const team = DEMO_AI_AGENT_TEAMS.find(t => t.id === req.params.teamId);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }

  const members = DEMO_AI_AGENT_TEAM_MEMBERS.filter(m => m.team_id === team.id);
  const agents = members
    .map(m => DEMO_AI_AGENTS.find(a => a.id === m.agent_id))
    .filter(Boolean);

  res.json({
    ...team,
    members,
    agents,
  });
});

// ============ Document Endpoints ============

app.get('/api/docs', (req, res) => {
  const { projectId, folderId } = req.query;
  let docs = DEMO_DOCS;

  if (projectId) {
    docs = docs.filter(d => d.project_id === projectId);
  }

  if (folderId) {
    docs = docs.filter(d => d.folder_id === folderId);
  }

  res.json(docs);
});

app.get('/api/docs/:docId', (req, res) => {
  const doc = DEMO_DOCS.find(d => d.id === req.params.docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json(doc);
});

// ============ Notifications ============

app.get('/api/notifications', (req, res) => {
  res.json(inMemoryNotifications);
});

app.patch('/api/notifications/:notificationId/read', (req, res) => {
  const notification = inMemoryNotifications.find(n => n.id === req.params.notificationId);
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  notification.status = 'read';
  notification.readAt = new Date().toISOString();
  res.json({ success: true });
});

app.patch('/api/notifications/:notificationId/dismiss', (req, res) => {
  const notification = inMemoryNotifications.find(n => n.id === req.params.notificationId);
  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  notification.status = 'dismissed';
  notification.dismissedAt = new Date().toISOString();
  res.json({ success: true });
});

// ============ Subscription ============

app.get('/api/subscription/status', (req, res) => {
  res.json(inMemorySubscription);
});

app.post('/api/subscription/checkout', (req, res) => {
  res.json({ url: 'https://checkout.stripe.com/demo' });
});

app.post('/api/subscription/portal', (req, res) => {
  res.json({ url: 'https://billing.stripe.com/demo' });
});

app.post('/api/subscription/switch-plan', (req, res) => {
  const plan = req.body?.plan || 'pro';
  inMemorySubscription.plan = plan;
  res.json({ success: true, plan, requiresCheckout: false });
});

app.post('/api/subscription/cancel', (req, res) => {
  inMemorySubscription.plan = 'free';
  inMemorySubscription.status = 'canceled';
  res.json({ success: true, plan: 'free' });
});

app.post('/api/subscription/ai-usage', (req, res) => {
  // Simple demo usage tracking
  const limit = inMemorySubscription.aiUsageLimit ?? 50;
  const remaining = inMemorySubscription.aiUsageRemaining ?? 50;
  const nextRemaining = Math.max(remaining - 1, 0);

  inMemorySubscription.aiUsageLimit = limit;
  inMemorySubscription.aiUsageRemaining = nextRemaining;

  res.json({
    success: true,
    usage: limit - nextRemaining,
    limit,
    remaining: nextRemaining,
  });
});

// ============ Integration Endpoints ============

app.get('/api/integrations', (req, res) => {
  res.json(DEMO_INTEGRATIONS);
});

app.post('/api/integrations/:integrationId/connect', (req, res) => {
  const integration = DEMO_INTEGRATIONS.find(i => i.id === req.params.integrationId);
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }

  integration.connected = true;
  integration.connectedAt = new Date().toISOString();

  res.json(integration);
});

app.post('/api/integrations/:integrationId/disconnect', (req, res) => {
  const integration = DEMO_INTEGRATIONS.find(i => i.id === req.params.integrationId);
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }

  integration.connected = false;
  integration.connectedAt = undefined;

  res.json(integration);
});

// ============ Users Endpoints (for listing) ============

app.get('/api/users', (req, res) => {
  res.json(DEMO_USERS);
});

app.get('/api/users/:email', (req, res) => {
  const user = getDemoUserByEmail(req.params.email);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

// ============ AI Service Mock Endpoints ============

app.get('/api/ask-api-key', (req, res) => {
  res.json({ apiKey: 'demo-ask-key' });
});

app.post('/api/ask', (req, res) => {
  const { query } = req.body;

  // Simulated AI response
  const responses = [
    'Based on the current project status, I recommend focusing on the critical path items first.',
    'The team has made good progress this week. Keep up the momentum!',
    'Consider allocating more resources to the infrastructure team to meet the deadline.',
    'The AI features integration is on track. Quality looks good so far.',
    'I notice some potential bottlenecks in the microservices migration. Let me flag those.',
  ];

  const response = responses[Math.floor(Math.random() * responses.length)];

  res.json({
    response,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/generate-task', (req, res) => {
  const { task_name, project_name, priority, status, description } = req.body;

  // Generate realistic task details based on input
  const hardcodedTitle = 'Record a product demo';
  const scrumDraft = generateScrumTaskDraft(hardcodedTitle, project_name, undefined);
  const generatedTask = {
    title: scrumDraft.title,
    description: scrumDraft.description,
    status: status || 'todo',
    priority: priority || 'medium',
    due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    tags: scrumDraft.tags,
    estimated_hours: 8 + Math.floor(Math.random() * 16),
    assignee_id: suggestAssigneeFromContext(project_name),
    assignee_name: getAssigneeName(suggestAssigneeFromContext(project_name)),
  };

  res.json({ task: generatedTask });
});

app.post('/api/plans/generate-resource-plan', (req, res) => {
  const { total_budget = 400000, team_members = 5, start_date, end_date } = req.body;

  // Calculate duration in days
  const startDate = new Date(start_date || Date.now());
  const endDate = new Date(end_date || Date.now() + 12 * 7 * 24 * 60 * 60 * 1000);
  const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  const durationWeeks = Math.ceil(durationDays / 7);

  const strategies = [
    {
      strategy: 'cost-optimized',
      rationale: 'Minimizes costs while meeting deadlines with conservative resource allocation.',
      total_cost: Math.round(total_budget * 0.75),
      estimated_duration_days: Math.ceil(durationDays * 1.3),
      team_size: Math.max(3, Math.round(team_members * 0.6)),
      risk_level: 'low',
      resource_allocations: [
        {
          user_email: 'sarah@example.com',
          user_name: 'Sarah Chen',
          role: 'Senior Developer',
          allocation_percentage: 60,
          hourly_rate: 95,
          estimated_hours: Math.ceil((durationWeeks * 1.3 * 40 * 0.6) / 100),
        },
        {
          user_email: 'maya@example.com',
          user_name: 'Maya Patel',
          role: 'UI/UX Designer',
          allocation_percentage: 40,
          hourly_rate: 75,
          estimated_hours: Math.ceil((durationWeeks * 1.3 * 40 * 0.4) / 100),
        },
        {
          user_email: 'james@example.com',
          user_name: 'James Wilson',
          role: 'DevOps Engineer',
          allocation_percentage: 50,
          hourly_rate: 90,
          estimated_hours: Math.ceil((durationWeeks * 1.3 * 40 * 0.5) / 100),
        },
      ],
      expected_outcomes: ['On budget', 'Sustainable pace', 'Lower resource costs'],
      trade_offs: ['Longer timeline', 'Less parallel work', 'Extended delivery'],
    },
    {
      strategy: 'time-optimized',
      rationale: 'Fastest completion with higher cost and aggressive resource allocation.',
      total_cost: Math.round(total_budget * 1.2),
      estimated_duration_days: Math.ceil(durationDays * 0.75),
      team_size: Math.max(5, Math.round(team_members * 1.2)),
      risk_level: 'medium',
      resource_allocations: [
        {
          user_email: 'sarah@example.com',
          user_name: 'Sarah Chen',
          role: 'Senior Developer',
          allocation_percentage: 100,
          hourly_rate: 95,
          estimated_hours: Math.ceil((durationWeeks * 0.75 * 40 * 1.0)),
        },
        {
          user_email: 'maya@example.com',
          user_name: 'Maya Patel',
          role: 'UI/UX Designer',
          allocation_percentage: 80,
          hourly_rate: 75,
          estimated_hours: Math.ceil((durationWeeks * 0.75 * 40 * 0.8)),
        },
        {
          user_email: 'james@example.com',
          user_name: 'James Wilson',
          role: 'DevOps Engineer',
          allocation_percentage: 90,
          hourly_rate: 90,
          estimated_hours: Math.ceil((durationWeeks * 0.75 * 40 * 0.9)),
        },
        {
          user_email: 'alex@example.com',
          user_name: 'Alex Rodriguez',
          role: 'QA Engineer',
          allocation_percentage: 70,
          hourly_rate: 85,
          estimated_hours: Math.ceil((durationWeeks * 0.75 * 40 * 0.7)),
        },
      ],
      expected_outcomes: ['Fast delivery', 'High velocity', 'Early market entry'],
      trade_offs: ['Higher cost', 'Team at full capacity', 'Higher burnout risk'],
    },
    {
      strategy: 'quality-optimized',
      rationale: 'Balanced approach focusing on high-quality deliverables with sustainable pace.',
      total_cost: Math.round(total_budget * 0.95),
      estimated_duration_days: durationDays,
      team_size: Math.round(team_members),
      risk_level: 'low',
      resource_allocations: [
        {
          user_email: 'sarah@example.com',
          user_name: 'Sarah Chen',
          role: 'Senior Developer',
          allocation_percentage: 80,
          hourly_rate: 95,
          estimated_hours: Math.ceil((durationWeeks * 40 * 0.8)),
        },
        {
          user_email: 'maya@example.com',
          user_name: 'Maya Patel',
          role: 'UI/UX Designer',
          allocation_percentage: 60,
          hourly_rate: 75,
          estimated_hours: Math.ceil((durationWeeks * 40 * 0.6)),
        },
        {
          user_email: 'james@example.com',
          user_name: 'James Wilson',
          role: 'DevOps Engineer',
          allocation_percentage: 60,
          hourly_rate: 90,
          estimated_hours: Math.ceil((durationWeeks * 40 * 0.6)),
        },
        {
          user_email: 'alex@example.com',
          user_name: 'Alex Rodriguez',
          role: 'QA Engineer',
          allocation_percentage: 50,
          hourly_rate: 85,
          estimated_hours: Math.ceil((durationWeeks * 40 * 0.5)),
        },
      ],
      expected_outcomes: ['High quality', 'Sustainable pace', 'Good cost efficiency'],
      trade_offs: ['Standard timeline', 'Moderate resource needs', 'Balanced approach'],
    },
  ];

  res.json({ strategies });
});

app.post('/api/plans/generate-insights', (req, res) => {
  const { health_score = 75, spent_to_date = 180000, total_budget = 400000, plan_status = 'active' } = req.body;

  const budgetUtilization = (spent_to_date / total_budget) * 100;
  const budgetStatus = budgetUtilization < 50 ? 'on_track' : budgetUtilization < 80 ? 'at_risk' : 'over_budget';

  res.json({
    summary: `Your ${plan_status} plan is progressing well with solid momentum across key initiatives. Team velocity is consistent and deliverables are on schedule.`,
    risks: [
      {
        title: 'Resource Capacity Risk',
        severity: 'medium',
        description: 'Team is at 85% capacity. Some team members are approaching burnout indicators.',
        impact: 'May delay timeline by 1-2 weeks if not addressed',
      },
      {
        title: 'Budget Utilization',
        severity: budgetUtilization > 75 ? 'high' : 'low',
        description: `Currently spent ${Math.round(budgetUtilization)}% of budget with 65% of work completed.`,
        impact: budgetUtilization > 75 ? 'Potential budget overrun of 10-15%' : 'Budget tracking well',
      },
    ],
    recommendations: [
      {
        title: 'Optimize Critical Path',
        priority: 'high',
        description: 'Focus on the 3 critical path items to reduce overall timeline risk.',
        expected_impact: 'Reduce timeline by 5-7 days',
      },
      {
        title: 'Resource Rebalancing',
        priority: budgetUtilization > 75 ? 'high' : 'medium',
        description: 'Redistribute some lower-priority work to reduce team overload.',
        expected_impact: 'Improve team utilization and prevent burnout',
      },
      {
        title: 'Risk Mitigation Review',
        priority: 'medium',
        description: 'Update risk register and implement contingency plans for identified risks.',
        expected_impact: 'Increase confidence level from medium to high',
      },
    ],
    predictions: {
      budget_trend: budgetStatus,
      timeline_trend: health_score >= 75 ? 'on_track' : 'at_risk',
      estimated_completion_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      confidence_level: health_score >= 75 ? 'high' : 'medium',
    },
    quick_insight: `Plan is ${health_score >= 75 ? 'on track' : 'at risk'} for completion. ${Math.round(budgetUtilization)}% of budget spent with ${health_score}% health score.`,
  });
});

// ============ Progress Tracking Endpoints ============

app.get('/api/task-progress-updates', (req, res) => {
  const { userId, projectId, dateFrom, dateTo, limit = 50 } = req.query;
  let updates = DEMO_TASK_PROGRESS_UPDATES;

  if (userId) {
    updates = updates.filter(u => u.userId === userId);
  }

  if (projectId) {
    updates = updates.filter(u => u.projectId === projectId);
  }

  // Date filtering
  if (dateFrom) {
    const from = new Date(dateFrom as string);
    updates = updates.filter(u => new Date(u.timestamp) >= from);
  }

  if (dateTo) {
    const to = new Date(dateTo as string);
    updates = updates.filter(u => new Date(u.timestamp) <= to);
  }

  // Sort by timestamp descending
  updates.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json(updates.slice(0, Number(limit)));
});

app.get('/api/project-progress-updates', (req, res) => {
  const { projectId, dateFrom, dateTo, limit = 50 } = req.query;
  let summaries = DEMO_PROJECT_PROGRESS_SUMMARIES;

  if (projectId) {
    summaries = summaries.filter(s => s.projectId === projectId);
  }

  // Date filtering
  if (dateFrom) {
    const from = new Date(dateFrom as string);
    summaries = summaries.filter(s => new Date(s.generatedAt) >= from);
  }

  if (dateTo) {
    const to = new Date(dateTo as string);
    summaries = summaries.filter(s => new Date(s.generatedAt) <= to);
  }

  // Sort by timestamp descending
  summaries.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  res.json(summaries.slice(0, Number(limit)));
});

app.get('/api/update-summaries', (req, res) => {
  const { projectId, all } = req.query;

  if (projectId) {
    if (all === 'true') {
      const summaries = DEMO_PROJECT_PROGRESS_SUMMARIES.filter(s => s.projectId === projectId);
      // Sort by timestamp descending
      summaries.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
      return res.json(summaries);
    }
    // Return latest summary for project
    const summaries = DEMO_PROJECT_PROGRESS_SUMMARIES.filter(s => s.projectId === projectId);
    summaries.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    const latest = summaries[0] || null;
    return res.json(latest);
  }

  res.json([]);
});

// ============ Chat/Messages Endpoints ============

app.post('/api/messages/stream', (req, res) => {
  const { message, citedContext } = req.body;

  // Setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Generate mock chat response
  const mockResponse = generateChatResponseFromContext(message, citedContext);

  // Emit tool start/end events to simulate tool usage
  const toolName = 'context_search';
  res.write(`data: ${JSON.stringify({ type: 'tool_start', tool_name: toolName, display_name: 'Context Search', description: 'Scanning cited context for relevant items.' })}\n\n`);
  setTimeout(() => {
    res.write(`data: ${JSON.stringify({ type: 'tool_end', tool_name: toolName, summary: 'Found relevant tasks and notes from cited context.' })}\n\n`);
  }, 200);

  // Emit doc drafting progress when user asks for a doc
  const messageLower = (message || '').toLowerCase();
  const wantsDoc = messageLower.includes('doc') || messageLower.includes('document');
  if (wantsDoc) {
    const stages = [
      { stage: 'outline', current: 1, total: 3, message: 'Drafting outline for the document...' },
      { stage: 'content', current: 2, total: 3, message: 'Writing key sections and milestones...' },
      { stage: 'final', current: 3, total: 3, message: 'Finalizing and formatting the document...' },
    ];
    stages.forEach((stage, index) => {
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: 'doc_progress', ...stage })}\n\n`);
      }, 250 + index * 250);
    });
  }

  // Stream response word-by-word with small delays for a streaming effect
  const words = mockResponse.split(' ');
  let sentText = '';

  words.forEach((word, index) => {
    setTimeout(() => {
      sentText += (index > 0 ? ' ' : '') + word;
      res.write(`data: ${JSON.stringify({ type: 'text_delta', text: word + (index < words.length - 1 ? ' ' : '') })}\n\n`);
    }, 300 + index * 50); // delay to allow tool events first
  });

  // Send done event after all words are streamed
  setTimeout(() => {
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  }, words.length * 50 + 100);
});

app.get('/api/messages/:chatId', (req, res) => {
  const messages = inMemoryChatMessages.filter(m => m.chatId === req.params.chatId);
  res.json(messages);
});

app.post('/api/messages', (req, res) => {
  const newMessage = {
    id: `msg-${Date.now()}`,
    ...req.body,
    timestamp: new Date().toISOString(),
  };
  inMemoryChatMessages.push(newMessage);
  res.json(newMessage);
});

app.delete('/api/messages/clear/:chatId', (req, res) => {
  inMemoryChatMessages = inMemoryChatMessages.filter(m => m.chatId !== req.params.chatId);
  res.json({ success: true });
});

// ============ 404 Handler ============

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============ Error Handler ============

app.use((err, req, res, next) => {
  console.error('Demo server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Mock Demo Server running on http://localhost:${PORT}`);
  console.log(`📊 All endpoints are in demo mode with mock data`);
  console.log(`🔄 Changes persist during this session only`);
});
