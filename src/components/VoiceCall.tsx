import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogOverlay } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { CallStatus, ParticipantInfo } from '@/hooks/useLiveKit';
import { useWebRTCContext } from '@/contexts/WebRTCContext';
import { callSignalingService, type CallSignal } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { signInWithCustomToken } from 'firebase/auth';
import { cn } from '@/lib/utils';
import { db, auth } from '@/lib/firebase-client';
import { getCurrentOrgSlug } from '@/services/api';

interface VoiceCallButtonProps {
  chatId: string;
  otherUserEmail?: string; // Optional for group calls
  otherUserName?: string;
  otherUserAvatar?: string;
  className?: string;
  externalCallStatus?: CallStatus; // Call status from parent component (for display)
  externalCallId?: string | null; // Call ID from parent component (for ending calls)
  onEndCall?: () => void | Promise<void>; // End call handler from parent component
  onMuteStateChange?: (isMuted: boolean, toggleMute: () => void) => void; // Callback to share mute state and function
  isGroupCall?: boolean; // Whether this is a group call (project/team channel)
  groupMembers?: Array<{ email: string; name?: string; avatar?: string }>; // Members for group calls
}

/**
 * Button to initiate a voice call in a DM chat or group call (project/team channel)
 */
export function VoiceCallButton({
  chatId,
  otherUserEmail,
  otherUserName,
  otherUserAvatar,
  className,
  externalCallStatus,
  externalCallId,
  onEndCall,
  onMuteStateChange,
  isGroupCall = false,
  groupMembers = [],
}: VoiceCallButtonProps) {
  const { user, loading: authLoading } = useAuth();
  const [isCalling, setIsCalling] = useState(false);
  const [callSignal, setCallSignal] = useState<CallSignal | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const callIdRef = useRef<string | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const processedAnswerRef = useRef<string | null>(null); // Track processed answers to prevent duplicates
  const isCreatingCallRef = useRef<boolean>(false); // Track if we're in the process of creating a call

  const {
    callStatus,
    startCall,
    answerCall,
    endCall,
    error,
    isMuted,
    toggleMute,
    currentCallId,
    setCurrentCallId,
    participants,
    participantCount,
  } = useWebRTCContext();

  // Sync local callIdRef with context
  useEffect(() => {
    if (currentCallId !== callIdRef.current) {
      callIdRef.current = currentCallId;
    }
  }, [currentCallId]);

  // Handle status changes
  useEffect(() => {
    // Only handle status changes if we're actually in a call
    if ((callStatus === 'ended' || callStatus === 'error') && callIdRef.current) {
      setIsCalling(false);
      setCallSignal(null); // Clear call signal state
      if (callIdRef.current) {
        const callIdToEnd = callIdRef.current;
        callSignalingService.endCall(callIdToEnd).catch(console.error);
        callIdRef.current = null;
        setCurrentCallId(null);
      }
    } else if (callStatus === 'idle' && isCreatingCallRef.current) {
      // Don't reset isCalling if we're in the middle of creating a call
    } else if (callStatus === 'idle' && callIdRef.current) {
      // Status went to idle but we have a call ID - might be a temporary reset
      // Don't clear isCalling if we have a call ID
    }
  }, [callStatus, setCurrentCallId]);

  // LiveKit handles signaling internally, no need for ICE candidate handling

  // Set up BroadcastChannel for multi-tab detection
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return; // BroadcastChannel not supported
    }

    const channel = new BroadcastChannel('webrtc-call-check');
    broadcastChannelRef.current = channel;

    // Listen for check messages from other tabs
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'check-call') {
        // If we're in a call, respond that we're active
        if (isCalling || callStatus !== 'idle') {
          channel.postMessage('call-active');
        }
      } else if (event.data === 'call-active') {
        // Another tab is starting a call - we should be aware but not block if we're already in a call
        if (!isCalling && callStatus === 'idle') {
          console.warn('Another tab is attempting to start a call');
        }
      }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [isCalling, callStatus]);

  // Share mute state and toggle function with parent when call is active
  useEffect(() => {
    if (onMuteStateChange && (callStatus === 'active' || callStatus === 'connecting')) {
      onMuteStateChange(isMuted, toggleMute);
    } else if (onMuteStateChange && (callStatus === 'idle' || callStatus === 'ended')) {
      // Clear mute state when call ends
      onMuteStateChange(false, () => {});
    }
  }, [callStatus, isMuted, toggleMute, onMuteStateChange]);

  // Subscribe to call signals
  useEffect(() => {
    if (!chatId || !user?.email) return;
    
    // Wait for auth to finish loading before subscribing
    if (authLoading) {
      return;
    }

    // Use Firestore real-time listeners for call signaling
    try {
      console.log('📞 VoiceCallButton: Setting up signal subscription for chatId:', chatId);
      unsubscribeRef.current = callSignalingService.subscribeToCallSignals(chatId, (signal) => {
        // Log all signal updates to debug
        console.log('📞 VoiceCallButton: Signal received', {
          hasSignal: !!signal,
          status: signal?.status,
          hasAnswer: !!signal?.answer,
          callId: signal?.callId,
          callerEmail: signal?.callerEmail,
          currentUser: user?.email,
          callIdRef: callIdRef.current,
        });
        
        setCallSignal(signal);
        
        if (signal) {
          // Handle incoming call
          if (signal.status === 'ringing' && signal.calleeEmail.toLowerCase() === user.email?.toLowerCase()) {
            setIsCalling(true);
            callIdRef.current = signal.callId;
          } else if (signal.status === 'active') {
            setIsCalling(true);
            callIdRef.current = signal.callId;
          } else if (signal.status === 'ringing' && signal.callerEmail.toLowerCase() === user.email?.toLowerCase()) {
            // Outgoing call (we're the caller)
            setIsCalling(true);
            callIdRef.current = signal.callId;
          } else if (signal.status === 'ended') {
            // Other user ended the call - only clean up if we were actually in a call
            // Don't call endCall() if we're not in an active call (prevents clearing ref unnecessarily)
            if (callIdRef.current === signal.callId && (callStatus === 'active' || callStatus === 'connecting' || callStatus === 'ringing')) {
              // We were in this call, so clean up
              setIsCalling(false);
              const endedCallId = callIdRef.current;
              callIdRef.current = null;
              setCurrentCallId(null); // Update shared context
              processedAnswerRef.current = null; // Reset processed answer tracking
              setCallSignal(null); // Clear call signal state
              endCall();
              // For Firestore, the status change should propagate automatically
              // But we can ensure cleanup
              if (endedCallId) {
                callSignalingService.endCall(endedCallId).catch(() => {
                  // Ignore errors - call is already ended
                });
              }
            } else {
              // This is a stale 'ended' signal for a call we're not in - just clear local state
              if (callIdRef.current === signal.callId) {
                // It's our call ID but we're not in an active call - just clear refs
                callIdRef.current = null;
                setCurrentCallId(null);
                setIsCalling(false);
                setCallSignal(null);
              }
              // Don't call endCall() if we're not actually in a call
            }
            // Don't process offer/answer/ICE candidates if call is ended
            return;
          }

          // LiveKit handles all signaling internally - we only track call status here
        } else {
          // No signal from Firestore - but don't immediately end the call
          // Check if we're actually in an active call first
          // Only clear if WebRTC connection is also idle/ended AND we don't have a call ID AND we're not creating a call
          if ((callStatus === 'idle' || callStatus === 'ended') && !callIdRef.current && !isCreatingCallRef.current) {
            // WebRTC connection is already ended, no call ID, and not creating a call - safe to clear
            // BUT DON'T call endCall() here - it's already been called if the call was active
            setIsCalling(false);
            setCallSignal(null);
          } else if (isCreatingCallRef.current) {
            // We're in the process of creating a call - don't clear state
            // Keep the call state as is - don't clear isCalling
          } else if (callStatus === 'active' || callStatus === 'connecting' || callStatus === 'ringing') {
            // Call is still active according to WebRTC - don't clear
            // This might be a temporary Firestore issue or the signal hasn't arrived yet
            // Keep the call state as is - don't clear isCalling
          } else if (callIdRef.current) {
            // We have a call ID but no signal - might be a timing issue
            // Don't clear isCalling if we have a call ID
            // Keep isCalling true if we have a call ID
          } else {
            // No call ID and idle status - safe to clear
            // BUT DON'T call endCall() - it's already been called
            setIsCalling(false);
            setCallSignal(null);
          }
        }
      });
    } catch (error) {
      // Silently handle subscription errors (might happen during initialization)
      console.debug('Error setting up call signaling subscription:', error);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [chatId, user?.email, authLoading, endCall, callStatus]);

  // Check if Firestore is available and user is authenticated before allowing calls
  // But don't disable if we're already in a call (allow ending the call)
  const canMakeCalls = useCallback(() => {
    // If we're already in a call, always allow it (for ending the call)
    if (isCalling || callStatus !== 'idle') {
      return true;
    }
    
    // For new calls, check prerequisites
    if (!db) {
      return false;
    }
    if (!user?.email) {
      return false;
    }
    // Be lenient with auth check - if user email exists, allow it
    // Auth might still be initializing or might work with custom tokens
    return true;
  }, [isCalling, callStatus, db, user?.email]);

  const handleCallClick = async () => {
    console.log('Call button clicked');
    if (!user?.email) {
      console.log('No user email, returning');
      return;
    }
    console.log('User email check passed');

    // Check for multiple tabs using BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const checkChannel = new BroadcastChannel('webrtc-call-check');
        let hasActiveCall = false;
        
        const timeout = setTimeout(() => {
          checkChannel.close();
        }, 100); // Reduced from 300ms to match reduced wait time
        
        const handleMessage = (event: MessageEvent) => {
          if (event.data === 'call-active') {
            hasActiveCall = true;
          }
        };
        
        checkChannel.addEventListener('message', handleMessage);
        checkChannel.postMessage('check-call');
        
        // Wait for responses from other tabs (reduced from 200ms to 50ms for faster startup)
        await new Promise(resolve => setTimeout(resolve, 50));
        
        clearTimeout(timeout);
        checkChannel.removeEventListener('message', handleMessage);
        checkChannel.close();
        
        if (hasActiveCall) {
          alert('Another tab is already in a call. Please close other tabs or end the call in the other tab before starting a new call.');
          return;
        }
      } catch (err) {
        console.warn('Could not check for multiple tabs:', err);
        // Continue anyway - BroadcastChannel might not be supported
      }
    }

    // Wait for auth to finish loading
    if (authLoading) {
      console.log('Auth loading, returning');
      alert('Please wait for authentication to complete.');
      return;
    }
    console.log('Auth loading check passed');

    // Check if Firestore is available - warn here when actually trying to use the feature
    if (!db) {
      console.error('Firestore not available. Voice calls require Firebase to be properly configured.');
      alert('Voice calls are not available. Please ensure Firebase is properly configured.');
      return;
    }
    console.log('Firestore check passed');

    // Check if user is logged in and Firestore is available
    if (!user?.email) {
      console.log('User email check failed (second check)');
      alert('You must be logged in to make voice calls. Please refresh the page and log in again.');
      return;
    }
    console.log('User email check passed (second check)');

    // Ensure Firebase Auth currentUser is ready (required for Firestore security rules)
    // Auth should be ready after login, but we'll do a quick check just in case
    if (!auth?.currentUser?.email) {
      console.log('Waiting for Firebase Auth currentUser to be ready...');
      let authReady = false;
      const maxWaitTime = 1000; // 1 second max wait (should be ready from login)
      const checkInterval = 50; // Check every 50ms
      const startTime = Date.now();

      while (!authReady && (Date.now() - startTime) < maxWaitTime) {
        if (auth?.currentUser?.email) {
          authReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!auth?.currentUser?.email) {
        console.error('Firebase Auth currentUser is not available. User may need to refresh the page.');
        alert('Authentication is not ready. Please refresh the page and try again.');
        return;
      }
    }

    if (!canMakeCalls()) {
      console.log('canMakeCalls returned false');
      alert('Voice calls are not available. Please ensure Firebase is properly configured.');
      return;
    }
    console.log('canMakeCalls check passed, starting call...');

    try {
      isCreatingCallRef.current = true; // Mark that we're creating a call
      setIsCalling(true);
      console.log('Calling startCall()...');
      
      // Generate room name from chatId (LiveKit uses room names instead of call IDs)
      const roomName = `call-${chatId}`;
      const participantName = user.name || user.email;
      
      // Start LiveKit call (connects to room and publishes audio)
      await startCall(roomName, participantName);
      console.log('LiveKit call started', { roomName, isGroupCall });
      
      // Create call record in Firestore for tracking (optional, for UI state)
      let callId: string;
      try {
        // Use a simple call ID format
        callId = `${chatId}-${Date.now()}`;
        
        // Optionally create a call document in Firestore for status tracking
        // This is not required for LiveKit but helps with UI state management
        const orgSlug = getCurrentOrgSlug();
        const callsPath = `orgs/${orgSlug || 'default'}/calls`;
        const callData: any = {
          callId,
          chatId,
          roomName,
          callerEmail: user.email,
          status: 'ringing',
          createdAt: new Date(),
          isGroupCall,
        };
        
        // For 1:1 calls, include calleeEmail
        if (!isGroupCall && otherUserEmail) {
          callData.calleeEmail = otherUserEmail;
        }
        
        // For group calls, include all member emails
        if (isGroupCall && groupMembers.length > 0) {
          callData.participantEmails = groupMembers.map(m => m.email).filter(Boolean);
        }
        
        // Note: We're not using Firestore for signaling anymore, just for call metadata
        // The actual signaling is handled by LiveKit
        if (db) {
          const { doc, setDoc } = await import('firebase/firestore');
          const callRef = doc(db, callsPath, callId);
          await setDoc(callRef, callData);
          
          // For group calls, notify all members about the call
          if (isGroupCall && groupMembers.length > 0) {
            // Create call invitations for each member
            const invitationsPath = `orgs/${orgSlug || 'default'}/callInvitations`;
            const { collection, addDoc } = await import('firebase/firestore');
            const invitationsRef = collection(db, invitationsPath);
            
            // Create invitations for all members except the caller
            const invitationPromises = groupMembers
              .filter(m => m.email && m.email.toLowerCase() !== user.email.toLowerCase())
              .map(member => 
                addDoc(invitationsRef, {
                  callId,
                  chatId,
                  roomName,
                  callerEmail: user.email,
                  participantEmail: member.email,
                  status: 'pending',
                  createdAt: new Date(),
                })
              );
            
            await Promise.all(invitationPromises);
            console.log('Group call invitations created', { callId, participantCount: groupMembers.length });
          }
        }
        
        console.log('Call record created', { callId, roomName, isGroupCall });
      } catch (createError) {
        console.error('Failed to create call record', createError);
        // Continue anyway - LiveKit call is already started
      }
      
      callIdRef.current = callId;
      setCurrentCallId(callId); // Update shared context
      isCreatingCallRef.current = false; // Call creation is complete
      setIsCalling(true);
      console.log('Call setup complete', { callId, roomName, isCalling: true });
    } catch (err) {
      console.error('❌ VoiceCall: Error starting call:', err);
      isCreatingCallRef.current = false; // Call creation failed
      setIsCalling(false);
      
      // Clean up resources
      try {
        endCall();
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr);
      }
      
      // Reset call ID ref if call failed before it was set
      if (!callIdRef.current) {
        callIdRef.current = null;
      }
      
      // Show user-friendly error message
      const errorMessage = err instanceof Error ? err.message : 'Failed to start call';
      if (errorMessage.includes('permission')) {
        // Microphone permission error - user needs to grant access
        alert('Microphone access is required for voice calls. Please allow microphone access in your browser settings and try again.');
      } else if (errorMessage.includes('not authenticated') || errorMessage.includes('authentication')) {
        // Authentication error
        alert('You must be logged in to make voice calls. Please refresh the page and log in again.');
      } else if (errorMessage.includes('Another tab')) {
        // Multi-tab error - already handled, just show message
        alert(errorMessage);
      } else {
        alert(`Failed to start call: ${errorMessage}`);
      }
    }
  };

  const handleEndCall = async () => {
    try {
      // If parent provided an end call handler, use it (it has access to the callId)
      if (onEndCall) {
        await onEndCall();
        // Also clean up local WebRTC resources
        endCall();
        setIsCalling(false);
        processedAnswerRef.current = null; // Reset processed answer tracking
        return;
      }
      
      // Otherwise, use the local callIdRef
      const callIdToUse = externalCallId || callIdRef.current;
      
      // Update signaling service to notify the other user
      if (callIdToUse) {
        try {
          await callSignalingService.endCall(callIdToUse);
        } catch (err) {
          console.error('Error ending call:', err);
          // Continue with cleanup even if update fails
        }
        if (!externalCallId) {
          callIdRef.current = null;
          setCurrentCallId(null); // Update shared context
        }
      }
      
      // Clean up WebRTC resources
      endCall();
      setIsCalling(false);
      processedAnswerRef.current = null; // Reset processed answer tracking
      setCallSignal(null); // Clear call signal state
      
      console.log('Call ended successfully');
    } catch (err) {
      console.error('Error ending call:', err);
      // Still clean up local resources even if there's an error
      endCall();
      setIsCalling(false);
      processedAnswerRef.current = null; // Reset processed answer tracking
      setCallSignal(null); // Clear call signal state
    }
  };

  // Determine the display status (use external status if available, otherwise use internal)
  // But if external status is 'idle' or 'ended', check internal status first
  const displayStatus = (externalCallStatus && externalCallStatus !== 'idle' && externalCallStatus !== 'ended') 
    ? externalCallStatus 
    : (callStatus !== 'idle' && callStatus !== 'ended' ? callStatus : externalCallStatus || callStatus);
  // Only show as in call if we have an active call ID and are actually calling
  // Also ensure we're not in ended state
  const isInCall = (displayStatus !== 'idle' && displayStatus !== 'ended') && 
                    (isCalling || callIdRef.current) && 
                    callStatus !== 'ended';
  
  // Get status text for button
  const getStatusText = () => {
    if (!isInCall) return 'Call';
    switch (displayStatus) {
      case 'ringing':
        return 'Ringing...';
      case 'connecting':
        return 'Connecting...';
      case 'active':
        return 'Call in progress';
      case 'error':
        return 'Call failed';
      default:
        return 'Call';
    }
  };


  // Show end call button during any active call state
  if (isInCall) {
    return (
      <div className="flex items-center gap-2">
        {isGroupCall && participantCount > 1 && (
          <span className="text-xs text-muted-foreground">
            {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
          </span>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleEndCall}
          className={className}
          title="End call"
        >
          <PhoneOff className="h-4 w-4 mr-2" />
          {displayStatus === 'ringing' ? 'Cancel' : 'End Call'}
        </Button>
      </div>
    );
  }

  // Only disable call button if we're not in a call and prerequisites aren't met
  if (!canMakeCalls()) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className={className}
        title="Voice calls require Firebase to be configured"
      >
        <Phone className="h-4 w-4 mr-2" />
        Call
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCallClick();
      }}
      disabled={isCalling}
      className={className}
    >
      <Phone className="h-4 w-4 mr-2" />
      {getStatusText()}
    </Button>
  );
}

interface IncomingCallDialogProps {
  callSignal: CallSignal;
  callerName?: string;
  callerAvatar?: string;
  chatId: string;
  onAccept: () => void;
  onReject: () => void;
  onMuteStateChange?: (isMuted: boolean, toggleMute: () => void) => void; // Callback to share mute state and function
}

/**
 * Dialog shown when receiving an incoming call
 */
export function IncomingCallDialog({
  callSignal,
  callerName,
  callerAvatar,
  chatId,
  onAccept,
  onReject,
  onMuteStateChange,
}: IncomingCallDialogProps) {
  const [isAnswering, setIsAnswering] = useState(false);
  const callIdRef = useRef<string | null>(callSignal.callId);
  const {
    answerCall,
    endCall,
    isMuted,
    toggleMute,
    callStatus,
  } = useWebRTCContext();

  // LiveKit handles signaling internally, no ICE candidate handling needed

  // Share mute state and toggle function with parent when call is active
  useEffect(() => {
    if (!onMuteStateChange) return;
    
    if (callStatus === 'active' || callStatus === 'connecting') {
      onMuteStateChange(isMuted, toggleMute);
    } else if (callStatus === 'idle' || callStatus === 'ended') {
      // Clear mute state when call ends
      onMuteStateChange(false, () => {});
    }
  }, [callStatus, isMuted, toggleMute, onMuteStateChange]);

  const handleAccept = async () => {
    if (!callSignal) {
      console.error('No call signal found');
      return;
    }

    // Ensure Firebase Auth currentUser is ready (required for Firestore security rules)
    // Auth should be ready after login, but we'll do a quick check just in case
    if (!auth?.currentUser?.email) {
      console.log('Waiting for Firebase Auth currentUser to be ready...');
      let authReady = false;
      const maxWaitTime = 1000; // 1 second max wait (should be ready from login)
      const checkInterval = 50; // Check every 50ms
      const startTime = Date.now();

      while (!authReady && (Date.now() - startTime) < maxWaitTime) {
        if (auth?.currentUser?.email) {
          authReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      if (!auth?.currentUser?.email) {
        console.error('Firebase Auth currentUser is not available. User may need to refresh the page.');
        alert('Authentication is not ready. Please refresh the page and try again.');
        return;
      }
    }

    try {
      setIsAnswering(true);
      console.log('📞 IncomingCallDialog: Accepting call...', {
        callId: callSignal.callId,
        hasOffer: !!callSignal.offer,
      });
      
      // Get room name from call signal or generate from chatId
      const roomName = callSignal.roomName || `call-${callSignal.chatId}`;
      const participantName = user?.name || user?.email || 'User';
      
      // Answer the call by connecting to LiveKit room
      await answerCall(roomName, participantName);
      console.log('📞 IncomingCallDialog: LiveKit call answered', {
        roomName,
        callId: callSignal.callId,
      });
      
      // Update call status in Firestore (optional, for UI state)
      if (callSignal.callId && db) {
        try {
          const orgSlug = getCurrentOrgSlug();
          const callsPath = `orgs/${orgSlug || 'default'}/calls`;
          const { doc, updateDoc } = await import('firebase/firestore');
          const callRef = doc(db, callsPath, callSignal.callId);
          await updateDoc(callRef, {
            status: 'active',
          });
          console.log('✅ IncomingCallDialog: Call status updated in Firestore');
        } catch (updateError) {
          console.error('❌ IncomingCallDialog: Error updating call status:', updateError);
          // Continue anyway - LiveKit call is already connected
        }
      }
      
      // Set call ID ref
      callIdRef.current = callSignal.callId;
      setCurrentCallId(callSignal.callId);

      console.log('✅ IncomingCallDialog: handleAccept completing, calling onAccept()');
      onAccept();
    } catch (err) {
      console.error('❌ IncomingCallDialog: Error answering call:', err);
      setIsAnswering(false);
      
      // Clean up resources on error
      try {
        endCall();
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr);
      }
      
      // Don't automatically reject - let the user decide or handle it gracefully
      // The call might still work even if there's an error
      // Only reject if it's a critical error
      if (err instanceof Error && err.message.includes('not authenticated')) {
        // If authentication failed, we can't proceed
        onReject();
      } else if (err instanceof Error && (err.message.includes('permission') || err.message.includes('microphone'))) {
        // Microphone permission error
        alert('Microphone access is required for voice calls. Please allow microphone access in your browser settings and try again.');
        onReject();
      }
      // Otherwise, don't automatically reject - the call might still work
    }
  };

  const handleReject = async () => {
    if (callIdRef.current) {
      try {
        await callSignalingService.endCall(callIdRef.current);
      } catch (err) {
        console.error('Error ending call on reject:', err);
        // Continue with cleanup even if signaling fails
      }
    } else if (callSignal?.callId) {
      // Fallback: use callId from signal if ref is not set
      try {
        await callSignalingService.endCall(callSignal.callId);
      } catch (err) {
        console.error('Error ending call on reject:', err);
      }
    }
    
    endCall();
    onReject();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleReject()}>
      <DialogPrimitive.Portal>
        {/* Transparent overlay instead of dark backdrop */}
        <DialogOverlay className="bg-transparent" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg sm:max-w-md"
          )}
        >
          <DialogHeader>
            <DialogTitle>Incoming Call</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-4 py-4">
            <Avatar className="h-20 w-20">
              <AvatarFallback className="text-2xl">
                {callerAvatar || callerName?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <p className="text-lg font-semibold">{callerName || 'Unknown'}</p>
              <p className="text-sm text-muted-foreground">is calling...</p>
            </div>
            <div className="flex space-x-4">
              <Button
                variant="destructive"
                size="lg"
                onClick={handleReject}
                disabled={isAnswering}
              >
                <X className="h-5 w-5 mr-2" />
                Reject
              </Button>
              <Button
                size="lg"
                onClick={handleAccept}
                disabled={isAnswering}
              >
                <Phone className="h-5 w-5 mr-2" />
                {isAnswering ? 'Answering...' : 'Answer'}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

interface ActiveCallControlsProps {
  callStatus: CallStatus;
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  className?: string;
}

/**
 * Controls for an active call (mute, hang up)
 */
export function ActiveCallControls({
  callStatus,
  isMuted,
  onToggleMute,
  onEndCall,
  className,
}: ActiveCallControlsProps) {
  // Show controls during any active call state (ringing, connecting, or active)
  const isActive = callStatus === 'active' || callStatus === 'connecting' || callStatus === 'ringing';

  if (!isActive) {
    return null;
  }
  
  // Don't show mute button during ringing (no audio yet)
  const showMute = callStatus === 'active' || callStatus === 'connecting';

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      {showMute && (
        <Button
          variant={isMuted ? "destructive" : "outline"}
          size="sm"
          onClick={onToggleMute}
          title={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? (
            <>
              <MicOff className="h-4 w-4 mr-2" />
              Unmute
            </>
          ) : (
            <>
              <Mic className="h-4 w-4 mr-2" />
              Mute
            </>
          )}
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        onClick={onEndCall}
        title={callStatus === 'ringing' ? "Cancel call" : "End call"}
      >
        <PhoneOff className="h-4 w-4 mr-2" />
        {callStatus === 'ringing' ? 'Cancel' : 'Hang Up'}
      </Button>
    </div>
  );
}

interface CallStatusIndicatorProps {
  status: CallStatus;
  className?: string;
}

/**
 * Visual indicator of call status
 */
export function CallStatusIndicator({ status, className }: CallStatusIndicatorProps) {
  if (status === 'idle' || status === 'ended') {
    return null;
  }

  const getStatusText = () => {
    switch (status) {
      case 'ringing':
        return 'Ringing...';
      case 'connecting':
        return 'Connecting...';
      case 'active':
        return 'Call in progress';
      case 'error':
        return 'Call failed';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'ringing':
      case 'connecting':
        return 'text-yellow-600';
      case 'active':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return '';
    }
  };

  return (
    <div className={cn("flex items-center space-x-2 text-sm", getStatusColor(), className)}>
      <div className={cn("h-2 w-2 rounded-full", {
        'bg-yellow-600 animate-pulse': status === 'ringing' || status === 'connecting',
        'bg-green-600': status === 'active',
        'bg-red-600': status === 'error',
      })} />
      <span>{getStatusText()}</span>
    </div>
  );
}

