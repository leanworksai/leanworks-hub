import type { Project, Comment } from '@/data/projectsData';
import type { Task, TaskComment } from '@/data/tasksData';
import type { Doc } from '@/data/docsData';
import type { Event } from '@/data/eventsData';
import { auth, db } from '@/lib/firebase-client';

// Use proxy API in development (uses gcp_credential.json via Admin SDK)
// In production, use relative path so nginx can proxy to the backend server
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Storage key for current org
const CURRENT_ORG_KEY = 'leanworks_current_org';

// Initialize API - legacy function name kept for compatibility
export const initFirestore = () => {
  // API initialization (legacy name)
};

// Get current org ID from storage (set by OrgContext)
export function getCurrentOrgId(): string | null {
  try {
    const saved = localStorage.getItem(CURRENT_ORG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.id || null;
    }
  } catch {
    // ignore
  }
  return null;
}

// Get current org slug from storage (set by OrgContext)
// Used for Firestore paths (sanitized name instead of ID)
export function getCurrentOrgSlug(): string | null {
  try {
    const saved = localStorage.getItem(CURRENT_ORG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.slug || null;
    }
  } catch {
    // ignore
  }
  return null;
}

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
  const orgId = getCurrentOrgId();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  // Include org context for org-scoped endpoints
  if (orgId) {
    headers['X-Org-Id'] = orgId;
  }
  
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

  async addComment(projectId: string, comment: string): Promise<Comment> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/comments`
      : `${API_BASE}/projects/${encodeURIComponent(projectId)}/comments`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add comment' }));
      throw new Error(error.error || 'Failed to add comment');
    }
    const data = await response.json();
    return data.comment;
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

  async addComment(taskId: string, comment: string): Promise<TaskComment> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/comments`
      : `${API_BASE}/tasks/${encodeURIComponent(taskId)}/comments`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add comment' }));
      throw new Error(error.error || 'Failed to add comment');
    }
    const data = await response.json();
    return data.comment;
  },
};

// Events Service
export const eventsService = {
  async getAll(): Promise<Event[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/events` : `${API_BASE}/events`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch events');
    return response.json();
  },

  async getById(eventId: string): Promise<Event | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/events/${eventId}` : `${API_BASE}/events/${eventId}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch event');
    return response.json();
  },

  async create(event: Event): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/events` : `${API_BASE}/events`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error('Failed to create event');
  },

  async update(eventId: string, updates: Partial<Event>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/events/${eventId}` : `${API_BASE}/events/${eventId}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update event');
  },

  async delete(eventId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/events/${eventId}` : `${API_BASE}/events/${eventId}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete event');
  },
};

// Docs Service
export const docsService = {
  async getAll(): Promise<Doc[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs` : `${API_BASE}/docs`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch docs');
    return response.json();
  },

  async getById(docId: string): Promise<Doc | null> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}` : `${API_BASE}/docs/${encodeURIComponent(docId)}`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to fetch doc');
    return response.json();
  },

  async create(doc: Doc): Promise<Doc> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs` : `${API_BASE}/docs`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(doc),
    });
    if (!response.ok) throw new Error('Failed to create doc');
    return response.json();
  },

  async update(docId: string, updates: Partial<Doc>): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}` : `${API_BASE}/docs/${encodeURIComponent(docId)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error('Failed to update doc');
  },

  async delete(docId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}` : `${API_BASE}/docs/${encodeURIComponent(docId)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete doc');
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

  async deleteAccount(): Promise<{ success: boolean; message: string }> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/users/me` : `${API_BASE}/users/me`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete account' }));
      throw new Error(error.error || 'Failed to delete account');
    }
    return response.json();
  },
};


// Team Invitations Service
export const systemNotificationsService = {
  async getNotifications(): Promise<Array<{
    id: string;
    userEmail: string;
    orgId: string | null;
    type: string;
    title: string;
    message: string;
    status: 'unread' | 'read' | 'dismissed';
    metadata?: any;
    actionUrl?: string | null;
    createdAt: string | null;
    readAt: string | null;
    dismissedAt: string | null;
  }>> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/notifications` : `${API_BASE}/notifications`;
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch notifications' }));
      throw new Error(error.error || 'Failed to fetch notifications');
    }
    return response.json();
  },

  async markAsRead(notificationId: string): Promise<{ success: boolean }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/notifications/${notificationId}/read` 
      : `${API_BASE}/notifications/${notificationId}/read`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to mark notification as read' }));
      throw new Error(error.error || 'Failed to mark notification as read');
    }
    return response.json();
  },

  async dismiss(notificationId: string): Promise<{ success: boolean }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/notifications/${notificationId}/dismiss` 
      : `${API_BASE}/notifications/${notificationId}/dismiss`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to dismiss notification' }));
      throw new Error(error.error || 'Failed to dismiss notification');
    }
    return response.json();
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

  async generateResponse(params: {
    chatId: string;
    message: string;  // Just the current message
    sessionId?: string;
  }): Promise<{ response: string; content: string }> {
    const userEmail = auth?.currentUser?.email;
    if (!userEmail) {
      throw new Error('User must be authenticated to generate response');
    }

    const orgSlug = getCurrentOrgSlug();
    if (!orgSlug) {
      throw new Error('Organization context is required');
    }

    // Determine the external AI service URL
    const isLocalDev = import.meta.env.DEV;
    // In production, use relative URL (will be proxied through ingress with HTTPS)
    // In local dev, use the direct service URL
    const aiServiceBase = isLocalDev 
      ? import.meta.env.VITE_AI_SERVICE_URL || 'http://0.0.0.0:8081'
      : import.meta.env.VITE_AI_SERVICE_URL || ''; // Use relative URL in production for HTTPS
    
    const aiServiceUrl = `${aiServiceBase}/api/messages/generate-response`;

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Use Bearer token for production, API key for local testing
    if (isLocalDev) {
      // Local testing: use API key
      try {
        const backendApiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';
        const apiKeyResponse = await fetch(`${backendApiBase}/api/ask-api-key`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${await getAuthToken() || ''}`,
          },
        });

        if (apiKeyResponse.ok) {
          const apiKeyData = await apiKeyResponse.json();
          headers['X-API-Key'] = apiKeyData.apiKey;
        } else {
          // Fallback to env var
          const fallbackKey = import.meta.env.VITE_ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
          headers['X-API-Key'] = fallbackKey;
        }
      } catch (error) {
        console.error('Failed to fetch API key from backend, using fallback:', error);
        const fallbackKey = import.meta.env.VITE_ASK_API_KEY || '7aeCdl+e5wtI/7PZFlGcUaWEM8Mf32AY7qSoThiO5WI=';
        headers['X-API-Key'] = fallbackKey;
      }
    } else {
      // Production: use Bearer token
      const token = await getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const requestPayload = {
      user_id: userEmail.toLowerCase(),
      org_slug: orgSlug,
      message: params.message,
      chatId: params.chatId,
      session_id: params.sessionId,
    };

    // Log the payload being sent to the ask API (development only)
    if (process.env.NODE_ENV === 'development') {
      console.log('📤 Ask API Request Payload:', JSON.stringify(requestPayload, null, 2));
      console.log('📤 Ask API URL:', aiServiceUrl);
    }

    const response = await fetch(aiServiceUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ 
        error: `Server error: ${response.status} ${response.statusText}` 
      }));
      throw new Error(errorData.error || `Failed to generate response: ${response.status}`);
    }

    const data = await response.json();
    return {
      response: data.response || data.content || '',
      content: data.content || data.response || '',
    };
  },

  // Subscribe to real-time message updates
  subscribeToMessages(chatId: string, callback: MessageListener): Unsubscribe {
    // Try Firestore real-time listener first (better for battery life)
    // Fall back to polling if Firestore isn't available
    try {
      if (db && auth?.currentUser?.email) {
        return this.subscribeViaFirestore(chatId, callback);
      }
    } catch (error) {
      console.debug('Firestore listener not available, using polling:', error);
    }
    
    // Fallback to polling
    return this.subscribeViaPolling(chatId, callback);
  },

  // Firestore real-time listener for messages (battery-efficient)
  subscribeViaFirestore(chatId: string, callback: MessageListener): Unsubscribe {
    // Check if Firestore is available
    if (!db) {
      console.warn('Firestore not ready, falling back to polling');
      return this.subscribeViaPolling(chatId, callback);
    }

    // Check auth
    if (!auth?.currentUser?.email) {
      console.warn('Firebase Auth not ready, falling back to polling');
      return this.subscribeViaPolling(chatId, callback);
    }

    let unsubscribeFn: (() => void) | null = null;
    let pollingUnsubscribe: Unsubscribe | null = null;
    let isActive = true;
    let usePolling = false;

    // Use dynamic import to avoid issues if firebase/firestore is not available
    import('firebase/firestore').then(async (firestore) => {
      if (!isActive || usePolling) return;

      const { collection, onSnapshot, query, where, orderBy, limit } = firestore;
      
      const userEmail = auth.currentUser?.email?.toLowerCase();
      if (!userEmail) {
        console.warn('No user email, falling back to polling');
        usePolling = true;
        if (isActive) {
          pollingUnsubscribe = this.subscribeViaPolling(chatId, callback);
        }
        return;
      }
      
      const orgSlug = getCurrentOrgSlug();
      if (!orgSlug) {
        console.warn('No org slug available, falling back to polling');
        usePolling = true;
        if (isActive) {
          pollingUnsubscribe = this.subscribeViaPolling(chatId, callback);
        }
        return;
      }

      const messagesPath = `orgs/${orgSlug}/messages`;
      const messagesRef = collection(db, messagesPath);

      // Build query constraints based on chatId type (same logic as backend)
      // All constraints must be collected and passed in a single query() call
      const queryConstraints: any[] = [where('chatId', '==', chatId)];

      // For AI assistant conversations, also filter by userId for privacy
      if (chatId.startsWith('ai-assistant-')) {
        queryConstraints.push(where('userId', '==', userEmail));
      }

      // For project channels, also filter by projectId
      if (chatId.startsWith('project-')) {
        const projectId = chatId.replace('project-', '');
        queryConstraints.push(where('projectId', '==', projectId));
      }

      // For team channels, also filter by teamId
      if (chatId.startsWith('team-')) {
        const teamId = chatId.replace('team-', '');
        queryConstraints.push(where('teamId', '==', teamId));
      }

      // Add orderBy and limit
      // Note: Firestore requires an index for compound queries with orderBy
      // If index doesn't exist, we'll catch the error and fall back to polling
      let q;
      try {
        q = query(
          messagesRef,
          ...queryConstraints,
          orderBy('timestamp', 'asc'),
          limit(100)
        );
      } catch (error) {
        // If orderBy fails, try without it (will sort in memory)
        console.warn('OrderBy not available, will sort in memory');
        q = query(
          messagesRef,
          ...queryConstraints,
          limit(100)
        );
      }

      unsubscribeFn = onSnapshot(
        q,
        {
          includeMetadataChanges: false, // Only get actual data changes
        },
        (snapshot) => {
          if (!isActive || usePolling) return;

          // Skip cache-only empty snapshots
          if (snapshot.metadata.fromCache && snapshot.empty) {
            return;
          }

          try {
            // Convert Firestore documents to ChatMessage format
            const messages = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                id: doc.id,
                chatId: data.chatId || chatId,
                role: data.role || 'user',
                content: data.content || '',
                timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : 
                          (data.timestamp ? new Date(data.timestamp) : new Date()),
                userId: data.userId || '',
                projectId: data.projectId || null,
                teamId: data.teamId || null,
                memberName: data.memberName || '',
                memberAvatar: data.memberAvatar || '',
                imageUrls: data.imageUrls || null,
                likes: Array.isArray(data.likes) ? data.likes : [],
                citedContext: data.citedContext || null,
              } as ChatMessage;
            });

            // Sort by timestamp ascending (oldest first) if orderBy wasn't used
            messages.sort((a, b) => {
              const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
              const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
              return aTime - bTime;
            });

            // Call callback with messages
            callback(messages);
          } catch (error) {
            console.error('Error processing Firestore snapshot:', error);
            // Don't fallback on processing errors - just log and continue
          }
        },
        (error: any) => {
          if (!isActive) return;

          console.error('Error in Firestore message listener:', error);
          
          // Check if it's an index error - these are recoverable with polling
          if (error.code === 9 || error.message?.includes('index')) {
            console.warn('Firestore index missing, falling back to polling');
            usePolling = true;
            // Unsubscribe from Firestore and switch to polling
            if (unsubscribeFn) {
              unsubscribeFn();
              unsubscribeFn = null;
            }
            if (isActive && !pollingUnsubscribe) {
              pollingUnsubscribe = this.subscribeViaPolling(chatId, callback);
            }
            return;
          }

          // For permission errors, fall back to polling
          if (error.code === 'permission-denied') {
            console.warn('Firestore permission denied, falling back to polling');
            usePolling = true;
            // Unsubscribe from Firestore and switch to polling
            if (unsubscribeFn) {
              unsubscribeFn();
              unsubscribeFn = null;
            }
            if (isActive && !pollingUnsubscribe) {
              pollingUnsubscribe = this.subscribeViaPolling(chatId, callback);
            }
            return;
          }

          // For other errors, log but don't fallback (might be temporary network issue)
          console.warn('Firestore listener error (non-critical):', error.message);
        }
      );
    }).catch((error: any) => {
      if (!isActive) return;
      console.error('Failed to setup Firestore listener:', error);
      usePolling = true;
      if (isActive && !pollingUnsubscribe) {
        pollingUnsubscribe = this.subscribeViaPolling(chatId, callback);
      }
    });

    // Return unsubscribe function
    return () => {
      isActive = false;
      if (unsubscribeFn) {
        unsubscribeFn();
      }
      if (pollingUnsubscribe) {
        pollingUnsubscribe();
      }
    };
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

  async getRecentConversations(limit: number = 50): Promise<Array<{
    chatId: string;
    lastMessage: string;
    lastMessageTimestamp: string;
    lastMessageRole: string;
    lastMessageUserId: string | null;
  }>> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/conversations/recent?limit=${limit}` 
      : `${API_BASE}/conversations/recent?limit=${limit}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch recent conversations');
    return response.json();
  },

  // Read Receipts Service
  async markChatAsRead(chatId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/read` : `${API_BASE}/chats/${encodeURIComponent(chatId)}/read`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to mark chat as read' }));
      throw new Error(error.error || 'Failed to mark chat as read');
    }
  },

  async getReadReceipts(): Promise<{ chatId: string; lastReadTimestamp: number }[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/chats/read-receipts` : `${API_BASE}/chats/read-receipts`;
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch read receipts');
    }
    return await response.json();
  },

  async getReadReceiptsBatch(chatIds: string[]): Promise<Map<string, number>> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/chats/read-receipts/batch` : `${API_BASE}/chats/read-receipts/batch`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ chatIds }),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch read receipts batch');
    }
    const data = await response.json();
    // Convert object to Map
    const map = new Map<string, number>();
    Object.entries(data).forEach(([chatId, timestamp]) => {
      map.set(chatId, timestamp as number);
    });
    return map;
  },
};

// Image Upload Service
export const imageUploadService = {
  async refreshImageUrls(chatId: string, imageUrls: string[]): Promise<string[]> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    // Get org slug for storage path
    const orgSlug = getCurrentOrgSlug();

    const url = import.meta.env.DEV ? `${API_BASE}/api/images/refresh` : `${API_BASE}/images/refresh`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    
    // Include org slug header if available
    if (orgSlug) {
      headers['X-Org-Slug'] = orgSlug;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
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

    // Get org slug for storage path
    const orgSlug = getCurrentOrgSlug();

    // Create FormData
    const formData = new FormData();
    formData.append('image', file);
    formData.append('chatId', chatId);

    // Upload to backend API
    const url = import.meta.env.DEV ? `${API_BASE}/api/images/upload` : `${API_BASE}/images/upload`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };
    
    // Include org slug header if available
    if (orgSlug) {
      headers['X-Org-Slug'] = orgSlug;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
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

// File Upload Service
export const fileUploadService = {
  async uploadFile(docId: string, file: File): Promise<{
    fileUrl: string;
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit');
    }

    // Get org slug for storage path
    const orgSlug = getCurrentOrgSlug();

    // Create FormData
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docId', docId);

    // Upload to backend API
    const url = import.meta.env.DEV ? `${API_BASE}/api/files/upload` : `${API_BASE}/files/upload`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };
    
    // Include org slug header if available
    if (orgSlug) {
      headers['X-Org-Slug'] = orgSlug;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to upload file' }));
      throw new Error(error.error || 'Failed to upload file');
    }

    const data = await response.json();
    if (!data.fileUrl || !data.fileId) {
      throw new Error('Invalid response: fileUrl or fileId is missing');
    }

    return {
      fileUrl: data.fileUrl,
      fileId: data.fileId,
      fileName: data.fileName || file.name,
      fileSize: data.fileSize || file.size,
      mimeType: data.mimeType || file.type || 'application/octet-stream',
    };
  },

  async refreshFileUrls(docId: string, fileUrls: string[]): Promise<string[]> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    // Get org slug for storage path
    const orgSlug = getCurrentOrgSlug();

    const url = import.meta.env.DEV ? `${API_BASE}/api/files/refresh` : `${API_BASE}/files/refresh`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    
    // Include org slug header if available
    if (orgSlug) {
      headers['X-Org-Slug'] = orgSlug;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileUrls, docId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to refresh file URLs' }));
      throw new Error(error.error || 'Failed to refresh file URLs');
    }

    const data = await response.json();
    if (!data.fileUrls || !Array.isArray(data.fileUrls)) {
      throw new Error('Invalid response: fileUrls array is missing');
    }

    return data.fileUrls;
  },
};

// Update Summaries Service
export interface UpdateSummary {
  projectId: string;
  dateId: string;
  updateSummary: string;
  generatedAt?: string;
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

  async getAllByProjectId(projectId: string): Promise<UpdateSummary[]> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/update-summaries?projectId=${encodeURIComponent(projectId)}&all=true` 
      : `${API_BASE}/update-summaries?projectId=${encodeURIComponent(projectId)}&all=true`;
    const response = await authenticatedFetch(url);
    if (response.status === 404) return [];
    if (!response.ok) throw new Error('Failed to fetch update summaries');
    return response.json();
  },
};

// LiveKit Service
export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

export const liveKitService = {
  async getToken(roomName: string, participantName?: string): Promise<LiveKitTokenResponse> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/livekit/token` 
      : `${API_BASE}/livekit/token`;

    const params = new URLSearchParams({
      roomName,
      ...(participantName && { participantName }),
    });

    const response = await authenticatedFetch(`${url}?${params}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to get LiveKit token' }));
      throw new Error(error.error || 'Failed to get LiveKit token');
    }
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
  roomName?: string; // LiveKit room name
  isGroupCall?: boolean; // Whether this is a group call
  participantEmails?: string[]; // All participants for group calls
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
      
      const orgSlug = getCurrentOrgSlug();
      const callsPath = `orgs/${orgSlug || 'default'}/calls`;
      const callsRef = collection(db, callsPath);

      // Calculate cutoff time - only get calls from the last 5 minutes
      // This prevents old ended calls from overwhelming the query results
      const cutoffTime = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);

      // Create two queries: one for when user is caller, one for when user is callee
      // Firestore requires queries to filter by fields checked in security rules
      // We'll combine results from both queries and filter by chatId in the callback
      const callerQuery = query(
        callsRef,
        where('callerEmail', '==', userEmail),
        where('createdAt', '>', cutoffTime),
        orderBy('createdAt', 'desc'),
        limit(10)
      );

      const calleeQuery = query(
        callsRef,
        where('calleeEmail', '==', userEmail),
        where('createdAt', '>', cutoffTime),
        orderBy('createdAt', 'desc'),
        limit(10)
      );

      // Combine results from both queries
      let callerSnapshot: any = null;
      let calleeSnapshot: any = null;
      let callerUnsubscribe: (() => void) | null = null;
      let calleeUnsubscribe: (() => void) | null = null;

      const processCombinedResults = () => {
        if (!isActive) return;
        if (!callerSnapshot && !calleeSnapshot) return;

        // Combine documents from both queries
        const allDocs = new Map<string, any>();
        
        if (callerSnapshot) {
          callerSnapshot.docs.forEach((doc: any) => {
            const data = doc.data();
            // Filter by chatId to ensure we only get calls for this chat
            if (data.chatId === chatId) {
              allDocs.set(doc.id, doc);
            }
          });
        }
        
        if (calleeSnapshot) {
          calleeSnapshot.docs.forEach((doc: any) => {
            const data = doc.data();
            // Filter by chatId to ensure we only get calls for this chat
            if (data.chatId === chatId) {
              allDocs.set(doc.id, doc);
            }
          });
        }

        const userCalls = Array.from(allDocs.values());

        if (userCalls.length === 0) {
          // Only clear if both snapshots are from server (not just cache)
          const bothFromServer = (!callerSnapshot || !callerSnapshot.metadata.fromCache) &&
                                 (!calleeSnapshot || !calleeSnapshot.metadata.fromCache);
          if (bothFromServer) {
            callback(null);
          }
          return;
        }

          // Sort documents: prioritize non-ended calls, then by createdAt (most recent first)
          const sortedDocs = [...userCalls].sort((a, b) => {
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
          const docCallId = callDoc.id || data.callId;
          
          const signal: CallSignal = {
            callId: docCallId,
            chatId: data.chatId || chatId,
            callerEmail: data.callerEmail || '',
            calleeEmail: data.calleeEmail || '',
            status: data.status || 'ringing',
            offer: data.offer ? (typeof data.offer === 'string' ? JSON.parse(data.offer) : data.offer) : undefined,
            answer: data.answer ? (typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer) : undefined,
            iceCandidates: data.iceCandidates || [],
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now()),
            endedAt: data.endedAt?.toDate ? data.endedAt.toDate() : (data.endedAt ? new Date(data.endedAt) : undefined),
            roomName: data.roomName,
            isGroupCall: data.isGroupCall || false,
            participantEmails: data.participantEmails || [],
          };

          if (import.meta.env.DEV) {
            const fromCache = (callerSnapshot?.metadata.fromCache || false) && 
                             (calleeSnapshot?.metadata.fromCache || false);
            console.log('📞 subscribeToCallSignals: Returning signal', {
              callId: signal.callId,
              status: signal.status,
              hasAnswer: !!signal.answer,
              fromCache: fromCache,
            });
          }

          callback(signal);
      };

      // Set up listener for caller query
      callerUnsubscribe = onSnapshot(
        callerQuery,
        {
          includeMetadataChanges: true,
        },
        (snapshot) => {
          if (!isActive) return;
          if (snapshot.metadata.fromCache && snapshot.empty) {
            return;
          }
          callerSnapshot = snapshot;
          processCombinedResults();
        },
        (error: any) => {
          if (!isActive) return;
          console.error('Error listening to call signals (caller query):', error);
        }
      );

      // Set up listener for callee query
      calleeUnsubscribe = onSnapshot(
        calleeQuery,
        {
          includeMetadataChanges: true,
        },
        (snapshot) => {
          if (!isActive) return;
          if (snapshot.metadata.fromCache && snapshot.empty) {
            return;
          }
          calleeSnapshot = snapshot;
          processCombinedResults();
        },
        (error: any) => {
          if (!isActive) return;
          console.error('Error listening to call signals (callee query):', error);
        }
      );

      // Return unsubscribe function that cleans up both listeners
      unsubscribeFn = () => {
        if (callerUnsubscribe) callerUnsubscribe();
        if (calleeUnsubscribe) calleeUnsubscribe();
      };
    }).catch((error: any) => {
      if (!isActive) return;
      console.error('Error listening to call signals:', error);
      // Don't call callback(null) on error - keep existing state
      // This prevents clearing the call signal on temporary errors
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
        if (import.meta.env.DEV) {
          console.warn('📞 subscribeToIncomingOffers: Firestore not ready, will retry...');
        }
        return;
      }

      // Check auth - wait for it to be ready
      if (!auth?.currentUser?.email) {
        if (import.meta.env.DEV) {
          console.warn('📞 subscribeToIncomingOffers: Auth not ready, will retry...');
        }
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
        
        // Verify the ID token has email claim (required for Firestore security rules)
        if (auth.currentUser) {
          try {
            const idToken = await auth.currentUser.getIdToken();
            // Decode token to check if email is present
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            if (!payload.email) {
              if (import.meta.env.DEV) {
                console.error('❌ ID token missing email claim. Please sign out and sign back in.');
                console.error('Token payload:', { hasEmail: !!payload.email });
              }
              // Force token refresh
              await auth.currentUser.getIdToken(true);
            }
          } catch (tokenError) {
            if (import.meta.env.DEV) {
              console.warn('⚠️ Could not verify token email claim:', tokenError);
            }
          }
        }

        const orgSlug = getCurrentOrgSlug();
        if (!orgSlug) {
          if (import.meta.env.DEV) {
            console.warn('📞 subscribeToIncomingOffers: No orgSlug available yet, will retry...');
          }
          return;
        }
        
        const callsRef = collection(db, `orgs/${orgSlug}/calls`);

        // Calculate cutoff time (60 seconds ago)
        const cutoffTime = Timestamp.fromMillis(Date.now() - 60000);

        // Criteria-based query
        // Note: Firestore doesn't support != null queries, so we filter offer existence in the callback
        if (import.meta.env.DEV) {
          console.log('📞 subscribeToIncomingOffers: Setting up query', {
            collectionPath: `orgs/${orgSlug}/calls`,
            queryFilters: {
              status: 'ringing',
            },
          });
        }
        
        const q = query(
          callsRef,
          where('calleeEmail', '==', userEmail),
          where('status', '==', 'ringing'),
          where('createdAt', '>', cutoffTime),
          orderBy('createdAt', 'desc'),
          limit(1)
        );


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
              if (import.meta.env.DEV) {
                console.log('✅ subscribeToIncomingOffers: Firestore listener established successfully');
              }
              // Clear retry interval once listener is established
              if (retryInterval) {
                clearInterval(retryInterval);
                retryInterval = null;
              }
            }

            // Log snapshot details for debugging
            if (import.meta.env.DEV) {
              console.log('📞 subscribeToIncomingOffers: Snapshot received', {
                empty: snapshot.empty,
                size: snapshot.size,
                fromCache: snapshot.metadata.fromCache,
                hasPendingWrites: snapshot.metadata.hasPendingWrites,
              });
            }

            // Skip cache-only empty snapshots
            if (snapshot.metadata.fromCache && snapshot.empty) {
              if (import.meta.env.DEV) {
                console.log('📞 subscribeToIncomingOffers: Skipping cache-only empty snapshot');
              }
              return;
            }

            if (snapshot.empty) {
              // Only clear if this is a server snapshot
              if (!snapshot.metadata.fromCache) {
                if (import.meta.env.DEV) {
                  console.log('📞 subscribeToIncomingOffers: Empty server snapshot, clearing callback');
                }
                callback(null);
              }
              return;
            }

            // Process document changes (new or modified documents)
            if (import.meta.env.DEV) {
              console.log('📞 subscribeToIncomingOffers: Processing document changes', {
                changesCount: snapshot.docChanges().length,
              });
            }
            
            snapshot.docChanges().forEach((change) => {
              if (import.meta.env.DEV) {
                console.log('📞 subscribeToIncomingOffers: Document change', {
                  type: change.type,
                });
              }
              
              if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                const callId = change.doc.id || data.callId;

                if (import.meta.env.DEV) {
                  console.log('📞 subscribeToIncomingOffers: Processing call document', {
                    callId,
                    status: data.status,
                    hasOffer: !!data.offer,
                  });
                }

                // Skip if already processed
                if (processedSet.has(callId)) {
                  if (import.meta.env.DEV) {
                    console.log('📞 subscribeToIncomingOffers: Call already processed, skipping');
                  }
                  return;
                }

                // Verify call has either an offer (WebRTC) or roomName (LiveKit) and is ringing
                const hasOffer = !!data.offer;
                const hasRoomName = !!data.roomName;
                if ((!hasOffer && !hasRoomName) || data.status !== 'ringing') {
                  if (import.meta.env.DEV) {
                    console.log('📞 subscribeToIncomingOffers: Call missing offer/roomName or wrong status', {
                      hasOffer,
                      hasRoomName,
                      status: data.status,
                    });
                  }
                  return;
                }

                // Verify email matching
                const calleeEmailLower = (data.calleeEmail || '').toLowerCase();
                if (calleeEmailLower !== userEmail) {
                  if (import.meta.env.DEV) {
                    console.log('📞 subscribeToIncomingOffers: Email mismatch', {
                      callId,
                    });
                  }
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

              if (import.meta.env.DEV) {
                console.log('📞 Incoming call detected:', { callId });
              }
              
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
                  roomName: data.roomName,
                  isGroupCall: data.isGroupCall || false,
                  participantEmails: data.participantEmails || [],
                };

                callback(signal);
              }
            });
          },
          (error) => {
            if (!isActive) return;
            
            if (import.meta.env.DEV) {
              console.error('❌ subscribeToIncomingOffers: Error in listener', {
                code: (error as any)?.code,
                message: (error as any)?.message,
              });
              
              // Handle index errors gracefully
              if ((error as any)?.code === 9 || (error as any)?.message?.includes('index')) {
                console.error('Firestore index error. Please create the composite index for database "leanworks-prod":', {
                  database: 'leanworks-prod',
                  indexFields: ['calleeEmail', 'status', 'createdAt'],
                });
              } else if ((error as any)?.code === 'permission-denied') {
                console.error('❌ subscribeToIncomingOffers: Permission denied');
              } else {
                console.error('Error listening to incoming offers:', error);
              }
            }
            // Reset listener state so retry can re-establish
            isListenerEstablished = false;
            unsubscribeFn = null;
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
        if (import.meta.env.DEV) {
          console.error('📞 subscribeToIncomingOffers: Max retries reached, giving up');
        }
        if (retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
        return;
      }
      
      if (import.meta.env.DEV) {
        console.log(`📞 subscribeToIncomingOffers: Retry attempt ${retryCount}/${maxRetries}`);
      }
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
      if (import.meta.env.DEV) {
        console.log('✅ createCallOffer: Got ID token', {
          tokenLength: idToken?.length,
        });
      }
    } catch (tokenError: any) {
      if (import.meta.env.DEV) {
        console.error('❌ createCallOffer: Failed to get ID token', {
          error: tokenError.message,
          code: tokenError.code,
        });
      }
      throw new Error('Failed to get authentication token. Please refresh the page and log in again.');
    }

    // Use backend API route to create call (bypasses Firestore security rules)
    const apiUrl = import.meta.env.DEV 
      ? `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/offer`
      : `${API_BASE}/calls/${encodeURIComponent(chatId)}/offer`;
    if (process.env.NODE_ENV === 'development') {
      console.log('📞 createCallOffer: Creating call via API', {
        apiUrl,
        chatId,
        callerEmail,
        calleeEmail,
      });
    }

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('📡 createCallOffer: Sending API request', {
          apiUrl,
          method: 'POST',
          hasToken: !!idToken,
          tokenLength: idToken?.length,
        });
      }

      // Get current org ID to include in request header
      const currentOrgId = getCurrentOrgId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      };
      
      if (currentOrgId) {
        headers['X-Org-Id'] = currentOrgId;
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log('📡 createCallOffer: Sending API request with headers', {
          apiUrl,
          method: 'POST',
          hasToken: !!idToken,
          hasOrgId: !!currentOrgId,
          orgId: currentOrgId,
          headers: Object.keys(headers),
        });
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          offer,
          calleeEmail: calleeEmail.toLowerCase(),
        }),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('📡 createCallOffer: API response received', {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
        });
      }

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
      
      if (process.env.NODE_ENV === 'development') {
        console.log('✅ createCallOffer: Call created successfully via API', {
          callId,
          chatId,
          callerEmail,
          calleeEmail,
          result,
        });
      }

      // Wait a moment for Firestore to propagate, then verify document exists
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the document was written by querying Firestore directly
      // Note: This is optional - if it fails due to permissions, the document still exists
      // and will be picked up by the Firestore listeners (subscribeToCallSignals)
      try {
        const { getDoc, doc: docFn } = await import('firebase/firestore');
        const orgSlug = getCurrentOrgSlug();
        const collectionPath = `orgs/${orgSlug || 'default'}/calls`;
        const callDocRef = docFn(db, collectionPath, callId);
        const verifyDoc = await getDoc(callDocRef);
        
        if (verifyDoc.exists()) {
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ createCallOffer: Document verified in Firestore', {
              callId,
              documentPath: callDocRef.path,
              data: verifyDoc.data(),
            });
          }
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ createCallOffer: Document not found in Firestore yet', {
              callId,
              documentPath: callDocRef.path,
              note: 'This might be a timing issue - document may appear shortly',
            });
          }
        }
      } catch (verifyError: any) {
        // Permission errors are expected if there's a case mismatch between
        // auth token email and stored email, but the document still exists
        // The Firestore listeners will pick it up automatically
        if (verifyError.code === 'permission-denied') {
          if (process.env.NODE_ENV === 'development') {
            console.log('ℹ️ createCallOffer: Document verification skipped (permission denied - document still exists)', {
              callId,
              note: 'This is non-critical - the document was created successfully and listeners will pick it up',
            });
          }
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ createCallOffer: Could not verify document', {
              error: verifyError.message,
              code: verifyError.code,
            });
          }
        }
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
    if (process.env.NODE_ENV === 'development') {
      console.log('📞 sendCallAnswer: Starting...', {
        callId,
        answerType: answer?.type,
        hasAnswerSdp: !!answer?.sdp,
      });
    }
    
    if (!db) {
      console.error('❌ sendCallAnswer: Firestore not initialized');
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      console.error('❌ sendCallAnswer: User not authenticated');
      throw new Error('User not authenticated');
    }

    const { doc, updateDoc } = await import('firebase/firestore');
    const orgSlug = getCurrentOrgSlug();
    const callRef = doc(db, `orgs/${orgSlug || 'default'}/calls`, callId);
    
    if (process.env.NODE_ENV === 'development') {
      console.log('📞 sendCallAnswer: Updating Firestore document...', {
        path: `orgs/${orgSlug || 'default'}/calls/${callId}`,
        orgSlug,
      });
    }

    await updateDoc(callRef, {
      answer: JSON.stringify(answer),
      status: 'active',
    });
    
    if (process.env.NODE_ENV === 'development') {
      console.log('✅ sendCallAnswer: Firestore document updated successfully');
    }
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
    const orgSlug = getCurrentOrgSlug();
    const callRef = doc(db, `orgs/${orgSlug || 'default'}/calls`, callId);

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
   * Start transcription for an active call
   */
  async startTranscription(callId: string): Promise<void> {
    if (!auth?.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    const idToken = await getAuthToken();
    if (!idToken) {
      throw new Error('Failed to get auth token');
    }

    const apiUrl = import.meta.env.DEV
      ? `${API_BASE}/api/calls/${callId}/start-transcription`
      : `${API_BASE}/calls/${callId}/start-transcription`;

    const currentOrgId = getCurrentOrgId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    };
    
    if (currentOrgId) {
      headers['X-Org-Id'] = currentOrgId;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to start transcription: ${response.statusText}`);
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('✅ Transcription started for call', { callId });
    }
  },

  /**
   * End call
   * This calls the backend endpoint which finalizes transcription and creates docs
   */
  async endCall(callId: string): Promise<void> {
    if (!db) {
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    const { doc, getDoc } = await import('firebase/firestore');
    const orgSlug = getCurrentOrgSlug();
    const callRef = doc(db, `orgs/${orgSlug || 'default'}/calls`, callId);

    try {
      // First get the call document to retrieve chatId
      const callDoc = await getDoc(callRef);
      if (!callDoc.exists()) {
        throw new Error(`Call document not found: ${callId}`);
      }

      const callData = callDoc.data();
      const chatId = callData?.chatId;

      if (!chatId) {
        console.warn('⚠️ Call document missing chatId, falling back to direct Firestore update');
        // Fallback: update Firestore directly if chatId is missing
        const { updateDoc, serverTimestamp } = await import('firebase/firestore');
      await updateDoc(callRef, {
        status: 'ended',
        endedAt: serverTimestamp(),
      });
        return;
      }

      // Call the backend endpoint which handles transcription finalization and doc creation
      const idToken = await getAuthToken();
      if (!idToken) {
        throw new Error('Failed to get auth token');
      }

      const apiUrl = import.meta.env.DEV
        ? `${API_BASE}/api/calls/${chatId}/end`
        : `${API_BASE}/calls/${chatId}/end`;

      const currentOrgId = getCurrentOrgId();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      };
      
      if (currentOrgId) {
        headers['X-Org-Id'] = currentOrgId;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to end call: ${response.statusText}`);
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('✅ Call ended successfully, transcription will be finalized and docs created');
      }
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

// Subscription Service
export interface SubscriptionStatus {
  plan: 'free' | 'standard' | 'pro';
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  aiDailyUsage: number;
  aiUsageLimit: number | null; // null means unlimited
  aiUsageRemaining: number | null; // null means unlimited
  trialEndsAt: string | null;
  isTrialActive: boolean;
  trialDaysRemaining: number;
  memberSince: string;
}

export const subscriptionService = {
  async getStatus(): Promise<SubscriptionStatus> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/status` 
      : `${API_BASE}/subscription/status`;
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to get subscription status' }));
      throw new Error(error.error || 'Failed to get subscription status');
    }
    return response.json();
  },

  async createCheckoutSession(plan: 'standard' | 'pro'): Promise<{ url: string }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/checkout` 
      : `${API_BASE}/subscription/checkout`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ 
        plan,
        successUrl: `${window.location.origin}/subscription?success=true`,
        cancelUrl: `${window.location.origin}/subscription?canceled=true`,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create checkout session' }));
      throw new Error(error.error || 'Failed to create checkout session');
    }
    return response.json();
  },

  async createPortalSession(): Promise<{ url: string }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/portal` 
      : `${API_BASE}/subscription/portal`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ 
        returnUrl: `${window.location.origin}/subscription`,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create portal session' }));
      throw new Error(error.error || 'Failed to create portal session');
    }
    return response.json();
  },

  async switchPlan(plan: 'standard' | 'pro'): Promise<{ success: boolean; plan: string }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/switch` 
      : `${API_BASE}/subscription/switch`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to switch plan' }));
      throw new Error(error.error || 'Failed to switch plan');
    }
    return response.json();
  },

  async cancelSubscription(): Promise<{ success: boolean }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/cancel` 
      : `${API_BASE}/subscription/cancel`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to cancel subscription' }));
      throw new Error(error.error || 'Failed to cancel subscription');
    }
    return response.json();
  },

  async downgradeToFree(): Promise<{ success: boolean; plan: string; message: string }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/downgrade-to-free` 
      : `${API_BASE}/subscription/downgrade-to-free`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to downgrade to free plan' }));
      throw new Error(error.error || 'Failed to downgrade to free plan');
    }
    return response.json();
  },

  async incrementAiUsage(): Promise<{ success: boolean; usage: number; limit: number | null; remaining: number | null }> {
    const url = import.meta.env.DEV 
      ? `${API_BASE}/api/subscription/ai-usage` 
      : `${API_BASE}/subscription/ai-usage`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'AI usage limit reached' }));
      throw new Error(error.error || 'Failed to increment AI usage');
    }
    return response.json();
  },
};
