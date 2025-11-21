import { useRef, useEffect, useState, useCallback } from 'react';
import { getRTCConfiguration } from '@/lib/webrtc-config';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'active' | 'ended' | 'error';

export interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callStatus: CallStatus;
  isMuted: boolean;
  isLocalAudioEnabled: boolean;
  error: string | null;
  startCall: () => Promise<void>;
  answerCall: (offer: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit | null>;
  endCall: () => void;
  toggleMute: () => void;
  createOffer: () => Promise<RTCSessionDescriptionInit | null>;
  setAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  addICECandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  peerConnection: RTCPeerConnection | null;
  getPeerConnection?: () => RTCPeerConnection | null;
}

export function useWebRTC(
  onStatusChange?: (status: CallStatus) => void,
  onRemoteStream?: (stream: MediaStream | null) => void
): UseWebRTCReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Sync mute state with track state when stream changes
  useEffect(() => {
    const syncMuteState = () => {
      // Check local stream first
      if (localStreamRef.current) {
        const audioTracks = localStreamRef.current.getAudioTracks();
        if (audioTracks.length > 0) {
          setIsMuted(!audioTracks[0].enabled);
          return;
        }
      }
      
      // Fallback: check peer connection senders
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const audioSenders = senders.filter(sender => sender.track && sender.track.kind === 'audio');
        if (audioSenders.length > 0 && audioSenders[0].track) {
          setIsMuted(!audioSenders[0].track.enabled);
        }
      }
    };
    
    syncMuteState();
    
    // Also sync periodically during active calls to catch changes from other instances
    if (callStatus === 'active' || callStatus === 'connecting') {
      const interval = setInterval(syncMuteState, 500);
      return () => clearInterval(interval);
    }
  }, [localStream, callStatus]);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const processedIceCandidates = useRef<Set<string>>(new Set()); // Track processed candidates by fingerprint
  const broadcastChannelCleanupRef = useRef<(() => void) | null>(null);
  const connectionRetryCount = useRef<number>(0);
  const maxRetries = 3; // Maximum number of connection retries
  
  // Log hook initialization to detect re-initialization (only in development)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('🔄 useWebRTC hook effect run', {
        hasPeerConnectionRef: !!peerConnectionRef.current,
        callStatus,
      });
    }
  });

  // Update status and notify callback
  // IMPORTANT: onStatusChange callback should NEVER clear peerConnectionRef
  const updateStatus = useCallback((status: CallStatus) => {
    if (import.meta.env.DEV) {
      console.log('🔄 updateStatus called', {
        newStatus: status,
        currentStatus: callStatus,
        hasPeerConnectionRef: !!peerConnectionRef.current,
      });
    }
    
    // CRITICAL: Store ref BEFORE any state updates or callbacks
    // This prevents the ref from being lost during React re-renders
    const refBeforeUpdate = peerConnectionRef.current;
    
    setCallStatus(status);
    
    // Call the callback - but ensure it can't clear our ref
    try {
      onStatusChange?.(status);
    } catch (err) {
      console.error('Error in onStatusChange callback:', err);
    }
    
    // CRITICAL: Always restore ref if it was cleared
    // This handles cases where React re-renders or callbacks clear the ref
    if (refBeforeUpdate && !peerConnectionRef.current) {
      console.error('❌ CRITICAL: Peer connection ref was cleared during updateStatus! Restoring...', {
        status,
        hadRef: !!refBeforeUpdate,
        refState: refBeforeUpdate.connectionState,
        refSignalingState: refBeforeUpdate.signalingState,
        stackTrace: new Error().stack?.split('\n').slice(1, 6).join('\n'),
      });
      peerConnectionRef.current = refBeforeUpdate;
    }
    
    // Additional safety: If status is 'idle' or 'ended', don't clear the ref if we're in the middle of setup
    // Only clear if we're explicitly ending a call
    if ((status === 'idle' || status === 'ended') && refBeforeUpdate) {
      // Don't clear the ref if we just set it (might be a temporary state change)
      // The ref should only be cleared by endCall(), not by status changes
      if (import.meta.env.DEV) {
        console.log('⚠️ Status changed to idle/ended, but preserving peer connection ref', {
          connectionState: refBeforeUpdate.connectionState,
          signalingState: refBeforeUpdate.signalingState,
          currentRef: !!peerConnectionRef.current,
        });
      }
    }
    
    // CRITICAL: If we're setting status to 'ringing' or 'connecting', ensure ref is set
    // This prevents the ref from being lost when transitioning to active call states
    if ((status === 'ringing' || status === 'connecting') && !peerConnectionRef.current && refBeforeUpdate) {
      console.error('❌ CRITICAL: Ref was cleared when setting status to ' + status + '! Restoring...', {
        hadRef: !!refBeforeUpdate,
        refConnectionState: refBeforeUpdate.connectionState,
      });
      peerConnectionRef.current = refBeforeUpdate;
    }
  }, [onStatusChange, callStatus]);

  // Initialize peer connection
  const initializePeerConnection = useCallback(() => {
    // Don't close existing connection if we're in the middle of a call
    // Only close if we're explicitly re-initializing
    const existingPc = peerConnectionRef.current;
    if (existingPc) {
      // Only close if connection is in a terminal state
      if (existingPc.connectionState === 'closed' || existingPc.connectionState === 'failed') {
        existingPc.close();
        peerConnectionRef.current = null;
      } else {
        // Connection is still active, don't close it - return existing and ensure ref is set
        if (import.meta.env.DEV) {
          console.log('⚠️ Using existing peer connection (still active)');
        }
        // Ensure ref is set (should already be, but be safe)
        if (peerConnectionRef.current !== existingPc) {
          peerConnectionRef.current = existingPc;
        }
        return existingPc;
      }
    }

    const pc = new RTCPeerConnection(getRTCConfiguration());
    // Set the ref immediately so it's available - CRITICAL: This must happen synchronously
    peerConnectionRef.current = pc;

    // Handle track events
    pc.ontrack = (event) => {
      console.log('Remote track received', {
        streams: event.streams?.length || 0,
        tracks: event.track ? [{
          kind: event.track.kind,
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState,
        }] : [],
      });
      if (event.streams && event.streams.length > 0) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        console.log('Setting remote stream', {
          streamId: stream.id,
          audioTracks: audioTracks.length,
          tracks: audioTracks.map(track => ({
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          })),
        });
        setRemoteStream(stream);
        onRemoteStream?.(stream);
      }
    };

    // Handle track removal
    pc.onsignalingstatechange = () => {
      // Signaling state changed
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      
      switch (state) {
        case 'connected':
          connectionRetryCount.current = 0; // Reset retry count on successful connection
          updateStatus('active');
          break;
        case 'disconnected':
          // Disconnected state - might recover, wait a bit before marking as error
          console.warn('Peer connection disconnected, waiting for potential recovery...');
          setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              updateStatus('error');
              setError('Connection lost');
            }
          }, 3000); // Wait 3 seconds for recovery
          break;
        case 'failed':
          // Connection failed - attempt retry if we haven't exceeded max retries
          if (connectionRetryCount.current < maxRetries) {
            connectionRetryCount.current++;
            console.warn(`Connection failed, attempting retry ${connectionRetryCount.current}/${maxRetries}...`);
            // Trigger ICE restart by creating a new offer/answer
            // This will be handled by the signaling layer
            updateStatus('connecting');
            setError(`Connection failed, retrying... (${connectionRetryCount.current}/${maxRetries})`);
          } else {
            updateStatus('error');
            setError('Connection failed after multiple retries');
          }
          break;
        case 'closed':
          connectionRetryCount.current = 0; // Reset retry count when connection is closed
          updateStatus('ended');
          break;
      }
    };

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      
      if (state === 'failed') {
        // ICE failed - might be able to recover with ICE restart
        if (connectionRetryCount.current < maxRetries) {
          console.warn('ICE connection failed, will attempt recovery...');
          // Don't immediately mark as error - let connection state handler manage retries
        } else {
          updateStatus('error');
          setError('ICE connection failed after multiple attempts');
        }
      } else if (state === 'disconnected') {
        // ICE disconnected - might recover
        console.warn('ICE connection disconnected, waiting for potential recovery...');
      } else if (state === 'connected' || state === 'completed') {
        connectionRetryCount.current = 0; // Reset retry count on successful ICE connection
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // ICE candidates will be sent via Firestore signaling
      }
    };

    // Handle ICE gathering state
    pc.onicegatheringstatechange = () => {
    };

    return pc;
  }, [updateStatus, onRemoteStream]);

  // Get user media (microphone)
  const getUserMedia = useCallback(async (): Promise<MediaStream> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      return stream;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied. Please allow microphone access.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('No microphone found. Please connect a microphone.');
      } else {
        throw new Error(`Failed to access microphone: ${error.message}`);
      }
    }
  }, []);

  // Start a call (create offer)
  const startCall = useCallback(async () => {
    if (import.meta.env.DEV) {
      console.log('startCall: BEGIN', {
        hasPeerConnectionRef: !!peerConnectionRef.current,
        callStatus,
      });
    }
    try {
      setError(null);
      updateStatus('connecting');

      // Check for multiple tabs trying to access media simultaneously
      // Use BroadcastChannel to detect other active tabs
      const channel = new BroadcastChannel('webrtc-call');
      let otherTabActive = false;
      
      const handleMessage = (event: MessageEvent) => {
        if (event.data === 'call-active') {
          otherTabActive = true;
        }
      };
      channel.addEventListener('message', handleMessage);
      
      // Notify other tabs that we're starting a call
      channel.postMessage('call-active');
      
      // Wait a bit to see if another tab responds (reduced from 100ms to 50ms for faster startup)
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (otherTabActive) {
        channel.close();
        throw new Error('Another tab is already in a call. Please close other tabs or end the call in the other tab.');
      }

      // Get local media stream
      const stream = await getUserMedia();
      
      // Verify stream is still valid and has tracks
      if (!stream || stream.getTracks().length === 0) {
        channel.close();
        throw new Error('Failed to get valid media stream. Please check your microphone permissions.');
      }
      
      // Check if any tracks are already ended (might happen with multiple tabs)
      const activeTracks = stream.getTracks().filter(track => track.readyState === 'live');
      if (activeTracks.length === 0) {
        channel.close();
        throw new Error('Microphone access was revoked or is being used by another tab. Please close other tabs and try again.');
      }
      
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Clear processed ICE candidates for new call
      processedIceCandidates.current.clear();

      // For startCall, always create a fresh peer connection
      // Close any existing connection first to ensure clean state
      if (peerConnectionRef.current) {
        const existingPc = peerConnectionRef.current;
        if (import.meta.env.DEV) {
          console.log('🔵 Closing existing peer connection before starting new call', {
            connectionState: existingPc.connectionState,
            signalingState: existingPc.signalingState,
          });
        }
        if (existingPc.connectionState !== 'closed') {
          existingPc.close();
        }
        peerConnectionRef.current = null;
      }

      // Initialize new peer connection
      if (import.meta.env.DEV) {
        console.log('🔵 About to call initializePeerConnection()');
      }
      const pc = initializePeerConnection();
      
      if (import.meta.env.DEV) {
        console.log('🔵 initializePeerConnection() returned', {
          pcObject: pc,
          refValue: peerConnectionRef.current,
          refMatches: peerConnectionRef.current === pc,
        });
      }
      
      // CRITICAL: Ensure ref is set immediately after initialization
      // This must happen synchronously to prevent race conditions
      if (peerConnectionRef.current !== pc) {
        console.error('❌ Peer connection ref mismatch after initialization!', {
          pcObject: pc,
          refValue: peerConnectionRef.current,
          refMatches: peerConnectionRef.current === pc,
        });
        peerConnectionRef.current = pc;
      }

      // Verify ref is set and matches the returned connection
      if (!peerConnectionRef.current) {
        console.error('❌ Peer connection ref is null after initialization!', {
          pcObject: pc,
          initializeReturned: !!pc,
        });
        channel.close();
        throw new Error('Failed to initialize peer connection - ref is null');
      }
      
      if (peerConnectionRef.current !== pc) {
        console.error('❌ Peer connection ref does not match returned connection!', {
          refValue: peerConnectionRef.current,
          pcObject: pc,
        });
        channel.close();
        throw new Error('Peer connection ref mismatch');
      }
      
      if (import.meta.env.DEV) {
        console.log('✅ Peer connection initialized and ref verified', {
          connectionState: pc.connectionState,
          signalingState: pc.signalingState,
          refSet: !!peerConnectionRef.current,
        });
      }

      // Add local stream tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Tracks are added synchronously, no need to wait
      // Check connection state immediately
      // The connection might be in 'new' state initially, which is fine
      // Also check ICE connection state
      const connectionState = pc.connectionState;
      const iceConnectionState = pc.iceConnectionState;
      
      if (connectionState === 'closed' || connectionState === 'failed') {
        channel.close();
        const errorMsg = connectionState === 'closed' 
          ? 'Peer connection was closed unexpectedly. This may be caused by multiple tabs accessing the microphone simultaneously. Please close other tabs and try again.'
          : 'Peer connection failed to initialize. Please check your microphone permissions and try again.';
        throw new Error(errorMsg);
      }
      
      // Warn if ICE connection is already failed (but don't throw yet, might recover)
      if (iceConnectionState === 'failed') {
        console.warn('ICE connection state is failed, but continuing...');
      }

      // Ensure ref is still pointing to our connection (it should be, but double-check)
      if (peerConnectionRef.current !== pc) {
        console.warn('Peer connection ref changed, updating it');
        peerConnectionRef.current = pc;
      }

      // Set up cleanup for BroadcastChannel
      const cleanup = () => {
        channel.removeEventListener('message', handleMessage);
        channel.close();
      };

      // Store cleanup function in ref for proper cleanup
      broadcastChannelCleanupRef.current = cleanup;

      // Final verification that peer connection ref is set before updating status
      if (import.meta.env.DEV) {
        console.log('🔍 startCall: Verification before updateStatus', {
          hasPeerConnectionRef: !!peerConnectionRef.current,
          peerConnectionState: peerConnectionRef.current?.connectionState,
          peerConnectionSignalingState: peerConnectionRef.current?.signalingState,
          isSameInstance: peerConnectionRef.current === pc,
        });
      }
      
      if (!peerConnectionRef.current) {
        console.error('❌ startCall: CRITICAL - Peer connection ref is null before updateStatus!');
        channel.close();
        throw new Error('Peer connection was not properly initialized');
      }

      // CRITICAL: Store ref in a local variable before updating status
      // This ensures we have a reference even if something clears the ref during status update
      const pcRef = peerConnectionRef.current;
      
      if (!pcRef) {
        console.error('❌ startCall: CRITICAL - Peer connection ref is null before updateStatus!', {
          pcObject: pc,
          refValue: peerConnectionRef.current,
          refObject: peerConnectionRef,
        });
        channel.close();
        throw new Error('Peer connection was not properly initialized');
      }
      
      // Log before status update
      if (import.meta.env.DEV) {
        console.log('🔵 About to call updateStatus("ringing")', {
          hasPcRef: !!pcRef,
          pcConnectionState: pcRef.connectionState,
          pcSignalingState: pcRef.signalingState,
        });
      }
      
      updateStatus('ringing');
      
      // CRITICAL: Restore ref if it was cleared during status update
      if (!peerConnectionRef.current && pcRef) {
        console.error('❌ CRITICAL: Peer connection ref was cleared during updateStatus("ringing"), restoring...', {
          hadRef: !!pcRef,
          refConnectionState: pcRef.connectionState,
        });
        peerConnectionRef.current = pcRef;
      }
      
      // Verify ref is still set after status update
      if (!peerConnectionRef.current) {
        console.error('❌ CRITICAL: Peer connection ref is STILL null after restore attempt!', {
          hadPcRef: !!pcRef,
          pcRefConnectionState: pcRef?.connectionState,
        });
      }
      
      // Verify ref is still set after status update (in case updateStatus triggers something)
      if (import.meta.env.DEV) {
        console.log('🔍 startCall: Verification after updateStatus', {
          hasPeerConnectionRef: !!peerConnectionRef.current,
          peerConnectionState: peerConnectionRef.current?.connectionState,
          peerConnectionSignalingState: peerConnectionRef.current?.signalingState,
        });
      }
      
      if (!peerConnectionRef.current) {
        console.error('❌ startCall: CRITICAL - Peer connection ref was cleared after updateStatus!');
        channel.close();
        throw new Error('Peer connection was cleared unexpectedly');
      }
      
      // Final check right before returning - ensure ref is still set
      if (!peerConnectionRef.current) {
        console.error('❌ startCall: FATAL - Peer connection ref is null at final check!');
        channel.close();
        throw new Error('Peer connection ref was null at final check');
      }
      
      if (import.meta.env.DEV) {
        console.log('✅ startCall: SUCCESS - About to return', {
          hasPeerConnectionRef: !!peerConnectionRef.current,
          peerConnectionState: peerConnectionRef.current?.connectionState,
          peerConnectionRefValue: peerConnectionRef.current,
        });
      }
      
      // CRITICAL: Return the peer connection ref value to ensure it's available
      // Store it one more time before returning to prevent any race conditions
      const finalPc = peerConnectionRef.current;
      if (!finalPc) {
        console.error('❌ startCall: CRITICAL - Ref became null right before return!');
        channel.close();
        throw new Error('Peer connection ref became null right before return');
      }
    } catch (err) {
      console.error('startCall: ERROR caught', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to start call';
      setError(errorMessage);
      updateStatus('error');
      console.error('Error starting call:', err);
      // Clean up on error
      if (broadcastChannelCleanupRef.current) {
        broadcastChannelCleanupRef.current();
        broadcastChannelCleanupRef.current = null;
      }
      if (peerConnectionRef.current) {
        if (import.meta.env.DEV) {
          console.log('🔴 Cleaning up peer connection due to error in startCall');
        }
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      throw err; // Re-throw so caller can handle it
    }
  }, [getUserMedia, initializePeerConnection, updateStatus]);

  // Create offer
  const createOffer = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    try {
      // Check peer connection immediately (should be ready since we just called startCall)
      let pc = peerConnectionRef.current;
      if (!pc) {
        // Only wait if peer connection is truly not ready (shouldn't happen in normal flow)
        let attempts = 0;
        const maxAttempts = 5; // Reduced from 20 - should be ready immediately
        while (!peerConnectionRef.current && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms
          attempts++;
        }
        
        pc = peerConnectionRef.current;
        if (!pc) {
          console.error('Peer connection ref is null after waiting');
          throw new Error('Peer connection not initialized. Please try starting the call again.');
        }
      }

      // Check connection state
      if (pc.connectionState === 'closed') {
        throw new Error('Peer connection is closed. Please try again.');
      }

      // Ensure local description is not already set
      if (pc.localDescription) {
        return pc.localDescription as RTCSessionDescriptionInit;
      }

      // Check senders immediately - tracks should already be added in startCall
      const senders = pc.getSenders();
      if (senders.length === 0) {
        console.warn('No senders found - this should not happen if startCall completed successfully');
        throw new Error('No audio tracks found. Please try again.');
      }

      // Verify senders have tracks
      const sendersWithTracks = senders.filter(s => s.track !== null);
      if (sendersWithTracks.length === 0) {
        console.warn('No senders with tracks found');
        throw new Error('Audio tracks are not properly attached. Please try again.');
      }

      // Check if we're in a valid state to create an offer
      // Should be 'new' or 'stable' state
      const currentSignalingState = pc.signalingState as string;
      if (currentSignalingState !== 'new' && currentSignalingState !== 'stable') {
        console.warn('Peer connection is not in a valid state to create offer', {
          signalingState: currentSignalingState,
          connectionState: pc.connectionState,
        });
        
        // If we're in 'have-local-offer' state and already have a local description, return it
        if (currentSignalingState === 'have-local-offer' && pc.localDescription) {
          console.log('Already have local offer, returning existing description');
          return pc.localDescription as RTCSessionDescriptionInit;
        }
        
        // Otherwise, this is an error
        throw new Error(`Cannot create offer in signaling state: ${currentSignalingState}`);
      }

      console.log('Calling pc.createOffer()...', {
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        sendersCount: senders.length,
        sendersWithTracksCount: sendersWithTracks.length,
      });
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      console.log('pc.createOffer() completed', { offerType: offer.type });
      
      console.log('Calling pc.setLocalDescription()...', {
        currentLocalDescription: pc.localDescription ? 'exists' : 'null',
        signalingState: pc.signalingState,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
      });
      
      // Check if peer connection is in a valid state
      const currentConnectionState = pc.connectionState as string;
      if (currentConnectionState === 'closed') {
        throw new Error('Peer connection is closed. Cannot set local description.');
      }
      
      // Call setLocalDescription - this should complete quickly
      try {
        await pc.setLocalDescription(offer);
        
        // Verify the description was actually set
        if (!pc.localDescription || pc.localDescription.type !== offer.type) {
          // Wait a bit more in case it's still being set
          await new Promise(resolve => setTimeout(resolve, 100));
          
          if (!pc.localDescription || pc.localDescription.type !== offer.type) {
            throw new Error('setLocalDescription completed but description was not set correctly');
          }
        }
        
        console.log('pc.setLocalDescription() completed successfully', {
          signalingState: pc.signalingState,
          localDescription: pc.localDescription ? 'set' : 'null',
          localDescriptionType: pc.localDescription?.type,
        });
      } catch (setDescError: any) {
        console.error('Error setting local description:', setDescError);
        
        // Check if description was set despite the error (some browsers set it synchronously)
        if (pc.localDescription && pc.localDescription.type === offer.type) {
          console.log('Local description was set despite error, continuing...', {
            signalingState: pc.signalingState,
            localDescriptionType: pc.localDescription.type,
          });
          // Description is set, continue
        } else {
          // Check for specific error types
          if (setDescError.name === 'InvalidStateError') {
            // Peer connection might be in wrong state - check if we can recover
            console.warn('InvalidStateError setting local description', {
              signalingState: pc.signalingState,
              connectionState: pc.connectionState,
            });
            
            // If we're in stable state and description is already set, that's fine
            if (pc.signalingState === 'stable' && pc.localDescription) {
              console.log('Already in stable state with description, continuing...');
              return pc.localDescription as RTCSessionDescriptionInit;
            }
          }
          
          // Description not set, throw the error
          throw setDescError;
        }
      }
      
      // Process any queued ICE candidates (with deduplication)
      console.log('Processing queued ICE candidates...', { queueLength: iceCandidatesQueue.current.length });
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          // Generate fingerprint for deduplication
          const fingerprint = `${candidate.candidate || ''}|${candidate.sdpMLineIndex?.toString() || ''}|${candidate.sdpMid || ''}`;
          if (!processedIceCandidates.current.has(fingerprint)) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              processedIceCandidates.current.add(fingerprint);
            } catch (err) {
              console.warn('Error adding queued ICE candidate:', err);
            }
          }
        }
      }
      console.log('Finished processing ICE candidates');

      return offer;
    } catch (err) {
      console.error('Error creating offer:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to create offer';
      setError(errorMessage);
      return null;
    }
  }, []);

  // Answer a call (set remote offer and create answer)
  const answerCall = useCallback(async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | null> => {
    let stream: MediaStream | null = null;
    try {
      setError(null);
      updateStatus('connecting');

      // Get local media stream
      stream = await getUserMedia();
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Clear processed ICE candidates for new call
      processedIceCandidates.current.clear();

      // Initialize peer connection
      const pc = initializePeerConnection();

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Set remote description (offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Process any queued ICE candidates (with deduplication)
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          // Generate fingerprint for deduplication
          const fingerprint = `${candidate.candidate || ''}|${candidate.sdpMLineIndex?.toString() || ''}|${candidate.sdpMid || ''}`;
          if (!processedIceCandidates.current.has(fingerprint)) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              processedIceCandidates.current.add(fingerprint);
            } catch (iceErr) {
              console.warn('Error adding queued ICE candidate:', iceErr);
            }
          }
        }
      }

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      updateStatus('active');
      return answer;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to answer call';
      setError(errorMessage);
      updateStatus('error');
      console.error('Error answering call:', err);
      
      // Cleanup on error
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        if (localStreamRef.current === stream) {
          localStreamRef.current = null;
          setLocalStream(null);
        }
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      return null;
    }
  }, [getUserMedia, initializePeerConnection, updateStatus]);

  // Set answer (for caller when callee answers)
  const setAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        throw new Error('Peer connection not initialized');
      }

      // Check if remote description is already set
      // If it's already set and we're in stable state, don't try to set it again
      if (pc.remoteDescription && pc.signalingState === 'stable') {
        return;
      }

      // Check if we're in the right state to set the answer
      // We should be in 'have-local-offer' state (we created an offer, waiting for answer)
      if (pc.signalingState !== 'have-local-offer' && pc.signalingState !== 'stable') {
        console.warn(`Cannot set answer in signaling state: ${pc.signalingState}`);
        // Queue the answer to be processed later if needed
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Process any queued ICE candidates after remote description is set (with deduplication)
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          // Generate fingerprint for deduplication
          const fingerprint = `${candidate.candidate || ''}|${candidate.sdpMLineIndex?.toString() || ''}|${candidate.sdpMid || ''}`;
          if (!processedIceCandidates.current.has(fingerprint)) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
              processedIceCandidates.current.add(fingerprint);
            } catch (iceErr) {
              console.warn('Error adding queued ICE candidate after setting answer:', iceErr);
            }
          }
        }
      }

      updateStatus('active');
    } catch (err: any) {
      // Handle InvalidStateError gracefully - it means answer was already set
      if (err.name === 'InvalidStateError' && err.message.includes('stable')) {
        return;
      }
      console.error('Error setting answer:', err);
      setError(err instanceof Error ? err.message : 'Failed to set answer');
      updateStatus('error');
    }
  }, [updateStatus]);

  // Generate fingerprint for ICE candidate to detect duplicates
  const getCandidateFingerprint = useCallback((candidate: RTCIceCandidateInit): string => {
    // Create a unique fingerprint from candidate properties
    const parts = [
      candidate.candidate || '',
      candidate.sdpMLineIndex?.toString() || '',
      candidate.sdpMid || '',
    ];
    return parts.join('|');
  }, []);

  // Add ICE candidate with deduplication
  const addICECandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    try {
      // Generate fingerprint for deduplication
      const fingerprint = getCandidateFingerprint(candidate);
      
      // Check if candidate has already been processed
      if (processedIceCandidates.current.has(fingerprint)) {
        console.log('Skipping duplicate ICE candidate:', fingerprint.substring(0, 50));
        return;
      }

      const pc = peerConnectionRef.current;
      if (!pc) {
        // Queue candidate if peer connection not ready (but don't mark as processed yet)
        iceCandidatesQueue.current.push(candidate);
        return;
      }

      // Check if peer connection is in a valid state
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        console.warn('Peer connection is closed or failed, ignoring ICE candidate');
        return;
      }

      const remoteDesc = pc.remoteDescription;
      if (!remoteDesc) {
        // Queue candidate if remote description not set yet (but don't mark as processed yet)
        iceCandidatesQueue.current.push(candidate);
        return;
      }

      // Try to add the candidate
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        // Mark as processed only after successful addition
        processedIceCandidates.current.add(fingerprint);
        console.log('Added ICE candidate:', fingerprint.substring(0, 50));
      } catch (addErr: any) {
        // Handle specific ICE candidate errors
        if (addErr.name === 'OperationError' || addErr.name === 'InvalidStateError') {
          // Peer connection might be in an invalid state, queue for later
          console.warn('Failed to add ICE candidate, queueing:', addErr.message);
          iceCandidatesQueue.current.push(candidate);
        } else {
          // Other errors (e.g., invalid candidate format) - mark as processed to avoid retrying
          console.error('Error adding ICE candidate:', addErr);
          processedIceCandidates.current.add(fingerprint); // Mark as processed to avoid infinite retries
        }
      }
    } catch (err) {
      console.error('Error processing ICE candidate:', err);
    }
  }, [getCandidateFingerprint]);

  // Toggle mute - works with both local stream and peer connection senders
  const toggleMute = useCallback(() => {
    let audioTracks: MediaStreamTrack[] = [];
    
    // First, try to get tracks from local stream
    if (localStreamRef.current) {
      audioTracks = localStreamRef.current.getAudioTracks();
    }
    
    // If no tracks in local stream, try to get from peer connection senders
    if (audioTracks.length === 0 && peerConnectionRef.current) {
      const senders = peerConnectionRef.current.getSenders();
      audioTracks = senders
        .map(sender => sender.track)
        .filter((track): track is MediaStreamTrack => track !== null && track.kind === 'audio');
    }
    
    // If we have audio tracks, toggle them
    if (audioTracks.length > 0) {
      // Get current state from the first track
      const currentEnabled = audioTracks[0].enabled;
      const newEnabled = !currentEnabled;
      
      // Update all audio tracks
      audioTracks.forEach((track) => {
        track.enabled = newEnabled;
      });
      
      // Also update local stream ref tracks if they exist (for consistency)
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = newEnabled;
        });
      }
      
      // Update state to match track state
      setIsMuted(!newEnabled);
      
    } else {
      console.warn('No audio tracks found to mute/unmute');
    }
  }, []);

  // End call and cleanup
  const endCall = useCallback(() => {
    // Early return if already idle and nothing to clean up (prevents unnecessary calls)
    const hasResources = !!peerConnectionRef.current || !!localStreamRef.current || !!remoteAudioRef.current;
    if (callStatus === 'idle' && !hasResources) {
      // Already idle and no resources to clean up - no-op
      if (import.meta.env.DEV) {
        console.log('🔵 endCall() called but already idle with no resources - skipping', {
          callStatus,
          hasPeerConnectionRef: !!peerConnectionRef.current,
          hasLocalStream: !!localStreamRef.current,
        });
      }
      return;
    }

    // Log when endCall is called for debugging (only if there's actually something to clean up)
    if (import.meta.env.DEV) {
      console.log('🔴 endCall() called', {
        hasPeerConnectionRef: !!peerConnectionRef.current,
        hasLocalStream: !!localStreamRef.current,
        callStatus,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n'),
      });
    }

    // Stop local stream tracks and ensure mic is closed
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        // Disable the track first (mute it)
        track.enabled = false;
        // Then stop the track to release the microphone
        track.stop();
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }

    // Cleanup BroadcastChannel
    if (broadcastChannelCleanupRef.current) {
      broadcastChannelCleanupRef.current();
      broadcastChannelCleanupRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      if (import.meta.env.DEV) {
        console.log('🔴 Closing peer connection in endCall()', {
          connectionState: peerConnectionRef.current.connectionState,
          signalingState: peerConnectionRef.current.signalingState,
        });
      }
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear remote stream and audio element
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.pause();
    }
    setRemoteStream(null);
    onRemoteStream?.(null);

    // Reset state - mic is closed/muted when call ends
    setIsMuted(true); // Set to true since mic is closed
    setError(null);
    iceCandidatesQueue.current = [];
    processedIceCandidates.current.clear(); // Clear processed candidates for next call
    connectionRetryCount.current = 0; // Reset retry count
    
    // Only update status if not already idle (prevents unnecessary state updates)
    // BUT: If we're in 'ringing' or 'connecting' state, something went wrong - log it
    if (callStatus === 'ringing' || callStatus === 'connecting') {
      console.warn('⚠️ endCall() called while in ' + callStatus + ' state - this might indicate an error', {
        hasPeerConnectionRef: !!peerConnectionRef.current,
        hasLocalStream: !!localStreamRef.current,
      });
    }
    
    if (callStatus !== 'idle') {
      updateStatus('idle');
    }
  }, [updateStatus, onRemoteStream, callStatus]);

  // Cleanup on unmount - only if there's an active call
  useEffect(() => {
    return () => {
      // Only cleanup if we have an active connection and we're not just starting
      // This prevents cleanup during component re-renders or initial setup
      if (peerConnectionRef.current && callStatus !== 'idle' && callStatus !== 'connecting') {
        endCall();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get ICE candidate from peer connection
  useEffect(() => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        // ICE candidates are handled via Firestore signaling
        // This is just for logging
      }
    };

    pc.addEventListener('icecandidate', handleIceCandidate);

    return () => {
      pc.removeEventListener('icecandidate', handleIceCandidate);
    };
  }, [peerConnectionRef.current]);

  // Create and manage remote audio element for playback
  useEffect(() => {
    // Create audio element if it doesn't exist
    if (!remoteAudioRef.current) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      // Use setAttribute for playsInline (not a standard property but required for Safari/iOS)
      audio.setAttribute('playsinline', 'true'); // Required for Safari/iOS
      audio.setAttribute('crossorigin', 'anonymous'); // Help with CORS if needed
      audio.style.display = 'none'; // Hide the audio element
      audio.style.position = 'fixed';
      audio.style.top = '0';
      audio.style.left = '0';
      audio.style.width = '0';
      audio.style.height = '0';
      audio.style.opacity = '0';
      audio.style.pointerEvents = 'none';
      document.body.appendChild(audio);
      remoteAudioRef.current = audio;

      // Add event listeners for debugging
      audio.addEventListener('play', () => {
        console.log('🎵 Audio element started playing', {
          paused: audio.paused,
          currentTime: audio.currentTime,
          volume: audio.volume,
          muted: audio.muted,
        });
      });

      audio.addEventListener('playing', () => {
        console.log('🎵 Audio element is playing', {
          paused: audio.paused,
          currentTime: audio.currentTime,
          readyState: audio.readyState,
        });
      });

      audio.addEventListener('pause', () => {
        console.warn('⚠️ Audio element was paused', {
          paused: audio.paused,
          currentTime: audio.currentTime,
        });
      });

      audio.addEventListener('error', (e) => {
        console.error('❌ Audio element error:', e, {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState,
        });
      });

      audio.addEventListener('loadedmetadata', () => {
        console.log('📊 Audio metadata loaded', {
          duration: audio.duration,
          readyState: audio.readyState,
        });
      });

      audio.addEventListener('canplay', () => {
        console.log('✅ Audio can play', {
          readyState: audio.readyState,
          paused: audio.paused,
        });
      });
    }

    // Update audio element when remote stream changes
    if (remoteStream && remoteAudioRef.current) {
      const audio = remoteAudioRef.current;
      const audioTracks = remoteStream.getAudioTracks();
      console.log('Updating remote audio element', {
        streamId: remoteStream.id,
        audioTracks: audioTracks.length,
        tracks: audioTracks.map(track => ({
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
        hasAudioElement: !!audio,
      });
      
      // Set the stream
      audio.srcObject = remoteStream;
      
      // Ensure tracks are enabled and not muted
      audioTracks.forEach(track => {
        console.log('Remote audio track state:', {
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
        if (!track.enabled) {
          console.log('Enabling remote audio track');
          track.enabled = true;
        }
        if (track.muted) {
          console.log('Warning: Remote audio track is muted');
        }
      });
      
      // Set volume to maximum and ensure not muted
      audio.volume = 1.0;
      audio.muted = false;
      
      // Function to attempt playing audio with retries
      const attemptPlay = async (retryCount = 0, maxRetries = 5) => {
        try {
          // Check if audio element is ready
          if (!audio.srcObject) {
            console.warn('Audio element has no srcObject, waiting...');
            if (retryCount < maxRetries) {
              setTimeout(() => attemptPlay(retryCount + 1, maxRetries), 200);
            }
            return;
          }

          // Check if there are active tracks
          const tracks = remoteStream.getAudioTracks();
          if (tracks.length === 0) {
            console.warn('No audio tracks in stream');
            return;
          }

          const activeTracks = tracks.filter(t => t.readyState === 'live');
          if (activeTracks.length === 0) {
            console.warn('No active audio tracks, waiting...');
            if (retryCount < maxRetries) {
              setTimeout(() => attemptPlay(retryCount + 1, maxRetries), 200);
            }
            return;
          }

          // Attempt to play
          await audio.play();
          
          console.log('✅ Remote audio playback started successfully', {
            paused: audio.paused,
            volume: audio.volume,
            muted: audio.muted,
            readyState: audio.readyState,
            currentTime: audio.currentTime,
            retryCount,
          });

          // Verify it's actually playing after a short delay
          setTimeout(() => {
            if (audio.paused) {
              console.warn('⚠️ Audio element is paused after play() succeeded - browser may have blocked it');
              // Try one more time
              audio.play().catch(err => {
                console.error('❌ Final play attempt failed:', err);
              });
            } else {
              console.log('✅ Audio is confirmed playing', {
                paused: audio.paused,
                currentTime: audio.currentTime,
              });
            }
          }, 100);
        } catch (err: any) {
          console.error(`❌ Error playing remote audio (attempt ${retryCount + 1}):`, err);
          
          // If it's an autoplay policy error, try again after user interaction
          if (err.name === 'NotAllowedError' || err.message?.includes('autoplay')) {
            console.warn('⚠️ Autoplay blocked - audio will play after user interaction');
            // Set up a one-time click handler to start audio
            const startAudioOnInteraction = () => {
              audio.play()
                .then(() => {
                  console.log('✅ Audio started after user interaction');
                })
                .catch((playErr) => {
                  console.error('❌ Failed to play after user interaction:', playErr);
                });
              document.removeEventListener('click', startAudioOnInteraction);
              document.removeEventListener('touchstart', startAudioOnInteraction);
            };
            document.addEventListener('click', startAudioOnInteraction, { once: true });
            document.addEventListener('touchstart', startAudioOnInteraction, { once: true });
          } else if (retryCount < maxRetries) {
            // Retry for other errors
            setTimeout(() => attemptPlay(retryCount + 1, maxRetries), 500);
          }
        }
      };

      // Start attempting to play
      attemptPlay();
    } else if (!remoteStream && remoteAudioRef.current) {
      // Clear the audio element when stream is removed
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.pause();
    }

    // Cleanup on unmount
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.pause();
        if (remoteAudioRef.current.parentNode) {
          remoteAudioRef.current.parentNode.removeChild(remoteAudioRef.current);
        }
        remoteAudioRef.current = null;
      }
    };
  }, [remoteStream]);

  const isLocalAudioEnabled = localStreamRef.current?.getAudioTracks()[0]?.enabled ?? false;

  // Getter function to always return current ref value
  // Use empty dependency array to ensure it always accesses the current ref
  const getPeerConnection = useCallback(() => {
    // Always access the ref directly - don't cache it
    const pc = peerConnectionRef.current;
    if (import.meta.env.DEV) {
      console.log('🔍 getPeerConnection called', {
        hasPc: !!pc,
        connectionState: pc?.connectionState,
        signalingState: pc?.signalingState,
      });
    }
    
    return peerConnectionRef.current; // Return directly from ref, not cached value
  }, []);

  return {
    localStream,
    remoteStream,
    callStatus,
    isMuted,
    isLocalAudioEnabled,
    error,
    startCall,
    answerCall,
    endCall,
    toggleMute,
    createOffer,
    setAnswer,
    addICECandidate,
    peerConnection: peerConnectionRef.current,
    getPeerConnection,
  };
}

/**
 * Test function to verify peer connection creation works
 * Call from browser console: window.testWebRTCPeerConnection()
 */
if (typeof window !== 'undefined') {
  (window as any).testWebRTCPeerConnection = async () => {
    console.log('🧪 Testing WebRTC Peer Connection Creation...');
    
    try {
      // Step 1: Test RTC Configuration
      const { getRTCConfiguration } = await import('@/lib/webrtc-config');
      const config = getRTCConfiguration();
      console.log('✅ Step 1: RTC Configuration loaded', {
        iceServers: config.iceServers.length,
        hasTURN: config.iceServers.some(s => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some(url => url && url.includes('turn:'));
        }),
      });

      // Step 2: Create peer connection
      console.log('🧪 Step 2: Creating RTCPeerConnection...');
      const pc = new RTCPeerConnection(config);
      console.log('✅ Step 2: Peer connection created', {
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        iceConnectionState: pc.iceConnectionState,
      });

      // Step 3: Test getting user media
      console.log('🧪 Step 3: Requesting microphone access...');
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        console.log('✅ Step 3: Microphone access granted', {
          tracks: stream.getTracks().length,
          audioTracks: stream.getAudioTracks().length,
        });
      } catch (mediaError: any) {
        console.error('❌ Step 3: Microphone access failed', {
          name: mediaError.name,
          message: mediaError.message,
        });
        pc.close();
        throw mediaError;
      }

      // Step 4: Add tracks to peer connection
      console.log('🧪 Step 4: Adding tracks to peer connection...');
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream!);
      });
      const senders = pc.getSenders();
      console.log('✅ Step 4: Tracks added', {
        senders: senders.length,
        sendersWithTracks: senders.filter(s => s.track !== null).length,
      });

      // Step 5: Create offer
      console.log('🧪 Step 5: Creating offer...');
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      console.log('✅ Step 5: Offer created', {
        type: offer.type,
        sdp: offer.sdp?.substring(0, 100) + '...',
      });

      // Step 6: Set local description
      console.log('🧪 Step 6: Setting local description...');
      await pc.setLocalDescription(offer);
      console.log('✅ Step 6: Local description set', {
        signalingState: pc.signalingState,
        hasLocalDescription: !!pc.localDescription,
      });

      // Step 7: Monitor ICE gathering
      console.log('🧪 Step 7: Monitoring ICE candidate gathering...');
      let iceCandidateCount = 0;
      const icePromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('⚠️ ICE gathering timeout after 5 seconds');
          resolve();
        }, 5000);

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            iceCandidateCount++;
            console.log(`✅ ICE candidate ${iceCandidateCount} gathered:`, {
              candidate: event.candidate.candidate?.substring(0, 50),
            });
          } else {
            console.log('✅ ICE gathering complete', {
              totalCandidates: iceCandidateCount,
            });
            clearTimeout(timeout);
            resolve();
          }
        };
      });

      await icePromise;

      // Step 8: Check final states
      console.log('🧪 Step 8: Checking final connection states...');
      console.log('✅ Step 8: Final states', {
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        localDescription: pc.localDescription ? 'set' : 'null',
        remoteDescription: pc.remoteDescription ? 'set' : 'null',
        senders: pc.getSenders().length,
      });

      // Cleanup
      console.log('🧹 Cleaning up test resources...');
      stream.getTracks().forEach(track => track.stop());
      pc.close();
      console.log('✅ Test completed successfully!');
      console.log('📊 Summary:', {
        peerConnectionCreated: true,
        microphoneAccess: true,
        tracksAdded: true,
        offerCreated: true,
        localDescriptionSet: true,
        iceCandidatesGathered: iceCandidateCount,
        allTestsPassed: true,
      });

      return {
        success: true,
        peerConnection: pc,
        offer,
        iceCandidateCount,
      };
    } catch (error: any) {
      console.error('❌ WebRTC Peer Connection Test Failed:', {
        error: error.message,
        name: error.name,
        stack: error.stack,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  };
}

