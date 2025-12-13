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
import { resample48kHzTo16kHz } from '../services/audio-processor.js';
import { recordChunk, cleanupParticipantBuffer } from '../services/audio-recorder.js';

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
  app.post('/api/livekit/webhook', express.json({ 
    limit: '10mb',
    type: ['application/json', 'application/webhook+json']
  }), async (req, res) => {
    try {
      // Log raw request for debugging
      console.log('📡 LiveKit webhook received!');
      console.log('📡 LiveKit webhook - Method:', req.method);
      console.log('📡 LiveKit webhook - URL:', req.url);
      console.log('📡 LiveKit webhook - Headers:', JSON.stringify(req.headers, null, 2));
      console.log('📡 LiveKit webhook - Body:', JSON.stringify(req.body, null, 2));
      
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
                const sorted = docsArray.sort((a, b) => {
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
          
          // Try to find a call with 'ringing' or 'active' status
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
              console.log(`✅ Using most recent call document: ${callId} with status: ${mostRecentData.status}`);
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
                
                const retrySnapshot = await retryQuery.get();
                
                // Sort in memory if needed
                if (retrySnapshot.docs.length > 0) {
                  const docsArray = Array.from(retrySnapshot.docs);
                  const sorted = docsArray.sort((a, b) => {
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
                
                // Get orgId - first check if it's already in callData, then try to get from orgSlug
                let orgId: string | undefined = callData.orgId || callData.organizationId;
                
                // If orgId not in callData, try to get it from orgSlug using multi-tenant-pool
                if (!orgId && orgSlug) {
                  try {
                    // Try to import and get orgId from orgSlug
                    const multiTenantPool = await import('../database/multi-tenant-pool.js').catch(() => null);
                    if (multiTenantPool?.getOrgIdBySlug) {
                      orgId = await multiTenantPool.getOrgIdBySlug(orgSlug);
                      console.log(`✅ Retrieved orgId ${orgId} from orgSlug ${orgSlug} for call ${callId}`);
                    } else {
                      console.warn(`⚠️ multi-tenant-pool module not available, using orgSlug ${orgSlug} without orgId`);
                    }
                  } catch (orgError: any) {
                    console.warn(`⚠️ Could not get orgId from orgSlug ${orgSlug} for auto-starting transcription:`, orgError.message);
                    // Continue with orgSlug - transcription worker can work with orgSlug
                  }
                }
                
                // Log what we have
                if (orgId) {
                  console.log(`📝 Using orgId ${orgId} for transcription (orgSlug: ${orgSlug})`);
                } else {
                  console.log(`📝 Using orgSlug ${orgSlug} for transcription (no orgId available)`);
                }
                
                // Check if transcription is enabled but not started
                // Note: We continue even if orgId is undefined - the worker can handle it
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
                      orgId, // Can be undefined - worker will handle it
                    });
                    console.log(`✅ Auto-started transcription for call ${callId} via track_published webhook${orgId ? ` (orgId: ${orgId})` : ' (no orgId)'}`);
                    
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

      // Process audio chunk - resample and record
      const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
      const resampledAudio = await resample48kHzTo16kHz(audioBuffer);
      await recordChunk(callId as string, participantEmail as string, resampledAudio);

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
    ws.on('message', async (data: Buffer) => {
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
          
          // Resample from 48kHz to 16kHz (LiveKit sends 48kHz, but we store/process at 16kHz)
          const resampledAudio = await resample48kHzTo16kHz(data);
          
          // Record audio chunk (non-blocking: saves to Cloud Storage and publishes to Pub/Sub)
          await recordChunk(callId, participantEmail, resampledAudio);
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
      
      // Clean up audio buffer for this participant
      cleanupParticipantBuffer(callId, participantEmail).catch((error) => {
        console.error(`❌ Error in cleanupParticipantBuffer:`, error);
      });
    });
  });

  console.log('✅ LiveKit WebSocket server set up at /api/livekit/audio-ws');
}

