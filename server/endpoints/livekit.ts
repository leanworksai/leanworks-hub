/**
 * LiveKit Token Generation Endpoint
 * Generates access tokens for LiveKit rooms
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { AccessToken, RoomServiceClient, EgressClient, EgressInfo, StreamOutput, ParticipantEgressOptions } from 'livekit-server-sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Firestore } from 'firebase-admin/firestore';
// Note: Transcription functions are deprecated in async architecture
// Transcription sessions are now managed in PostgreSQL by the transcription worker
import { resample48kHzTo16kHz, cleanupResamplerForSession, clearAllResamplerState } from '../services/audio-processor.js';
import { recordChunk, cleanupParticipantBuffer, clearAllStreamingSessions } from '../services/audio-recorder.js';
import { audioLogger, logAudioChunk, logBackpressure } from '../utils/logger.js';
// Debug audio saving removed - production recordChunk() saves to GCS

// Cache for LiveKit credentials (from Secret Manager)
let cachedLiveKitCredentials: { apiKey: string; apiSecret: string } | null = null;
let liveKitCredentialsCacheTime: number = 0;
const LIVEKIT_CREDENTIALS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Lock sample rates per session to prevent detection inconsistencies
// Key: sessionKey (callId:participantEmail), Value: locked sample rate
const sessionSampleRates = new Map<string, number>();

// Track empty call timers to auto-end calls when no participants remain
// Key: roomName, Value: NodeJS.Timeout
const emptyCallTimers = new Map<string, NodeJS.Timeout>();

// Helper function to normalize byte order value from environment variable
// Only supports little-endian (or small-endian as alias)
// Big-endian support has been removed - LiveKit always sends little-endian
function normalizeByteOrder(value: string | undefined): 'little-endian' {
  if (!value) return 'little-endian';
  const normalized = value.toLowerCase().trim();
  // Support 'small-endian' as alias for 'little-endian' (small = little)
  if (normalized === 'small-endian' || normalized === 'little-endian') {
    return 'little-endian';
  }
  // Default to little-endian if unknown value
  console.warn(`⚠️ Unknown AUDIO_BYTE_ORDER value: "${value}", defaulting to 'little-endian'`);
  return 'little-endian';
}

// Get LiveKit credentials from Secret Manager (used for both dev and prod)
async function getLiveKitCredentials(
  secretManagerClient: SecretManagerServiceClient | null,
  projectId: string | null | undefined,
  isLocalDev: boolean = false
): Promise<{ apiKey: string; apiSecret: string }> {
  // For local development with local server, use dev credentials
  if (isLocalDev) {
    console.log('✅ Using local dev credentials for local LiveKit server');
    return { apiKey: 'devkey', apiSecret: 'devsecret' };
  }

  // Validate required parameters for production
  if (!secretManagerClient) {
    throw new Error('Secret Manager client is not available');
  }
  if (!projectId) {
    throw new Error('Project ID is not available');
  }

  // Return cached credentials if still valid
  if (cachedLiveKitCredentials && Date.now() - liveKitCredentialsCacheTime < LIVEKIT_CREDENTIALS_CACHE_TTL) {
    return cachedLiveKitCredentials;
  }

  try {
    // Fetch API Key from GCP Secret Manager (for production self-hosted server)
    const apiKeySecretName = `projects/${projectId}/secrets/livekit-api-key/versions/latest`;
    const [apiKeyVersion] = await secretManagerClient.accessSecretVersion({ name: apiKeySecretName });
    const apiKey = apiKeyVersion.payload?.data?.toString()?.trim() || '';

    // Fetch API Secret from GCP Secret Manager
    const apiSecretSecretName = `projects/${projectId}/secrets/livekit-api-secret/versions/latest`;
    const [apiSecretVersion] = await secretManagerClient.accessSecretVersion({ name: apiSecretSecretName });
    const apiSecret = apiSecretVersion.payload?.data?.toString()?.trim() || '';

    if (!apiKey || !apiSecret) {
      throw new Error('LiveKit credentials are incomplete');
    }

    cachedLiveKitCredentials = { apiKey, apiSecret };
    liveKitCredentialsCacheTime = Date.now();
    console.log('✅ LiveKit credentials fetched from Secret Manager (production)');
    return cachedLiveKitCredentials;
  } catch (error: any) {
    console.error('❌ Failed to fetch LiveKit credentials from Secret Manager:', error);
    throw new Error(`Failed to fetch LiveKit credentials: ${error.message}`);
  }
}

// Generate LiveKit access token
async function generateLiveKitToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  participantIdentity: string,
  participantName?: string,
  canPublish: boolean = true,
  canSubscribe: boolean = true
): Promise<string> {
  try {
    if (!apiKey || !apiSecret) {
      throw new Error('API key and secret are required');
    }
    if (!roomName) {
      throw new Error('Room name is required');
    }
    if (!participantIdentity) {
      throw new Error('Participant identity is required');
    }

    console.log('📞 Creating AccessToken:', { 
      apiKeyLength: apiKey.length, 
      apiSecretLength: apiSecret.length,
      roomName,
      participantIdentity,
      participantName 
    });

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName || participantIdentity,
    });

    const grant = {
      room: roomName,
      roomJoin: true,
      canPublish,
      canSubscribe,
    };

    at.addGrant(grant);

    const token = await at.toJwt();
    console.log('✅ Token generated:', { tokenLength: token.length });
    return token;
  } catch (error: any) {
    console.error('❌ Error in generateLiveKitToken:', error);
    console.error('   Error details:', {
      message: error.message,
      stack: error.stack,
      apiKeyLength: apiKey?.length,
      apiSecretLength: apiSecret?.length,
      roomName,
      participantIdentity
    });
    throw error;
  }
}

// Helper function to end a call internally (used by auto-end logic)
async function endCallInternal(
  db: Firestore,
  roomName: string,
  reason: 'auto_ended_empty' | 'auto_ended_initiator'
): Promise<void> {
  try {
    // Find the call document by roomName
    const callSnapshot = await db.collectionGroup('calls')
      .where('roomName', '==', roomName)
      .where('status', 'in', ['active', 'ringing'])
      .limit(1)
      .get();
    
    if (callSnapshot.empty) {
      console.log(`ℹ️ No active call found for room ${roomName}`);
      return;
    }
    
    const callDoc = callSnapshot.docs[0];
    const callData = callDoc.data();
    const callId = callDoc.id;
    
    console.log(`🔚 Auto-ending call ${callId} (reason: ${reason})`);
    
    // Update call status to ended
    await callDoc.ref.update({
      status: 'ended',
      endedAt: new Date(),
      endReason: reason,
    });
    
    // Import flushCallBuffers dynamically to avoid circular dependencies
    const { flushCallBuffers } = await import('../services/audio-recorder.js');
    
    // Flush audio buffers in background
    flushCallBuffers(callId).catch((flushError: any) => {
      console.warn('⚠️ Error flushing audio buffers:', flushError.message);
    });
    
    // Get participants for the call_ended event
    const participants: Array<{ email: string; name?: string }> = [];
    if (callData?.callerEmail) {
      participants.push({ email: callData.callerEmail });
    }
    if (callData?.calleeEmail && !callData.calleeEmail.startsWith('project-') && !callData.calleeEmail.startsWith('team-')) {
      participants.push({ email: callData.calleeEmail });
    }
    if (callData?.participantEmails && Array.isArray(callData.participantEmails)) {
      for (const email of callData.participantEmails) {
        if (!participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
          participants.push({ email });
        }
      }
    }
    
    // Extract orgSlug from path
    const pathParts = callDoc.ref.path.split('/');
    let orgSlug: string | undefined;
    if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
      orgSlug = pathParts[1];
    }
    
    // Publish call_ended event
    const { publishCallEvent } = await import('../services/pubsub-events.js');
    await publishCallEvent('call_ended', {
      callId,
      roomName: callData.roomName,
      participants,
      endReason: reason,
      ...(orgSlug && { orgSlug }),
    });
    
    console.log(`✅ Call ${callId} auto-ended successfully (reason: ${reason})`);
  } catch (error: any) {
    console.error(`❌ Error auto-ending call for room ${roomName}:`, error);
  }
}

export function setupLiveKitEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  db: Firestore,
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
) {
  // GET /api/livekit/token - Get LiveKit access token
  app.get('/api/livekit/token', authenticateUser, async (req, res) => {
    try {
      const userEmail = (req as any).userEmail;
      
      if (!userEmail) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { roomName, participantName, canPublish, canSubscribe } = req.query;

      if (!roomName || typeof roomName !== 'string') {
        return res.status(400).json({ error: 'roomName is required' });
      }

      // Get LiveKit URL from environment or use default
      // Local dev: ws://localhost:7880 (local server)
      // Production: self-hosted server URL from environment variable
      const livekitUrl = process.env.LIVEKIT_URL || 
                        (process.env.NODE_ENV === 'production' 
                          ? 'wss://livekit.leanworks.ai' 
                          : 'ws://localhost:7880');

      // Determine if we're using local dev server
      const isLocalDev = livekitUrl.includes('localhost') || livekitUrl.includes('127.0.0.1');

      // Get credentials based on environment
      // Local dev: use dev credentials for local server
      // Production: use GCP Secret Manager credentials for self-hosted server
      console.log('📞 Getting LiveKit credentials:', { isLocalDev, livekitUrl, projectId });
      let apiKey: string;
      let apiSecret: string;
      try {
        const credentials = await getLiveKitCredentials(secretManagerClient, projectId, isLocalDev);
        apiKey = credentials.apiKey;
        apiSecret = credentials.apiSecret;
        console.log('✅ Credentials obtained:', { apiKeyLength: apiKey.length, apiSecretLength: apiSecret.length });
      } catch (credError: any) {
        console.error('❌ Error getting credentials:', credError);
        throw new Error(`Failed to get LiveKit credentials: ${credError.message}`);
      }

      // Generate token with appropriate credentials
      let token: string;
      try {
        token = await generateLiveKitToken(
          apiKey,
          apiSecret,
          roomName,
          userEmail,
          typeof participantName === 'string' ? participantName : undefined,
          canPublish !== 'false',
          canSubscribe !== 'false'
        );
        console.log('✅ Token generated successfully');
      } catch (tokenError: any) {
        console.error('❌ Error generating token:', tokenError);
        throw new Error(`Failed to generate LiveKit token: ${tokenError.message}`);
      }

      // Validate token is a string
      if (typeof token !== 'string') {
        throw new Error(`Token generation failed: expected string, got ${typeof token}`);
      }

      console.log('📞 Generated LiveKit token:', { 
        url: livekitUrl, 
        tokenLength: token.length,
        roomName,
        participantIdentity: userEmail,
        environment: isLocalDev ? 'local-dev' : 'production'
      });

      res.json({
        token,
        url: livekitUrl,
      });
    } catch (error: any) {
      console.error('❌ Error generating LiveKit token:', error);
      console.error('   Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      // Return detailed error in development, generic in production
      const isDevelopment = process.env.NODE_ENV === 'development';
      const errorMessage = error.message || 'Unknown error';
      const errorStack = isDevelopment ? error.stack : undefined;
      
      if (error.message?.includes('LiveKit credentials')) {
        return res.status(503).json({ 
          error: 'LiveKit service not configured',
          message: 'Voice calls may not work. Please contact support.',
          ...(isDevelopment && { details: errorMessage, stack: errorStack }),
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to generate LiveKit token',
        message: isDevelopment ? errorMessage : 'Voice calls may not work. Please try again later.',
        ...(isDevelopment && { stack: errorStack }),
      });
    }
  });

  // GET /api/livekit/webhook/test - Test endpoint to verify webhook URL is accessible
  app.get('/api/livekit/webhook/test', (req, res) => {
    res.json({ 
      success: true, 
      message: 'Webhook endpoint is accessible',
      timestamp: new Date().toISOString()
    });
  });

  // POST /api/livekit/webhook - Handle LiveKit webhooks (egress, room events, etc.)
  // LiveKit sends webhooks with Content-Type: application/webhook+json
  // Best practice: Respond immediately, process asynchronously to prevent timeouts
  app.post('/api/livekit/webhook', express.json({ 
    limit: '10mb',
    type: ['application/json', 'application/webhook+json']
  }), async (req, res) => {
    const event = req.body;
    const eventType = event?.event || 'unknown';
    
    // Minimal logging before response
    console.log('📡 LiveKit webhook received:', eventType, { 
      room: event?.room?.name, 
      participant: event?.participant?.identity,
      track: event?.track?.sid
    });
    
    // Respond immediately to prevent timeouts (LiveKit expects response within 5-10 seconds)
    res.status(200).json({ received: true });
    
    // Process webhook asynchronously in background
    setImmediate(async () => {
      try {
        // Helper function to actually start the egress (extracted for reuse)
        const doStartEgress = async (
          roomName: string,
          participantIdentity: string,
          trackSid: string,
          callId: string,
          callData: any,
          orgSlug?: string
        ) => {
          // In async architecture, transcription is handled by the worker
          // We just need to start egress and the worker will process audio chunks
          
          // Get participant email from identity (identity is usually the email)
          const participantEmail = participantIdentity.toLowerCase();
          
          // Check if this participant is in the call
          const isParticipant = callData.participantEmails?.some(
            (email: string) => email.toLowerCase() === participantEmail
          ) || callData.callerEmail?.toLowerCase() === participantEmail || 
             callData.calleeEmail?.toLowerCase() === participantEmail;
          
          if (!isParticipant) {
            console.log('📝 Participant not in call:', participantEmail);
            return;
          }
          
          // Get LiveKit credentials
          const livekitUrl = process.env.LIVEKIT_URL || 
                            (process.env.NODE_ENV === 'production' 
                              ? 'wss://livekit.leanworks.ai' 
                              : 'ws://localhost:7880');
          const isLocalDev = livekitUrl.includes('localhost') || livekitUrl.includes('127.0.0.1');
          const credentials = await getLiveKitCredentials(secretManagerClient, projectId, isLocalDev);
          
          // Get base URL for WebSocket audio endpoint
          let baseUrl = process.env.API_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3001';
          if (isLocalDev && baseUrl.includes('localhost')) {
            baseUrl = baseUrl.replace('localhost', 'host.docker.internal');
          }
          const wsBaseUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
          // Include orgSlug in WebSocket URL if available
          const wsUrlParams = new URLSearchParams({
            callId,
            participantEmail,
            ...(orgSlug && { orgSlug })
          });
          const wsUrl = `${wsBaseUrl}/api/livekit/audio-ws?${wsUrlParams.toString()}`;
          
          // CRITICAL: Verify track before starting egress
          const httpUrl = livekitUrl.replace('ws://', 'http://').replace('wss://', 'https://');
          let trackVerified = false;
          let trackInfo: any = null;
          
          // Retry logic for track verification (race condition: track might not be immediately available)
          for (let retry = 0; retry < 3; retry++) {
            try {
              const roomService = new RoomServiceClient(httpUrl, credentials.apiKey, credentials.apiSecret);
              // Use listRooms and filter by name (getRoom may not be available in all SDK versions)
              const rooms = await roomService.listRooms([roomName]);
              const roomInfo = rooms && rooms.length > 0 ? rooms[0] : null;
              
              if (!roomInfo) {
                audioLogger.warn({
                  event: 'track_verification_room_not_found',
                  roomName,
                  participantEmail,
                  trackSid,
                  retry,
                }, `Room ${roomName} not found (retry ${retry + 1}/3)`);
                if (retry < 2) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  continue;
                }
                break;
              }
              
              // Find the participant and track
              // Note: Room type may vary by SDK version, use type assertion for compatibility
              const roomInfoAny = roomInfo as any;
              
              // Log room structure for debugging (only on first retry)
              if (retry === 0) {
                audioLogger.debug({
                  event: 'room_info_structure',
                  roomName,
                  roomInfoKeys: Object.keys(roomInfoAny || {}),
                  hasParticipants: 'participants' in roomInfoAny,
                  participantsType: typeof roomInfoAny?.participants,
                  participantsIsArray: Array.isArray(roomInfoAny?.participants),
                  participantsLength: Array.isArray(roomInfoAny?.participants) ? roomInfoAny.participants.length : 
                                    (roomInfoAny?.participants ? Object.keys(roomInfoAny.participants).length : 0),
                }, `Room info structure for debugging`);
              }
              
              // Try different ways to access participants (handle different SDK versions)
              let participants: any[] = [];
              if (Array.isArray(roomInfoAny?.participants)) {
                participants = roomInfoAny.participants;
              } else if (roomInfoAny?.participants && typeof roomInfoAny.participants === 'object') {
                // Might be a Map or object with participant identities as keys
                if (roomInfoAny.participants instanceof Map) {
                  participants = Array.from(roomInfoAny.participants.values());
                } else {
                  participants = Object.values(roomInfoAny.participants);
                }
              }
              
              // Log available participants for debugging
              if (retry === 0 && participants.length > 0) {
                audioLogger.debug({
                  event: 'room_participants_list',
                  roomName,
                  participantCount: participants.length,
                  participantIdentities: participants.map((p: any) => ({
                    identity: p.identity || p.name || 'unknown',
                    sid: p.sid,
                    state: p.state,
                    tracksCount: p.tracks?.length || 0,
                  })),
                  lookingFor: participantIdentity,
                }, `Available participants in room`);
              }
              
              const participant = participants.find(
                (p: any) => {
                  const pIdentity = p.identity || p.name || '';
                  return pIdentity === participantIdentity || 
                         pIdentity.toLowerCase() === participantIdentity.toLowerCase();
                }
              );
              
              if (!participant) {
                audioLogger.warn({
                  event: 'track_verification_participant_not_found',
                  roomName,
                  participantIdentity,
                  trackSid,
                  retry,
                  participantsFound: participants.length,
                  participantIdentities: participants.map((p: any) => p.identity || p.name || 'unknown'),
                }, `Participant ${participantIdentity} not found in room (retry ${retry + 1}/3, found ${participants.length} participants)`);
                if (retry < 2) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  continue;
                }
                break;
              }
              
              const track = participant.tracks?.find((t: any) => t.sid === trackSid);
              
              if (!track) {
                audioLogger.warn({
                  event: 'track_verification_track_not_found',
                  roomName,
                  participantIdentity,
                  trackSid,
                  retry,
                  availableTracks: participant.tracks?.map((t: any) => ({
                    sid: t.sid,
                    kind: t.kind,
                    source: t.source,
                    mimeType: t.mimeType,
                  })),
                }, `Track ${trackSid} not found for participant (retry ${retry + 1}/3)`);
                if (retry < 2) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  continue;
                }
                break;
              }
              
              trackInfo = track;
              
              // Verify track properties
              const isAudio = track.kind === 'audio' || track.mimeType?.startsWith('audio/') || track.source === 'MICROPHONE';
              const isMuted = track.muted === true;
              
              audioLogger.info({
                event: 'track_verification',
                participantIdentity,
                roomName,
                trackSid: track.sid,
                kind: track.kind,
                source: track.source,
                mimeType: track.mimeType,
                muted: track.muted,
                name: track.name,
                isAudio,
                isMuted,
              }, `Track verification for egress`);
              
              if (!isAudio) {
                audioLogger.error({
                  event: 'non_audio_track_egress',
                  participantIdentity,
                  roomName,
                  trackSid: track.sid,
                  kind: track.kind,
                  source: track.source,
                  mimeType: track.mimeType,
                  message: 'Track is not an audio track! Egress will fail!',
                }, `CRITICAL: Track ${trackSid} is not an audio track (kind: ${track.kind}, source: ${track.source})!`);
                return; // Don't start egress for non-audio tracks
              }
              
              if (isMuted) {
                audioLogger.error({
                  event: 'muted_track_egress',
                  participantIdentity,
                  roomName,
                  trackSid: track.sid,
                  message: 'Track is MUTED! Egress will capture silence!',
                }, `CRITICAL: Track ${trackSid} is MUTED! Egress will capture silence!`);
                return; // Don't start egress for muted track
              }
              
              // Check for multiple audio tracks (might indicate wrong track selected)
              const audioTracks = participant.tracks?.filter((t: any) => 
                t.kind === 'audio' || t.mimeType?.startsWith('audio/') || t.source === 'MICROPHONE'
              ) || [];
              
              if (audioTracks.length > 1) {
                audioLogger.warn({
                  event: 'multiple_audio_tracks',
                  participantIdentity,
                  roomName,
                  trackSid: track.sid,
                  totalAudioTracks: audioTracks.length,
                  tracks: audioTracks.map((t: any) => ({
                    sid: t.sid,
                    source: t.source,
                    muted: t.muted,
                    name: t.name,
                  })),
                  message: 'Multiple audio tracks found - ensure correct track is selected',
                }, `WARNING: Participant has ${audioTracks.length} audio tracks - ensure correct track selected`);
              }
              
              trackVerified = true;
              break; // Success, exit retry loop
            } catch (verifyError: any) {
              audioLogger.warn({
                event: 'track_verification_failed',
                participantIdentity,
                roomName,
                trackSid,
                retry,
                error: verifyError.message,
              }, `Could not verify track before egress (retry ${retry + 1}/3): ${verifyError.message}`);
              
              if (retry < 2) {
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          }
          
          if (!trackVerified) {
            // If room was found but participant wasn't, this might be a timing issue
            // (e.g., host-only room where participant isn't in list yet)
            // Check if room exists - if it does, proceed with warning (track was published, so it should be valid)
            let roomExists = false;
            try {
              const roomService = new RoomServiceClient(httpUrl, credentials.apiKey, credentials.apiSecret);
              const rooms = await roomService.listRooms([roomName]);
              roomExists = rooms && rooms.length > 0;
            } catch (e) {
              // Ignore errors checking room
            }
            
            if (roomExists) {
              // Room exists but participant not found - likely timing issue with host-only rooms
              // Proceed with egress but log strong warning
              audioLogger.warn({
                event: 'track_verification_partial',
                participantIdentity,
                roomName,
                trackSid,
                message: 'Room found but participant not in list - proceeding with egress (may be timing issue with host-only room)',
              }, `WARNING: Could not verify participant ${participantIdentity} in room ${roomName}, but room exists. Proceeding with egress (track ${trackSid} was published, so it should be valid).`);
              // Continue to start egress
            } else {
              // Room doesn't exist - definitely skip
              audioLogger.error({
                event: 'track_verification_failed_final',
                participantIdentity,
                roomName,
                trackSid,
                message: 'Track verification failed after 3 retries - room not found - skipping egress',
              }, `CRITICAL: Could not verify track ${trackSid} after 3 retries - room not found - skipping egress to prevent silence capture`);
              return;
            }
          }
          
          // Create EgressClient
          console.log(`🔧 Creating EgressClient with URL: ${httpUrl}`);
          const egressClient = new EgressClient(httpUrl, credentials.apiKey, credentials.apiSecret);
          
          try {
            console.log(`📹 Starting egress for participant ${participantEmail} in call ${callId}`);
            console.log(`   Room: ${roomName}, Track: ${trackSid}`);
            console.log(`   Track verified: kind=${trackInfo?.kind}, source=${trackInfo?.source}, muted=${trackInfo?.muted}`);
            console.log(`   WebSocket URL: ${wsUrl}`);
            
            const info = await egressClient.startTrackEgress(roomName, wsUrl, trackSid);
            console.log(`✅ Egress started successfully:`, info.egressId);
          } catch (egressError: any) {
            const errorMessage = egressError.message || String(egressError);
            const isEgressUnavailable = errorMessage.includes('no response from servers') || 
                                       errorMessage.includes('unavailable') ||
                                       egressError.code === 'unavailable';
            
            if (isEgressUnavailable && isLocalDev) {
              console.warn('⚠️ LiveKit egress service not available in local development.');
              console.warn('   Egress is a separate service that needs to be run alongside LiveKit server.');
            } else {
              console.error('❌ Error starting egress:', {
                message: egressError.message,
                code: egressError.code,
                httpUrl,
                roomName,
                trackSid,
              });
            }
          }
        };

        // Helper function to start egress for a participant's audio track
        const startEgressForParticipant = async (roomName: string, participantIdentity: string, trackSid: string) => {
          console.log('🔍 startEgressForParticipant called:', { roomName, participantIdentity, trackSid });
          
          if (!db) {
            console.warn('⚠️ Firestore not available, cannot look up call info');
            return;
          }

          try {
            // Look up call document by roomName using collection group query
            // This searches across all orgs/calls collections
            // Accept both 'ringing' and 'active' statuses (call might still be ringing when track is published)
            let snapshot;
            try {
              // Try query with orderBy first (requires composite index: roomName + createdAt)
              let callsQuery = db.collectionGroup('calls')
                .where('roomName', '==', roomName);
              
              try {
                // Try to use orderBy if composite index exists
                callsQuery = callsQuery.orderBy('createdAt', 'desc').limit(20);
                snapshot = await callsQuery.get();
              } catch (orderByError: any) {
                // If orderBy fails (no composite index), query without orderBy and sort in memory
                console.log('⚠️ Composite index (roomName + createdAt) not available, sorting in memory');
                callsQuery = callsQuery.limit(50); // Get more documents to ensure we find the current call
                snapshot = await callsQuery.get();
                
                // Sort in memory by createdAt descending
                if (snapshot.docs.length > 0) {
                  const docsArray = Array.from(snapshot.docs);
                  const sorted = docsArray.sort((a: any, b: any) => {
                    const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.toDate?.()?.getTime() || a.data().createdAt?.getTime?.() || 0;
                    const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.toDate?.()?.getTime() || b.data().createdAt?.getTime?.() || 0;
                    return bTime - aTime; // Most recent first
                  });
                  snapshot = { docs: sorted, empty: sorted.length === 0 } as any;
                }
              }
            } catch (queryError: any) {
              // Handle missing index error (code 9 = FAILED_PRECONDITION)
              if (queryError.code === 9 || queryError.code === 'FAILED_PRECONDITION') {
                console.error('❌ Firestore index missing for collectionGroup("calls").where("roomName")');
                console.error('');
                console.error('   To fix this, you have two options:');
                console.error('');
                console.error('   1. Deploy indexes (if fieldOverrides is configured):');
                console.error('      firebase deploy --only firestore:indexes');
                console.error('');
                console.error('   2. Create index manually in Firebase Console:');
                console.error('      https://console.firebase.google.com/project/leanworks-474204/firestore/indexes');
                console.error('');
                console.error('      Steps:');
                console.error('      - Click "Add Index"');
                console.error('      - Collection ID: calls');
                console.error('      - Query scope: Collection group');
                console.error('      - Fields: roomName (Ascending)');
                console.error('      - Click "Create"');
                console.error('');
                console.error('   Index needed: collectionGroup "calls" with field "roomName" (ASCENDING)');
                // Don't throw - allow the retry mechanism to work
                return;
              }
              throw queryError;
            }
            
            let callData: any = null;
            let callId: string | null = null;
            
            // Log all found documents for debugging
            if (snapshot.docs.length > 0) {
              console.log(`📝 Found ${snapshot.docs.length} call document(s) for roomName: ${roomName}`);
              snapshot.docs.forEach((doc, idx) => {
                const data = doc.data();
                console.log(`   [${idx + 1}] Call ID: ${doc.id}, Status: ${data.status}, RoomName: ${data.roomName}, Path: ${doc.ref.path}`);
              });
            }
            
            let callDocRef: any = null; // Store document reference to extract orgSlug
            let orgSlug: string | undefined;
            
            // Try to find a call with 'ringing' or 'active' status
            if (!callId) {
              for (const doc of snapshot.docs) {
                const data = doc.data();
                if (data.status === 'active' || data.status === 'ringing') {
                  callData = data;
                  callId = doc.id;
                  callDocRef = doc.ref;
                  // Extract orgSlug from document path: orgs/{orgSlug}/calls/{callId}
                  const pathParts = doc.ref.path.split('/');
                  if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
                    orgSlug = pathParts[1];
                    console.log(`✅ Found matching call: ${callId} with status: ${data.status}, orgSlug: ${orgSlug}`);
                  }
                  break;
                }
              }
            }
            
            // If still no call found, use the most recent call document (even if status is not active)
            // This handles cases where the call document exists but status hasn't been updated yet
            // We sort by createdAt descending to get the most recent one
            if (!callId && snapshot.docs.length > 0) {
              const sortedDocs = snapshot.docs.sort((a, b) => {
                const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.getTime?.() || 0;
                const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.getTime?.() || 0;
                return bTime - aTime; // Most recent first
              });
              const mostRecentDoc = sortedDocs[0];
              const mostRecentData = mostRecentDoc.data();
              // Only use if status is not 'ended' (to avoid using old calls)
              if (mostRecentData.status !== 'ended') {
                callData = mostRecentData;
                callId = mostRecentDoc.id;
                callDocRef = mostRecentDoc.ref;
                // Extract orgSlug from document path
                const pathParts = mostRecentDoc.ref.path.split('/');
                if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
                  orgSlug = pathParts[1];
                }
                console.log(`✅ Using most recent call document: ${callId} with status: ${mostRecentData.status}, orgSlug: ${orgSlug}`);
              }
            }
            
            // If still no call found, wait for transcription to start or retry
            // This prevents using old ended calls which would cause transcription mismatch
            
            if (!callId || !callData) {
              console.log('📝 No call found for room:', roomName, '- will retry in 2 seconds...');
              console.log(`   Query returned ${snapshot.docs.length} document(s), but none with status 'ringing' or 'active'`);
              // Retry after a delay - the call document might not be created yet, or transcription might start
              setTimeout(async () => {
                try {
                  console.log('🔄 Retrying call lookup for room:', roomName);
                  
                  // Try Firestore query again with orderBy
                  let retryQuery = db.collectionGroup('calls')
                    .where('roomName', '==', roomName);
                  
                  try {
                    retryQuery = retryQuery.orderBy('createdAt', 'desc').limit(20);
                  } catch (orderByError: any) {
                    retryQuery = retryQuery.limit(50); // Get more if orderBy not available
                  }
                  
                  let retrySnapshot = await retryQuery.get();
                  
                  // Sort in memory if needed
                  if (retrySnapshot.docs.length > 0) {
                    const docsArray = Array.from(retrySnapshot.docs);
                    const sorted = docsArray.sort((a: any, b: any) => {
                      const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.toDate?.()?.getTime() || a.data().createdAt?.getTime?.() || 0;
                      const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.toDate?.()?.getTime() || b.data().createdAt?.getTime?.() || 0;
                      return bTime - aTime; // Most recent first
                    });
                    retrySnapshot = { docs: sorted, empty: sorted.length === 0 } as any;
                  }
                  console.log(`   Retry found ${retrySnapshot.docs.length} document(s) in Firestore`);
                  
                  // First try to find active/ringing call
                  let foundCall = false;
                  for (const doc of retrySnapshot.docs) {
                    const data = doc.data();
                    console.log(`   Checking: ${doc.id}, Status: ${data.status}, RoomName: ${data.roomName}`);
                    if (data.status === 'active' || data.status === 'ringing') {
                      console.log('✅ Call found on retry:', doc.id, 'status:', data.status);
                      foundCall = true;
                      // Recursively call this function with the found call
                      await startEgressForParticipant(roomName, participantIdentity, trackSid);
                      return;
                    }
                  }
                  
                  // If no active/ringing call found, use the most recent call document as fallback
                  if (!foundCall && retrySnapshot.docs.length > 0) {
                    const sortedDocs = retrySnapshot.docs.sort((a, b) => {
                      const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.getTime?.() || 0;
                      const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.getTime?.() || 0;
                      return bTime - aTime; // Most recent first
                    });
                    const mostRecentDoc = sortedDocs[0];
                    const mostRecentData = mostRecentDoc.data();
                    if (mostRecentData.status !== 'ended') {
                      console.log(`   ✅ Using most recent call document on retry: ${mostRecentDoc.id} with status: ${mostRecentData.status}`);
                      callData = mostRecentData;
                      callId = mostRecentDoc.id;
                      foundCall = true;
                    }
                  }
                  
                  if (!foundCall) {
                    console.log('   ⚠️ No suitable call found - egress will not start');
                    console.log('   This usually means the call document has not been created yet or transcription has not started');
                    return;
                  }
                  
                  // Recursively call this function with the found call
                  await startEgressForParticipant(roomName, participantIdentity, trackSid);
                  return;
                  
                  console.log('📝 Call still not found after retry for room:', roomName);
                  console.log('   This might mean:');
                  console.log('   1. Call document was not created yet');
                  console.log('   2. Call document has a different roomName format');
                  console.log('   3. Call document is in a different org path');
                  console.log('   4. Transcription session hasn\'t started yet');
                } catch (retryError: any) {
                  if (retryError.code === 9 || retryError.code === 'FAILED_PRECONDITION') {
                    console.error('❌ Firestore index still missing on retry. Please deploy indexes.');
                  } else {
                    console.error('❌ Error in retry query:', retryError);
                  }
                }
              }, 2000);
              return;
            }
            
            // Use the helper function to start egress (pass orgSlug if we found it)
            await doStartEgress(roomName, participantIdentity, trackSid, callId, callData, orgSlug);
          } catch (error: any) {
            console.error('❌ Error in startEgressForParticipant:', error);
          }
        };
        
        // Handle different webhook event types
        if (eventType === 'egress_started' || eventType === 'egress_updated') {
          console.log('📹 LiveKit egress event:', eventType, event.egressInfo);
        } else if (eventType === 'room_started') {
          console.log('📞 LiveKit room started:', event.room?.name);
        } else if (eventType === 'participant_joined') {
          console.log('👤 Participant joined:', event.participant?.identity, 'in room:', event.room?.name);
          
          // Cancel empty call timer if someone joins
          const roomName = event.room?.name;
          if (roomName && emptyCallTimers.has(roomName)) {
            const timer = emptyCallTimers.get(roomName);
            if (timer) {
              clearTimeout(timer);
              emptyCallTimers.delete(roomName);
              console.log(`⏱️ Cancelled empty call timer for room ${roomName} (participant rejoined)`);
            }
          }
        } else if (eventType === 'participant_left') {
          console.log('👋 Participant left:', event.participant?.identity, 'from room:', event.room?.name, 'reason:', event.participant?.disconnectReason);
          
          // Check if room is now empty and start timer if needed
          const roomName = event.room?.name;
          if (roomName) {
            // Query LiveKit to get current participant count
            try {
              const livekitUrl = process.env.LIVEKIT_URL || 
                                (process.env.NODE_ENV === 'production' 
                                  ? 'wss://livekit.leanworks.ai' 
                                  : 'ws://localhost:7880');
              const isLocalDev = livekitUrl.includes('localhost') || livekitUrl.includes('127.0.0.1');
              const credentials = await getLiveKitCredentials(secretManagerClient, projectId, isLocalDev);
              const httpUrl = livekitUrl.replace('ws://', 'http://').replace('wss://', 'https://');
              const roomService = new RoomServiceClient(httpUrl, credentials.apiKey, credentials.apiSecret);
              
              // List participants in the room
              const participants = await roomService.listParticipants(roomName);
              const participantCount = participants.length;
              
              console.log(`📊 Room ${roomName} now has ${participantCount} participant(s)`);
              
              // If room is empty, start 1-minute timer to auto-end call
              if (participantCount === 0) {
                // Cancel any existing timer for this room
                if (emptyCallTimers.has(roomName)) {
                  const existingTimer = emptyCallTimers.get(roomName);
                  if (existingTimer) {
                    clearTimeout(existingTimer);
                  }
                }
                
                // Start new 1-minute (60 second) timer
                console.log(`⏱️ Starting 60-second empty call timer for room ${roomName}`);
                const timer = setTimeout(async () => {
                  console.log(`⏰ Empty call timer expired for room ${roomName}, ending call...`);
                  emptyCallTimers.delete(roomName);
                  await endCallInternal(db, roomName, 'auto_ended_empty');
                }, 60000); // 60 seconds = 1 minute
                
                emptyCallTimers.set(roomName, timer);
              }
            } catch (error: any) {
              console.error('❌ Error checking participant count:', error);
            }
          }
        } else if (eventType === 'participant_connection_aborted') {
          console.log('⚠️ Participant connection aborted:', event.participant?.identity, 'from room:', event.room?.name, 'reason:', event.participant?.disconnectReason);
          // Connection aborted - similar to participant_left but indicates abnormal disconnection
          // No special action needed, egress will stop automatically
        } else if (eventType === 'track_published') {
          console.log('🎵 track_published webhook received:', {
            roomName: event.room?.name,
            participantIdentity: event.participant?.identity,
            trackSid: event.track?.sid,
            trackType: event.track?.type,
            trackName: event.track?.name
          });
          const track = event.track;
          const roomName = event.room?.name;
          const participantIdentity = event.participant?.identity;
          const trackSid = track?.sid;
          
          // Check if it's an audio track - LiveKit webhooks use mimeType or source
          const isAudio = track?.mimeType?.startsWith('audio/') || 
                         track?.source === 'MICROPHONE' ||
                         track?.kind === 'audio';
          
          console.log('🎵 Track published:', { 
            kind: track?.kind,
            mimeType: track?.mimeType,
            source: track?.source,
            isAudio,
            participant: participantIdentity,
            room: roomName,
            trackSid
          });
          
          // Start egress for audio tracks when transcription is active and recording is enabled
          if (isAudio && roomName && participantIdentity && trackSid) {
            // First, try to auto-start transcription if not already started and recording is enabled
            try {
              const callSnapshot = await db.collectionGroup('calls')
                .where('roomName', '==', roomName)
                .where('status', 'in', ['active', 'ringing'])
                .limit(1)
                .get();
              
              if (!callSnapshot.empty) {
                const callDoc = callSnapshot.docs[0];
                const callData = callDoc.data();
                const callId = callDoc.id;
                
                // Check if recording is enabled for this call
                if (callData?.enableRecording !== true) {
                  console.log(`📝 Recording disabled for call ${callId}, skipping transcription`);
                  return;
                }
                
                // Extract orgSlug from path: orgs/{orgSlug}/calls/{callId}
                const pathParts = callDoc.ref.path.split('/');
                if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
                  const orgSlug = pathParts[1];
                  
                  console.log(`📝 Using orgSlug ${orgSlug} for transcription`);
                  
                  // Check if transcription is enabled but not started
                  if (callData.transcriptionEnabled && !callData.transcriptionStarted) {
                    const participants: Array<{ email: string; name?: string }> = [];
                    if (callData.callerEmail) {
                      participants.push({ email: callData.callerEmail });
                    }
                    if (callData.calleeEmail && !callData.calleeEmail.startsWith('project-') && !callData.calleeEmail.startsWith('team-')) {
                      participants.push({ email: callData.calleeEmail });
                    }
                    if (callData?.participantEmails && Array.isArray(callData.participantEmails)) {
                      for (const email of callData.participantEmails) {
                        if (!participants.find(p => p.email.toLowerCase() === email.toLowerCase())) {
                          participants.push({ email });
                        }
                      }
                    }
                    
                    if (participants.length > 0) {
                      const { publishCallEvent } = await import('../services/pubsub-events.js');
                      await publishCallEvent('transcription_started', {
                        callId,
                        roomName,
                        participants,
                        orgSlug, // Use orgSlug instead of orgId
                      });
                      console.log(`✅ Auto-started transcription for call ${callId} via track_published webhook (orgSlug: ${orgSlug})`);
                      
                      // Mark transcription as started in Firestore
                      await callDoc.ref.update({ transcriptionStarted: true });
                    }
                  }
                }
              }
            } catch (autoStartError: any) {
              console.warn('⚠️ Could not auto-start transcription:', autoStartError.message);
              // Continue to start egress anyway
            }
            
            console.log('🎵 Starting egress for audio track...');
            await startEgressForParticipant(roomName, participantIdentity, trackSid);
          } else {
            console.log('🎵 Skipping egress - conditions not met:', {
              isAudio,
              hasRoomName: !!roomName,
              hasParticipant: !!participantIdentity,
              hasTrackSid: !!trackSid
            });
          }
        } else if (eventType === 'track_unpublished') {
          console.log('🎵 track_unpublished webhook received:', {
            roomName: event.room?.name,
            participantIdentity: event.participant?.identity,
            trackSid: event.track?.sid
          });
          // Track unpublished - no action needed, egress will stop automatically
        } else if (eventType === 'egress_ended') {
          console.log('📹 LiveKit egress ended:', event.egressInfo);
        } else {
          console.log('📡 Unhandled webhook event type:', eventType);
        }
      } catch (error: any) {
        console.error('❌ Error processing LiveKit webhook (background):', error);
        // Errors in background processing don't affect webhook response
      }
    });
  });

  // POST /api/livekit/audio - Receive audio chunks from LiveKit egress
  // This endpoint receives audio data from LiveKit egress service
  app.post('/api/livekit/audio', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    try {
      const { callId, participantEmail } = req.query;
      
      if (!callId || !participantEmail) {
        return res.status(400).json({ error: 'callId and participantEmail are required' });
      }

      if (!req.body || req.body.length === 0) {
        return res.status(400).json({ error: 'Audio data is required' });
      }

      // Look up orgSlug from call document
      let orgSlug: string | undefined;
      try {
        if (db) {
          const callsQuery = db.collectionGroup('calls');
          const snapshot = await callsQuery.get();
          
          // Find document with matching ID
          for (const doc of snapshot.docs) {
            if (doc.id === callId) {
              const pathParts = doc.ref.path.split('/');
              if (pathParts.length >= 2 && pathParts[0] === 'orgs') {
                orgSlug = pathParts[1];
                break;
              }
            }
          }
        }
      } catch (error: any) {
        console.warn(`⚠️ Could not look up orgSlug for call ${callId}:`, error.message);
      }

      // Process audio chunk - resample and record
      // NOTE: This endpoint is deprecated in favor of WebSocket, but keeping for backward compatibility
      const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
      // Create session key for per-session resampling
      const sessionKey = `${callId}:${participantEmail}`;
      // Resample from 48kHz to 16kHz for AssemblyAI compatibility
      const resampledAudio = await resample48kHzTo16kHz(audioBuffer, sessionKey);
      // Pass explicit sample rate: 16kHz after resampling
      await recordChunk(callId as string, participantEmail as string, resampledAudio, orgSlug, 16000);

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('❌ Error processing audio chunk:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/livekit/start-transcription - Start transcription for a call
  app.post('/api/livekit/start-transcription', authenticateUser, async (req, res) => {
    try {
      const { callId, roomName, participants } = req.body;

      if (!callId || !roomName || !participants || !Array.isArray(participants)) {
        return res.status(400).json({ error: 'callId, roomName, and participants array are required' });
      }

      // Transcription is now handled asynchronously by the worker
      // This endpoint is kept for backward compatibility but does nothing
      console.log('⚠️ Direct transcription start is deprecated. Use /api/calls/:chatId/start-transcription instead.');
      
      res.json({ success: true, message: 'Transcription started' });
    } catch (error: any) {
      console.error('❌ Error starting transcription:', error);
      res.status(500).json({ error: error.message });
    }
  });

  console.log('✅ LiveKit endpoints registered');
}

/**
 * Set up WebSocket server for receiving audio streams from LiveKit egress
 * This should be called after the HTTP server is created
 */
export function setupLiveKitWebSocketServer(server: any): void {
  // CRITICAL: Clear all module-level state on server startup/restart
  // This ensures queues and state don't persist across server restarts
  const sessionSampleRatesSize = sessionSampleRates.size;
  sessionSampleRates.clear();
  clearAllResamplerState();
  clearAllStreamingSessions();
  
  // Clear empty call timers
  const emptyCallTimersSize = emptyCallTimers.size;
  emptyCallTimers.forEach((timer) => clearTimeout(timer));
  emptyCallTimers.clear();
  
  console.log('🧹 Cleared all module-level state on server startup', {
    sessionSampleRatesSize,
    emptyCallTimersSize,
  });
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1046',message:'Server startup - clearing all module-level state',data:{sessionSampleRatesSize},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  const wss = new WebSocketServer({ 
    noServer: true  // Don't auto-upgrade, handle manually
  });

  // Handle upgrade requests manually to ensure proper path matching
  server.on('upgrade', (request: any, socket: any, head: Buffer) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    
    // Only handle WebSocket upgrades for the audio-ws path
    if (url.pathname === '/api/livekit/audio-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Not our WebSocket endpoint, destroy the socket
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const callId = url.searchParams.get('callId');
    const participantEmail = url.searchParams.get('participantEmail');
    const orgSlug = url.searchParams.get('orgSlug') || undefined; // Get orgSlug from URL parameter

    if (!callId || !participantEmail) {
      audioLogger.error({
        event: 'websocket_missing_params',
        callId: callId || null,
        participantEmail: participantEmail || null,
      }, 'WebSocket connection missing callId or participantEmail');
      ws.close(1008, 'Missing callId or participantEmail');
      return;
    }
    
    // TypeScript: callId and participantEmail are now guaranteed to be non-null
    const validCallId: string = callId;
    const validParticipantEmail: string = participantEmail;
    
    if (!orgSlug) {
      audioLogger.warn({
        event: 'websocket_missing_orgslug',
        callId: validCallId,
        participantEmail: validParticipantEmail,
      }, `WebSocket connection missing orgSlug for call ${validCallId}. Audio files may be saved to wrong location.`);
    } else {
      audioLogger.info({
        event: 'websocket_connected',
        callId: validCallId,
        participantEmail: validParticipantEmail,
        orgSlug,
      }, `WebSocket connection received orgSlug ${orgSlug} for call ${validCallId}`);
    }

    audioLogger.info({
      event: 'websocket_opened',
      callId: validCallId,
      participantEmail: validParticipantEmail,
      orgSlug: orgSlug || '(not provided)',
      remoteAddress: req.socket.remoteAddress,
      url: req.url,
    }, `WebSocket connection opened for transcription`);

    let audioChunkCount = 0;
    let verificationLogCount = 0; // Counter for verification logging (log every 100 chunks)
    let lastLogTime = Date.now();
    
    // Track pending chunks for backpressure detection
    const pendingChunks = new Map<string, number>();
    const sessionKey = `${validCallId}:${validParticipantEmail}`;
    
    // Track silence detection metrics
    let consecutiveSilenceChunks = 0;
    let totalSilenceChunks = 0;
    let totalChunksWithAudio = 0;
    const silenceHistory: Array<{ chunkNumber: number; isSilence: boolean; maxAmplitude: number }> = [];
    const MAX_SILENCE_HISTORY = 100; // Keep last 100 chunks for analysis
    
    // Multi-layered backpressure management
    interface BackpressureState {
      isPaused: boolean;
      circuitBreakerState: 'closed' | 'open' | 'half-open';
      circuitBreakerFailures: number;
      circuitBreakerLastFailure: number;
      lastPauseTime: number;
      lastResumeTime: number;
      droppedChunks: number;
      rateLimitDelay: number; // Adaptive rate limiting delay in ms
    }
    
    const backpressureState: BackpressureState = {
      isPaused: false,
      circuitBreakerState: 'closed',
      circuitBreakerFailures: 0,
      circuitBreakerLastFailure: 0,
      lastPauseTime: 0,
      lastResumeTime: Date.now(),
      droppedChunks: 0,
      rateLimitDelay: 0,
    };
    
    // Dead Letter Queue for dropped chunks
    interface DroppedChunk {
      chunkNumber: number;
      chunkData: Buffer;
      timestamp: number;
      reason: string;
      queueDepth: number;
      pending: number;
    }
    const deadLetterQueue: DroppedChunk[] = [];
    const MAX_DEAD_LETTER_QUEUE = 1000; // Max chunks to store in DLQ
    
    // Circuit breaker thresholds
    const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10; // Open after 10 consecutive failures
    const CIRCUIT_BREAKER_RESET_TIMEOUT = 30000; // 30 seconds before trying half-open
    const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 3; // Need 3 successes to close from half-open
    
    // Backpressure thresholds
    const BACKPRESSURE_PAUSE_THRESHOLD = 50; // Pause WebSocket at 50 chunks
    const BACKPRESSURE_RESUME_THRESHOLD = 20; // Resume when queue drops to 20
    const BACKPRESSURE_DROP_THRESHOLD = 100; // Drop chunks at 100 chunks
    const BACKPRESSURE_WARNING_THRESHOLD = 30; // Warn at 30 chunks
    
    // CRITICAL: Chunk ordering queue - async pipeline (parallel processing, sequential writes)
    interface QueuedChunk {
      chunkNumber: number;
      chunkData: Buffer;
      orgSlug: string | undefined;
      processingPromise: Promise<{ audio: Buffer; sampleRate: number }>; // Processing happens immediately in parallel, returns audio + detected rate
      resolve: () => void;
      reject: (error: Error) => void;
    }
    
    const chunkQueue = new Map<string, {
      queue: QueuedChunk[];
      processing: boolean;
      nextExpectedChunk: number;
    }>();
    
    if (!chunkQueue.has(sessionKey)) {
      chunkQueue.set(sessionKey, {
        queue: [],
        processing: false,
        nextExpectedChunk: 1,
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1209',message:'Created new chunk queue for session',data:{sessionKey,queueSize:0,nextExpectedChunk:1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      const existingQueue = chunkQueue.get(sessionKey);
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1215',message:'Reusing existing chunk queue (should not happen on new connection)',data:{sessionKey,queueSize:existingQueue?.queue.length||0,nextExpectedChunk:existingQueue?.nextExpectedChunk||0,processing:existingQueue?.processing||false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    }
    
    /**
     * Process write queue in order (ensures sequential writes)
     * Processing happens in parallel, but writes are sequential
     * Also handles backpressure state updates (resume WebSocket, update circuit breaker)
     */
    async function processWriteQueueInOrder(sessionKey: string): Promise<void> {
      const queueState = chunkQueue.get(sessionKey);
      if (!queueState || queueState.processing) {
        return; // Already processing or no queue
      }
      
      queueState.processing = true;
      
      while (queueState.queue.length > 0) {
        // Find the next chunk in sequence
        const nextIndex = queueState.queue.findIndex(
          item => item.chunkNumber === queueState.nextExpectedChunk
        );
        
        if (nextIndex === -1) {
          // Next chunk not in queue yet, wait a bit
          await new Promise(resolve => setTimeout(resolve, 10));
          continue;
        }
        
        // Remove the next chunk in sequence
        const [chunk] = queueState.queue.splice(nextIndex, 1);
        queueState.nextExpectedChunk++;
        
        try {
          // Apply adaptive rate limiting delay if needed
          if (backpressureState.rateLimitDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, backpressureState.rateLimitDelay));
          }
          
          // Wait for processing to complete (may already be done if fast)
          const { audio: processedAudio, sampleRate: detectedSampleRate } = await chunk.processingPromise;
          
          // Log sample rate being passed to recordChunk (especially for first chunk)
          if (chunk.chunkNumber === 1) {
            audioLogger.info({
              event: 'recording_chunk_with_sample_rate',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              chunkNumber: 1,
              processedAudioSize: processedAudio.length,
              sampleRate: detectedSampleRate,
            }, `📝 Recording chunk 1 with sample rate ${detectedSampleRate}Hz (${processedAudio.length} bytes)`);
          }
          
          // CRITICAL: Write sequentially (this ensures order)
          // Use the detected sample rate from processing (ensures header matches data)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1269',message:'Writing chunk to recorder',data:{sessionKey,chunkNumber:chunk.chunkNumber,processedAudioSize:processedAudio.length,detectedSampleRate,queueDepth:queueState.queue.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          await recordChunk(validCallId, validParticipantEmail, processedAudio, chunk.orgSlug, detectedSampleRate);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1272',message:'Chunk written to recorder',data:{sessionKey,chunkNumber:chunk.chunkNumber,processedAudioSize:processedAudio.length,detectedSampleRate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          
          // Success - update circuit breaker
          if (backpressureState.circuitBreakerState === 'half-open') {
            // Count successes in half-open state
            const successCount = (backpressureState.circuitBreakerFailures < 0 ? 
              Math.abs(backpressureState.circuitBreakerFailures) : 0) + 1;
            if (successCount >= CIRCUIT_BREAKER_SUCCESS_THRESHOLD) {
              backpressureState.circuitBreakerState = 'closed';
              backpressureState.circuitBreakerFailures = 0;
              audioLogger.info({
                event: 'circuit_breaker_closed',
                participantEmail: validParticipantEmail,
                callId: validCallId,
              }, `Circuit breaker closed after ${successCount} successful chunks`);
            } else {
              backpressureState.circuitBreakerFailures = -successCount;
            }
          } else if (backpressureState.circuitBreakerState === 'closed') {
            // Reset failure count on success
            backpressureState.circuitBreakerFailures = 0;
          }
          
          chunk.resolve();
        } catch (error: any) {
          // Failure - update circuit breaker
          backpressureState.circuitBreakerFailures++;
          backpressureState.circuitBreakerLastFailure = Date.now();
          
          if (backpressureState.circuitBreakerState === 'half-open') {
            // Any failure in half-open opens the circuit
            backpressureState.circuitBreakerState = 'open';
            audioLogger.error({
              event: 'circuit_breaker_opened',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              reason: 'Failure in half-open state',
            }, `Circuit breaker opened due to failure in half-open state`);
          } else if (backpressureState.circuitBreakerFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
            backpressureState.circuitBreakerState = 'open';
            audioLogger.error({
              event: 'circuit_breaker_opened',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              failures: backpressureState.circuitBreakerFailures,
            }, `Circuit breaker opened after ${backpressureState.circuitBreakerFailures} failures`);
          }
          
          audioLogger.error({
            event: 'chunk_processing_error',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber: chunk.chunkNumber,
            error: error.message,
            stack: error.stack,
          }, `Error processing/writing chunk ${chunk.chunkNumber}`);
          chunk.reject(error);
        }
      }
      
      queueState.processing = false;
      
      // Check if we should resume WebSocket (queue drained)
      const currentQueueDepth = queueState.queue.length;
      const currentPending = pendingChunks.get(sessionKey) || 0;
      
      if (backpressureState.isPaused && currentQueueDepth <= BACKPRESSURE_RESUME_THRESHOLD && currentPending <= BACKPRESSURE_RESUME_THRESHOLD) {
        // Resume WebSocket
        backpressureState.isPaused = false;
        backpressureState.lastResumeTime = Date.now();
        ws.resume();
        logBackpressure(validParticipantEmail, sessionKey, currentQueueDepth, currentPending, 'resume');
        
        // Reduce rate limiting delay on successful resume
        backpressureState.rateLimitDelay = Math.max(0, backpressureState.rateLimitDelay - 5);
      }
      
      // Update adaptive rate limiting based on queue depth
      if (currentQueueDepth > 0) {
        // Increase delay slightly if queue is still building
        backpressureState.rateLimitDelay = Math.min(50, backpressureState.rateLimitDelay + 1);
      } else {
        // Decrease delay when queue is empty
        backpressureState.rateLimitDelay = Math.max(0, backpressureState.rateLimitDelay - 2);
      }
    }
    
    /**
     * Check circuit breaker state and update if needed
     */
    function checkCircuitBreaker(): boolean {
      const now = Date.now();
      
      if (backpressureState.circuitBreakerState === 'open') {
        // Check if enough time has passed to try half-open
        if (now - backpressureState.circuitBreakerLastFailure >= CIRCUIT_BREAKER_RESET_TIMEOUT) {
          backpressureState.circuitBreakerState = 'half-open';
          backpressureState.circuitBreakerFailures = 0; // Reset to count successes
          audioLogger.info({
            event: 'circuit_breaker_half_open',
            participantEmail: validParticipantEmail,
            callId: validCallId,
          }, `Circuit breaker entering half-open state`);
          return true; // Allow one chunk through
        }
        return false; // Circuit is open, reject chunks
      }
      
      return true; // Circuit is closed or half-open, allow chunks
    }
    
    /**
     * Store dropped chunk in dead letter queue
     */
    function storeInDeadLetterQueue(chunkData: Buffer, chunkNumber: number, reason: string, queueDepth: number, pending: number): void {
      if (deadLetterQueue.length >= MAX_DEAD_LETTER_QUEUE) {
        // Remove oldest chunk
        deadLetterQueue.shift();
      }
      
      deadLetterQueue.push({
        chunkNumber,
        chunkData: Buffer.from(chunkData), // Copy buffer
        timestamp: Date.now(),
        reason,
        queueDepth,
        pending,
      });
      
      audioLogger.debug({
        event: 'chunk_stored_in_dlq',
        participantEmail: validParticipantEmail,
        callId: validCallId,
        chunkNumber,
        reason,
        dlqSize: deadLetterQueue.length,
      }, `Stored chunk ${chunkNumber} in dead letter queue (reason: ${reason})`);
    }
    
    /**
     * Process audio chunk (detects sample rate and resamples if needed)
     * This runs in parallel for multiple chunks
     * Returns both processed audio and detected sample rate
     */
    async function processChunkAsync(
      chunkData: Buffer,
      chunkNumber: number,
      resolvedOrgSlug: string | undefined
    ): Promise<{ audio: Buffer; sampleRate: number }> {
      try {
        const originalSize = chunkData.length;
        
        // CRITICAL FIX: Assume 48kHz from LiveKit (more reliable than detection)
        // LiveKit TrackEgress always sends 48kHz PCM16 audio per documentation
        // Detection from chunk size can be inaccurate due to timing variations
        // Assuming 48kHz ensures correct resampling and WAV header
        const detectedInputRate = 48000; // LiveKit always sends 48kHz PCM16
        
        // CRITICAL: Lock sample rate per session to prevent detection inconsistencies
        // Detection can vary between chunks due to timing variations, but the actual
        // audio source has a fixed sample rate. Lock it on the first chunk.
        const sessionKey = `${validCallId}:${validParticipantEmail}`;
        let lockedInputRate = sessionSampleRates.get(sessionKey);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1475',message:'Sample rate check',data:{sessionKey,lockedInputRate:lockedInputRate||null,detectedInputRate,chunkNumber,originalSize},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        if (!lockedInputRate) {
          // First chunk - lock the detected rate
          lockedInputRate = detectedInputRate;
          sessionSampleRates.set(sessionKey, lockedInputRate);
          audioLogger.info({
            event: 'sample_rate_locked',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            lockedRate: lockedInputRate,
            firstChunkDetectedRate: detectedInputRate,
            chunkNumber,
          }, `🔒 Locked sample rate to ${lockedInputRate}Hz for session (first chunk detected ${detectedInputRate}Hz)`);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1488',message:'Sample rate locked',data:{sessionKey,lockedInputRate,detectedInputRate,chunkNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        } else if (detectedInputRate !== lockedInputRate) {
          // Subsequent chunk with different detection - log warning but use locked rate
          audioLogger.warn({
            event: 'sample_rate_detection_mismatch',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            lockedRate: lockedInputRate,
            detectedRate: detectedInputRate,
            chunkNumber,
            originalSize,
          }, `⚠️ Chunk ${chunkNumber} detected as ${detectedInputRate}Hz but using locked ${lockedInputRate}Hz (prevents sample rate mixing)`);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:1499',message:'Sample rate mismatch',data:{sessionKey,lockedInputRate,detectedInputRate,chunkNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        }
        
        // Use locked rate for all processing (ensures consistency)
        const inputSampleRate = lockedInputRate;
        
        // LiveKit always sends PCM16 audio in little-endian format (per documentation)
        // No byte order conversion needed - data is already in the correct format
        
        // Target sample rate for storage (16kHz for transcription compatibility)
        const targetSampleRate = 16000;
        
        // DIAGNOSTIC: Log first chunk with detection results
        if (chunkNumber === 1) {
          audioLogger.info({
            event: 'first_chunk_diagnostic',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber: 1,
            originalSize,
            detectedInputRate,
            targetSampleRate,
          }, `🔍 First audio chunk diagnostic: ${originalSize} bytes, detected ${detectedInputRate}Hz, target ${targetSampleRate}Hz`);
          
          // Verify detection makes sense
          const expected48kHzSize = 960 * 2; // 1920 bytes for 20ms at 48kHz
          const expected16kHzSize = 320 * 2; // 640 bytes for 20ms at 16kHz
          const sizeDiff48kHz = Math.abs(originalSize - expected48kHzSize);
          const sizeDiff16kHz = Math.abs(originalSize - expected16kHzSize);
          
          audioLogger.info({
            event: 'chunk_size_analysis',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            expected48kHzSize,
            expected16kHzSize,
            sizeDiff48kHz,
            sizeDiff16kHz,
          }, `Expected sizes: 48kHz=${expected48kHzSize} bytes (diff=${sizeDiff48kHz}), 16kHz=${expected16kHzSize} bytes (diff=${sizeDiff16kHz})`);
          
          if (detectedInputRate === 16000 && sizeDiff16kHz < sizeDiff48kHz) {
            audioLogger.info({
              event: 'no_resampling_needed',
              participantEmail: validParticipantEmail,
              callId: validCallId,
            }, `✅ Audio is already 16kHz - no resampling needed`);
          } else if (detectedInputRate === 48000) {
            audioLogger.info({
              event: 'resampling_required',
              participantEmail: validParticipantEmail,
              callId: validCallId,
            }, `✅ Audio is 48kHz - will resample to 16kHz`);
          } else {
            audioLogger.warn({
              event: 'unexpected_detected_rate',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              detectedInputRate,
            }, `⚠️ Detected rate ${detectedInputRate}Hz doesn't match expected rates. Proceeding with resampling if needed.`);
          }
          
          // Check if audio data looks valid
          if (chunkData.length >= 20) {
            const samples: number[] = [];
            let peak = 0;
            for (let i = 0; i < 10 && i * 2 < chunkData.length; i++) {
              const sample = chunkData.readInt16LE(i * 2);
              samples.push(sample);
              peak = Math.max(peak, Math.abs(sample));
            }
            const peakDb = peak > 0 ? (20 * Math.log10(peak / 32768)).toFixed(2) : '-Inf';
            audioLogger.info({
              event: 'audio_samples_check',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              firstSamples: samples,
              peak,
              peakDb,
            }, `First 10 samples: [${samples.join(', ')}], Peak: ${peak} (${peakDb} dB)`);
            
            if (peak < 100) {
              audioLogger.warn({
                event: 'quiet_audio_warning',
                participantEmail: validParticipantEmail,
                callId: validCallId,
                peak,
              }, `⚠️ WARNING: Audio is very quiet (peak=${peak}). This might indicate a problem.`);
            }
          }
        }

        const bypassResampling = process.env.BYPASS_RESAMPLING === 'true';
        
        // Process audio based on detected rate
        let processedAudio: Buffer;
        let outputSampleRate: number;
        
        if (inputSampleRate === targetSampleRate) {
          // Already at target rate - use data as-is (already little-endian)
          processedAudio = chunkData;
          outputSampleRate = targetSampleRate;
          
          if (chunkNumber === 1 || chunkNumber % 100 === 0) {
            audioLogger.info({
              event: 'no_resampling_needed',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              chunkNumber,
              inputSampleRate,
              targetSampleRate,
            }, `✓ Using audio as-is (already ${targetSampleRate}Hz, chunk ${chunkNumber})`);
          }
        } else if (inputSampleRate === 48000) {
          // BYPASS MODE: Skip resampling if enabled (for debugging)
          if (bypassResampling) {
            processedAudio = chunkData; // Use data as-is (already little-endian)
            outputSampleRate = 48000; // Use 48kHz instead of 16kHz
            audioLogger.warn({
              event: 'resampling_bypassed',
              participantEmail: validParticipantEmail,
              callId: validCallId,
              chunkNumber,
              warning: 'BYPASS_RESAMPLING=true - saving 48kHz directly (for debugging only)',
            }, `⚠️ BYPASS: Skipping resampling, saving 48kHz directly (chunk ${chunkNumber})`);
          } else {
            // Resample from 48kHz to 16kHz
            // Use per-session resampler for stateful resampling (prevents discontinuities)
            // Data is already in little-endian format (LiveKit always sends LE)
            processedAudio = await resample48kHzTo16kHz(chunkData, sessionKey);
            outputSampleRate = targetSampleRate;
            
            const resampledSize = processedAudio.length;
            const expectedSize = Math.floor(originalSize / 3);
            const sizeDiff = Math.abs(resampledSize - expectedSize);
            const sizeDiffPercent = (sizeDiff / expectedSize) * 100;
            
            // Always log first chunk resampling result
            if (chunkNumber === 1) {
              audioLogger.info({
                event: 'resampling_completed',
                participantEmail: validParticipantEmail,
                callId: validCallId,
                chunkNumber: 1,
                originalSize,
                resampledSize,
                expectedSize,
                sizeDiff,
                sizeDiffPercent,
              }, `✅ Resampling completed for chunk 1: ${originalSize} bytes → ${resampledSize} bytes (expected ~${expectedSize} bytes, diff=${sizeDiffPercent.toFixed(1)}%)`);
            }
            
            if (sizeDiffPercent > 15) {
              audioLogger.error({
                event: 'resampling_verification_failed',
                participantEmail: validParticipantEmail,
                callId: validCallId,
                originalSize,
                resampledSize,
                expectedSize,
                sizeDiffPercent,
                inputSampleRate,
              }, `❌ Resampling verification failed for ${validParticipantEmail}: original=${originalSize} bytes, resampled=${resampledSize} bytes, expected~${expectedSize} bytes (${sizeDiffPercent.toFixed(1)}% difference)`);
              throw new Error(`Resampling verification failed: ${sizeDiffPercent.toFixed(1)}% difference`);
            }
            
            // Log verification success every 100 chunks (to avoid spam)
            verificationLogCount++;
            if (verificationLogCount % 100 === 0) {
              audioLogger.info({
                event: 'resampling_verification_success',
                participantEmail: validParticipantEmail,
                callId: validCallId,
                chunkNumber,
                originalSize,
                resampledSize,
                expectedSize,
                sizeDiffPercent,
              }, `✓ Resampling verified for ${participantEmail}: ${originalSize} bytes → ${resampledSize} bytes (expected ~${expectedSize} bytes, ${sizeDiffPercent.toFixed(1)}% difference)`);
            }
          }
        } else {
          // Unexpected rate - log warning but try to resample anyway
          audioLogger.warn({
            event: 'unexpected_sample_rate_detected',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber,
            inputSampleRate,
            targetSampleRate,
            chunkSize: originalSize,
          }, `⚠️ Unexpected input sample rate ${inputSampleRate}Hz. Attempting to resample to ${targetSampleRate}Hz.`);
          
          // Try resampling (assuming it's 48kHz-like)
          // Use per-session resampler for stateful resampling
          processedAudio = await resample48kHzTo16kHz(chunkData, sessionKey);
          outputSampleRate = targetSampleRate;
          
          audioLogger.warn({
            event: 'unexpected_sample_rate_resampled',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber,
            inputSampleRate,
            targetSampleRate,
            chunkSize: originalSize,
            resampledSize: processedAudio.length,
          }, `Unexpected sample rate ${inputSampleRate}Hz detected, resampled to ${targetSampleRate}Hz (${originalSize} → ${processedAudio.length} bytes)`);
        }
        
        // Log final result for first chunk
        if (chunkNumber === 1) {
          audioLogger.info({
            event: 'chunk_processing_complete',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber: 1,
            originalSize,
            processedSize: processedAudio.length,
            inputSampleRate,
            outputSampleRate,
            resampled: inputSampleRate !== outputSampleRate,
          }, `✅ Chunk 1 processing complete: ${originalSize} bytes @ ${inputSampleRate}Hz → ${processedAudio.length} bytes @ ${outputSampleRate}Hz (resampled: ${inputSampleRate !== outputSampleRate})`);
        }
        
        // Return processed audio with detected sample rate
        return { audio: processedAudio, sampleRate: outputSampleRate };
      } catch (error: any) {
        audioLogger.error({
          event: 'resampling_error',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          chunkNumber,
          error: error.message,
          stack: error.stack,
        }, `Error in processChunkAsync for chunk ${chunkNumber}`);
        throw error; // Re-throw to be caught by caller
      }
    }
    
    // Handle binary audio data from LiveKit egress (with ordering queue)
    ws.on('message', (data: Buffer) => {
      // LiveKit egress sends audio data as binary messages
      if (!Buffer.isBuffer(data)) {
        audioLogger.warn({ event: 'invalid_message_type', type: typeof data }, 'Received non-binary message from LiveKit egress');
        return;
      }
      
      // Validate buffer is not empty
      if (data.length === 0) {
        audioLogger.warn({
          event: 'empty_buffer_received',
          participantEmail: validParticipantEmail,
          callId: validCallId,
        }, 'Received empty buffer from LiveKit egress');
        return;
      }
      
      // CRITICAL: Buffer Reuse Prevention
      // ===================================
      // WebSocket libraries may reuse the same Buffer object for multiple messages
      // to improve performance. If we hold a reference to the original buffer and
      // process it asynchronously, the buffer may be overwritten before processing
      // completes, causing data corruption (e.g., "heavy monster tone" audio artifacts).
      // 
      // Solution: Copy the buffer immediately when received, before any async operations.
      // This ensures the data won't be overwritten by subsequent messages.
      // 
      // Industry Best Practice: Always copy buffers before async processing or queuing.
      const chunkData = Buffer.from(data);
      
      // Verify copy succeeded
      if (chunkData.length !== data.length) {
        audioLogger.error({
          event: 'buffer_copy_failed',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          originalLength: data.length,
          copyLength: chunkData.length,
        }, `Buffer copy failed - length mismatch (original: ${data.length}, copy: ${chunkData.length})`);
        return;
      }
      
      // CRITICAL: Check if stream is Ogg/Opus format (starts with "OggS" header)
      // LiveKit TrackEgress exports Opus tracks as Ogg/Opus, not PCM16
      // If we receive Ogg/Opus but treat it as PCM16, it will look like garbage
      // Note: Using original 'data' buffer for synchronous format checks is safe
      if (audioChunkCount === 0 && data.length >= 4) {
        const header = data.toString('ascii', 0, 4);
        if (header === 'OggS') {
          audioLogger.error({
            event: 'ogg_opus_format_detected',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            header,
            message: 'CRITICAL: Received Ogg/Opus format from LiveKit egress, but code is treating it as PCM16! Audio will be corrupted. Need to decode Opus, not byte-swap.',
          }, `❌ CRITICAL: Stream starts with "OggS" - this is Ogg/Opus format, not PCM16! The code is incorrectly treating compressed Opus data as raw PCM16. This will cause severe audio corruption.`);
          // Continue processing but log the error - don't crash the connection
        } else {
          // Log that we're receiving PCM (expected format)
          audioLogger.debug({
            event: 'pcm_format_detected',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            header: header.split('').map(c => c.charCodeAt(0)).join(','),
            message: 'Stream does not start with OggS - assuming PCM16 format (expected)',
          }, `✅ Stream format check: Not Ogg/Opus (header: ${header.split('').map(c => `0x${c.charCodeAt(0).toString(16)}`).join(' ')}) - treating as PCM16`);
        }
      }
      
      audioChunkCount++;
      const now = Date.now();
      
      // CRITICAL: Check for potential format issues even with correct PCM format
      // 1. Sample rate mismatch (48k vs 16k) → chipmunk/slow
      // 2. Channels/interleaving (stereo interpreted as mono) → weird artifacts
      
      // Check 1: Detect if this might be stereo (would cause sample rate misdetection)
      // For 20ms chunk at 48kHz mono: 48000 * 0.02 * 2 = 1920 bytes
      // For 20ms chunk at 48kHz stereo: 48000 * 0.02 * 2 * 2 = 3840 bytes
      // If chunk size suggests stereo but we're treating as mono, sample rate detection will be wrong
      // Note: Using original 'data' buffer for synchronous format checks is safe
      if (audioChunkCount === 1) {
        const expectedMono48kHz = 48000 * 0.02 * 2; // 1920 bytes for 20ms @ 48kHz mono
        const expectedStereo48kHz = 48000 * 0.02 * 2 * 2; // 3840 bytes for 20ms @ 48kHz stereo
        const expectedMono16kHz = 16000 * 0.02 * 2; // 640 bytes for 20ms @ 16kHz mono
        const expectedStereo16kHz = 16000 * 0.02 * 2 * 2; // 1280 bytes for 20ms @ 16kHz stereo
        
        const sizeDiffMono48 = Math.abs(chunkData.length - expectedMono48kHz);
        const sizeDiffStereo48 = Math.abs(chunkData.length - expectedStereo48kHz);
        const sizeDiffMono16 = Math.abs(chunkData.length - expectedMono16kHz);
        const sizeDiffStereo16 = Math.abs(chunkData.length - expectedStereo16kHz);
        
        // Check if size matches stereo better than mono
        // CRITICAL: Only flag as stereo if stereo match is significantly better AND mono match is poor
        // This prevents false positives when chunk size exactly matches mono (e.g., 1920 bytes = mono 48kHz)
        // Example: 1920 bytes matches mono 48kHz exactly (diff=0), but stereo 16kHz diff=640
        // We should NOT flag this as stereo since mono match is perfect
        const minMonoDiff = Math.min(sizeDiffMono48, sizeDiffMono16);
        const minStereoDiff = Math.min(sizeDiffStereo48, sizeDiffStereo16);
        const stereoMatchBetter = minStereoDiff < minMonoDiff;
        const monoMatchPoor = minMonoDiff > 100; // Mono match must be > 100 bytes off
        
        if (stereoMatchBetter && monoMatchPoor) {
          audioLogger.error({
            event: 'stereo_audio_detected',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkSize: chunkData.length,
            expectedMono48kHz,
            expectedStereo48kHz,
            expectedMono16kHz,
            expectedStereo16kHz,
            message: 'CRITICAL: Audio chunk size suggests STEREO format, but code is treating it as MONO! This will cause sample rate misdetection and weird artifacts. Need to handle stereo interleaving.',
          }, `❌ CRITICAL: Chunk size (${chunkData.length} bytes) suggests STEREO format, but code assumes MONO! This will cause sample rate misdetection and audio artifacts.`);
        }
      }
      
      // Calculate audio level (synchronous operation, safe to use original buffer)
      const samples = new Int16Array(data.length / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = data.readInt16LE(i * 2);
      }
      
      // Calculate audio level
      let maxAmplitude = 0;
      let sumSquares = 0;
      let nonZeroCount = 0;
      
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        maxAmplitude = Math.max(maxAmplitude, abs);
        sumSquares += samples[i] * samples[i];
        if (abs > 0) nonZeroCount++;
      }
      
      const rms = Math.sqrt(sumSquares / samples.length);
      const dbLevel: number | undefined = maxAmplitude > 0 ? 20 * Math.log10(maxAmplitude / 32768) : undefined;
      const rmsDb: number | undefined = rms > 0 ? 20 * Math.log10(rms / 32768) : undefined;
      
      // Enhanced silence detection: check both amplitude and RMS
      const isSilence = maxAmplitude === 0 || (maxAmplitude < 50 && nonZeroCount < samples.length * 0.01 && rms < 10);
      
      // Track silence metrics
      if (isSilence) {
        consecutiveSilenceChunks++;
        totalSilenceChunks++;
      } else {
        consecutiveSilenceChunks = 0;
        totalChunksWithAudio++;
      }
      
      // Maintain silence history (rolling window)
      silenceHistory.push({ chunkNumber: audioChunkCount, isSilence, maxAmplitude });
      if (silenceHistory.length > MAX_SILENCE_HISTORY) {
        silenceHistory.shift();
      }
      
      // Log first chunk and every 100th chunk with audio level
      if (audioChunkCount === 1 || audioChunkCount % 100 === 0) {
        if (isSilence) {
          logAudioChunk('error', 'silence_detected', {
            chunkNumber: audioChunkCount,
            participantEmail: validParticipantEmail,
            callId: validCallId,
            maxAmplitude,
            dbLevel: (dbLevel !== undefined && isFinite(dbLevel)) ? dbLevel : -Infinity,
            rms,
            rmsDb: (rmsDb !== undefined && isFinite(rmsDb)) ? rmsDb : -Infinity,
            nonZeroSamples: nonZeroCount,
            totalSamples: samples.length,
            chunkSize: chunkData.length,
            isSilence: true,
            consecutiveSilenceChunks,
            silencePercentage: audioChunkCount > 0 ? (totalSilenceChunks / audioChunkCount) * 100 : 0,
          });
        } else {
          logAudioChunk('info', 'audio_chunk_received', {
            chunkNumber: audioChunkCount,
            participantEmail: validParticipantEmail,
            callId: validCallId,
            maxAmplitude,
            dbLevel: (dbLevel !== undefined && isFinite(dbLevel)) ? dbLevel : -Infinity,
            rms,
            rmsDb: (rmsDb !== undefined && isFinite(rmsDb)) ? rmsDb : -Infinity,
            chunkSize: chunkData.length,
            isSilence: false,
          });
        }
      }
      
      // Enhanced persistent silence detection
      if (consecutiveSilenceChunks > 10) {
        // Log warning every 100 consecutive silence chunks or on first detection
        if (consecutiveSilenceChunks % 100 === 0 || consecutiveSilenceChunks === 11) {
          const silencePercentage = audioChunkCount > 0 ? (totalSilenceChunks / audioChunkCount) * 100 : 0;
          logAudioChunk('error', 'persistent_silence', {
            chunkNumber: audioChunkCount,
            participantEmail: validParticipantEmail,
            callId: validCallId,
            maxAmplitude,
            dbLevel: (dbLevel !== undefined && isFinite(dbLevel)) ? dbLevel : -Infinity,
            consecutiveSilenceChunks,
            totalSilenceChunks,
            totalChunksWithAudio,
            silencePercentage,
            message: 'Multiple consecutive chunks appear to be silence - egress may be capturing wrong track or muted track',
          });
        }
      }
      
      // Periodic audio level summary (every 100 chunks)
      if (audioChunkCount % 100 === 0 && audioChunkCount > 0) {
        const silencePercentage = (totalSilenceChunks / audioChunkCount) * 100;
        const avgAmplitude = silenceHistory.reduce((sum, h) => sum + h.maxAmplitude, 0) / silenceHistory.length;
        const recentSilenceCount = silenceHistory.filter(h => h.isSilence).length;
        const recentSilencePercentage = (recentSilenceCount / silenceHistory.length) * 100;
        
        audioLogger.info({
          event: 'audio_level_summary',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          chunkNumber: audioChunkCount,
          totalChunks: audioChunkCount,
          totalSilenceChunks,
          totalChunksWithAudio,
          silencePercentage,
          consecutiveSilenceChunks,
          recentSilencePercentage,
          avgAmplitude,
          message: 'Periodic audio level summary',
        }, `Audio level summary: ${totalChunksWithAudio} chunks with audio, ${totalSilenceChunks} silence (${silencePercentage.toFixed(1)}%), ${consecutiveSilenceChunks} consecutive silence`);
      }
      
      // Log every 5 seconds to show audio is flowing
      if (now - lastLogTime > 5000) {
        audioLogger.info({
          event: 'audio_streaming_status',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          totalChunks: audioChunkCount,
          chunkSize: chunkData.length,
          queueDepth: chunkQueue.get(sessionKey)?.queue.length || 0,
        }, `Audio streaming: ${audioChunkCount} chunks received from ${validParticipantEmail} (${chunkData.length} bytes)`);
        lastLogTime = now;
      }
      
      // CRITICAL: Queue chunks to ensure sequential processing
      const queueState = chunkQueue.get(sessionKey)!;
      
      // Check circuit breaker first
      if (!checkCircuitBreaker()) {
        // Circuit breaker is open - store in DLQ and drop
        // Note: storeInDeadLetterQueue already copies the buffer, but use chunkData for consistency
        storeInDeadLetterQueue(chunkData, audioChunkCount, 'circuit_breaker_open', queueState.queue.length, pendingChunks.get(sessionKey) || 0);
        backpressureState.droppedChunks++;
        logBackpressure(validParticipantEmail, sessionKey, queueState.queue.length, pendingChunks.get(sessionKey) || 0, 'drop');
        return;
      }
      
      // Backpressure detection - multi-layered approach
      const pending = pendingChunks.get(sessionKey) || 0;
      const queueDepth = queueState.queue.length;
      
      // Layer 1: Drop chunks if queue is critically high (prevent memory issues)
      if (pending > BACKPRESSURE_DROP_THRESHOLD || queueDepth > BACKPRESSURE_DROP_THRESHOLD) {
        // Note: storeInDeadLetterQueue already copies the buffer, but use chunkData for consistency
        storeInDeadLetterQueue(chunkData, audioChunkCount, 'queue_too_full', queueDepth, pending);
        backpressureState.droppedChunks++;
        logBackpressure(validParticipantEmail, sessionKey, queueDepth, pending, 'drop');
        return; // Drop chunk to prevent memory issues
      }
      
      // Layer 2: Pause WebSocket if queue is getting high (prevent further buildup)
      if (!backpressureState.isPaused && (pending > BACKPRESSURE_PAUSE_THRESHOLD || queueDepth > BACKPRESSURE_PAUSE_THRESHOLD)) {
        backpressureState.isPaused = true;
        backpressureState.lastPauseTime = Date.now();
        ws.pause(); // Pause WebSocket to stop receiving more chunks
        logBackpressure(validParticipantEmail, sessionKey, queueDepth, pending, 'pause');
        
        // Increase rate limiting delay when pausing
        backpressureState.rateLimitDelay = Math.min(50, backpressureState.rateLimitDelay + 10);
      }
      
      // Layer 3: Warning if queue is building up
      if (queueDepth > BACKPRESSURE_WARNING_THRESHOLD || pending > BACKPRESSURE_WARNING_THRESHOLD) {
        logBackpressure(validParticipantEmail, sessionKey, queueDepth, pending, 'warning');
      }
      
      // Increment pending counter
      pendingChunks.set(sessionKey, pending + 1);
      
      // CRITICAL: Start processing immediately (async pipeline - parallel processing)
      // ✅ Use chunkData (safe copy) instead of original data buffer
      const processingPromise = processChunkAsync(chunkData, audioChunkCount, orgSlug ?? undefined);
      
      // Add chunk to queue with processing promise
      new Promise<void>((resolve, reject) => {
        queueState.queue.push({
          chunkNumber: audioChunkCount,
          chunkData: chunkData, // ✅ Use chunkData (safe copy) instead of original data buffer
          orgSlug: orgSlug ?? undefined,
          processingPromise, // Processing happens in parallel
          resolve: () => {
            // Decrement pending counter when done
            const current = pendingChunks.get(sessionKey) || 0;
            pendingChunks.set(sessionKey, Math.max(0, current - 1));
            resolve();
          },
          reject: (error: Error) => {
            // Decrement pending counter on error
            const current = pendingChunks.get(sessionKey) || 0;
            pendingChunks.set(sessionKey, Math.max(0, current - 1));
            reject(error);
          },
        });
        
        // Process write queue (non-blocking - writes happen sequentially)
        processWriteQueueInOrder(sessionKey).catch((error: any) => {
          audioLogger.error({
            event: 'write_queue_error',
            participantEmail: validParticipantEmail,
            callId: validCallId,
            chunkNumber: audioChunkCount,
            error: error.message,
            stack: error.stack,
          }, `Error in write queue processor for ${validParticipantEmail}`);
        });
      }).catch((error: any) => {
        audioLogger.error({
          event: 'queue_error',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          chunkNumber: audioChunkCount,
          error: error.message,
          stack: error.stack,
        }, `Error queuing chunk ${audioChunkCount} for ${validParticipantEmail}`);
      });
    });

    ws.on('error', (error) => {
      audioLogger.error({
        event: 'websocket_error',
        participantEmail: validParticipantEmail,
        callId: validCallId,
        error: error.message,
        stack: error.stack,
      }, `WebSocket error for ${validParticipantEmail}`);
    });

    ws.on('close', (code, reason) => {
      // Log final backpressure statistics
      const finalQueueDepth = chunkQueue.get(sessionKey)?.queue.length || 0;
      const finalPending = pendingChunks.get(sessionKey) || 0;
      
      audioLogger.info({
        event: 'websocket_closed',
        participantEmail: validParticipantEmail,
        callId: validCallId,
        code,
        reason: reason.toString(),
        totalChunks: audioChunkCount,
        finalQueueDepth,
        finalPending,
        droppedChunks: backpressureState.droppedChunks,
        dlqSize: deadLetterQueue.length,
        circuitBreakerState: backpressureState.circuitBreakerState,
        totalPauseTime: backpressureState.isPaused ? Date.now() - backpressureState.lastPauseTime : 0,
      }, `WebSocket connection closed for ${validParticipantEmail} (dropped: ${backpressureState.droppedChunks}, DLQ: ${deadLetterQueue.length})`);
      
      // Log dead letter queue summary if chunks were dropped
      if (deadLetterQueue.length > 0) {
        audioLogger.warn({
          event: 'dlq_summary',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          dlqSize: deadLetterQueue.length,
          droppedChunks: backpressureState.droppedChunks,
          oldestChunk: deadLetterQueue[0]?.chunkNumber,
          newestChunk: deadLetterQueue[deadLetterQueue.length - 1]?.chunkNumber,
        }, `Dead letter queue contains ${deadLetterQueue.length} dropped chunks`);
      }
      
      // Clean up chunk queue
      chunkQueue.delete(sessionKey);
      
      // Clean up pending chunks counter
      pendingChunks.delete(sessionKey);
      
      // Clean up resampler for this session (prevent memory leaks)
      // Note: cleanupResamplerForSession is async, but we don't await to avoid blocking close handler
      cleanupResamplerForSession(sessionKey).catch((error) => {
        console.error(`Failed to cleanup resampler for ${sessionKey}:`, error);
      });
      
      // Clean up locked sample rate for this session
      sessionSampleRates.delete(sessionKey);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/156ece8c-6c97-4de8-beda-eee9a64e6408',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'livekit.ts:2076',message:'WebSocket closed - cleaned up connection state',data:{sessionKey,finalQueueDepth,finalPending,chunkQueueSize:chunkQueue.size,pendingChunksSize:pendingChunks.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      
      // Clean up audio buffer for this participant
      cleanupParticipantBuffer(validCallId, validParticipantEmail).catch((error) => {
        audioLogger.error({
          event: 'cleanup_error',
          participantEmail: validParticipantEmail,
          callId: validCallId,
          error: error.message,
          stack: error.stack,
        }, `Error in cleanupParticipantBuffer`);
      });
    });
  });

  console.log('✅ LiveKit WebSocket server set up at /api/livekit/audio-ws');
}

