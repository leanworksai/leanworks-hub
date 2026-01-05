import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db, auth } from '@/lib/firebase-client';
import { callSignalingService, type CallSignal, getCurrentOrgSlug } from '@/services/api';
import { IncomingCallDialog } from './VoiceCall';
import { useUsers } from '@/hooks/useUsers';
import { useUserMap } from '@/hooks/useUserMap';
import { useWebRTCContext } from '@/contexts/WebRTCContext';

/**
 * Global call listener that listens for incoming calls across all DM chats
 * Works even when the chat window is closed
 */
export function GlobalCallListener() {
  const { user, loading: authLoading } = useAuth();
  const { data: allDomainUsers = [] } = useUsers();
  const userMap = useUserMap();
  const [incomingCallSignal, setIncomingCallSignal] = useState<CallSignal | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  const unsubscribeFnRef = useRef<(() => void) | null>(null);
  const invitationUnsubscribeRef = useRef<(() => void) | null>(null);
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
          if (import.meta.env.DEV) {
            console.warn('⚠️ GlobalCallListener: No user email available');
          }
          return;
        }
        
        if (import.meta.env.DEV) {
          console.log('📞 GlobalCallListener: Setting up incoming call listener');
        }
        
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

            // Verify call signal is valid (with LiveKit, we check for roomName instead of offer)
            if (signal.status !== 'ringing') {
              processedCallIdsRef.current.add(callId);
              return;
            }
            
            // Ensure we have a room name (either from signal or we'll generate from chatId)
            if (!signal.roomName && !signal.chatId) {
              console.warn('📞 GlobalCallListener: Call signal missing roomName and chatId', { callId });
              processedCallIdsRef.current.add(callId);
              return;
            }

            // Only update if this is a new call
            if (callId !== lastCallIdRef.current) {
              if (import.meta.env.DEV) {
                console.log('📞 GlobalCallListener: New incoming call!', { callId });
              }
              lastCallIdRef.current = callId;
              processedCallIdsRef.current.add(callId);
              setIncomingCallSignal(signal);
            }
          },
          processedCallIdsRef.current
        );
      };

      // Setup listener for group call invitations
      const setupInvitationListener = () => {
        if (!isActive || !db) return;

        // Clean up previous subscription if any
        if (invitationUnsubscribeRef.current) {
          invitationUnsubscribeRef.current();
          invitationUnsubscribeRef.current = null;
        }

        const userEmail = (auth?.currentUser?.email || user?.email || '').toLowerCase();
        if (!userEmail) {
          if (import.meta.env.DEV) {
            console.warn('⚠️ GlobalCallListener: No user email available for invitation listener');
          }
          return;
        }

        if (import.meta.env.DEV) {
          console.log('📞 GlobalCallListener: Setting up group call invitation listener');
        }

        (async () => {
          try {
            const firestore = await import('firebase/firestore');
            const { collection, onSnapshot, query, where, orderBy, limit, Timestamp } = firestore;
            
            const orgSlug = getCurrentOrgSlug();
            if (!orgSlug) {
              console.warn('📞 GlobalCallListener: No orgSlug for invitation listener');
              return;
            }

            const invitationsRef = collection(db, `orgs/${orgSlug}/callInvitations`);
            
            // Calculate cutoff time (5 minutes ago)
            const cutoffTime = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);

            const q = query(
              invitationsRef,
              where('participantEmail', '==', userEmail),
              where('status', '==', 'pending'),
              where('createdAt', '>', cutoffTime),
              orderBy('createdAt', 'desc'),
              limit(10)
            );

            invitationUnsubscribeRef.current = onSnapshot(
              q,
              (snapshot) => {
                if (!isActive) return;

                snapshot.docChanges().forEach((change) => {
                  if (change.type === 'added') {
                    const invitationData = change.doc.data();
                    const invitationId = change.doc.id;

                    // Skip if already processed
                    if (processedCallIdsRef.current.has(invitationData.callId)) {
                      return;
                    }

                    // Skip if already in a call
                    if (callStatus !== 'idle') {
                      console.log('Already in a call, skipping invitation', { invitationId, callId: invitationData.callId });
                      return;
                    }

                    console.log('📞 GlobalCallListener: New group call invitation!', {
                      invitationId,
                      callId: invitationData.callId,
                      callerEmail: invitationData.callerEmail,
                      roomName: invitationData.roomName,
                    });

                    // Convert invitation to CallSignal format
                    const callSignal: CallSignal = {
                      callId: invitationData.callId,
                      chatId: invitationData.chatId,
                      callerEmail: invitationData.callerEmail,
                      calleeEmail: userEmail,
                      status: 'ringing',
                      roomName: invitationData.roomName,
                      createdAt: invitationData.createdAt?.toDate?.() || new Date(),
                    };

                    processedCallIdsRef.current.add(invitationData.callId);
                    lastCallIdRef.current = invitationData.callId;
                    setIncomingCallSignal(callSignal);
                  }
                });
              },
              (error) => {
                console.error('❌ GlobalCallListener: Error in invitation listener', error);
              }
            );
          } catch (err) {
            console.error('❌ GlobalCallListener: Failed to setup invitation listener', err);
          }
        })();
      };

      // Initial setup
      setupListener();
      setupInvitationListener();

      // Health check: periodically verify the listener is working
      // This helps recover from network disconnections or auth token refreshes
      healthCheckInterval = setInterval(() => {
        if (!isActive) return;
        
        // If auth state changed (e.g., token refresh), re-establish listeners
        if (auth?.currentUser?.email) {
          if (!unsubscribeFnRef.current) {
            console.log('📞 GlobalCallListener: Health check - re-establishing call listener');
            setupListener();
          }
          if (!invitationUnsubscribeRef.current) {
            console.log('📞 GlobalCallListener: Health check - re-establishing invitation listener');
            setupInvitationListener();
          }
        }
      }, 30000); // Check every 30 seconds
    };

    checkAuthAndSetup();

    // Cleanup function for Firestore listeners
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
      if (invitationUnsubscribeRef.current) {
        invitationUnsubscribeRef.current();
        invitationUnsubscribeRef.current = null;
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
      {/* Only show dialog for group calls - 1:1 calls use "Join Call" button in chat UI */}
      {incomingCallSignal && incomingCallSignal.status === 'ringing' && incomingCallSignal.isGroupCall && (
        <IncomingCallDialog
          callSignal={incomingCallSignal}
          chatId={incomingCallSignal.chatId}
            callerName={(() => {
              const callerEntry = userMap.get(incomingCallSignal.callerEmail?.toLowerCase() || '');
              return callerEntry ? callerEntry.displayName : incomingCallSignal.callerEmail;
            })()}
            callerAvatar={(() => {
              const callerEntry = userMap.get(incomingCallSignal.callerEmail?.toLowerCase() || '');
              return callerEntry ? callerEntry.initials : incomingCallSignal.callerEmail.charAt(0).toUpperCase();
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

