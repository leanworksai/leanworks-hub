import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db, auth } from '@/lib/firebase-client';
import { callSignalingService, type CallSignal } from '@/services/firestore';
import { callSignalingApiService } from '@/services/call-signaling-api';
import { IncomingCallDialog } from './VoiceCall';
import { useUsers } from '@/hooks/useUsers';
import { useWebRTC } from '@/hooks/useWebRTC';

/**
 * Global call listener that listens for incoming calls across all DM chats
 * Works even when the chat window is closed
 */
export function GlobalCallListener() {
  const { user } = useAuth();
  const { data: allDomainUsers = [] } = useUsers();
  const [incomingCallSignal, setIncomingCallSignal] = useState<CallSignal | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallIdRef = useRef<string | null>(null);
  const {
    endCall: endWebRTCCall,
  } = useWebRTC();

  useEffect(() => {
    if (!user?.email) return;

    // Use API-based signaling by default (more reliable, doesn't require Firebase Auth)
    const useApi = !db || !auth?.currentUser?.email;

    if (useApi) {
      // Poll for incoming calls using API
      const poll = async () => {
        try {
          const calls = await callSignalingApiService.getIncomingCalls();
          
          // Find the most recent ringing call
          const ringingCall = calls.find(call => call.status === 'ringing');
          
          if (ringingCall && ringingCall.callId !== lastCallIdRef.current) {
            lastCallIdRef.current = ringingCall.callId;
            setIncomingCallSignal(ringingCall);
          } else if (!ringingCall && lastCallIdRef.current) {
            // No more ringing calls
            lastCallIdRef.current = null;
            setIncomingCallSignal(null);
          }
        } catch (err) {
          // Silently handle errors during polling
          console.debug('Error polling for incoming calls:', err);
        }
      };

      // Poll immediately, then every 2 seconds
      poll();
      pollIntervalRef.current = setInterval(poll, 2000);
    } else {
      // Use Firestore real-time listener for all calls where user is callee
      // This requires a Firestore query that listens to all calls
      // For now, we'll use a similar polling approach with Firestore
      // In a production system, you'd set up a proper Firestore listener
      const poll = async () => {
        try {
          // For Firestore, we'd need to query directly
          // Since we don't have a direct method, we'll use the API endpoint if available
          // or implement Firestore query here
          const calls = await callSignalingApiService.getIncomingCalls();
          
          const ringingCall = calls.find(call => call.status === 'ringing');
          
          if (ringingCall && ringingCall.callId !== lastCallIdRef.current) {
            lastCallIdRef.current = ringingCall.callId;
            setIncomingCallSignal(ringingCall);
          } else if (!ringingCall && lastCallIdRef.current) {
            lastCallIdRef.current = null;
            setIncomingCallSignal(null);
          }
        } catch (err) {
          console.debug('Error polling for incoming calls:', err);
        }
      };

      poll();
      pollIntervalRef.current = setInterval(poll, 2000);
    }

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [user?.email, endWebRTCCall]);

  // Handle ending the call
  const handleEndCall = async () => {
    if (incomingCallSignal?.callId) {
      try {
        const useApi = !db || !auth?.currentUser?.email;
        if (useApi) {
          await callSignalingApiService.endCall(incomingCallSignal.callId, incomingCallSignal.chatId);
        } else {
          await callSignalingService.endCall(incomingCallSignal.callId);
        }
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
      {incomingCallSignal && incomingCallSignal.status === 'ringing' && (() => {
        // Determine which signaling service to use
        const useApi = !db || !auth?.currentUser?.email;
        
        return (
          <IncomingCallDialog
            callSignal={incomingCallSignal}
            chatId={incomingCallSignal.chatId}
            useApiSignaling={useApi}
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
        );
      })()}
    </>
  );
}

