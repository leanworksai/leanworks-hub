import type { Project } from '@/data/projectsData';
import type { Task } from '@/data/tasksData';
import type { Team, TeamDetailData } from '@/data/teamsData';
import { auth, db } from '@/lib/firebase-client';

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

  async connectAtlassian(email: string, domain: string, apiToken: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/integrations/atlassian/connect` : `${API_BASE}/integrations/atlassian/connect`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ email, domain, apiToken }),
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

// Messages Service
export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | Date;
  userId?: string;
  projectId?: string;
  memberName?: string;
  memberAvatar?: string;
}

export type MessageListener = (messages: ChatMessage[]) => void;
export type Unsubscribe = () => void;

export const messagesService = {
  async getByChatId(chatId: string): Promise<ChatMessage[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/messages/${encodeURIComponent(chatId)}` : `${API_BASE}/messages/${encodeURIComponent(chatId)}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();
    // Convert timestamp strings to Date objects
    return messages.map((msg: ChatMessage) => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'string' ? new Date(msg.timestamp) : msg.timestamp,
    }));
  },

  async create(message: {
    chatId: string;
    role?: 'user' | 'assistant';
    content: string;
    projectId?: string;
    memberName?: string;
    memberAvatar?: string;
  }): Promise<ChatMessage> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/messages` : `${API_BASE}/messages`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create message' }));
      throw new Error(error.error || 'Failed to create message');
    }
    const data = await response.json();
    return {
      ...data.message,
      timestamp: typeof data.message.timestamp === 'string' ? new Date(data.message.timestamp) : data.message.timestamp,
    };
  },

  // Subscribe to real-time message updates
  subscribeToMessages(chatId: string, callback: MessageListener): Unsubscribe {
    // Try to use Firestore real-time listener if available
    if (db && auth?.currentUser?.email) {
      try {
        // Dynamic import to avoid issues if firebase/firestore is not available
        import('firebase/firestore').then((firestore) => {
          const { collection, query, where, orderBy, onSnapshot } = firestore;
          
          const userEmail = auth.currentUser?.email;
          if (!userEmail) {
            // Fallback to polling if no user
            return this.subscribeViaPolling(chatId, callback);
          }
          
          const domain = userEmail.split('@')[1]?.toLowerCase() || '';
          const messagesRef = collection(db, `domains/${domain}/messages`);
          
          // Try to create query with orderBy, fallback if index doesn't exist
          let q;
          try {
            q = query(
              messagesRef,
              where('chatId', '==', chatId),
              orderBy('timestamp', 'asc')
            );
          } catch (error: any) {
            // If index error, query without orderBy
            if (error.code === 9 || error.message?.includes('index')) {
              q = query(
                messagesRef,
                where('chatId', '==', chatId)
              );
            } else {
              throw error;
            }
          }
          
          const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              const messages: ChatMessage[] = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                  id: doc.id,
                  ...data,
                  timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
                } as ChatMessage;
              });
              
              // Sort by timestamp if we didn't use orderBy
              messages.sort((a, b) => {
                const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
                const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
                return aTime - bTime;
              });
              
              callback(messages);
            },
            (error) => {
              console.error('Firestore listener error, falling back to polling:', error);
              // Fallback to polling on error - but we can't return from here
              // So we'll just let it fall through to polling
            }
          );
          
          return unsubscribe;
        }).catch((error) => {
          console.log('Firestore import failed, using polling:', error);
          return this.subscribeViaPolling(chatId, callback);
        });
      } catch (error) {
        console.log('Firestore setup error, using polling:', error);
      }
    }
    
    // Fallback to polling (always use polling for now since dynamic import is async)
    return this.subscribeViaPolling(chatId, callback);
  },

  // Polling fallback for when Firestore real-time is not available
  subscribeViaPolling(chatId: string, callback: MessageListener): Unsubscribe {
    let lastMessageIds: Set<string> = new Set();
    let isActive = true;
    let pollTimeout: NodeJS.Timeout | null = null;
    
    const poll = async () => {
      if (!isActive) return;
      
      try {
        const messages = await this.getByChatId(chatId);
        const currentIds = new Set(messages.map(m => m.id));
        
        // Only call callback if messages actually changed
        const idsChanged = lastMessageIds.size !== currentIds.size ||
          ![...lastMessageIds].every(id => currentIds.has(id));
        
        if (idsChanged) {
          lastMessageIds = currentIds;
          callback(messages);
        }
      } catch (error) {
        console.error('Error polling messages:', error);
      }
      
      // Poll every 3 seconds (less aggressive)
      if (isActive) {
        pollTimeout = setTimeout(poll, 3000);
      }
    };
    
    // Start polling after a short delay
    pollTimeout = setTimeout(poll, 1000);
    
    // Return unsubscribe function
    return () => {
      isActive = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
    };
  },
};

