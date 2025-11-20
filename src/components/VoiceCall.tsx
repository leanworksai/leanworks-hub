import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogOverlay } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Phone, PhoneOff, Mic, MicOff, X } from 'lucide-react';
import { useWebRTC, CallStatus } from '@/hooks/useWebRTC';
import { callSignalingService, type CallSignal } from '@/services/firestore';
import { callSignalingApiService } from '@/services/call-signaling-api';
import { useAuth } from '@/contexts/AuthContext';
import { signInWithCustomToken } from 'firebase/auth';
import { cn } from '@/lib/utils';
import { db, auth } from '@/lib/firebase-client';

interface VoiceCallButtonProps {
  chatId: string;
  otherUserEmail: string;
  otherUserName?: string;
  otherUserAvatar?: string;
  className?: string;
  externalCallStatus?: CallStatus; // Call status from parent component (for display)
  externalCallId?: string | null; // Call ID from parent component (for ending calls)
  onEndCall?: () => void | Promise<void>; // End call handler from parent component
  onMuteStateChange?: (isMuted: boolean, toggleMute: () => void) => void; // Callback to share mute state and function
}

/**
 * Button to initiate a voice call in a DM chat
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
}: VoiceCallButtonProps) {
  const { user, loading: authLoading } = useAuth();
  const [isCalling, setIsCalling] = useState(false);
  const [callSignal, setCallSignal] = useState<CallSignal | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const callIdRef = useRef<string | null>(null);
  const [useApiSignaling, setUseApiSignaling] = useState(true); // Default to API-based signaling
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const processedAnswerRef = useRef<string | null>(null); // Track processed answers to prevent duplicates

  const {
    callStatus,
    startCall,
    answerCall,
    endCall,
    createOffer,
    setAnswer,
    addICECandidate,
    peerConnection,
    getPeerConnection,
    error,
    isMuted,
    toggleMute,
  } = useWebRTC(
    (status) => {
      // Only handle status changes if we're actually in a call
      // Don't call endCall here as it might interfere with call setup
      if ((status === 'ended' || status === 'error') && callIdRef.current) {
        setIsCalling(false);
        setCallSignal(null); // Clear call signal state
        if (callIdRef.current) {
          // Use the correct signaling service based on current setting
          const callIdToEnd = callIdRef.current;
          if (useApiSignaling) {
            callSignalingApiService.endCall(callIdToEnd, chatId).catch(console.error);
          } else {
            callSignalingService.endCall(callIdToEnd).catch(console.error);
          }
          callIdRef.current = null;
        }
      }
    }
  );

  // Listen for ICE candidates and send them via signaling service
  useEffect(() => {
    if (!peerConnection || !callIdRef.current) return;

    const handleICECandidate = async (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && callIdRef.current) {
        try {
          if (useApiSignaling) {
            await callSignalingApiService.sendICECandidate(callIdRef.current, chatId, event.candidate.toJSON());
          } else {
            await callSignalingService.sendICECandidate(callIdRef.current, event.candidate.toJSON());
          }
        } catch (err) {
          console.error('Error sending ICE candidate:', err);
        }
      }
    };

    peerConnection.addEventListener('icecandidate', handleICECandidate);

    return () => {
      peerConnection.removeEventListener('icecandidate', handleICECandidate);
    };
  }, [peerConnection, useApiSignaling, chatId]);

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

    // Determine which signaling service to use
    // Default to API-based signaling, only use Firestore if Firebase Auth is confirmed working
    const shouldUseApi = useApiSignaling || !db || !auth?.currentUser?.email;
    
    try {
      if (shouldUseApi) {
        // Use API-based signaling (polling)
        unsubscribeRef.current = callSignalingApiService.subscribeToCallSignals(chatId, (signal) => {
      setCallSignal(signal);
      
      if (signal) {
        // Handle incoming call
        if (signal.status === 'ringing' && signal.calleeEmail.toLowerCase() === user.email?.toLowerCase()) {
          // This user is being called
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
          // Other user ended the call - stop processing and clean up
          setIsCalling(false);
          const endedCallId = callIdRef.current;
          callIdRef.current = null;
          processedAnswerRef.current = null; // Reset processed answer tracking
          setCallSignal(null); // Clear call signal state
          endCall();
          // Optionally notify the signaling service that we've acknowledged the end
          if (endedCallId && useApiSignaling) {
            // The API will handle this automatically, but we can ensure cleanup
            callSignalingApiService.endCall(endedCallId, chatId).catch(() => {
              // Ignore errors - call is already ended
            });
          }
          // Don't process offer/answer/ICE candidates if call is ended
          return;
        }

        // Only process offer/answer/ICE candidates if call is still active
        // Handle offer
        if (signal.offer && signal.callerEmail.toLowerCase() !== user.email?.toLowerCase()) {
          // Received offer, but we'll handle it in IncomingCallDialog
        }

        // Handle answer - only if call is still active and we have a peer connection
        if (signal.answer && signal.callerEmail.toLowerCase() === user.email?.toLowerCase() && 
            peerConnection && callIdRef.current) {
          // Call was answered - only process if we haven't processed this answer yet
          const answerKey = `${signal.callId}-${JSON.stringify(signal.answer).substring(0, 50)}`;
          if (processedAnswerRef.current !== answerKey) {
            processedAnswerRef.current = answerKey;
            setAnswer(signal.answer).catch((err) => {
              // If setting answer fails (e.g., already set or peer connection closed), reset the processed flag
              if (err.message?.includes('stable') || err.message?.includes('already') || 
                  err.message?.includes('not initialized') || err.message?.includes('closed')) {
                // Answer was already set or connection closed, this is fine
                console.log('Answer already processed or connection closed, ignoring');
              } else {
                console.error('Error setting answer:', err);
                processedAnswerRef.current = null; // Reset on error to allow retry
              }
            });
          }
        }

          // Handle ICE candidates
          // Only process if we have a peer connection (it will queue if not ready)
          if (signal.iceCandidates && signal.iceCandidates.length > 0 && peerConnection) {
            signal.iceCandidates.forEach((candidateStr) => {
              try {
                const candidate = typeof candidateStr === 'string' ? JSON.parse(candidateStr) : candidateStr;
                // addICECandidate will queue candidates if peer connection isn't ready
                addICECandidate(candidate).catch((err) => {
                  console.warn('Error adding ICE candidate from signal:', err);
                });
              } catch (err) {
                console.error('Error parsing ICE candidate:', err);
              }
            });
          }
        } else {
          // No signal means no active call
          setIsCalling(false);
          setCallSignal(null); // Clear call signal state
        }
      });
    } else {
      // Use Firestore-based signaling (real-time)
      unsubscribeRef.current = callSignalingService.subscribeToCallSignals(chatId, (signal) => {
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
            // Other user ended the call - stop processing and clean up
            setIsCalling(false);
            const endedCallId = callIdRef.current;
            callIdRef.current = null;
            processedAnswerRef.current = null; // Reset processed answer tracking
            setCallSignal(null); // Clear call signal state
            endCall();
            // Optionally notify the signaling service that we've acknowledged the end
            if (endedCallId && !useApiSignaling) {
              // For Firestore, the status change should propagate automatically
              // But we can ensure cleanup
              callSignalingService.endCall(endedCallId).catch(() => {
                // Ignore errors - call is already ended
              });
            }
            // Don't process offer/answer/ICE candidates if call is ended
            return;
          }

          // Only process offer/answer/ICE candidates if call is still active
          // Handle offer
          if (signal.offer && signal.callerEmail.toLowerCase() !== user.email?.toLowerCase()) {
            // Received offer - handled in IncomingCallDialog
          }

          // Handle answer - only if call is still active and we have a peer connection
          if (signal.answer && signal.callerEmail.toLowerCase() === user.email?.toLowerCase() && 
              peerConnection && callIdRef.current) {
            // Call was answered - only process if we haven't processed this answer yet
            const answerKey = `${signal.callId}-${JSON.stringify(signal.answer).substring(0, 50)}`;
            if (processedAnswerRef.current !== answerKey) {
              processedAnswerRef.current = answerKey;
              setAnswer(signal.answer).catch((err) => {
                // If setting answer fails (e.g., already set or peer connection closed), reset the processed flag
                if (err.message?.includes('stable') || err.message?.includes('already') || 
                    err.message?.includes('not initialized') || err.message?.includes('closed')) {
                  // Answer was already set or connection closed, this is fine
                  console.log('Answer already processed or connection closed, ignoring');
                } else {
                  console.error('Error setting answer:', err);
                  processedAnswerRef.current = null; // Reset on error to allow retry
                }
              });
            }
          }

          // Handle ICE candidates
          // Only process if we have a peer connection (it will queue if not ready)
          if (signal.iceCandidates && signal.iceCandidates.length > 0 && peerConnection) {
            signal.iceCandidates.forEach((candidateStr) => {
              try {
                const candidate = typeof candidateStr === 'string' ? JSON.parse(candidateStr) : candidateStr;
                // addICECandidate will queue candidates if peer connection isn't ready
                addICECandidate(candidate).catch((err) => {
                  console.warn('Error adding ICE candidate from signal:', err);
                });
              } catch (err) {
                console.error('Error parsing ICE candidate:', err);
              }
            });
          }
        } else {
          // No signal means no active call
          setIsCalling(false);
          setCallSignal(null); // Clear call signal state
        }
      });
    }
    } catch (error) {
      // Silently handle subscription errors (might happen during initialization)
      console.debug('Error setting up call signaling subscription:', error);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [chatId, user?.email, authLoading, useApiSignaling, setAnswer, addICECandidate, endCall]);

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
    if (!user?.email) return;

    // Check for multiple tabs using BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const checkChannel = new BroadcastChannel('webrtc-call-check');
        let hasActiveCall = false;
        
        const timeout = setTimeout(() => {
          checkChannel.close();
        }, 300);
        
        const handleMessage = (event: MessageEvent) => {
          if (event.data === 'call-active') {
            hasActiveCall = true;
          }
        };
        
        checkChannel.addEventListener('message', handleMessage);
        checkChannel.postMessage('check-call');
        
        // Wait for responses from other tabs
        await new Promise(resolve => setTimeout(resolve, 200));
        
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
      alert('Please wait for authentication to complete.');
      return;
    }

    // Check if Firestore is available - warn here when actually trying to use the feature
    if (!db) {
      console.error('Firestore not available. Voice calls require Firebase to be properly configured.');
      alert('Voice calls are not available. Please ensure Firebase is properly configured.');
      return;
    }

    // Default to API-based signaling (more reliable, doesn't require Firebase Auth)
    // Only use Firestore if Firebase Auth is explicitly available and working
    let shouldUseApiSignaling = true; // Default to API
    
    // Only try Firestore if Firebase Auth is confirmed working
    if (auth?.currentUser?.email && db && !useApiSignaling) {
      // Firebase Auth is working and user wants Firestore - use it
      shouldUseApiSignaling = false;
      console.log('Using Firestore-based call signaling (Firebase Auth available)');
    } else {
      // Default: use API-based signaling
      console.log('Using API-based call signaling (default)');
    }
    
    // Check if user is logged in (required for API calls)
    if (!user?.email) {
      alert('You must be logged in to make voice calls. Please refresh the page and log in again.');
      return;
    }

    if (!canMakeCalls()) {
      alert('Voice calls are not available. Please ensure Firebase is properly configured.');
      return;
    }

    try {
      setIsCalling(true);
      
      // First, start the call (this gets media and initializes peer connection)
      await startCall();
      
      // Verify peer connection is available before proceeding (use getter for current value)
      const pc = getPeerConnection?.() || peerConnection;
      if (!pc) {
        console.error('Peer connection is null after startCall');
        throw new Error('Peer connection not initialized. Please try again.');
      }
      
      // Wait a bit longer for peer connection to be fully initialized and tracks added
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Double-check peer connection is still available
      const pcAfterWait = getPeerConnection?.() || peerConnection;
      if (!pcAfterWait) {
        console.error('Peer connection became null while waiting');
        throw new Error('Peer connection was lost. Please try again.');
      }
      
      console.log('Creating offer, peer connection state:', pcAfterWait.connectionState, 'senders:', pcAfterWait.getSenders().length);
      
      // Now create the offer
      const offer = await createOffer();
      if (!offer) {
        // Check if there was an error
        throw new Error('Failed to create offer. The peer connection may not be ready. Please try again.');
      }
      
      console.log('Offer created successfully:', offer.type);

      // Create call offer (use API if Firebase Auth unavailable)
      // Use local variable instead of state to avoid async state update issues
      const callId = shouldUseApiSignaling
        ? await callSignalingApiService.createCallOffer(
            chatId,
            user.email,
            otherUserEmail,
            offer
          )
        : await callSignalingService.createCallOffer(
            chatId,
            user.email,
            otherUserEmail,
            offer
          );
      callIdRef.current = callId;

      // ICE candidates will be sent automatically via the useEffect hook
    } catch (err) {
      console.error('Error starting call:', err);
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
          if (useApiSignaling) {
            await callSignalingApiService.endCall(callIdToUse, chatId);
          } else {
            await callSignalingService.endCall(callIdToUse);
          }
        } catch (err) {
          console.error('Error ending call:', err);
          // Continue with cleanup even if update fails
        }
        if (!externalCallId) {
          callIdRef.current = null;
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
      onClick={handleCallClick}
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
  chatId: string; // Chat ID needed for API-based signaling
  useApiSignaling?: boolean; // Whether to use API-based signaling
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
  useApiSignaling = true,
  onAccept,
  onReject,
  onMuteStateChange,
}: IncomingCallDialogProps) {
  const [isAnswering, setIsAnswering] = useState(false);
  const callIdRef = useRef<string | null>(callSignal.callId);
  const {
    answerCall,
    endCall,
    createOffer,
    addICECandidate,
    peerConnection,
    isMuted,
    toggleMute,
    callStatus,
  } = useWebRTC();

  useEffect(() => {
    // Handle ICE candidates from the signal
    // Only process if we have a peer connection (it will queue if not ready)
    if (callSignal.iceCandidates && callSignal.iceCandidates.length > 0 && peerConnection) {
      callSignal.iceCandidates.forEach((candidateStr) => {
        try {
          const candidate = typeof candidateStr === 'string' ? JSON.parse(candidateStr) : candidateStr;
          // addICECandidate will queue candidates if peer connection isn't ready
          addICECandidate(candidate).catch((err) => {
            console.warn('Error adding ICE candidate from signal:', err);
          });
        } catch (err) {
          console.error('Error parsing ICE candidate:', err);
        }
      });
    }
  }, [callSignal.iceCandidates, addICECandidate, peerConnection]);

  // Listen for ICE candidates and send them via the appropriate signaling service
  useEffect(() => {
    if (!peerConnection || !callIdRef.current) return;

    const handleICECandidate = async (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && callIdRef.current) {
        try {
          if (useApiSignaling) {
            await callSignalingApiService.sendICECandidate(callIdRef.current, chatId, event.candidate.toJSON());
          } else {
            await callSignalingService.sendICECandidate(callIdRef.current, event.candidate.toJSON());
          }
        } catch (err) {
          console.error('Error sending ICE candidate:', err);
        }
      }
    };

    peerConnection.addEventListener('icecandidate', handleICECandidate);

    return () => {
      peerConnection.removeEventListener('icecandidate', handleICECandidate);
    };
  }, [peerConnection, useApiSignaling, chatId]);

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
    if (!callSignal.offer) {
      console.error('No offer found in call signal');
      return;
    }

    try {
      setIsAnswering(true);
      
      // Answer the call (this will set remote description and create answer)
      // answerCall now returns the answer it creates
      const answer = await answerCall(callSignal.offer);
      
      // Send the answer via the appropriate signaling service
      if (answer && callIdRef.current) {
        try {
          if (useApiSignaling) {
            await callSignalingApiService.sendCallAnswer(callIdRef.current, chatId, answer);
          } else {
            await callSignalingService.sendCallAnswer(callIdRef.current, answer);
          }
        } catch (signalingError) {
          console.error('Error sending call answer:', signalingError);
          // Don't reject the call if signaling fails - the WebRTC connection might still work
          // Just log the error and continue
        }
      } else if (!answer) {
        console.error('Failed to create answer');
        setIsAnswering(false);
        return;
      }

      onAccept();
    } catch (err) {
      console.error('Error answering call:', err);
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
        if (useApiSignaling) {
          await callSignalingApiService.endCall(callIdRef.current, chatId);
        } else {
          await callSignalingService.endCall(callIdRef.current);
        }
      } catch (err) {
        console.error('Error ending call on reject:', err);
        // Continue with cleanup even if signaling fails
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

