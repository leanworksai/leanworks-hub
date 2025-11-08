import type { Project } from '@/data/projectsData';
import type { Task } from '@/data/tasksData';
import type { Team, TeamDetailData } from '@/data/teamsData';
import { auth } from '@/lib/firebase-client';

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

// Helper to get auth token for API requests
async function getAuthToken(): Promise<string | null> {
  // First try to get token from Firebase Auth
  if (auth && auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken();
    } catch (error) {
      console.warn('Failed to get token from Firebase Auth:', error);
    }
  }
  
  // Fallback: try to get stored custom token from window (set by auth context)
  try {
    const storedToken = (window as any).__customToken;
    if (storedToken) {
      return storedToken;
    }
  } catch (error) {
    // Ignore
  }
  
  // Final fallback: try to get from localStorage (for persistence)
  try {
    const cachedToken = localStorage.getItem('leanworks_custom_token');
    if (cachedToken) {
      // Also restore it to window for consistency
      (window as any).__customToken = cachedToken;
      return cachedToken;
    }
  } catch (error) {
    // Ignore localStorage errors
  }
  
  return null;
}

// Helper to make authenticated API requests
async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };
  
  return fetch(url, {
    ...options,
    headers,
  });
}

// Projects Service
export const projectsService = {
  async getAll(): Promise<Project[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects` : `${API_BASE}/projects`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch projects');
    return response.json();
  },

  async getById(projectName: string): Promise<Project | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch project');
    return response.json();
  },

  async create(project: Project): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects` : `${API_BASE}/projects`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(project),
    });
    if (!response.ok) throw new Error('Failed to create project');
  },

  async update(projectName: string, updates: Partial<Project>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update project');
  },

  async delete(projectName: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectName)}` : `${API_BASE}/projects/${encodeURIComponent(projectName)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete project');
  },
};

// Tasks Service
export const tasksService = {
  async getAll(): Promise<Task[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks` : `${API_BASE}/tasks`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    return response.json();
  },

  async getById(taskId: string): Promise<Task | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch task');
    return response.json();
  },

  async getByProject(projectId: string): Promise<Task[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/project/${encodeURIComponent(projectId)}` : `${API_BASE}/tasks/project/${encodeURIComponent(projectId)}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    return response.json();
  },

  async create(task: Task): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks` : `${API_BASE}/tasks`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(task),
    });
    if (!response.ok) throw new Error('Failed to create task');
  },

  async update(taskId: string, updates: Partial<Task>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update task');
  },

  async delete(taskId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete task');
  },
};

// Users Service
export const usersService = {
  async getProfile(): Promise<any> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/users/profile` : `${API_BASE}/users/profile`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch user profile');
    return response.json();
  },

  async getAll(): Promise<any[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/users` : `${API_BASE}/users`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch users');
    return response.json();
  },
};

// Teams Service
export const teamsService = {
  async getAll(): Promise<Team[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams` : `${API_BASE}/teams`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch teams');
    return response.json();
  },

  async getById(teamName: string): Promise<TeamDetailData | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch team');
    return response.json();
  },

  async create(team: Team, teamDetail: TeamDetailData): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams` : `${API_BASE}/teams`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ team, teamDetail }),
    });
    if (!response.ok) throw new Error('Failed to create team');
  },

  async update(teamName: string, updates: Partial<Team>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team');
  },

  async updateDetail(teamName: string, updates: Partial<TeamDetailData>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/detail` : `${API_BASE}/teams/${encodeURIComponent(teamName)}/detail`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team detail');
  },

  async delete(teamName: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}` : `${API_BASE}/teams/${encodeURIComponent(teamName)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete team');
  },

  async removeMember(teamName: string, memberEmail: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberEmail)}`
      : `${API_BASE}/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberEmail)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to remove member' }));
      throw new Error(error.error || 'Failed to remove member');
    }
  },

  async leaveTeam(teamName: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/leave`
      : `${API_BASE}/teams/${encodeURIComponent(teamName)}/leave`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to leave team' }));
      throw new Error(error.error || 'Failed to leave team');
    }
  },
};

// Team Join Requests Service
export const teamJoinRequestsService = {
  async requestJoin(teamName: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/join-request` : `${API_BASE}/teams/${encodeURIComponent(teamName)}/join-request`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send join request' }));
      throw new Error(error.error || 'Failed to send join request');
    }
  },

  async getPendingRequests(): Promise<any[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/join-requests` : `${API_BASE}/teams/join-requests`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch join requests');
    return response.json();
  },

  async approveRequest(requestId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/join-requests/${requestId}/approve` : `${API_BASE}/teams/join-requests/${requestId}/approve`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to approve request' }));
      throw new Error(error.error || 'Failed to approve request');
    }
  },

  async rejectRequest(requestId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/join-requests/${requestId}/reject` : `${API_BASE}/teams/join-requests/${requestId}/reject`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to reject request' }));
      throw new Error(error.error || 'Failed to reject request');
    }
  },
};

// Integrations Service
export interface Integration {
  id: string;
  name: string;
  connected: boolean;
  connectedAt?: string;
}

export const integrationsService = {
  async getAll(): Promise<Integration[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/integrations` : `${API_BASE}/integrations`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch integrations');
    return response.json();
  },

  async connectSlack(botToken: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/integrations/slack/connect` : `${API_BASE}/integrations/slack/connect`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ botToken }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to connect Slack' }));
      throw new Error(error.error || 'Failed to connect Slack');
    }
  },

  async connectAtlassian(email: string, password: string, apiToken: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/integrations/atlassian/connect` : `${API_BASE}/integrations/atlassian/connect`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ email, password, apiToken }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to connect Atlassian' }));
      throw new Error(error.error || 'Failed to connect Atlassian');
    }
  },

  async disconnect(integrationId: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/integrations/${integrationId}/disconnect`
      : `${API_BASE}/integrations/${integrationId}/disconnect`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to disconnect integration' }));
      throw new Error(error.error || 'Failed to disconnect integration');
    }
  },
};

