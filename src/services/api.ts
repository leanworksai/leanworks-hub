import type { Project } from '@/data/projectsData';
import type { Task } from '@/data/tasksData';
import type { Team, TeamDetailData } from '@/data/teamsData';
import type { Note } from '@/data/notesData';
import { auth, db } from '@/lib/firebase-client';

// Use proxy API in development (uses gcp_credential.json via Admin SDK)
// In production, use relative path so nginx can proxy to the backend server
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Initialize API - legacy function name kept for compatibility
export const initFirestore = () => {
  // API initialization (legacy name)
};

// Helper to get auth token for API requests
export async function getAuthToken(): Promise<string | null> {
  // First try to get token from Firebase Auth
  if (auth && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      return idToken;
    } catch (error) {
      console.warn('⚠️ Failed to get token from Firebase Auth:', error);
    }
  } else {
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
  
  console.warn('⚠️ No auth token available for API request');
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

  async getById(projectId: string): Promise<Project | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}` : `${API_BASE}/projects/${encodeURIComponent(projectId)}`;
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

  async update(projectId: string, updates: Partial<Project>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}` : `${API_BASE}/projects/${encodeURIComponent(projectId)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update project');
  },

  async delete(projectId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}` : `${API_BASE}/projects/${encodeURIComponent(projectId)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete project');
  },

  async addMember(projectId: string, memberEmail: string, role?: string, avatar?: string): Promise<any> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/members`
      : `${API_BASE}/projects/${encodeURIComponent(projectId)}/members`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ memberEmail, role, avatar }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add member' }));
      throw new Error(error.error || 'Failed to add member');
    }
    return response.json();
  },

  async removeMember(projectId: string, memberEmail: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberEmail)}`
      : `${API_BASE}/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberEmail)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to remove member' }));
      throw new Error(error.error || 'Failed to remove member');
    }
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

// Notes Service
export const notesService = {
  async getAll(): Promise<Note[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notes` : `${API_BASE}/notes`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch notes');
    return response.json();
  },

  async getById(noteId: string): Promise<Note | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notes/${encodeURIComponent(noteId)}` : `${API_BASE}/notes/${encodeURIComponent(noteId)}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch note');
    return response.json();
  },

  async create(note: Note): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notes` : `${API_BASE}/notes`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(note),
    });
    if (!response.ok) throw new Error('Failed to create note');
  },

  async update(noteId: string, updates: Partial<Note>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notes/${encodeURIComponent(noteId)}` : `${API_BASE}/notes/${encodeURIComponent(noteId)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update note');
  },

  async delete(noteId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notes/${encodeURIComponent(noteId)}` : `${API_BASE}/notes/${encodeURIComponent(noteId)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete note');
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

  async updateProfile(data: { jobTitle: string; timezone: string; responsibilities?: string }): Promise<any> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/users/profile` : `${API_BASE}/users/profile`;
    const response = await authenticatedFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update profile' }));
      throw new Error(error.error || 'Failed to update profile');
    }
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

  async getById(teamId: string): Promise<TeamDetailData | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamId)}` : `${API_BASE}/teams/${encodeURIComponent(teamId)}`;
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

  async update(teamId: string, updates: Partial<Team>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamId)}` : `${API_BASE}/teams/${encodeURIComponent(teamId)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team');
  },

  async updateDetail(teamId: string, updates: Partial<TeamDetailData>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamId)}/detail` : `${API_BASE}/teams/${encodeURIComponent(teamId)}/detail`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update team detail');
  },

  async delete(teamId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/${encodeURIComponent(teamId)}` : `${API_BASE}/teams/${encodeURIComponent(teamId)}`;
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

// Team Invitations Service
export const teamInvitationsService = {
  async inviteMember(teamName: string, inviteeEmail: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/teams/${encodeURIComponent(teamName)}/invitations`
      : `${API_BASE}/teams/${encodeURIComponent(teamName)}/invitations`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ inviteeEmail }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send invitation' }));
      throw new Error(error.error || 'Failed to send invitation');
    }
  },

  async getInvitations(): Promise<any[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/teams/invitations` : `${API_BASE}/teams/invitations`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch invitations');
    return response.json();
  },

  async acceptInvitation(invitationId: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/teams/invitations/${invitationId}/accept`
      : `${API_BASE}/teams/invitations/${invitationId}/accept`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to accept invitation' }));
      throw new Error(error.error || 'Failed to accept invitation');
    }
  },

  async declineInvitation(invitationId: string): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/teams/invitations/${invitationId}/decline`
      : `${API_BASE}/teams/invitations/${invitationId}/decline`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to decline invitation' }));
      throw new Error(error.error || 'Failed to decline invitation');
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

  // Unified connect method for all integrations
  async connect(integrationId: string, credentials: Record<string, string>): Promise<void> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/integrations/${integrationId}/connect`
      : `${API_BASE}/integrations/${integrationId}/connect`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `Failed to connect ${integrationId}` }));
      throw new Error(error.error || `Failed to connect ${integrationId}`);
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
  teamId?: string;
  memberName?: string;
  memberAvatar?: string;
  imageUrls?: string[];
  likes?: string[]; // Array of user emails who liked the message
  citedContext?: {
    projects?: any[];
    tasks?: any[];
    teams?: any[];
  };
}

export type MessageListener = (messages: ChatMessage[]) => void;
export type Unsubscribe = () => void;

export const messagesService = {
  async getByChatId(chatId: string, afterTimestamp?: Date): Promise<ChatMessage[]> {
    let url = import.meta.env.DEV ? `${API_BASE}/api/messages/${encodeURIComponent(chatId)}` : `${API_BASE}/messages/${encodeURIComponent(chatId)}`;
    if (afterTimestamp) {
      url += `?afterTimestamp=${afterTimestamp.toISOString()}`;
    }
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const messages = await response.json();
    // Convert timestamp strings to Date objects and normalize likes
    return messages.map((msg: ChatMessage) => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'string' ? new Date(msg.timestamp) : msg.timestamp,
      likes: Array.isArray(msg.likes) ? msg.likes : [], // Normalize likes to always be an array
    }));
  },

  async create(message: {
    chatId: string;
    role?: 'user' | 'assistant';
    content: string;
    projectId?: string;
    teamId?: string;
    memberName?: string;
    memberAvatar?: string;
    imageUrls?: string[];
    citedContext?: {
      projects?: any[];
      tasks?: any[];
      teams?: any[];
    };
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
    if (!data.message) {
      throw new Error('Invalid response: message data is missing');
    }
    return {
      ...data.message,
      timestamp: data.message.timestamp 
        ? (typeof data.message.timestamp === 'string' ? new Date(data.message.timestamp) : data.message.timestamp)
        : new Date(),
    };
  },

  async toggleLike(messageId: string): Promise<{ likes: string[]; liked: boolean }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/messages/${encodeURIComponent(messageId)}/like` 
      : `${API_BASE}/messages/${encodeURIComponent(messageId)}/like`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to toggle like' }));
      throw new Error(error.error || 'Failed to toggle like');
    }
    return response.json();
  },

  // Subscribe to real-time message updates
  subscribeToMessages(chatId: string, callback: MessageListener): Unsubscribe {
    // Use polling by default (more reliable, works without Firebase Auth)
    // Firestore real-time listeners require Firebase Auth which may not be available
    return this.subscribeViaPolling(chatId, callback);
    
    // Note: Firestore real-time listeners are disabled by default because:
    // 1. They require Firebase Auth which may not be configured
    // 2. Dynamic imports are async and cause timing issues
    // 3. Polling is more reliable and works with API-based auth
    // If you need real-time listeners, ensure Firebase Auth is properly configured
    // and handle the async nature of dynamic imports properly
  },

  // Polling fallback for when Firestore real-time is not available
  subscribeViaPolling(chatId: string, callback: MessageListener): Unsubscribe {
    let lastMessageIds: Set<string> = new Set();
    let lastMessageCount = 0;
    let lastMessageHashes: Map<string, string> = new Map(); // Store hash of message content to detect changes
    let isActive = true;
    let pollTimeout: NodeJS.Timeout | null = null;
    
    // Create a simple hash of message content to detect changes
    const getMessageHash = (msg: ChatMessage): string => {
      return JSON.stringify({
        id: msg.id,
        content: msg.content,
        likes: msg.likes || [],
        imageUrls: msg.imageUrls || [],
      });
    };
    
    const poll = async () => {
      if (!isActive) return;
      
      try {
        const messages = await this.getByChatId(chatId);
        const currentIds = new Set(messages.map(m => m.id));
        const currentCount = messages.length;
        
        // Create hash map of current messages
        const currentHashes = new Map<string, string>();
        messages.forEach(msg => {
          currentHashes.set(msg.id, getMessageHash(msg));
        });
        
        // Check if messages changed (by ID, count, or content)
        const idsChanged = lastMessageIds.size !== currentIds.size ||
          ![...lastMessageIds].every(id => currentIds.has(id)) ||
          currentCount !== lastMessageCount;
        
        // Check if any message content changed (e.g., likes)
        let contentChanged = false;
        if (!idsChanged) {
          // Only check content if IDs haven't changed
          for (const [id, currentHash] of currentHashes.entries()) {
            const lastHash = lastMessageHashes.get(id);
            if (lastHash !== currentHash) {
              contentChanged = true;
              break;
            }
          }
        }
        
        if (idsChanged || contentChanged) {
          lastMessageIds = currentIds;
          lastMessageCount = currentCount;
          lastMessageHashes = currentHashes;
          callback(messages);
        }
      } catch (error) {
        // Silently handle polling errors (network issues, etc.)
        console.debug('Error polling messages:', error);
      }
      
      // Poll every 2 seconds for better responsiveness (was 3 seconds)
      if (isActive) {
        pollTimeout = setTimeout(poll, 2000);
      }
    };
    
    // Start polling immediately (no delay for faster message delivery)
    poll();
    
    // Return unsubscribe function
    return () => {
      isActive = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
    };
  },
};

// Image Upload Service
export const imageUploadService = {
  async refreshImageUrls(chatId: string, imageUrls: string[]): Promise<string[]> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const url = import.meta.env.DEV ? `${API_BASE}/api/images/refresh` : `${API_BASE}/images/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageUrls, chatId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to refresh image URLs' }));
      throw new Error(error.error || 'Failed to refresh image URLs');
    }

    const data = await response.json();
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) {
      throw new Error('Invalid response: imageUrls array is missing');
    }

    return data.imageUrls;
  },

  async uploadImage(chatId: string, file: File): Promise<string> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Image size exceeds 10MB limit');
    }

    // Validate file type (allow common image formats - will be converted to JPG on backend)
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const fileName = file.name.toLowerCase();
    const isValidType = validTypes.includes(file.type) || 
                        validExtensions.some(ext => fileName.endsWith(ext));
    
    if (!isValidType) {
      throw new Error('Only image files are allowed (JPG, PNG, WebP, GIF)');
    }

    // Create FormData
    const formData = new FormData();
    formData.append('image', file);
    formData.append('chatId', chatId);

    // Upload to backend API
    const url = import.meta.env.DEV ? `${API_BASE}/api/images/upload` : `${API_BASE}/images/upload`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to upload image' }));
      throw new Error(error.error || 'Failed to upload image');
    }

    const data = await response.json();
    if (!data.imageUrl) {
      throw new Error('Invalid response: imageUrl is missing');
    }

    return data.imageUrl;
  },
};

// Update Summaries Service
export interface UpdateSummary {
  projectId: string;
  dateId: string;
  updateSummary: string;
}

export const updateSummariesService = {
  async getAll(): Promise<Record<string, { dateId: string; updateSummary: string }>> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/update-summaries` : `${API_BASE}/update-summaries`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch update summaries');
    return response.json();
  },

  async getByProjectId(projectId: string): Promise<UpdateSummary | null> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/update-summaries?projectId=${encodeURIComponent(projectId)}` 
      : `${API_BASE}/update-summaries?projectId=${encodeURIComponent(projectId)}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch update summary');
    return response.json();
  },
};

// Call Signaling Service
export interface CallSignal {
  callId: string;
  chatId: string;
  callerEmail: string;
  calleeEmail: string;
  status: 'ringing' | 'active' | 'ended';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  iceCandidates?: RTCIceCandidateInit[];
  createdAt: Date | string;
  endedAt?: Date | string;
}

export type CallSignalListener = (signal: CallSignal | null) => void;
export type CallSignalUnsubscribe = () => void;

export const callSignalingService = {
  /**
   * Subscribe to call signals for a specific chat
   */
  subscribeToCallSignals(chatId: string, callback: CallSignalListener): CallSignalUnsubscribe {
    // Check if Firestore is available (db might be null if not initialized)
    if (!db) {
      // Silently return during initialization - Firestore might not be ready yet
      // We'll warn when actually trying to use the feature
      return () => {};
    }

    // Check auth, but don't warn during initial subscription (auth might still be initializing)
    // The warning will appear when actually trying to create/answer calls
    if (!auth?.currentUser?.email) {
      return () => {};
    }

    let unsubscribeFn: (() => void) | null = null;
    let isActive = true;

    // Use dynamic import to avoid issues if firebase/firestore is not available
    import('firebase/firestore').then(async (firestore) => {
      if (!isActive) return;

      const { collection, onSnapshot, query, where, orderBy, limit, Timestamp } = firestore;
      
      const userEmail = auth.currentUser?.email?.toLowerCase();
      if (!userEmail) {
        console.warn('No user email, cannot subscribe to call signals');
        return;
      }

      const { sanitizeDomainForFirestore } = await import('@/lib/utils');
      const domain = sanitizeDomainForFirestore(userEmail);
      const callsRef = collection(db, `domains/${domain}/calls`);

      // Calculate cutoff time - only get calls from the last 5 minutes
      // This prevents old ended calls from overwhelming the query results
      const cutoffTime = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);

      // Query for recent calls for this chat
      // Requires composite index: chatId (asc) + createdAt (desc)
      const q = query(
        callsRef,
        where('chatId', '==', chatId),
        where('createdAt', '>', cutoffTime),
        orderBy('createdAt', 'desc'),
        limit(10)
      );

      unsubscribeFn = onSnapshot(
        q,
        {
          // Include metadata changes to detect when data comes from cache vs server
          includeMetadataChanges: true,
        },
        (snapshot) => {
          if (!isActive) return;

          // In Safari, sometimes we get cache-only snapshots first
          // Only process if we have data or if this is a server snapshot
          if (snapshot.metadata.fromCache && snapshot.empty) {
            // This is a cached empty result, wait for server result
            return;
          }

          if (snapshot.empty) {
            // Only clear if this is a server snapshot (not just cache)
            if (!snapshot.metadata.fromCache) {
              callback(null);
            }
            return;
          }

          // Sort documents: prioritize non-ended calls, then by createdAt (most recent first)
          const sortedDocs = [...snapshot.docs].sort((a, b) => {
            const aData = a.data();
            const bData = b.data();
            
            // First, prioritize non-ended calls
            const aEnded = aData.status === 'ended';
            const bEnded = bData.status === 'ended';
            if (aEnded !== bEnded) {
              return aEnded ? 1 : -1; // Non-ended calls come first
            }
            
            // Then sort by createdAt (most recent first)
            const aCreated = aData.createdAt?.toMillis?.() || aData.createdAt?.seconds * 1000 || 0;
            const bCreated = bData.createdAt?.toMillis?.() || bData.createdAt?.seconds * 1000 || 0;
            return bCreated - aCreated; // Descending order (newest first)
          });
          
          // Log for debugging
          if (import.meta.env.DEV && sortedDocs.length > 0) {
            console.log('📞 subscribeToCallSignals: Sorted call documents', {
              count: sortedDocs.length,
              docs: sortedDocs.slice(0, 3).map(doc => ({
                id: doc.id,
                status: doc.data().status,
                hasAnswer: !!doc.data().answer,
                createdAt: doc.data().createdAt?.toMillis?.() || doc.data().createdAt?.seconds * 1000 || 0,
              })),
            });
          }
          
          if (sortedDocs.length === 0) {
            callback(null);
            return;
          }
          
          const callDoc = sortedDocs[0];
          const data = callDoc.data();
          
          // Use the document ID as callId (should match the callId in the data)
          const callId = callDoc.id || data.callId;
          
          const signal: CallSignal = {
            callId: callId,
            chatId: data.chatId || chatId,
            callerEmail: data.callerEmail || '',
            calleeEmail: data.calleeEmail || '',
            status: data.status || 'ringing',
            offer: data.offer ? (typeof data.offer === 'string' ? JSON.parse(data.offer) : data.offer) : undefined,
            answer: data.answer ? (typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer) : undefined,
            iceCandidates: data.iceCandidates || [],
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now()),
            endedAt: data.endedAt?.toDate ? data.endedAt.toDate() : (data.endedAt ? new Date(data.endedAt) : undefined),
          };

          if (import.meta.env.DEV) {
            console.log('📞 subscribeToCallSignals: Returning signal', {
              callId: signal.callId,
              status: signal.status,
              hasAnswer: !!signal.answer,
              fromCache: snapshot.metadata.fromCache,
            });
          }

          callback(signal);
        },
        (error) => {
          if (!isActive) return;
          console.error('Error listening to call signals:', error);
          // Don't call callback(null) on error - keep existing state
          // This prevents clearing the call signal on temporary errors
        }
      );
    }).catch((error) => {
      console.error('Failed to import firestore:', error);
    });

    // Return unsubscribe function
    return () => {
      isActive = false;
      if (unsubscribeFn) {
        unsubscribeFn();
      }
    };
  },

  /**
   * Subscribe to incoming call offers with criteria-based filtering
   * Filters by: calleeEmail, status='ringing', offer exists, createdAt within 60s
   */
  subscribeToIncomingOffers(
    currentUserEmail: string,
    callback: CallSignalListener,
    processedCallIds?: Set<string>
  ): CallSignalUnsubscribe {
    let unsubscribeFn: (() => void) | null = null;
    let isActive = true;
    let retryInterval: NodeJS.Timeout | null = null;
    let isListenerEstablished = false;
    const processedSet = processedCallIds || new Set<string>();

    const setupListener = async () => {
      if (!isActive || isListenerEstablished) return;

      // Check if Firestore is available
      if (!db) {
        console.warn('📞 subscribeToIncomingOffers: Firestore not ready, will retry...');
        return;
      }

      // Check auth - wait for it to be ready
      if (!auth?.currentUser?.email) {
        console.warn('📞 subscribeToIncomingOffers: Auth not ready, will retry...');
        return;
      }

      try {
        const firestore = await import('firebase/firestore');
        if (!isActive) return;

        const { collection, onSnapshot, query, where, orderBy, limit, Timestamp } = firestore;
        
        const userEmail = currentUserEmail.toLowerCase();
        if (!userEmail) {
          console.warn('No user email, cannot subscribe to incoming offers');
          return;
        }

        const { sanitizeDomainForFirestore } = await import('@/lib/utils');
        const domain = sanitizeDomainForFirestore(userEmail);
        const callsRef = collection(db, `domains/${domain}/calls`);

        // Calculate cutoff time (60 seconds ago)
        const cutoffTime = Timestamp.fromMillis(Date.now() - 60000);

        // Criteria-based query
        // Note: Firestore doesn't support != null queries, so we filter offer existence in the callback
        const q = query(
          callsRef,
          where('calleeEmail', '==', userEmail),
          where('status', '==', 'ringing'),
          where('createdAt', '>', cutoffTime),
          orderBy('createdAt', 'desc'),
          limit(1)
        );

        console.log('📞 subscribeToIncomingOffers: Setting up Firestore listener', {
          userEmail,
          domain,
        });

        unsubscribeFn = onSnapshot(
          q,
          {
            includeMetadataChanges: true,
          },
          (snapshot) => {
            if (!isActive) return;

            // Mark listener as established on first successful callback
            if (!isListenerEstablished) {
              isListenerEstablished = true;
              console.log('✅ subscribeToIncomingOffers: Firestore listener established successfully');
              // Clear retry interval once listener is established
              if (retryInterval) {
                clearInterval(retryInterval);
                retryInterval = null;
              }
            }

            // Skip cache-only empty snapshots
            if (snapshot.metadata.fromCache && snapshot.empty) {
              return;
            }

            if (snapshot.empty) {
              // Only clear if this is a server snapshot
              if (!snapshot.metadata.fromCache) {
                callback(null);
              }
              return;
            }

            // Process document changes (new or modified documents)
            snapshot.docChanges().forEach((change) => {
              if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const callId = change.doc.id || data.callId;

                // Skip if already processed
                if (processedSet.has(callId)) {
                  return;
                }

                // Verify offer exists and is valid
                if (!data.offer || data.status !== 'ringing') {
                  return;
                }

                // Verify email matching
                const calleeEmailLower = (data.calleeEmail || '').toLowerCase();
                if (calleeEmailLower !== userEmail) {
                  return;
                }

              // Verify call is recent (double-check)
              const createdAt = data.createdAt?.toMillis?.() || 
                               (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : 0) ||
                               (data.createdAt?.getTime ? data.createdAt.getTime() : 0);
              const callAge = Date.now() - createdAt;
              if (callAge > 60000) {
                // Call is older than 60 seconds, skip it
                processedSet.add(callId);
                return;
              }

              console.log('📞 Incoming call detected:', { callId, callerEmail: data.callerEmail });
              
              // NOTE: Don't mark as processed here - let the callback handle it
              // This allows the callback to decide whether to process the call

              const signal: CallSignal = {
                  callId,
                  chatId: data.chatId || '',
                  callerEmail: data.callerEmail || '',
                  calleeEmail: data.calleeEmail || '',
                  status: data.status || 'ringing',
                  offer: data.offer ? (typeof data.offer === 'string' ? JSON.parse(data.offer) : data.offer) : undefined,
                  answer: data.answer ? (typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer) : undefined,
                  iceCandidates: data.iceCandidates || [],
                  createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now()),
                  endedAt: data.endedAt?.toDate ? data.endedAt.toDate() : (data.endedAt ? new Date(data.endedAt) : undefined),
                };

                callback(signal);
              }
            });
          },
          (error) => {
            if (!isActive) return;
            
            // Handle index errors gracefully
            if ((error as any)?.code === 9 || (error as any)?.message?.includes('index')) {
              console.error('Firestore index error. Please create the composite index for database "leanworks-prod":', {
                database: 'leanworks-prod',
                indexFields: ['calleeEmail', 'status', 'createdAt'],
              });
            } else {
              console.error('Error listening to incoming offers:', error);
              // Reset listener state so retry can re-establish
              isListenerEstablished = false;
              unsubscribeFn = null;
            }
          }
        );
      } catch (error) {
        console.error('Failed to setup incoming offers listener:', error);
        isListenerEstablished = false;
      }
    };

    // Initial setup attempt
    setupListener();

    // Retry every 2 seconds until listener is established (max 30 retries = 60 seconds)
    let retryCount = 0;
    const maxRetries = 30;
    retryInterval = setInterval(() => {
      if (!isActive) {
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
        return;
      }
      
      if (isListenerEstablished) {
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
        return;
      }

      retryCount++;
      if (retryCount > maxRetries) {
        console.error('📞 subscribeToIncomingOffers: Max retries reached, giving up');
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
        return;
      }

      console.log(`📞 subscribeToIncomingOffers: Retry attempt ${retryCount}/${maxRetries}`);
      setupListener();
    }, 2000);

    // Return unsubscribe function
    return () => {
      isActive = false;
      if (retryInterval) {
        clearInterval(retryInterval);
        retryInterval = null;
      }
      if (unsubscribeFn) {
        unsubscribeFn();
      }
    };
  },

  /**
   * Create a call offer
   * Uses backend API route to write to Firestore (bypasses security rules)
   * The GlobalCallListener will still receive updates via WebSocket (onSnapshot)
   */
  async createCallOffer(
    chatId: string,
    callerEmail: string,
    calleeEmail: string,
    offer: RTCSessionDescriptionInit
  ): Promise<string> {
    // Verify auth is available
    if (!auth?.currentUser) {
      console.error('❌ createCallOffer: User not authenticated - auth.currentUser is null');
      throw new Error('User not authenticated. Please refresh the page and log in again.');
    }

    // Get auth token for API request
    let idToken: string | null = null;
    try {
      idToken = await auth.currentUser.getIdToken();
      console.log('✅ createCallOffer: Got ID token', {
        tokenLength: idToken?.length,
        tokenPrefix: idToken?.substring(0, 20),
      });
    } catch (tokenError: any) {
      console.error('❌ createCallOffer: Failed to get ID token', {
        error: tokenError.message,
        code: tokenError.code,
      });
      throw new Error('Failed to get authentication token. Please refresh the page and log in again.');
    }

    // Use backend API route to create call (bypasses Firestore security rules)
    const apiUrl = import.meta.env.DEV 
      ? `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/offer`
      : `${API_BASE}/calls/${encodeURIComponent(chatId)}/offer`;
    console.log('📞 createCallOffer: Creating call via API', {
      apiUrl,
      chatId,
      callerEmail,
      calleeEmail,
    });

    try {
      console.log('📡 createCallOffer: Sending API request', {
        apiUrl,
        method: 'POST',
        hasToken: !!idToken,
        tokenLength: idToken?.length,
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          offer,
          calleeEmail: calleeEmail.toLowerCase(),
        }),
      });

      console.log('📡 createCallOffer: API response received', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Unknown error' };
        }
        console.error('❌ createCallOffer: API request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          errorText,
        });
        throw new Error(errorData.error || `Failed to create call: ${response.statusText}`);
      }

      const result = await response.json();
      const callId = result.callId;
      
      console.log('✅ createCallOffer: Call created successfully via API', {
        callId,
        chatId,
        callerEmail,
        calleeEmail,
        result,
      });

      // Wait a moment for Firestore to propagate, then verify document exists
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the document was written by querying Firestore directly
      try {
        const { getDoc, doc: docFn, collection: collectionFn } = await import('firebase/firestore');
        const userEmail = auth.currentUser?.email?.toLowerCase() || '';
        const { sanitizeDomainForFirestore } = await import('@/lib/utils');
        const domain = sanitizeDomainForFirestore(userEmail);
        const collectionPath = `domains/${domain}/calls`;
        const callDocRef = docFn(db, collectionPath, callId);
        const verifyDoc = await getDoc(callDocRef);
        
        if (verifyDoc.exists()) {
          console.log('✅ createCallOffer: Document verified in Firestore', {
            callId,
            documentPath: callDocRef.path,
            data: verifyDoc.data(),
          });
        } else {
          console.warn('⚠️ createCallOffer: Document not found in Firestore yet', {
            callId,
            documentPath: callDocRef.path,
            note: 'This might be a timing issue - document may appear shortly',
          });
        }
      } catch (verifyError: any) {
        console.warn('⚠️ createCallOffer: Could not verify document', {
          error: verifyError.message,
          code: verifyError.code,
        });
      }

      // The GlobalCallListener will automatically receive the new call document
      // via WebSocket (onSnapshot) - no need to verify here
      return callId;
    } catch (error: any) {
      console.error('❌ createCallOffer: Failed to create call via API', {
        error: error.message,
        stack: error.stack,
        chatId,
        callerEmail,
        calleeEmail,
      });
      throw error;
    }
  },

  /**
   * Send call answer
   */
  async sendCallAnswer(callId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    console.log('📞 sendCallAnswer: Starting...', {
      callId,
      answerType: answer?.type,
      hasAnswerSdp: !!answer?.sdp,
    });
    
    if (!db) {
      console.error('❌ sendCallAnswer: Firestore not initialized');
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      console.error('❌ sendCallAnswer: User not authenticated');
      throw new Error('User not authenticated');
    }

    const { doc, updateDoc } = await import('firebase/firestore');
    const userEmail = auth.currentUser.email.toLowerCase();
    const { sanitizeDomainForFirestore } = await import('@/lib/utils');
    const domain = sanitizeDomainForFirestore(userEmail);
    const callRef = doc(db, `domains/${domain}/calls`, callId);
    
    console.log('📞 sendCallAnswer: Updating Firestore document...', {
      path: `domains/${domain}/calls/${callId}`,
      userEmail,
    });

    await updateDoc(callRef, {
      answer: JSON.stringify(answer),
      status: 'active',
    });
    
    console.log('✅ sendCallAnswer: Firestore document updated successfully');
  },

  /**
   * Send ICE candidate
   */
  async sendICECandidate(callId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!db) {
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    const { doc, getDoc, updateDoc, arrayUnion } = await import('firebase/firestore');
    const userEmail = auth.currentUser.email.toLowerCase();
    const { sanitizeDomainForFirestore } = await import('@/lib/utils');
    const domain = sanitizeDomainForFirestore(userEmail);
    const callRef = doc(db, `domains/${domain}/calls`, callId);

    // Get current candidates and add new one
    const callDoc = await getDoc(callRef);
    if (!callDoc.exists()) {
      throw new Error('Call not found');
    }

    const currentCandidates = callDoc.data().iceCandidates || [];
    await updateDoc(callRef, {
      iceCandidates: arrayUnion(JSON.stringify(candidate)),
    });
  },

  /**
   * End call
   */
  async endCall(callId: string): Promise<void> {
    if (!db) {
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    const { doc, updateDoc, serverTimestamp, getDoc } = await import('firebase/firestore');
    const userEmail = auth.currentUser?.email?.toLowerCase();
    const { sanitizeDomainForFirestore } = await import('@/lib/utils');
    const domain = sanitizeDomainForFirestore(userEmail);
    const callRef = doc(db, `domains/${domain}/calls`, callId);

    try {
      // First verify the document exists
      const callDoc = await getDoc(callRef);
      if (!callDoc.exists()) {
        throw new Error(`Call document not found: ${callId}`);
      }

      // Update the call document
      await updateDoc(callRef, {
        status: 'ended',
        endedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('Failed to end call:', error);
      throw error;
    }
  },
};

// Updates Service
export interface Update {
  updateId: string;
  associatedTasks: string[];
  dateId: string;
  projectId: string;
  reason: string;
  timestamp: string;
  update: string;
  userId: string;
}

export const updatesService = {
  async getByTaskId(taskId: string): Promise<Update[]> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/updates/task/${encodeURIComponent(taskId)}` 
      : `${API_BASE}/updates/task/${encodeURIComponent(taskId)}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch updates');
    return response.json();
  },
};

