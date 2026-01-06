import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { CallStatus, ParticipantInfo } from '@/hooks/useLiveKit';
import { useWebRTCContext } from '@/contexts/WebRTCContext';
import { callSignalingService, type CallSignal, messagesService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useUsers } from '@/hooks/useUsers';
import { useUserMap } from '@/hooks/useUserMap';
import { signInWithCustomToken } from 'firebase/auth';
import { cn } from '@/lib/utils';
import { db, auth } from '@/lib/firebase-client';
import { getCurrentOrgSlug } from '@/services/api';
import { trackVoiceCall, trackConversion, trackFirstFeatureUse } from '@/lib/analytics';
import { getUserSignupDate, getDaysSinceSignup } from '@/lib/first-time-tracker';

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
  const { data: allDomainUsers = [] } = useUsers();
  const userMap = useUserMap();
  const [isCalling, setIsCalling] = useState(false);
  const [callSignal, setCallSignal] = useState<CallSignal | null>(null);
  const [showRecordingConsent, setShowRecordingConsent] = useState(false);
  const [pendingCallData, setPendingCallData] = useState<{ roomName: string; participantName: string; callId: string } | null>(null);
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
      isCreatingCallRef.current = false; // Reset creating call flag
      if (callIdRef.current) {
        const callIdToEnd = callIdRef.current;
        callSignalingService.endCall(callIdToEnd).catch(console.error);
        callIdRef.current = null;
        setCurrentCallId(null);
      }
      // Notify other tabs that call has ended
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage('call-ended');
      }
    } else if (callStatus === 'idle') {
      // When call status is idle, make sure we're not in a call state
      if (!isCreatingCallRef.current && !callIdRef.current) {
        setIsCalling(false);
        // Notify other tabs that call has ended
        if (broadcastChannelRef.current) {
          broadcastChannelRef.current.postMessage('call-ended');
        }
      }
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
        // Only respond if we're actually in an active call (not just idle with stale state)
        if (callStatus === 'active' || callStatus === 'connecting' || (isCalling && callStatus !== 'idle')) {
          channel.postMessage('call-active');
        } else {
          // Respond that we're not in a call
          channel.postMessage('call-ended');
        }
      } else if (event.data === 'call-active') {
        // Another tab is in a call
        if (!isCalling && callStatus === 'idle') {
          console.warn('Another tab is in a call');
        }
      } else if (event.data === 'call-ended') {
        // Another tab ended a call - we can ignore this, just for awareness
        console.log('Another tab ended a call');
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
      // Only log subscription setup in dev mode to reduce noise
      if (import.meta.env.DEV) {
        console.log('📞 VoiceCallButton: Setting up signal subscription for chatId:', chatId);
      }
      unsubscribeRef.current = callSignalingService.subscribeToCallSignals(chatId, (signal) => {
        // Only log signal updates in dev mode and when status changes significantly
        if (import.meta.env.DEV && signal && (
          !callSignal || 
          callSignal.status !== signal.status || 
          callSignal.callId !== signal.callId
        )) {
          console.log('📞 VoiceCallButton: Signal received', {
            hasSignal: !!signal,
            status: signal?.status,
            callId: signal?.callId,
            callerEmail: signal?.callerEmail,
          });
        }
        
        setCallSignal(signal);
        
        if (signal) {
          const isGroupCall = signal.isGroupCall || chatId.startsWith('project-') || chatId.startsWith('team-');
          const userEmail = user.email?.toLowerCase();
          
          // Unified approach: check if user is a participant using participantEmails
          // This works for both 1:1 and group calls
          const isParticipant = signal.participantEmails?.some(
            (email: string) => email?.toLowerCase() === userEmail
          ) || false;
          
          // Also check legacy fields for backwards compatibility
          const isCaller = signal.callerEmail?.toLowerCase() === userEmail;
          const isCallee = signal.calleeEmail?.toLowerCase() === userEmail;
          const isInCall = isParticipant || isCaller || isCallee;
          
          // Handle incoming call
          // For participants receiving a ringing call, don't set isCalling yet
          // They should only see the join button, not the call controls
          // isCalling will be set to true after they join the room
          if (signal.status === 'ringing' && isInCall && !isCaller) {
            // Don't set isCalling here - participant hasn't joined yet
            // Just store the call ID for reference
            callIdRef.current = signal.callId;
          } else if (signal.status === 'active' && isInCall) {
            // Active call - user is a participant (caller, callee, or group participant)
            setIsCalling(true);
            callIdRef.current = signal.callId;
          } else if (signal.status === 'ringing' && isCaller) {
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
        unsubscribeRef.current = null;
      }
    };
  }, [chatId, user?.email, authLoading]);

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
        }, 100);
        
        const handleMessage = (event: MessageEvent) => {
          if (event.data === 'call-active') {
            hasActiveCall = true;
          } else if (event.data === 'call-ended') {
            // Another tab confirmed no call - we can proceed
            hasActiveCall = false;
          }
        };
        
        checkChannel.addEventListener('message', handleMessage);
        checkChannel.postMessage('check-call');
        
        // Wait for responses from other tabs
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
    console.log('canMakeCalls check passed, showing recording consent dialog...');

    // Generate room name from chatId (LiveKit uses room names instead of call IDs)
    const roomName = `call-${chatId}`;
    const participantName = user?.email || 'User';
    
    // Use a simple call ID format
    const callId = `${chatId}-${Date.now()}`;
    
    // Store call data and show consent dialog
    setPendingCallData({ roomName, participantName, callId });
    setShowRecordingConsent(true);
  };

  const proceedWithCall = async (enableRecording: boolean) => {
    if (!pendingCallData || !user?.email || !db) {
      console.error('Cannot proceed with call: missing data');
      return;
    }

    const { roomName, participantName, callId } = pendingCallData;
    setShowRecordingConsent(false);

    try {
      isCreatingCallRef.current = true; // Mark that we're creating a call
      
      // Create call record in Firestore FIRST (before connecting to LiveKit)
      // This ensures the room exists in Firestore before participants try to join
      try {
        const orgSlug = getCurrentOrgSlug();
        const callsPath = `orgs/${orgSlug || 'default'}/calls`;
        // Unified approach: always use participantEmails for both 1:1 and group calls
        // For 1:1 calls: participantEmails = [caller, callee]
        // For group calls: participantEmails = all members
        const participantEmails: string[] = [];
        if (isGroupCall && groupMembers.length > 0) {
          participantEmails.push(...groupMembers.map(m => m.email?.toLowerCase()).filter(Boolean));
        } else if (!isGroupCall && otherUserEmail) {
          // 1:1 call: add both caller and callee
          participantEmails.push(user.email?.toLowerCase() || '', otherUserEmail.toLowerCase());
        }
        
        const callData: any = {
          callId,
          chatId,
          roomName,
          callerEmail: user.email?.toLowerCase(), // Ensure lowercase for Firestore rules
          status: 'ringing',
          createdAt: new Date(),
          isGroupCall,
          participantEmails: participantEmails.filter(Boolean), // Remove any empty strings
          enableRecording, // Store user's recording preference
        };
        
        // For 1:1 calls, include calleeEmail (required for security rules)
        if (!isGroupCall && otherUserEmail) {
          callData.calleeEmail = otherUserEmail.toLowerCase(); // Ensure lowercase
        } else if (isGroupCall) {
          // For group calls, set calleeEmail to chatId so all members can see it
          // Security rules will check participantEmails
          callData.calleeEmail = chatId;
        }
        
        // Create call document in Firestore BEFORE connecting to LiveKit
        // This ensures the room is "created" in Firestore first, similar to group calls
        if (db) {
          const { doc, setDoc } = await import('firebase/firestore');
          const callRef = doc(db, callsPath, callId);
          await setDoc(callRef, callData);
          console.log('Call record created in Firestore', { callId, roomName, isGroupCall, enableRecording });
          
          // Create a message in the chat (for both 1:1 and group calls) to notify participants
            try {
              // Get user's display name from userMap
              const currentUserEntry = userMap.get(user.email?.toLowerCase() || '');
              const callerName = currentUserEntry ? currentUserEntry.displayName : (user?.email || 'Someone');
              const callerInitials = currentUserEntry ? currentUserEntry.initials : (user?.email?.charAt(0).toUpperCase() || 'S');
              
            // Determine projectId or teamId from chatId (only for group calls)
              let projectId: string | undefined;
              let teamId: string | undefined;
              if (chatId.startsWith('project-')) {
                projectId = chatId.replace('project-', '');
              } else if (chatId.startsWith('team-')) {
                teamId = chatId.replace('team-', '');
              }
              
            // Create a message in the chat announcing the call
              // Include callId and roomName in the content so we can detect it later
              await messagesService.create({
                chatId,
                role: 'user',
                content: `📞 ${callerName} started a voice call. [CALL:${callId}:${roomName}]`,
                projectId,
                teamId,
                memberName: callerName,
                memberAvatar: callerInitials,
              });
              
            console.log('Call message created in chat', { 
              callId, 
              roomName, 
              isGroupCall,
              participantCount: isGroupCall ? groupMembers.length : 2 
            });
            } catch (messageError) {
            console.error('Failed to create call message:', messageError);
              // Continue anyway - call is already started
          }
        }
        
        console.log('Call record created', { callId, roomName, isGroupCall });
      } catch (createError) {
        console.error('Failed to create call record', createError);
        throw createError; // Don't continue if we can't create the call record
      }
      
      // Now connect to LiveKit room (room is already "created" in Firestore)
      setIsCalling(true);
      console.log('Connecting to LiveKit room...', { roomName, callId });
      try {
        await startCall(roomName, participantName);
        console.log('LiveKit call started', { roomName, isGroupCall });
        
        // Update call status to 'active' after successful connection
        if (callId && db) {
          try {
            const orgSlug = getCurrentOrgSlug();
            const callsPath = `orgs/${orgSlug || 'default'}/calls`;
            const { doc, updateDoc } = await import('firebase/firestore');
            const callRef = doc(db, callsPath, callId);
            await updateDoc(callRef, {
              status: 'active',
            });
            console.log('Call status updated to active', { callId });
            
            // Start transcription for the call only if recording is enabled
            if (enableRecording) {
              try {
                await callSignalingService.startTranscription(callId);
                console.log('✅ Transcription started', { callId });
              } catch (transcriptionError) {
                console.error('❌ Failed to start transcription:', transcriptionError);
                // Continue anyway - call is active even if transcription fails
              }
            } else {
              console.log('📝 Recording disabled by user, skipping transcription', { callId });
            }
          } catch (updateError) {
            console.error('Failed to update call status to active:', updateError);
            // Continue anyway - LiveKit call is connected
          }
      }
      
      callIdRef.current = callId;
      setCurrentCallId(callId); // Update shared context
      isCreatingCallRef.current = false; // Call creation is complete
      setPendingCallData(null); // Clear pending call data
      console.log('Call setup complete', { callId, roomName, isCalling: true });
      
      // Track call initiation
      trackVoiceCall('initiate', isGroupCall ? 'group' : 'direct', {
        call_id: callId,
        chat_id: chatId,
        has_recording: enableRecording,
      });
      
      // Track first-time voice call usage
      (async () => {
        const signupDate = await getUserSignupDate();
        const daysSinceSignup = getDaysSinceSignup(signupDate);
        trackFirstFeatureUse('voice_call', daysSinceSignup);
      })();
      } catch (livekitError) {
        // If LiveKit connection fails, mark call as ended in Firestore
        console.error('❌ VoiceCall: LiveKit connection failed:', livekitError);
        if (callId && db) {
          try {
            const orgSlug = getCurrentOrgSlug();
            const callsPath = `orgs/${orgSlug || 'default'}/calls`;
            const { doc, updateDoc } = await import('firebase/firestore');
            const callRef = doc(db, callsPath, callId);
            await updateDoc(callRef, {
              status: 'ended',
              endedAt: new Date(),
            });
            console.log('Call marked as ended due to connection failure', { callId });
          } catch (updateError) {
            console.error('Failed to mark call as ended:', updateError);
          }
        }
        throw livekitError; // Re-throw to be caught by outer catch
      }
    } catch (err) {
      console.error('❌ VoiceCall: Error starting call:', err);
      isCreatingCallRef.current = false; // Call creation failed
      
      // Clean up all call state
      setIsCalling(false);
      callIdRef.current = null;
      setCurrentCallId(null); // Update shared context
      setCallSignal(null); // Clear call signal state
      processedAnswerRef.current = null; // Reset processed answer tracking
      
      // Clean up resources
      try {
        endCall();
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr);
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
      // Check if user is the call creator
      const isCallCreator = callSignal?.callerEmail.toLowerCase() === user?.email?.toLowerCase();
      
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
      
      // For group calls: only end the call for everyone if user is the creator
      // Otherwise, just leave the call (don't update Firestore status)
      if (callIdToUse) {
        if (isGroupCall && !isCallCreator) {
          // Attendee leaving - just disconnect, don't end the call for everyone
          console.log('Attendee leaving group call', { callId: callIdToUse });
          // Don't call callSignalingService.endCall() - just disconnect locally
        } else {
          // Creator ending call or 1:1 call - end it for everyone
          try {
            await callSignalingService.endCall(callIdToUse);
          } catch (err) {
            console.error('Error ending call:', err);
            // Continue with cleanup even if update fails
          }
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
      
      // Track call end
      trackVoiceCall('end', isGroupCall ? 'group' : 'direct', {
        call_id: callIdToUse,
      });
      
      console.log('Call ended/left successfully');
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
  // Only show as in call if:
  // 1. User has actually joined the room (callStatus is 'active' or 'connecting')
  // 2. OR user is the caller and has initiated the call (isCalling is true and callStatus is not idle/ended/ringing)
  // This prevents callees from seeing call controls before they join the room
  // For callees: only show controls after they've joined (callStatus is 'active' or 'connecting')
  // For callers: show controls when they've initiated the call (isCalling is true)
  const isInCall = callStatus === 'active' || 
                    callStatus === 'connecting' || 
                    (isCalling && callStatus !== 'idle' && callStatus !== 'ended' && callStatus !== 'ringing');
  
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
    // Check if user is the call creator
    // For group calls, only the creator (caller) can end the call for everyone
    // Other participants can only leave
    const isCallCreator = callSignal?.callerEmail?.toLowerCase() === user?.email?.toLowerCase();
    
    // For group calls: if we have callSignal and user is not the creator, show "Leave"
    // If callSignal is not available yet, default to "End Call" (will be corrected when signal arrives)
    const showLeaveButton = isGroupCall && callSignal && !isCallCreator;
    
    const buttonText = showLeaveButton
      ? 'Leave' 
      : (displayStatus === 'ringing' ? 'Cancel' : 'End Call');
    const buttonTitle = showLeaveButton
      ? 'Leave the call' 
      : 'End call for everyone';
    
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
          title={buttonTitle}
        >
          <PhoneOff className="h-4 w-4 mr-2" />
          {buttonText}
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

  // Show "Join Call" button if there's an active call we're a participant of but haven't joined yet
  // This works for both 1:1 and group calls - unified UX
  const userEmail = user?.email?.toLowerCase();
  const isParticipant = callSignal?.participantEmails?.some(
    (email: string) => email?.toLowerCase() === userEmail
  ) || callSignal?.calleeEmail?.toLowerCase() === userEmail || false; // Also check calleeEmail for 1:1 calls
  const isCaller = callSignal?.callerEmail?.toLowerCase() === userEmail;
  
  const showJoinButton = callSignal && 
    (callSignal.status === 'ringing' || callSignal.status === 'active') &&
    callStatus === 'idle' &&
    !isCalling &&
    isParticipant &&
    !isCaller;

  if (showJoinButton) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!callSignal?.roomName) return;
          
          try {
            setIsCalling(true);
            const participantName = user?.email || 'User';
            await answerCall(callSignal.roomName, participantName);
            callIdRef.current = callSignal.callId;
            setCurrentCallId(callSignal.callId);
            console.log('Joined call', { callId: callSignal.callId, roomName: callSignal.roomName, isGroupCall });
            
            // Start transcription if call is active, transcription hasn't started yet, and recording is enabled
            // Only the first participant to join should start it, but it's safe to call multiple times
            if (callSignal.status === 'active' && callSignal.callId && db) {
              try {
                // Check if recording is enabled for this call
                const orgSlug = getCurrentOrgSlug();
                const callsPath = `orgs/${orgSlug || 'default'}/calls`;
                const { doc, getDoc } = await import('firebase/firestore');
                const callRef = doc(db, callsPath, callSignal.callId);
                const callDoc = await getDoc(callRef);
                const enableRecording = callDoc.exists() ? (callDoc.data().enableRecording ?? false) : false;
                
                if (enableRecording) {
                  await callSignalingService.startTranscription(callSignal.callId);
                  console.log('✅ Transcription started after joining call', { callId: callSignal.callId });
                } else {
                  console.log('📝 Recording disabled for this call, skipping transcription', { callId: callSignal.callId });
                }
              } catch (transcriptionError) {
                console.error('❌ Failed to start transcription after joining:', transcriptionError);
                // Continue anyway - call is active even if transcription fails
              }
            }
          } catch (err) {
            console.error('Error joining call:', err);
            // Clean up all call state on join failure
            setIsCalling(false);
            callIdRef.current = null;
            setCurrentCallId(null);
            setCallSignal(null);
            processedAnswerRef.current = null;
            endCall();
          }
        }}
        className={className}
      >
        <Phone className="h-4 w-4 mr-2" />
        Join Call
      </Button>
    );
  }

  return (
    <>
      <AlertDialog open={showRecordingConsent} onOpenChange={(open) => {
        if (!open) {
          setShowRecordingConsent(false);
          setPendingCallData(null);
          isCreatingCallRef.current = false;
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Recording with AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to enable recording with AI for this call? This will allow automatic transcription and summary generation after the call ends.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => proceedWithCall(false)}>
              No, Start Call Without Recording
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => proceedWithCall(true)} disabled>
              Yes, Enable Recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    </>
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
  const { user } = useAuth();
  const [isAnswering, setIsAnswering] = useState(false);
  const callIdRef = useRef<string | null>(callSignal.callId);
  const {
    answerCall,
    endCall,
    isMuted,
    toggleMute,
    callStatus,
    setCurrentCallId,
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
        hasRoomName: !!callSignal.roomName,
      });
      
      // Get room name from call signal or generate from chatId
      const roomName = callSignal.roomName || `call-${callSignal.chatId}`;
      const participantName = user?.email || 'User';
      
      // Join the LiveKit room (room is already created by caller, similar to group calls)
      await answerCall(roomName, participantName);
      console.log('📞 IncomingCallDialog: Joined LiveKit room', {
        roomName,
        callId: callSignal.callId,
      });
      
      // Track call answer
      trackVoiceCall('answer', 'direct', {
        call_id: callSignal.callId,
        chat_id: callSignal.chatId,
      });
      
      // Update call status to 'active' if it's still 'ringing' (caller may have already updated it)
      if (callSignal.callId && db) {
        try {
          const orgSlug = getCurrentOrgSlug();
          const callsPath = `orgs/${orgSlug || 'default'}/calls`;
          const { doc, updateDoc, getDoc } = await import('firebase/firestore');
          const callRef = doc(db, callsPath, callSignal.callId);
          const callDoc = await getDoc(callRef);
          if (callDoc.exists() && callDoc.data().status === 'ringing') {
            await updateDoc(callRef, {
              status: 'active',
            });
            console.log('✅ IncomingCallDialog: Call status updated to active');
            
            // Start transcription for the call only if recording is enabled
            const callData = callDoc.data();
            const enableRecording = callData?.enableRecording ?? false;
            if (enableRecording) {
              try {
                await callSignalingService.startTranscription(callSignal.callId);
                console.log('✅ Transcription started', { callId: callSignal.callId });
              } catch (transcriptionError) {
                console.error('❌ Failed to start transcription:', transcriptionError);
                // Continue anyway - call is active even if transcription fails
              }
            } else {
              console.log('📝 Recording disabled for this call, skipping transcription', { callId: callSignal.callId });
            }
          } else {
            console.log('📞 IncomingCallDialog: Call status already updated or call ended');
          }
        } catch (updateError) {
          console.error('❌ IncomingCallDialog: Error updating call status:', updateError);
          // Continue anyway - LiveKit call is already connected
        }
      }

      // Update invitation status if this is a group call invitation
      if (callSignal.callId && db && user?.email) {
        try {
          const orgSlug = getCurrentOrgSlug();
          const invitationsPath = `orgs/${orgSlug || 'default'}/callInvitations`;
          const { collection, query, where, getDocs, updateDoc, doc } = await import('firebase/firestore');
          const invitationsRef = collection(db, invitationsPath);
          const q = query(
            invitationsRef,
            where('callId', '==', callSignal.callId),
            where('participantEmail', '==', user.email.toLowerCase())
          );
          const snapshot = await getDocs(q);
          snapshot.forEach(async (invitationDoc) => {
            await updateDoc(doc(db, invitationsPath, invitationDoc.id), {
              status: 'accepted',
            });
          });
          console.log('✅ IncomingCallDialog: Invitation status updated to accepted');
        } catch (invitationError) {
          console.error('❌ IncomingCallDialog: Error updating invitation status:', invitationError);
          // Continue anyway - LiveKit call is already connected
        }
      }
      
      // Set call ID ref
      callIdRef.current = callSignal.callId;
      setCurrentCallId(callSignal.callId);

      console.log('✅ IncomingCallDialog: handleAccept completing, calling onAccept()');
      onAccept();
    } catch (err: any) {
      console.error('❌ IncomingCallDialog: Error answering call:', err);
      setIsAnswering(false);
      
      // Clean up call state on answer failure
      setIsCalling(false);
      callIdRef.current = null;
      setCurrentCallId(null);
      setCallSignal(null);
      processedAnswerRef.current = null;
      endCall();
      
      // Show user-friendly error message
      const errorMessage = err.message || 'Failed to accept call. Please try again.';
      alert(`Error accepting call: ${errorMessage}`);
      
      // Don't call onAccept if there was an error
      // The dialog will remain open so user can try again
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
    const callIdToTrack = callIdRef.current || callSignal?.callId;
    
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
    
    // Track call rejection
    if (callIdToTrack) {
      trackVoiceCall('reject', 'direct', {
        call_id: callIdToTrack,
      });
    }
    
    endCall();
    onReject();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleReject()}>
      <DialogContent 
        className={cn(
          "z-[9999] sm:max-w-md"
        )}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Incoming Call</DialogTitle>
          <DialogDescription>
            {callerName || 'Someone'} is calling you
          </DialogDescription>
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
      </DialogContent>
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

