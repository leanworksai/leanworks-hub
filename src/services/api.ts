import type { Project, Comment } from '@/data/projectsData';
import type { Task, TaskComment } from '@/data/tasksData';
import type { Doc } from '@/data/docsData';
import { normalizeDocContentForSave } from '@/lib/tiptapContent';
import { auth, db } from '@/lib/firebase-client';

// In development, call the local backend. In production, use the same-origin proxy.
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
  // In demo mode, return a demo token
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return 'mock-token-demo';
  }

  // First try to get token from Firebase Auth
  if (auth && auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      return idToken;
    } catch (error) {
      console.warn('⚠️ Failed to get token from Firebase Auth:', error);
    }
  }
  
  console.warn('⚠️ No auth token available for API request');
  return null;
}

// Helper to make authenticated API requests
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
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
type TaskUpdatePayload = Partial<Task> & {
  assigneeType?: 'human' | 'ai_agent' | 'ai_team';
  agentId?: string;
  agentTeamId?: string;
  agentIds?: string[];
};

type TaskCreateResponse = { id: string } & Partial<Task>;

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

  async create(task: Task): Promise<TaskCreateResponse> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks` : `${API_BASE}/tasks`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(task),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to create task' }));
      // Extract detailed validation errors if available
      if (errorData.details && typeof errorData.details === 'object') {
        const errorMessages = Object.entries(errorData.details)
          .map(([field, message]) => `${field}: ${message}`)
          .join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      throw new Error(errorData.error || 'Failed to create task');
    }
    return response.json();
  },

  async update(taskId: string, updates: TaskUpdatePayload): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/tasks/${taskId}` : `${API_BASE}/tasks/${taskId}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to update task' }));
      const errorMessage = Array.isArray(errorData.details) 
        ? errorData.details.join(', ')
        : typeof errorData.details === 'object' && errorData.details !== null
        ? Object.entries(errorData.details).map(([k, v]) => `${k}: ${v}`).join(', ')
        : errorData.error || 'Failed to update task';
      
      console.error('Task update error details:', {
        status: response.status,
        statusText: response.statusText,
        fullError: errorData,
        errorMessage,
        updates: updates,
        updateKeys: Object.keys(updates)
      });
      throw new Error(errorMessage);
    }
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
    const payload: Doc = {
      ...doc,
      content: normalizeDocContentForSave(doc.content),
    };
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs` : `${API_BASE}/docs`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to create doc' }));
      // Handle 413 Payload Too Large specifically
      if (response.status === 413) {
        throw new Error('Document is too large. Please reduce the content size.');
      }
      // Extract detailed validation errors if available
      if (errorData.details && typeof errorData.details === 'object') {
        const errorMessages = Object.entries(errorData.details)
          .map(([field, message]) => `${field}: ${message}`)
          .join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      throw new Error(errorData.error || 'Failed to create doc');
    }
    return response.json();
  },

  async update(docId: string, updates: Partial<Doc>): Promise<void> {
    const payload: Partial<Doc> = { ...updates };
    if (payload.content !== undefined) {
      payload.content = normalizeDocContentForSave(payload.content as any);
    }
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}` : `${API_BASE}/docs/${encodeURIComponent(docId)}`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to update doc' }));
      // Extract detailed validation errors if available
      if (errorData.details && typeof errorData.details === 'object') {
        const errorMessages = Object.entries(errorData.details)
          .map(([field, message]) => `${field}: ${message}`)
          .join('; ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      // Handle 413 Payload Too Large specifically
      if (response.status === 413) {
        throw new Error('Document is too large. Please reduce the content size.');
      }
      throw new Error(errorData.error || 'Failed to update doc');
    }
  },

  async delete(docId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}` : `${API_BASE}/docs/${encodeURIComponent(docId)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete doc');
  },

  async shareDoc(docId: string, email: string, message?: string): Promise<{
    success: boolean;
    isNewMember: boolean;
    message: string;
  }> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/docs/${encodeURIComponent(docId)}/share` : `${API_BASE}/docs/${encodeURIComponent(docId)}/share`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ email, message }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to share doc' }));
      throw new Error(error.error || 'Failed to share doc');
    }
    return response.json();
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


// System Notifications Service
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

  // GitHub-specific methods
  async checkGitHubInstallation(): Promise<{
    installation: {
      id: number;
      account: {
        login: string;
        id: number;
        type: string;
      };
      repository_selection: string;
      permissions: Record<string, string>;
    } | null;
  }> {
    const url = import.meta.env.DEV
      ? `${API_BASE}/api/integrations/github/check-installation`
      : `${API_BASE}/integrations/github/check-installation`;
    const response = await authenticatedFetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to check GitHub installation' }));
      throw new Error(error.error || 'Failed to check GitHub installation');
    }
    return response.json();
  },

  async saveGitHubInstallation(installationId: number): Promise<void> {
    const url = import.meta.env.DEV
      ? `${API_BASE}/api/integrations/github/save-installation`
      : `${API_BASE}/integrations/github/save-installation`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save GitHub installation' }));
      throw new Error(error.error || 'Failed to save GitHub installation');
    }
  },
};

// Messages Service removed - team chat feature removed

export const messagesService = {
  async getByChatId(chatId: string, afterTimestamp?: Date): Promise<ChatMessage[]> {
    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

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
    citedContext?: any;
  }): Promise<ChatMessage> {
    // Only allow AI assistant chats
    if (!message.chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

    const url = import.meta.env.DEV ? `${API_BASE}/api/messages` : `${API_BASE}/messages`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create message' }));
      throw new Error(error.error || 'Failed to create message');
    }
    return response.json();
  },

  async generateResponse(params: {
    chatId: string;
    content: string;
    role?: 'user' | 'assistant';
    projectId?: string;
    teamId?: string;
    memberName?: string;
    memberAvatar?: string;
    imageUrls?: string[];
    sessionId?: string;
    citedContext?: any;
  }): Promise<{ response: string; content: string }> {
    // Only allow AI assistant chats
    if (!params.chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

    const userEmail = auth?.currentUser?.email;
    if (!userEmail) {
      throw new Error('User must be authenticated to generate response');
    }

    const orgSlug = getCurrentOrgSlug();
    if (!orgSlug) {
      throw new Error('Organization context is required');
    }

    const requestPayload: any = {
      user_id: userEmail.toLowerCase(),
      org_slug: orgSlug,
      message: params.content,
      chatId: params.chatId,
      session_id: params.sessionId,
    };

    // Add cited_context if present
    if (params.citedContext) {
      requestPayload.cited_context = params.citedContext;
    }

    const aiServiceUrl = import.meta.env.DEV
      ? `${API_BASE}/api/messages/generate-response`
      : `${API_BASE}/messages/generate-response`;
    const response = await authenticatedFetch(aiServiceUrl, {
      method: 'POST',
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

  subscribeViaFirestore(chatId: string, callback: MessageListener): Unsubscribe {
    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      console.warn('Only AI assistant chats are supported for real-time updates');
      return () => {};
    }

    // Simplified version - just return empty unsubscribe for now
    // The full implementation would require restoring the Firestore subscription logic
    console.log('AI chat real-time subscription requested but simplified');
    return () => {};
  },

  async toggleLike(messageId: string): Promise<void> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/messages/${messageId}/like` : `${API_BASE}/messages/${messageId}/like`;
    const response = await authenticatedFetch(url, {
      method: 'PATCH',
    });
    if (!response.ok) {
      throw new Error('Failed to toggle like');
    }
  },

  async clearChatHistory(chatId: string): Promise<void> {
    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

    const url = import.meta.env.DEV ? `${API_BASE}/api/messages/clear/${encodeURIComponent(chatId)}` : `${API_BASE}/messages/clear/${encodeURIComponent(chatId)}`;
    const response = await authenticatedFetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to clear chat history');
    }
  },
};

// File Upload Service
export const fileUploadService = {
  async uploadFile(docId: string, file: File): Promise<any> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const url = import.meta.env.DEV ? `${API_BASE}/api/files/upload` : `${API_BASE}/files/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docId', docId);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to upload file' }));
      throw new Error(error.error || 'Failed to upload file');
    }

    return response.json();
  },
};

// Image Upload Service
export const imageUploadService = {
  async uploadImage(chatId: string, file: File): Promise<string> {
    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Image size exceeds 10MB limit');
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const fileName = file.name.toLowerCase();
    const hasValidType = validTypes.includes(file.type);
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

    if (!hasValidType && !hasValidExtension) {
      throw new Error('Invalid image format. Supported formats: JPG, PNG, WebP, GIF');
    }

    const url = import.meta.env.DEV ? `${API_BASE}/api/images/upload` : `${API_BASE}/images/upload`;
    const formData = new FormData();
    formData.append('image', file);
    formData.append('chatId', chatId);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };

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

  async refreshImageUrls(chatId: string, imageUrls: string[]): Promise<string[]> {
    // Only allow AI assistant chats
    if (!chatId.startsWith('ai-assistant-')) {
      throw new Error('Only AI assistant chats are supported');
    }

    const token = await getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const orgSlug = getCurrentOrgSlug();

    const url = import.meta.env.DEV ? `${API_BASE}/api/images/refresh` : `${API_BASE}/images/refresh`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

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
};

// Call Signaling Service removed - audio call feature removed

// Updates Service (Task Progress Updates)
export const updatesService = {
  async getByTaskId(taskId: string): Promise<any[]> {
    const url = import.meta.env.DEV ? `${API_BASE}/api/updates/task/${taskId}` : `${API_BASE}/updates/task/${taskId}`;
    const response = await authenticatedFetch(url);
    if (!response.ok) throw new Error('Failed to fetch task updates');
    return response.json();
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

// Call Signaling Service removed - audio call feature removed


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

  async switchPlan(plan: 'free' | 'standard' | 'pro'): Promise<{ success: boolean; plan: string; checkoutUrl?: string; requiresCheckout?: boolean }> {
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
