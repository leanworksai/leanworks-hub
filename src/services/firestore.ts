import type { Project } from '@/data/projectsData';
import type { Task } from '@/data/tasksData';
import type { Team, TeamDetailData } from '@/data/teamsData';
import { auth, db } from '@/lib/firebase-client';

// Use proxy API in development (uses gcp_credential.json via Admin SDK)
// In production, use relative path so nginx can proxy to the backend server
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Initialize Firestore - uses proxy API in development
export const initFirestore = () => {
  // Firestore initialization
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
    teamId?: string;
    memberName?: string;
    memberAvatar?: string;
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
    let isActive = true;
    let pollTimeout: NodeJS.Timeout | null = null;
    
    const poll = async () => {
      if (!isActive) return;
      
      try {
        const messages = await this.getByChatId(chatId);
        const currentIds = new Set(messages.map(m => m.id));
        const currentCount = messages.length;
        
        // Check if messages changed (by ID or count)
        const idsChanged = lastMessageIds.size !== currentIds.size ||
          ![...lastMessageIds].every(id => currentIds.has(id)) ||
          currentCount !== lastMessageCount;
        
        if (idsChanged) {
          lastMessageIds = currentIds;
          lastMessageCount = currentCount;
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
    import('firebase/firestore').then((firestore) => {
      if (!isActive) return;

      const { collection, onSnapshot, query, where, orderBy, limit } = firestore;
      
      const userEmail = auth.currentUser?.email?.toLowerCase();
      if (!userEmail) {
        console.warn('No user email, cannot subscribe to call signals');
        return;
      }

      const domain = userEmail.split('@')[1]?.toLowerCase() || '';
      const callsRef = collection(db, `domains/${domain}/calls`);

      // Query for active calls for this chat
      let q;
      try {
        q = query(
          callsRef,
          where('chatId', '==', chatId),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
      } catch (error: any) {
        // If index error, query without orderBy
        if (error.code === 9 || error.message?.includes('index')) {
          q = query(
            callsRef,
            where('chatId', '==', chatId),
            limit(1)
          );
        } else {
          throw error;
        }
      }

      unsubscribeFn = onSnapshot(
        q,
        (snapshot) => {
          if (!isActive) return;

          if (snapshot.empty) {
            callback(null);
            return;
          }

          const callDoc = snapshot.docs[0];
          const data = callDoc.data();
          
          const signal: CallSignal = {
            callId: callDoc.id,
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

          callback(signal);
        },
        (error) => {
          if (!isActive) return;
          console.error('Error listening to call signals:', error);
          callback(null);
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
   * Create a call offer
   */
  async createCallOffer(
    chatId: string,
    callerEmail: string,
    calleeEmail: string,
    offer: RTCSessionDescriptionInit
  ): Promise<string> {
    if (!db) {
      console.error('Firestore not initialized. Please ensure Firebase is properly configured.');
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      // Try to wait a bit for auth to initialize (in case it's still loading)
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!auth?.currentUser?.email) {
        // Only log error if auth is actually missing (not just loading)
        // This is called when user actively tries to make a call, so it's a real error
        console.error('User not authenticated. Firebase Auth currentUser is not available. User may need to log in again.');
        throw new Error('User not authenticated. Please refresh the page and log in again.');
      }
    }

    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    const userEmail = auth.currentUser?.email?.toLowerCase();
    const domain = userEmail.split('@')[1]?.toLowerCase() || '';
    const callsRef = collection(db, `domains/${domain}/calls`);

    const callId = `${chatId}-${Date.now()}`;
    const callData = {
      callId,
      chatId,
      callerEmail: callerEmail.toLowerCase(),
      calleeEmail: calleeEmail.toLowerCase(),
      status: 'ringing',
      offer: JSON.stringify(offer),
      iceCandidates: [],
      createdAt: serverTimestamp(),
    };

    await addDoc(callsRef, callData);
    return callId;
  },

  /**
   * Send call answer
   */
  async sendCallAnswer(callId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    if (!db) {
      throw new Error('Firestore not initialized. Please ensure Firebase is properly configured.');
    }

    if (!auth?.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    const { doc, updateDoc } = await import('firebase/firestore');
    const userEmail = auth.currentUser?.email?.toLowerCase();
    const domain = userEmail.split('@')[1]?.toLowerCase() || '';
    const callRef = doc(db, `domains/${domain}/calls`, callId);

    await updateDoc(callRef, {
      answer: JSON.stringify(answer),
      status: 'active',
    });
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
    const userEmail = auth.currentUser?.email?.toLowerCase();
    const domain = userEmail.split('@')[1]?.toLowerCase() || '';
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

    const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
    const userEmail = auth.currentUser?.email?.toLowerCase();
    const domain = userEmail.split('@')[1]?.toLowerCase() || '';
    const callRef = doc(db, `domains/${domain}/calls`, callId);

    await updateDoc(callRef, {
      status: 'ended',
      endedAt: serverTimestamp(),
    });
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

