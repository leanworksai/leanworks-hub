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
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const broadcastChannelCleanupRef = useRef<(() => void) | null>(null);

  // Update status and notify callback
  const updateStatus = useCallback((status: CallStatus) => {
    setCallStatus(status);
    onStatusChange?.(status);
  }, [onStatusChange]);

  // Initialize peer connection
  const initializePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const pc = new RTCPeerConnection(getRTCConfiguration());
    // Set the ref immediately so it's available
    peerConnectionRef.current = pc;

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log('Received remote stream:', event.streams[0]);
      setRemoteStream(event.streams[0]);
      onRemoteStream?.(event.streams[0]);
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('Connection state:', state);
      
      switch (state) {
        case 'connected':
          updateStatus('active');
          break;
        case 'disconnected':
        case 'failed':
          updateStatus('error');
          setError('Connection failed');
          break;
        case 'closed':
          updateStatus('ended');
          break;
      }
    };

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('ICE connection state:', state);
      
      if (state === 'failed' || state === 'disconnected') {
        updateStatus('error');
        setError('ICE connection failed');
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // ICE candidates will be sent via Firestore signaling
        console.log('ICE candidate generated:', event.candidate);
      }
    };

    // Handle ICE gathering state
    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
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
      
      // Wait a bit to see if another tab responds
      await new Promise(resolve => setTimeout(resolve, 100));
      
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

      // Initialize peer connection
      const pc = initializePeerConnection();
      
      // Ensure ref is set (it should be set in initializePeerConnection, but double-check)
      if (!peerConnectionRef.current) {
        console.warn('Peer connection ref was not set, setting it now');
        peerConnectionRef.current = pc;
      }

      // Verify ref is set
      if (!peerConnectionRef.current) {
        channel.close();
        throw new Error('Failed to initialize peer connection');
      }

      console.log('Peer connection initialized, adding tracks...');

      // Add local stream tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      console.log('Tracks added, senders:', pc.getSenders().length);

      // Wait a moment for tracks to be added and connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check connection state more carefully
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

      console.log('startCall completed, peer connection state:', pc.connectionState);
      updateStatus('ringing');
    } catch (err) {
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
      // Wait for peer connection to be ready
      let attempts = 0;
      const maxAttempts = 20; // Increased attempts
      while (!peerConnectionRef.current && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error('Peer connection ref is null after waiting');
        throw new Error('Peer connection not initialized. Please try starting the call again.');
      }

      // Check connection state
      if (pc.connectionState === 'closed') {
        throw new Error('Peer connection is closed. Please try again.');
      }

      // Ensure local description is not already set
      if (pc.localDescription) {
        console.log('Local description already set, returning existing offer');
        // Return existing offer if already created
        return pc.localDescription as RTCSessionDescriptionInit;
      }

      // Ensure we have at least one track before creating offer
      const senders = pc.getSenders();
      if (senders.length === 0) {
        console.warn('No senders found, waiting for tracks...');
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('Creating offer with', pc.getSenders().length, 'senders');
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      
      console.log('Offer created, setting local description');
      await pc.setLocalDescription(offer);
      
      // Process any queued ICE candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.warn('Error adding queued ICE candidate:', err);
          }
        }
      }

      console.log('Offer ready:', offer.type);
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

      // Initialize peer connection
      const pc = initializePeerConnection();

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Set remote description (offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Process any queued ICE candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (iceErr) {
            console.warn('Error adding queued ICE candidate:', iceErr);
            // Continue processing other candidates
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
        console.log('Answer already set, skipping duplicate answer');
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

      // Process any queued ICE candidates after remote description is set
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (iceErr) {
            console.warn('Error adding queued ICE candidate after setting answer:', iceErr);
            // Continue processing other candidates even if one fails
          }
        }
      }

      updateStatus('active');
    } catch (err: any) {
      // Handle InvalidStateError gracefully - it means answer was already set
      if (err.name === 'InvalidStateError' && err.message.includes('stable')) {
        console.log('Answer already set, ignoring duplicate');
        return;
      }
      console.error('Error setting answer:', err);
      setError(err instanceof Error ? err.message : 'Failed to set answer');
      updateStatus('error');
    }
  }, [updateStatus]);

  // Add ICE candidate
  const addICECandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        // Queue candidate if peer connection not ready
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
        // Queue candidate if remote description not set yet
        iceCandidatesQueue.current.push(candidate);
        return;
      }

      // Try to add the candidate
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (addErr: any) {
        // Handle specific ICE candidate errors
        if (addErr.name === 'OperationError' || addErr.name === 'InvalidStateError') {
          // Peer connection might be in an invalid state, queue for later
          console.warn('Failed to add ICE candidate, queueing:', addErr.message);
          iceCandidatesQueue.current.push(candidate);
        } else {
          // Other errors (e.g., invalid candidate format) - log but don't queue
          console.error('Error adding ICE candidate:', addErr);
        }
      }
    } catch (err) {
      console.error('Error processing ICE candidate:', err);
    }
  }, []);

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
      
      console.log(`Microphone ${newEnabled ? 'unmuted' : 'muted'}`);
    } else {
      console.warn('No audio tracks found to mute/unmute');
    }
  }, []);

  // End call and cleanup
  const endCall = useCallback(() => {
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
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear remote stream
    setRemoteStream(null);
    onRemoteStream?.(null);

    // Reset state - mic is closed/muted when call ends
    setIsMuted(true); // Set to true since mic is closed
    setError(null);
    iceCandidatesQueue.current = [];
    updateStatus('idle');
  }, [updateStatus, onRemoteStream]);

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
        console.log('ICE candidate:', event.candidate);
      }
    };

    pc.addEventListener('icecandidate', handleIceCandidate);

    return () => {
      pc.removeEventListener('icecandidate', handleIceCandidate);
    };
  }, [peerConnectionRef.current]);

  const isLocalAudioEnabled = localStreamRef.current?.getAudioTracks()[0]?.enabled ?? false;

  // Getter function to always return current ref value
  const getPeerConnection = useCallback(() => {
    return peerConnectionRef.current;
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

