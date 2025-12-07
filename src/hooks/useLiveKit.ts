import { useRef, useEffect, useState, useCallback } from 'react';
import { Room, RoomEvent, RemoteParticipant, LocalTrack, RemoteTrack, Track, TrackPublication } from 'livekit-client';
import { getAuthToken } from '@/services/api';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'active' | 'ended' | 'error';

export interface ParticipantInfo {
  identity: string;
  name?: string;
  isSpeaking: boolean;
  isMuted: boolean;
  audioTrack?: MediaStreamTrack;
}

export interface UseLiveKitReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callStatus: CallStatus;
  isMuted: boolean;
  isLocalAudioEnabled: boolean;
  error: string | null;
  participants: ParticipantInfo[]; // All remote participants
  participantCount: number; // Total participant count (including local)
  startCall: (roomName: string, participantName?: string) => Promise<void>;
  answerCall: (roomName: string, participantName?: string) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  createOffer: () => Promise<RTCSessionDescriptionInit | null>;
  setAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  addICECandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  peerConnection: RTCPeerConnection | null;
  getPeerConnection?: () => RTCPeerConnection | null;
  room: Room | null;
}

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Fetch LiveKit token from backend
async function fetchLiveKitToken(roomName: string, participantName?: string): Promise<{ token: string; url: string }> {
  const authToken = await getAuthToken();
  if (!authToken) {
    throw new Error('Authentication required');
  }

  const apiUrl = import.meta.env.DEV
    ? `${API_BASE}/api/livekit/token`
    : `${API_BASE}/livekit/token`;

  const params = new URLSearchParams({
    roomName,
    ...(participantName && { participantName }),
  });

  const response = await fetch(`${apiUrl}?${params}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch LiveKit token');
  }

  return response.json();
}

export function useLiveKit(
  onStatusChange?: (status: CallStatus) => void,
  onRemoteStream?: (stream: MediaStream | null) => void
): UseLiveKitReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  
  const roomRef = useRef<Room | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const isMutedRef = useRef(false);
  const participantsRef = useRef<Map<string, ParticipantInfo>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map()); // Track streams per participant

  // Update status and notify callback
  const updateStatus = useCallback((status: CallStatus) => {
    setCallStatus(status);
    if (onStatusChange) {
      onStatusChange(status);
    }
  }, [onStatusChange]);

  // Create and manage remote audio element for playback
  useEffect(() => {
    // Create audio element if it doesn't exist
    if (!remoteAudioRef.current) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true'); // Required for Safari/iOS
      audio.setAttribute('crossorigin', 'anonymous');
      audio.style.display = 'none';
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
        console.log('🎵 Remote audio element started playing');
      });
      audio.addEventListener('playing', () => {
        console.log('🎵 Remote audio element is playing');
      });
      audio.addEventListener('error', (e) => {
        console.error('❌ Remote audio element error:', e, {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState,
        });
      });
    }

    // Update audio element when remote stream changes
    if (remoteStream && remoteAudioRef.current) {
      const audio = remoteAudioRef.current;
      const audioTracks = remoteStream.getAudioTracks();
      
      console.log('🎵 Updating remote audio element', {
        streamId: remoteStream.id,
        trackCount: audioTracks.length,
        tracks: audioTracks.map(t => ({ id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
      });

      audio.srcObject = remoteStream;

      // Try to play the audio
      audio.play().then(() => {
        console.log('✅ Remote audio playback started');
      }).catch((err) => {
        console.error('❌ Failed to play remote audio:', err);
        // On some browsers, autoplay might be blocked - user interaction is required
        console.warn('⚠️ Audio autoplay blocked. User interaction may be required.');
      });
    } else if (!remoteStream && remoteAudioRef.current) {
      // Clear the audio element when stream is removed
      remoteAudioRef.current.srcObject = null;
      console.log('🎵 Remote audio element cleared');
    }

    // Cleanup on unmount
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    };
  }, [remoteStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach(track => track.stop());
        remoteStreamRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    };
  }, []);

  // Helper function to update aggregated remote stream (combines all participant audio)
  const updateAggregatedRemoteStream = useCallback(() => {
    // Create a new aggregated stream with all participant audio tracks
    const aggregatedStream = new MediaStream();
    let hasTracks = false;
    
    remoteStreamsRef.current.forEach((stream) => {
      stream.getAudioTracks().forEach(track => {
        aggregatedStream.addTrack(track);
        hasTracks = true;
      });
    });
    
    if (hasTracks) {
      remoteStreamRef.current = aggregatedStream;
      setRemoteStream(aggregatedStream);
    } else {
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
  }, []);

  // Helper function to update participants list
  const updateParticipantsList = useCallback(() => {
    const participantsList = Array.from(participantsRef.current.values());
    setParticipants(participantsList);
  }, []);

  // Start call - connect to LiveKit room
  const startCall = useCallback(async (roomName: string, participantName?: string) => {
    try {
      setError(null);
      updateStatus('connecting');

      // Get LiveKit token
      const { token, url } = await fetchLiveKitToken(roomName, participantName);
      
      // Validate token is a string
      if (typeof token !== 'string') {
        throw new Error(`Invalid token type: expected string, got ${typeof token}. Token: ${JSON.stringify(token)}`);
      }
      
      // Validate URL
      if (!url || typeof url !== 'string') {
        throw new Error(`Invalid URL: expected string, got ${typeof url}. URL: ${JSON.stringify(url)}`);
      }
      
      console.log('📞 Connecting to LiveKit:', { url, tokenLength: token.length, tokenPreview: token.substring(0, 20) + '...' });

      // Create room
      const room = new Room();
      roomRef.current = room;
      
      // Clear previous participants
      participantsRef.current.clear();
      remoteStreamsRef.current.clear();
      setParticipants([]);

      // Set up event handlers
      room.on(RoomEvent.Connected, () => {
        console.log('✅ LiveKit room connected');
        updateStatus('active');
      });

      room.on(RoomEvent.Disconnected, () => {
        console.log('📞 LiveKit room disconnected');
        updateStatus('ended');
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
        }
        if (remoteStreamRef.current) {
          remoteStreamRef.current.getTracks().forEach(track => track.stop());
          remoteStreamRef.current = null;
        }
        // Clean up all participant streams
        remoteStreamsRef.current.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
        remoteStreamsRef.current.clear();
        participantsRef.current.clear();
        setLocalStream(null);
        setRemoteStream(null);
        setParticipants([]);
      });

      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        console.log('📞 Participant connected:', participant.identity, participant.name);
        
        // Add participant to tracking
        const participantInfo: ParticipantInfo = {
          identity: participant.identity,
          name: participant.name,
          isSpeaking: false,
          isMuted: false,
        };
        participantsRef.current.set(participant.identity, participantInfo);
        updateParticipantsList();
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        console.log('📞 Participant disconnected:', participant.identity);
        
        // Remove participant from tracking
        participantsRef.current.delete(participant.identity);
        const participantStream = remoteStreamsRef.current.get(participant.identity);
        if (participantStream) {
          participantStream.getTracks().forEach(track => track.stop());
        }
        remoteStreamsRef.current.delete(participant.identity);
        updateParticipantsList();
        
        // Update aggregated remote stream
        updateAggregatedRemoteStream();
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: TrackPublication, participant: RemoteParticipant) => {
        console.log('📞 Track subscribed:', track.kind, participant.identity);
        
        if (track.kind === Track.Kind.Audio) {
          // Get or create stream for this participant
          let participantStream = remoteStreamsRef.current.get(participant.identity);
          if (!participantStream) {
            participantStream = new MediaStream();
            remoteStreamsRef.current.set(participant.identity, participantStream);
          }
          
          // Attach track to participant's stream
          if (track.mediaStreamTrack) {
            participantStream.addTrack(track.mediaStreamTrack);
            
            // Update participant info
            const participantInfo = participantsRef.current.get(participant.identity);
            if (participantInfo) {
              participantInfo.audioTrack = track.mediaStreamTrack;
              participantInfo.isMuted = !track.mediaStreamTrack.enabled;
              participantsRef.current.set(participant.identity, participantInfo);
            }
            
            // Update aggregated remote stream (combines all participants)
            updateAggregatedRemoteStream();
            if (onRemoteStream && remoteStreamRef.current) {
              onRemoteStream(remoteStreamRef.current);
            }
          }
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: TrackPublication, participant: RemoteParticipant) => {
        console.log('📞 Track unsubscribed:', track.kind, participant.identity);
        
        if (track.kind === Track.Kind.Audio) {
          // Remove track from participant's stream
          const participantStream = remoteStreamsRef.current.get(participant.identity);
          if (participantStream && track.mediaStreamTrack) {
            participantStream.removeTrack(track.mediaStreamTrack);
          }
          
          // Update participant info
          const participantInfo = participantsRef.current.get(participant.identity);
          if (participantInfo) {
            participantInfo.audioTrack = undefined;
            participantsRef.current.set(participant.identity, participantInfo);
          }
          
          // Update aggregated remote stream
          updateAggregatedRemoteStream();
        }
      });

      // Track speaking events (if available in LiveKit)
      room.on(RoomEvent.ParticipantMetadataChanged, (metadata: string | undefined, participant: RemoteParticipant) => {
        // Handle metadata changes if needed
      });

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      isMutedRef.current = false;
      setIsMuted(false);

      // Connect to room
      await room.connect(url, token);

      // Publish audio track
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        await room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.Microphone,
        });
        console.log('✅ Audio track published');
      }

    } catch (err: any) {
      console.error('❌ Error starting call:', err);
      setError(err.message || 'Failed to start call');
      updateStatus('error');
      
      // Cleanup on error
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
        setLocalStream(null);
      }
    }
    }, [updateStatus, onRemoteStream, updateAggregatedRemoteStream, updateParticipantsList]);

  // Answer call - same as start call for LiveKit
  const answerCall = useCallback(async (roomName: string, participantName?: string) => {
    await startCall(roomName, participantName);
  }, [startCall]);

  // End call
  const endCall = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop());
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
    
    // Clean up all participant streams
    remoteStreamsRef.current.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    remoteStreamsRef.current.clear();
    participantsRef.current.clear();
    setParticipants([]);
    
    updateStatus('ended');
  }, [updateStatus]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room || !localStreamRef.current) return;

    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;

    const track = audioTracks[0];
    const newMutedState = !isMutedRef.current;
    
    // Update track enabled state
    track.enabled = !newMutedState;
    
    // Update LiveKit track publication
    const publications = room.localParticipant.audioTrackPublications;
    publications.forEach((pub) => {
      if (pub.track) {
        pub.track.enabled = !newMutedState;
      }
    });

    isMutedRef.current = newMutedState;
    setIsMuted(newMutedState);
  }, []);

  // Legacy methods for compatibility (not used with LiveKit but required by interface)
  const createOffer = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    console.warn('createOffer not used with LiveKit');
    return null;
  }, []);

  const setAnswer = useCallback(async (answer: RTCSessionDescriptionInit): Promise<void> => {
    console.warn('setAnswer not used with LiveKit');
  }, []);

  const addICECandidate = useCallback(async (candidate: RTCIceCandidateInit): Promise<void> => {
    console.warn('addICECandidate not used with LiveKit');
  }, []);

  // Get peer connection (not used with LiveKit but required by interface)
  const getPeerConnection = useCallback((): RTCPeerConnection | null => {
    // LiveKit manages peer connections internally
    return null;
  }, []);

  // Calculate participant count (including local participant)
  const participantCount = participants.length + (callStatus === 'active' ? 1 : 0);

  return {
    localStream,
    remoteStream,
    callStatus,
    isMuted,
    isLocalAudioEnabled: !isMuted,
    error,
    participants,
    participantCount,
    startCall,
    answerCall,
    endCall,
    toggleMute,
    createOffer,
    setAnswer,
    addICECandidate,
    peerConnection: null,
    getPeerConnection,
    room: roomRef.current,
  };
}

