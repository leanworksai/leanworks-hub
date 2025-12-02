import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db, auth } from '@/lib/firebase-client';
import { callSignalingService, type CallSignal } from '@/services/api';
import { IncomingCallDialog } from './VoiceCall';
import { useUsers } from '@/hooks/useUsers';
import { useWebRTCContext } from '@/contexts/WebRTCContext';

/**
 * Global call listener that listens for incoming calls across all DM chats
 * Works even when the chat window is closed
 */
export function GlobalCallListener() {
  const { user, loading: authLoading } = useAuth();
  const { data: allDomainUsers = [] } = useUsers();
  const [incomingCallSignal, setIncomingCallSignal] = useState<CallSignal | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  const unsubscribeFnRef = useRef<(() => void) | null>(null);
  const processedCallIdsRef = useRef<Set<string>>(new Set());
  const {
    endCall: endWebRTCCall,
    callStatus,
  } = useWebRTCContext();

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    if (!user?.email) return;

    // Use Firestore real-time listener for all calls where user is callee
    // Wait for auth.currentUser to be ready (it might be initializing)
    if (!db) {
      console.warn('⚠️ GlobalCallListener: Firestore not ready');
      return;
    }

    let isActive = true;
    let healthCheckInterval: NodeJS.Timeout | null = null;

    // Check if auth.currentUser is ready, with retry logic
    const checkAuthAndSetup = async () => {
      // Wait for auth.currentUser to be available (up to 10 seconds)
      let authReady = false;
      const maxWaitTime = 10000;
      const checkInterval = 200;
      const startTime = Date.now();

      while (!authReady && (Date.now() - startTime) < maxWaitTime) {
        if (auth?.currentUser?.email) {
          authReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!auth?.currentUser?.email) {
        console.warn('⚠️ GlobalCallListener: Auth currentUser not ready after waiting, will retry via health check');
        // Don't return - let the health check retry
      }

      const setupListener = () => {
        if (!isActive || !db) return;

        // Clean up previous subscription if any
        if (unsubscribeFnRef.current) {
          unsubscribeFnRef.current();
          unsubscribeFnRef.current = null;
        }

        const userEmail = (auth?.currentUser?.email || user?.email || '').toLowerCase();
        if (!userEmail) {
          console.warn('⚠️ GlobalCallListener: No user email available');
          return;
        }
        
        console.log('📞 GlobalCallListener: Setting up incoming call listener', { userEmail });
        
        // Use the new criteria-based subscribeToIncomingOffers function
        // The subscribeToIncomingOffers now has its own retry logic built-in
        unsubscribeFnRef.current = callSignalingService.subscribeToIncomingOffers(
          userEmail,
          async (signal) => {
            if (!isActive) return;

            if (!signal) {
              // No signal - clear if we had one
              if (lastCallIdRef.current) {
                lastCallIdRef.current = null;
                setIncomingCallSignal(null);
              }
              return;
            }

            const callId = signal.callId;

            // Skip if already processed
            if (processedCallIdsRef.current.has(callId)) {
              return;
            }

            // Auto-reject if already in an active call
            if (callStatus !== 'idle') {
              console.log('Already in a call, auto-rejecting incoming offer', { callId, currentCallStatus: callStatus });
              try {
                await callSignalingService.endCall(callId);
                processedCallIdsRef.current.add(callId);
              } catch (err) {
                console.error('Error auto-rejecting call:', err);
                // Still mark as processed to avoid showing UI
                processedCallIdsRef.current.add(callId);
              }
              return;
            }

            // Verify offer exists and is valid
            if (!signal.offer || signal.status !== 'ringing') {
              processedCallIdsRef.current.add(callId);
              return;
            }

            // Only update if this is a new call
            if (callId !== lastCallIdRef.current) {
              console.log('📞 GlobalCallListener: New incoming call!', { callId, callerEmail: signal.callerEmail });
              lastCallIdRef.current = callId;
              processedCallIdsRef.current.add(callId);
              setIncomingCallSignal(signal);
            }
          },
          processedCallIdsRef.current
        );
      };

      // Initial setup
      setupListener();

      // Health check: periodically verify the listener is working
      // This helps recover from network disconnections or auth token refreshes
      healthCheckInterval = setInterval(() => {
        if (!isActive) return;
        
        // If auth state changed (e.g., token refresh), re-establish listener
        if (auth?.currentUser?.email && !unsubscribeFnRef.current) {
          console.log('📞 GlobalCallListener: Health check - re-establishing listener');
          setupListener();
        }
      }, 30000); // Check every 30 seconds
    };

    checkAuthAndSetup();

    // Cleanup function for Firestore listener
    return () => {
      isActive = false;
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }
      if (unsubscribeFnRef.current) {
        unsubscribeFnRef.current();
        unsubscribeFnRef.current = null;
      }
    };
  }, [user?.email, authLoading, callStatus]);

  // Handle ending the call
  const handleEndCall = async () => {
    if (incomingCallSignal?.callId) {
      try {
        await callSignalingService.endCall(incomingCallSignal.callId);
      } catch (err) {
        console.error('Error ending call:', err);
      }
    }
    endWebRTCCall();
    setIncomingCallSignal(null);
    lastCallIdRef.current = null;
  };

  return (
    <>
      {incomingCallSignal && incomingCallSignal.status === 'ringing' && (
        <IncomingCallDialog
          callSignal={incomingCallSignal}
          chatId={incomingCallSignal.chatId}
            callerName={(() => {
              const caller = allDomainUsers.find(u => u.email === incomingCallSignal.callerEmail);
              if (caller) {
                return `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || caller.email;
              }
              return incomingCallSignal.callerEmail;
            })()}
            callerAvatar={(() => {
              const caller = allDomainUsers.find(u => u.email === incomingCallSignal.callerEmail);
              if (caller) {
                return `${caller.firstName?.charAt(0) || ''}${caller.lastName?.charAt(0) || ''}`.toUpperCase() || incomingCallSignal.callerEmail.charAt(0).toUpperCase();
              }
              return incomingCallSignal.callerEmail.charAt(0).toUpperCase();
            })()}
            onAccept={() => {
              setIncomingCallSignal(null);
            }}
          onReject={async () => {
            setIncomingCallSignal(null);
            await handleEndCall();
          }}
        />
      )}
    </>
  );
}

