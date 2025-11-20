/**
 * Call Signaling API Service
 * Uses backend API endpoints for call signaling when Firebase Auth is not available
 */

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Helper to get auth token
async function getAuthToken(): Promise<string | null> {
  try {
    // Try to get token from window (set by AuthContext)
    const token = (window as any).__customToken;
    if (token) return token;

    // Try localStorage
    const storedToken = localStorage.getItem('leanworks_custom_token');
    if (storedToken) {
      (window as any).__customToken = storedToken;
      return storedToken;
    }
  } catch {
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
    ...(options.headers as Record<string, string> || {}),
  };
  
  return fetch(url, {
    ...options,
    headers,
  });
}

export interface CallSignal {
  callId: string;
  chatId: string;
  callerEmail: string;
  calleeEmail: string;
  callerName?: string;
  callerAvatar?: string;
  status: 'ringing' | 'active' | 'ended';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  iceCandidates?: RTCIceCandidateInit[];
  createdAt: Date;
  updatedAt: Date;
}

export type CallSignalListener = (signal: CallSignal | null) => void;
export type CallSignalUnsubscribe = () => void;

export const callSignalingApiService = {
  /**
   * Poll for call signals (since we can't use Firestore real-time listeners)
   */
  subscribeToCallSignals(
    chatId: string,
    callback: CallSignalListener
  ): CallSignalUnsubscribe {
    let isActive = true;
    let pollInterval: NodeJS.Timeout | null = null;
    let lastCallId: string | null = null;
    let lastStatus: string | null = null;

    const poll = async () => {
      if (!isActive) return;

      try {
        const token = await getAuthToken();
        if (!token) {
          // No token, silently return (auth might not be ready yet)
          return;
        }

        const url = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/status`;
        const response = await authenticatedFetch(url);

        if (!response.ok) {
          if (response.status === 404) {
            // No call found - this is normal
            if (lastCallId) {
              callback(null);
              lastCallId = null;
              lastStatus = null;
            }
            return;
          }
          // Other errors (401, 403, 500, etc.) - silently ignore during polling
          // These might happen if auth isn't ready or server is down
          return;
        }

        const data = await response.json();
        
        if (data.status === 'idle' || !data.callId) {
          if (lastCallId) {
            callback(null);
            lastCallId = null;
            lastStatus = null;
          }
          return;
        }

        // Notify if call ID changed OR status changed (for synchronization)
        if (data.callId !== lastCallId || data.status !== lastStatus) {
          lastCallId = data.callId;
          lastStatus = data.status;
          
          // Fetch full call details
          try {
            const fullCallData = await this.getCallDetails(chatId, data.callId);
            if (fullCallData) {
              callback(fullCallData);
            }
          } catch (detailError) {
            // Silently handle detail fetch errors
            console.debug('Error fetching call details:', detailError);
          }
        }
      } catch (error) {
        // Silently handle all errors during polling
        // Don't log to console to avoid noise
        // Errors might occur if:
        // - Auth token not ready yet
        // - Network issues
        // - Server temporarily unavailable
        // All of these are normal and shouldn't spam the console
      }
    };

    // Poll immediately (if auth is ready), then every 2 seconds
    // Use a small delay to ensure auth token is available
    setTimeout(() => {
      if (isActive) {
        poll();
      }
    }, 500);
    
    pollInterval = setInterval(() => {
      if (isActive) {
        poll();
      }
    }, 2000);

    return () => {
      isActive = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  },

  /**
   * Get full call details
   */
  async getCallDetails(chatId: string, callId: string): Promise<CallSignal | null> {
    try {
      // For now, we'll construct from status endpoint
      // In a full implementation, you'd have a GET /api/calls/:chatId/:callId endpoint
      const statusUrl = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/status`;
      const response = await authenticatedFetch(statusUrl);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      // Parse offer/answer if they exist (they're stored as JSON strings)
      let offer: RTCSessionDescriptionInit | undefined;
      let answer: RTCSessionDescriptionInit | undefined;
      
      if (data.offer) {
        try {
          offer = typeof data.offer === 'string' ? JSON.parse(data.offer) : data.offer;
        } catch {
          // Ignore parse errors
        }
      }
      
      if (data.answer) {
        try {
          answer = typeof data.answer === 'string' ? JSON.parse(data.answer) : data.answer;
        } catch {
          // Ignore parse errors
        }
      }

      return {
        callId: data.callId,
        chatId,
        callerEmail: data.callerEmail,
        calleeEmail: data.calleeEmail,
        status: data.status || 'idle',
        offer,
        answer,
        iceCandidates: data.iceCandidates || [],
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: data.endedAt ? new Date(data.endedAt) : new Date(),
      };
    } catch (error) {
      console.error('Error getting call details:', error);
      return null;
    }
  },

  /**
   * Create a call offer
   */
  async createCallOffer(
    chatId: string,
    callerEmail: string,
    calleeEmail: string,
    offer: RTCSessionDescriptionInit,
    callerName?: string,
    callerAvatar?: string
  ): Promise<string> {
    const url = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/offer`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        offer,
        calleeEmail,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create call offer' }));
      throw new Error(error.error || 'Failed to create call offer');
    }

    const data = await response.json();
    return data.callId;
  },

  /**
   * Send call answer
   */
  async sendCallAnswer(callId: string, chatId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const url = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/answer`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        callId,
        answer,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send call answer' }));
      throw new Error(error.error || 'Failed to send call answer');
    }
  },

  /**
   * Send ICE candidate
   */
  async sendICECandidate(callId: string, chatId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const url = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/ice-candidate`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        callId,
        candidate,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to send ICE candidate' }));
      throw new Error(error.error || 'Failed to send ICE candidate');
    }
  },

  /**
   * End call
   */
  async endCall(callId: string, chatId: string): Promise<void> {
    const url = `${API_BASE}/api/calls/${encodeURIComponent(chatId)}/end`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        callId,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to end call' }));
      throw new Error(error.error || 'Failed to end call');
    }
  },

  /**
   * Get all incoming calls for the current user
   */
  async getIncomingCalls(): Promise<CallSignal[]> {
    const url = `${API_BASE}/api/calls/incoming`;
    const response = await authenticatedFetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        // Route might not be available yet (server needs restart) or no calls
        // Return empty array silently
        return [];
      }
      // Only log non-404 errors
      const error = await response.json().catch(() => ({ error: 'Failed to get incoming calls' }));
      console.error('Error getting incoming calls:', error);
      throw new Error(error.error || 'Failed to get incoming calls');
    }

    const data = await response.json();
    if (!data.calls || !Array.isArray(data.calls)) {
      return [];
    }

    // Convert to CallSignal format
    return data.calls.map((call: any) => {
      let offer: RTCSessionDescriptionInit | undefined;
      let answer: RTCSessionDescriptionInit | undefined;
      
      if (call.offer) {
        try {
          offer = typeof call.offer === 'string' ? JSON.parse(call.offer) : call.offer;
        } catch {
          // Ignore parse errors
        }
      }
      
      if (call.answer) {
        try {
          answer = typeof call.answer === 'string' ? JSON.parse(call.answer) : call.answer;
        } catch {
          // Ignore parse errors
        }
      }

      return {
        callId: call.callId,
        chatId: call.chatId,
        callerEmail: call.callerEmail,
        calleeEmail: call.calleeEmail,
        status: call.status || 'ringing',
        offer,
        answer,
        iceCandidates: call.iceCandidates || [],
        createdAt: call.createdAt ? new Date(call.createdAt) : new Date(),
        updatedAt: call.createdAt ? new Date(call.createdAt) : new Date(),
      };
    });
  },
};

