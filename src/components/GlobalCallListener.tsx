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
  const {
    endCall: endWebRTCCall,
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
    let setupAttempts = 0;
    const maxSetupAttempts = 3;
    let periodicCheckInterval: NodeJS.Timeout | null = null;

    // Check if auth.currentUser is ready, with retry logic
    const checkAuthAndSetup = async () => {
      // Wait for auth.currentUser to be available (up to 5 seconds)
      let authReady = false;
      const maxWaitTime = 5000;
      const checkInterval = 100;
      const startTime = Date.now();

      while (!authReady && (Date.now() - startTime) < maxWaitTime) {
        if (auth?.currentUser?.email) {
          authReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!auth?.currentUser?.email) {
        console.warn('⚠️ GlobalCallListener: Auth currentUser not ready after waiting');
        return;
      }

      const setupListener = () => {
        if (!isActive || !db || !auth?.currentUser?.email) return;

        setupAttempts++;

        import('firebase/firestore').then(async (firestore) => {
        if (!isActive || !db || !auth?.currentUser?.email) return;

        const { collection, onSnapshot, query, where, orderBy, limit } = firestore;
        const userEmail = auth.currentUser.email.toLowerCase();
        const { sanitizeDomainForFirestore } = await import('@/lib/utils');
        const domain = sanitizeDomainForFirestore(userEmail);
          const collectionPath = `domains/${domain}/calls`;
          const callsRef = collection(db, collectionPath);

        // Query for ringing calls where user is the callee
        let q;
          // Use query without orderBy to avoid index requirement
          // The index would be: calleeEmail (ASC), status (ASC), createdAt (DESC)
          // We'll get multiple results and sort in memory if needed
          q = query(
            callsRef,
            where('calleeEmail', '==', userEmail),
            where('status', '==', 'ringing'),
            limit(10) // Get up to 10 calls, we'll take the most recent one
          );
          
          unsubscribeFnRef.current = onSnapshot(
            q,
            {
              includeMetadataChanges: true,
            },
            (snapshot) => {
              if (!isActive) {
                return;
              }

              // Skip cache-only empty snapshots
              if (snapshot.metadata.fromCache && snapshot.empty) {
                return;
              }

              if (snapshot.empty) {
                if (lastCallIdRef.current) {
                  lastCallIdRef.current = null;
                  setIncomingCallSignal(null);
                }
                return;
              }

              // Sort documents by createdAt (most recent first) since we can't use orderBy
              // Also filter out ended calls and stale calls (older than 5 minutes)
              const now = Date.now();
              const maxCallAge = 5 * 60 * 1000; // 5 minutes in milliseconds
              
              const sortedDocs = [...snapshot.docs]
                .filter((doc) => {
                  const data = doc.data();
                  // Exclude calls that are ended or have endedAt set
                  if (data.status === 'ended' || data.endedAt) {
                    return false;
                  }
                  
                  // Exclude stale calls (older than 5 minutes)
                  const createdAt = data.createdAt?.toMillis?.() || 
                                   (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : 0) ||
                                   (data.createdAt?.getTime ? data.createdAt.getTime() : 0);
                  const callAge = now - createdAt;
                  
                  if (callAge > maxCallAge) {
                    return false;
                  }
                  
                  return true;
                })
                .sort((a, b) => {
                  const aCreated = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                  const bCreated = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                  return bCreated - aCreated; // Descending order (newest first)
                });
              
              // If no valid calls after filtering, clear the signal
              if (sortedDocs.length === 0) {
                if (lastCallIdRef.current) {
                  lastCallIdRef.current = null;
                  setIncomingCallSignal(null);
                }
                return;
              }
              
              const callDoc = sortedDocs[0];
              const data = callDoc.data();
              const callId = callDoc.id;

              // Verify email matching
              const calleeEmailLower = (data.calleeEmail || '').toLowerCase();
              if (calleeEmailLower !== userEmail) {
                return;
              }

            // Only update if this is a new call
            if (callId !== lastCallIdRef.current) {
              lastCallIdRef.current = callId;
              
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

              setIncomingCallSignal(signal);
            }
          },
          (error) => {
            if (!isActive) return;
              console.error('GlobalCallListener: Listener error', error);
              
              // If it's an index error and we haven't exceeded max attempts, retry
              if (((error as any)?.code === 9 || (error as any)?.message?.includes('index')) && setupAttempts < maxSetupAttempts) {
                setTimeout(() => {
                  if (isActive) {
                    setupListener();
                  }
                }, 1000);
              }
            }
          );

        }).catch((error) => {
          console.error('❌ GlobalCallListener: Failed to import firestore', error);
          
          // Retry if we haven't exceeded max attempts
          if (setupAttempts < maxSetupAttempts && isActive) {
            setTimeout(() => {
              if (isActive) {
                setupListener();
              }
            }, 2000);
          }
        });
      };

      // Initial setup
      setupListener();

      // Periodic check to verify listener is working (every 10 seconds)
      periodicCheckInterval = setInterval(async () => {
        if (!isActive || !db || !auth?.currentUser?.email) {
          if (periodicCheckInterval) {
            clearInterval(periodicCheckInterval);
            periodicCheckInterval = null;
          }
          return;
        }

        try {
          const { getDocs, collection, query, where, limit } = await import('firebase/firestore');
          const userEmail = auth.currentUser.email.toLowerCase();
          const { sanitizeDomainForFirestore } = await import('@/lib/utils');
          const domain = sanitizeDomainForFirestore(userEmail);
          const collectionPath = `domains/${domain}/calls`;
          const callsRef = collection(db, collectionPath);
          
          // Check for calls where user is callee
          const calleeQuery = query(
            callsRef,
            where('calleeEmail', '==', userEmail),
            where('status', '==', 'ringing'),
            limit(10)
          );
          
          // Also check ALL calls in the collection (for debugging)
          const allCallsQuery = query(callsRef, limit(10));
          
          const [calleeSnapshot, allCallsSnapshot] = await Promise.all([
            getDocs(calleeQuery),
            getDocs(allCallsQuery),
          ]);
          
          // Filter out ended calls from the results
          const activeCalleeCalls = calleeSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.status !== 'ended' && !data.endedAt;
          });
        } catch (err) {
          // Periodic check failed - silently continue
        }
      }, 10000); // Check every 10 seconds
    };

    checkAuthAndSetup();

    // Cleanup function for Firestore listener
    return () => {
      isActive = false;
      if (periodicCheckInterval) {
        clearInterval(periodicCheckInterval);
        periodicCheckInterval = null;
      }
      if (unsubscribeFnRef.current) {
        unsubscribeFnRef.current();
        unsubscribeFnRef.current = null;
      }
    };
  }, [user?.email, authLoading, endWebRTCCall]);

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

