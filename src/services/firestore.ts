import type { Project } from '@/data/projectsData';
import type { Task } from '@/data/tasksData';
import type { Team, TeamDetailData } from '@/data/teamsData';

// Use proxy API in development (uses gcp_credential.json via Admin SDK)
// In production, use relative path so nginx can proxy to the backend server
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Initialize Firestore - uses proxy API in development
export const initFirestore = () => {
  if (import.meta.env.DEV) {
    console.log('🔧 Using Firestore proxy API (gcp_credential.json)');
  } else {
    console.log('🌐 Using Firebase JS SDK');
  }
};

// Projects Service
export const projectsService = {
  async getAll(): Promise<Project[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects` : `${API_BASE}/projects`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch projects');
    return response.json();
  },

  async getById(projectName: string): Promise<Project | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch project');
    return response.json();
  },

  async create(project: Project): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects` : `${API_BASE}/projects`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!response.ok) throw new Error('Failed to create project');
  },

  async update(projectName: string, updates: Partial<Project>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update project');
  },

  async delete(projectName: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete project');
  },
};

// Tasks Service
export const tasksService = {
  async getAll(): Promise<Task[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks` : `${API_BASE}/tasks`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    return response.json();
  },

  async getById(taskId: string): Promise<Task | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch task');
    return response.json();
  },

  async getByProject(projectId: string): Promise<Task[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/project/${encodeURIComponent(projectId)}` : `${API_BASE}/tasks/project/${encodeURIComponent(projectId)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    return response.json();
  },

  async create(task: Task): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks` : `${API_BASE}/tasks`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    if (!response.ok) throw new Error('Failed to create task');
  },

  async update(taskId: string, updates: Partial<Task>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update task');
  },

  async delete(taskId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete task');
  },
};

// Teams Service
export const teamsService = {
  async getAll(): Promise<Team[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams` : `${API_BASE}/teams`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch teams');
    return response.json();
  },

  async getById(teamName: string): Promise<TeamDetailData | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch team');
    return response.json();
  },

  async create(team: Team, teamDetail: TeamDetailData): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams` : `${API_BASE}/teams`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, teamDetail }),
    });
    if (!response.ok) throw new Error('Failed to create team');
  },

  async update(teamName: string, updates: Partial<Team>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team');
  },

  async updateDetail(teamName: string, updates: Partial<TeamDetailData>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/detail` : `${API_BASE}/teams/${encodeURIComponent(teamName)}/detail`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team detail');
  },

  async delete(teamName: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete team');
  },
};

