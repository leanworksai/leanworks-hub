/**
 * LiveKit Token Generation Endpoint
 * Generates access tokens for LiveKit rooms
 */

import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Cache for LiveKit credentials (from Secret Manager)
let cachedLiveKitCredentials: { apiKey: string; apiSecret: string } | null = null;
let liveKitCredentialsCacheTime: number = 0;
const LIVEKIT_CREDENTIALS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Get LiveKit credentials from Secret Manager
async function getLiveKitCredentials(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<{ apiKey: string; apiSecret: string }> {
  // Return cached credentials if still valid
  if (cachedLiveKitCredentials && Date.now() - liveKitCredentialsCacheTime < LIVEKIT_CREDENTIALS_CACHE_TTL) {
    return cachedLiveKitCredentials;
  }

  try {
    // Fetch API Key
    const apiKeySecretName = `projects/${projectId}/secrets/livekit-api-key/versions/latest`;
    const [apiKeyVersion] = await secretManagerClient.accessSecretVersion({ name: apiKeySecretName });
    const apiKey = apiKeyVersion.payload?.data?.toString()?.trim() || '';

    // Fetch API Secret
    const apiSecretSecretName = `projects/${projectId}/secrets/livekit-api-secret/versions/latest`;
    const [apiSecretVersion] = await secretManagerClient.accessSecretVersion({ name: apiSecretSecretName });
    const apiSecret = apiSecretVersion.payload?.data?.toString()?.trim() || '';

    if (!apiKey || !apiSecret) {
      throw new Error('LiveKit credentials are incomplete');
    }

    cachedLiveKitCredentials = { apiKey, apiSecret };
    liveKitCredentialsCacheTime = Date.now();
    console.log('✅ LiveKit credentials fetched from Secret Manager');
    return cachedLiveKitCredentials;
  } catch (error: any) {
    console.error('❌ Failed to fetch LiveKit credentials from Secret Manager:', error);
    throw new Error(`Failed to fetch LiveKit credentials: ${error.message}`);
  }
}

// Generate LiveKit access token
function generateLiveKitToken(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  participantIdentity: string,
  participantName?: string,
  canPublish: boolean = true,
  canSubscribe: boolean = true
): string {
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

  return at.toJwt();
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

      // Get LiveKit credentials
      const { apiKey, apiSecret } = await getLiveKitCredentials(secretManagerClient, projectId);

      // Generate token
      const token = generateLiveKitToken(
        apiKey,
        apiSecret,
        roomName,
        userEmail,
        typeof participantName === 'string' ? participantName : undefined,
        canPublish !== 'false',
        canSubscribe !== 'false'
      );

      // Get LiveKit URL from environment or use default
      // In production, this should be set via environment variable
      // For GCP, this will be the LoadBalancer IP or domain
      const livekitUrl = process.env.LIVEKIT_URL || 
                        (process.env.NODE_ENV === 'production' 
                          ? 'wss://livekit.leanworks.ai' 
                          : 'ws://localhost:7880');

      res.json({
        token,
        url: livekitUrl,
      });
    } catch (error: any) {
      console.error('❌ Error generating LiveKit token:', error);
      
      if (error.message?.includes('LiveKit credentials')) {
        return res.status(503).json({ 
          error: 'LiveKit service not configured',
          message: 'Voice calls may not work. Please contact support.',
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to generate LiveKit token',
        message: 'Voice calls may not work. Please try again later.',
      });
    }
  });

  console.log('✅ LiveKit endpoints registered');
}

