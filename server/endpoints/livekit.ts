/**
 * LiveKit Token Generation Endpoint
 * Generates access tokens for LiveKit rooms
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { AccessToken, RoomServiceClient, EgressClient, EgressInfo, StreamOutput, ParticipantEgressOptions, TrackEgressOptions } from 'livekit-server-sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { FirebaseFirestore } from 'firebase-admin/firestore';
import { startTranscriptionSession, processAudioChunk, isTranscriptionActive, findActiveTranscriptionByRoom, getTranscriptionSession } from '../services/transcription.js';
import { processLiveKitAudio } from '../services/audio-processor.js';

// Cache for LiveKit credentials (from Secret Manager)
let cachedLiveKitCredentials: { apiKey: string; apiSecret: string } | null = null;
let liveKitCredentialsCacheTime: number = 0;
const LIVEKIT_CREDENTIALS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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

export function setupLiveKitEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  secretManagerClient: SecretManagerServiceClient,
  projectId: string,
  db?: FirebaseFirestore.Firestore
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
  app.post('/api/livekit/webhook', express.json({ 
    limit: '10mb',
    type: ['application/json', 'application/webhook+json']
  }), async (req, res) => {
    try {
      // Log raw request for debugging
      console.log('📡 LiveKit webhook received - Raw body:', JSON.stringify(req.body, null, 2));
      console.log('📡 LiveKit webhook headers:', req.headers);
      
      const event = req.body;
      const eventType = event?.event || 'unknown';
      
      console.log('📡 LiveKit webhook event type:', eventType, { 
        room: event?.room?.name, 
        participant: event?.participant?.identity,
        track: event?.track?.sid
      });
      
      // Helper function to actually start the egress (extracted for reuse)
      const doStartEgress = async (
        roomName: string,
        participantIdentity: string,
        trackSid: string,
        callId: string,
        callData: any
      ) => {
        // Check if transcription is active for this call
        if (!isTranscriptionActive(callId)) {
          console.log('📝 Transcription not active yet for call:', callId, '- will retry in 3 seconds...');
          setTimeout(async () => {
            if (isTranscriptionActive(callId)) {
              console.log('📝 Transcription is now active, starting egress...');
              await doStartEgress(roomName, participantIdentity, trackSid, callId, callData);
            } else {
              console.log('📝 Transcription still not active after retry for call:', callId);
              setTimeout(async () => {
                if (isTranscriptionActive(callId)) {
                  console.log('📝 Transcription is now active (second retry), starting egress...');
                  await doStartEgress(roomName, participantIdentity, trackSid, callId, callData);
                } else {
                  console.log('📝 Transcription never became active for call:', callId);
                }
              }, 3000);
            }
          }, 3000);
          return;
        }

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
        const wsUrl = `${wsBaseUrl}/api/livekit/audio-ws?callId=${callId}&participantEmail=${encodeURIComponent(participantEmail)}`;
        
        // Create EgressClient
        const httpUrl = livekitUrl.replace('ws://', 'http://').replace('wss://', 'https://');
        console.log(`🔧 Creating EgressClient with URL: ${httpUrl}`);
        const egressClient = new EgressClient(httpUrl, credentials.apiKey, credentials.apiSecret);
        
        try {
          console.log(`📹 Starting egress for participant ${participantEmail} in call ${callId}`);
          console.log(`   Room: ${roomName}, Track: ${trackSid}`);
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
          const callsQuery = db.collectionGroup('calls')
            .where('roomName', '==', roomName)
            .limit(10); // Get multiple to filter by status in memory
          
          let snapshot;
          try {
            snapshot = await callsQuery.get();
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
          
          // First, check if there's an active transcription session for this room
          // If so, use that callId - even if the Firestore document isn't found yet
          const activeTranscriptionCallId = findActiveTranscriptionByRoom(roomName);
          if (activeTranscriptionCallId) {
            console.log(`📝 Found active transcription session for room ${roomName} with callId: ${activeTranscriptionCallId}`);
            // Try to find the call document that matches the transcription session's callId
            let foundMatchingDoc = false;
            for (const doc of snapshot.docs) {
              if (doc.id === activeTranscriptionCallId) {
                callData = doc.data();
                callId = doc.id;
                foundMatchingDoc = true;
                console.log(`✅ Found call document matching active transcription: ${callId} with status: ${callData.status}`);
                break;
              }
            }
            
            // If we found an active transcription session but no matching Firestore doc,
            // use the transcription callId anyway (the doc might not be created/indexed yet)
            if (!foundMatchingDoc) {
              callId = activeTranscriptionCallId;
              // Get participant info from the transcription session
              const transcriptionSession = getTranscriptionSession(activeTranscriptionCallId);
              const participantEmails = transcriptionSession 
                ? Array.from(transcriptionSession.participants.keys())
                : [];
              
              callData = {
                callId: activeTranscriptionCallId,
                roomName: roomName,
                status: 'active', // Assume active since transcription is running
                participantEmails: participantEmails,
              };
              console.log(`✅ Using transcription session callId ${callId} (Firestore document not found yet, but transcription is active)`);
              console.log(`   Participants from transcription session: ${participantEmails.join(', ')}`);
            }
          }
          
          // If no transcription match found, try to find a call with 'ringing' or 'active' status
          if (!callId) {
            for (const doc of snapshot.docs) {
              const data = doc.data();
              if (data.status === 'active' || data.status === 'ringing') {
                callData = data;
                callId = doc.id;
                console.log(`✅ Found matching call: ${callId} with status: ${data.status}`);
                break;
              }
            }
          }
          
          // If still no call found, use the most recent call document
          // (the call might have just been created and status hasn't been set yet,
          // or the call document exists but status update is pending)
          if (!callId && snapshot.docs.length > 0) {
            // Sort by createdAt (most recent first) or by callId timestamp (if callId contains timestamp)
            const sortedDocs = snapshot.docs.sort((a, b) => {
              const aData = a.data();
              const bData = b.data();
              
              // Try createdAt first
              const aTime = aData.createdAt?.toMillis?.() || aData.createdAt?.getTime?.() || 
                           (aData.createdAt ? new Date(aData.createdAt).getTime() : 0);
              const bTime = bData.createdAt?.toMillis?.() || bData.createdAt?.getTime?.() || 
                           (bData.createdAt ? new Date(bData.createdAt).getTime() : 0);
              
              if (aTime !== bTime) {
                return bTime - aTime; // Most recent first
              }
              
              // Fallback: extract timestamp from callId if it follows the pattern: chatId-timestamp
              const aIdMatch = a.id.match(/-(\d+)$/);
              const bIdMatch = b.id.match(/-(\d+)$/);
              if (aIdMatch && bIdMatch) {
                return parseInt(bIdMatch[1]) - parseInt(aIdMatch[1]);
              }
              
              return 0;
            });
            
            const mostRecentDoc = sortedDocs[0];
            const mostRecentData = mostRecentDoc.data();
            callData = mostRecentData;
            callId = mostRecentDoc.id;
            console.log(`✅ Using most recent call document: ${callId} with status: ${mostRecentData.status}`);
            console.log(`   Note: This call may be in 'ended' status from a previous session, but we'll use it for egress`);
          }
          
          if (!callId || !callData) {
            console.log('📝 No call found for room:', roomName, '- will retry in 2 seconds...');
            console.log(`   Query returned ${snapshot.docs.length} document(s), but none with status 'ringing' or 'active'`);
            // Retry after a delay - the call document might not be created yet, or transcription might start
            setTimeout(async () => {
              try {
                console.log('🔄 Retrying call lookup for room:', roomName);
                
                // First, check if transcription session has started (it might have started by now)
                const retryTranscriptionCallId = findActiveTranscriptionByRoom(roomName);
                if (retryTranscriptionCallId) {
                  console.log(`   ✅ Found active transcription session on retry with callId: ${retryTranscriptionCallId}`);
                  // Use transcription session callId directly
                  const transcriptionSession = getTranscriptionSession(retryTranscriptionCallId);
                  const participantEmails = transcriptionSession 
                    ? Array.from(transcriptionSession.participants.keys())
                    : [];
                  
                  const transcriptionCallData = {
                    callId: retryTranscriptionCallId,
                    roomName: roomName,
                    status: 'active',
                    participantEmails: participantEmails,
                  };
                  
                  console.log(`   Using transcription session callId ${retryTranscriptionCallId}`);
                  console.log(`   Participants from transcription: ${participantEmails.join(', ')}`);
                  
                  // Continue with egress using transcription session data
                  await doStartEgress(roomName, participantIdentity, trackSid, retryTranscriptionCallId, transcriptionCallData);
                  return;
                }
                
                // If no transcription session, try Firestore query
                const retryQuery = db.collectionGroup('calls')
                  .where('roomName', '==', roomName)
                  .limit(10);
                const retrySnapshot = await retryQuery.get();
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
                
                // If no active/ringing call, use the most recent one
                if (!foundCall && retrySnapshot.docs.length > 0) {
                  const sortedDocs = retrySnapshot.docs.sort((a, b) => {
                    const aData = a.data();
                    const bData = b.data();
                    const aTime = aData.createdAt?.toMillis?.() || aData.createdAt?.getTime?.() || 
                                 (aData.createdAt ? new Date(aData.createdAt).getTime() : 0);
                    const bTime = bData.createdAt?.toMillis?.() || bData.createdAt?.getTime?.() || 
                                 (bData.createdAt ? new Date(bData.createdAt).getTime() : 0);
                    if (aTime !== bTime) return bTime - aTime;
                    const aIdMatch = a.id.match(/-(\d+)$/);
                    const bIdMatch = b.id.match(/-(\d+)$/);
                    if (aIdMatch && bIdMatch) {
                      return parseInt(bIdMatch[1]) - parseInt(aIdMatch[1]);
                    }
                    return 0;
                  });
                  
                  const mostRecentDoc = sortedDocs[0];
                  const mostRecentData = mostRecentDoc.data();
                  console.log(`✅ Using most recent call on retry: ${mostRecentDoc.id} with status: ${mostRecentData.status}`);
                  // Recursively call this function - it will use the most recent call logic
                  await startEgressForParticipant(roomName, participantIdentity, trackSid);
                  return;
                }
                
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
          
          // Use the helper function to start egress
          await doStartEgress(roomName, participantIdentity, trackSid, callId, callData);
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
      } else if (eventType === 'participant_left') {
        console.log('👋 Participant left:', event.participant?.identity, 'from room:', event.room?.name, 'reason:', event.participant?.disconnectReason);
      } else if (eventType === 'track_published') {
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
        
        // Start egress for audio tracks when transcription is active
        if (isAudio && roomName && participantIdentity && trackSid) {
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
      } else if (eventType === 'egress_ended') {
        console.log('📹 LiveKit egress ended:', event.egressInfo);
      }

      // Always respond 200 to acknowledge webhook
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('❌ Error handling LiveKit webhook:', error);
      // Still return 200 to prevent retries for malformed requests
      res.status(200).json({ received: true, error: error.message });
    }
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

      // Process audio chunk
      const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
      processLiveKitAudio(callId as string, participantEmail as string, audioBuffer);

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

      await startTranscriptionSession(callId, roomName, participants, secretManagerClient, projectId);
      
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

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const callId = url.searchParams.get('callId');
    const participantEmail = url.searchParams.get('participantEmail');

    if (!callId || !participantEmail) {
      console.error('❌ WebSocket connection missing callId or participantEmail');
      ws.close(1008, 'Missing callId or participantEmail');
      return;
    }

    console.log(`🔌 WebSocket connection opened for transcription:`, {
      callId,
      participantEmail,
      remoteAddress: req.socket.remoteAddress,
      url: req.url
    });

    let audioChunkCount = 0;
    let lastLogTime = Date.now();
    
    // Handle binary audio data from LiveKit egress
    ws.on('message', (data: Buffer) => {
      try {
        // LiveKit egress sends audio data as binary messages
        if (Buffer.isBuffer(data)) {
          audioChunkCount++;
          const now = Date.now();
          
          // Log every 5 seconds to show audio is flowing
          if (now - lastLogTime > 5000) {
            console.log(`🎤 Audio streaming: ${audioChunkCount} chunks received from ${participantEmail} (${data.length} bytes)`);
            lastLogTime = now;
          }
          
          // Forward audio chunk to transcription service
          processLiveKitAudio(callId, participantEmail, data);
        } else {
          console.warn('⚠️ Received non-binary message from LiveKit egress:', typeof data);
        }
      } catch (error: any) {
        console.error(`❌ Error processing audio chunk for ${participantEmail}:`, error);
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for ${participantEmail}:`, error);
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket connection closed for ${participantEmail}:`, {
        code,
        reason: reason.toString(),
        callId,
        totalChunks: audioChunkCount
      });
    });
  });

  console.log('✅ LiveKit WebSocket server set up at /api/livekit/audio-ws');
}

