/**
 * LiveKit Token Generation Endpoint
 * Generates access tokens for LiveKit rooms
 */

import express from 'express';
import { AccessToken, RoomServiceClient, EgressClient, EgressInfo, StreamOutput } from 'livekit-server-sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { startTranscriptionSession, processAudioChunk } from '../services/transcription.js';
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

  // POST /api/livekit/webhook - Handle LiveKit webhooks (egress, room events, etc.)
  app.post('/api/livekit/webhook', express.raw({ type: 'application/json', limit: '10mb' }), async (req, res) => {
    try {
      const event = req.body;
      
      // Handle different webhook event types
      if (event.event === 'egress_started' || event.event === 'egress_updated') {
        console.log('📹 LiveKit egress event:', event.event, event.egressInfo);
        // Egress started/updated - audio is being captured
        // We can use this to track egress status
      } else if (event.event === 'room_started') {
        console.log('📞 LiveKit room started:', event.room);
        // Room started - could trigger transcription if needed
      } else if (event.event === 'participant_joined') {
        console.log('👤 Participant joined:', event.participant);
        // Participant joined - update transcription session if needed
      } else if (event.event === 'track_published') {
        console.log('🎵 Track published:', event.track);
        // Track published - audio track available
      } else if (event.event === 'egress_ended') {
        console.log('📹 LiveKit egress ended:', event.egressInfo);
        // Egress ended - transcription should be finalized
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

