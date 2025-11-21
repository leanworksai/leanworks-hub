import { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from 'react';
import { useWebRTC, CallStatus, UseWebRTCReturn } from '@/hooks/useWebRTC';

interface WebRTCContextValue extends UseWebRTCReturn {
  // Additional context-specific methods if needed
  currentCallId: string | null;
  setCurrentCallId: (callId: string | null) => void;
}

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

/**
 * WebRTC Provider - Manages a single WebRTC instance shared across all components
 * This prevents multiple peer connections from being created for the same call
 */
export function WebRTCProvider({ children }: { children: ReactNode }) {
  const [currentCallId, setCurrentCallIdState] = useState<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  
  // Single shared WebRTC instance
  const webrtc = useWebRTC(
    (status) => {
      // Handle status changes globally
      if (status === 'ended' || status === 'error') {
        // Clear call ID when call ends
        if (callIdRef.current) {
          callIdRef.current = null;
          setCurrentCallIdState(null);
        }
      }
    }
  );

  const setCurrentCallId = useCallback((callId: string | null) => {
    callIdRef.current = callId;
    setCurrentCallIdState(callId);
  }, []);

  // Sync ref with state
  useEffect(() => {
    callIdRef.current = currentCallId;
  }, [currentCallId]);

  const value: WebRTCContextValue = {
    ...webrtc,
    currentCallId,
    setCurrentCallId,
  };

  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
}

/**
 * Hook to access the shared WebRTC context
 * Throws an error if used outside of WebRTCProvider
 */
export function useWebRTCContext(): WebRTCContextValue {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTCContext must be used within a WebRTCProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if context is not available
 * Useful for components that might be used outside the provider
 */
export function useWebRTCContextOptional(): WebRTCContextValue | null {
  return useContext(WebRTCContext);
}

