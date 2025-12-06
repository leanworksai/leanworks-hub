/**
 * TURN Server Credentials Endpoint
 * Fetches temporary TURN credentials from Twilio's Network Traversal Service
 */

import express from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Cache for Twilio credentials (from Secret Manager)
let cachedTwilioCredentials: { accountSid: string; authToken: string } | null = null;
let twilioCredentialsCacheTime: number = 0;
const TWILIO_CREDENTIALS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cache for TURN credentials (from Twilio API)
let cachedTurnCredentials: TwilioTokenResponse | null = null;
let turnCredentialsCacheTime: number = 0;
const TURN_CREDENTIALS_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (tokens last 24 hours)

interface TwilioIceServer {
  url?: string;
  urls?: string | string[];
  username?: string;
  credential?: string;
}

interface TwilioTokenResponse {
  username: string;
  password: string;
  ttl: number;
  date_created: string;
  date_updated: string;
  account_sid: string;
  ice_servers: TwilioIceServer[];
}

// Get Twilio credentials from Secret Manager
async function getTwilioCredentials(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<{ accountSid: string; authToken: string }> {
  // Return cached credentials if still valid
  if (cachedTwilioCredentials && Date.now() - twilioCredentialsCacheTime < TWILIO_CREDENTIALS_CACHE_TTL) {
    return cachedTwilioCredentials;
  }

  try {
    // Fetch Account SID
    const accountSidSecretName = `projects/${projectId}/secrets/twilio-account-sid/versions/latest`;
    const [accountSidVersion] = await secretManagerClient.accessSecretVersion({ name: accountSidSecretName });
    const accountSid = accountSidVersion.payload?.data?.toString()?.trim() || '';

    // Fetch Auth Token
    const authTokenSecretName = `projects/${projectId}/secrets/twilio-auth-token/versions/latest`;
    const [authTokenVersion] = await secretManagerClient.accessSecretVersion({ name: authTokenSecretName });
    const authToken = authTokenVersion.payload?.data?.toString()?.trim() || '';

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are incomplete');
    }

    cachedTwilioCredentials = { accountSid, authToken };
    twilioCredentialsCacheTime = Date.now();
    console.log('✅ Twilio credentials fetched from Secret Manager');
    return cachedTwilioCredentials;
  } catch (error: any) {
    console.error('❌ Failed to fetch Twilio credentials from Secret Manager:', error);
    throw new Error(`Failed to fetch Twilio credentials: ${error.message}`);
  }
}

// Generate TURN credentials from Twilio API
async function generateTurnCredentials(
  accountSid: string,
  authToken: string
): Promise<TwilioTokenResponse> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    // Request 24 hour TTL (86400 seconds)
    body: 'Ttl=86400',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as TwilioTokenResponse;
  return data;
}

// Get TURN credentials (with caching)
async function getTurnCredentials(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<TwilioTokenResponse> {
  // Return cached TURN credentials if still valid
  if (cachedTurnCredentials && Date.now() - turnCredentialsCacheTime < TURN_CREDENTIALS_CACHE_TTL) {
    console.log('✅ Using cached TURN credentials');
    return cachedTurnCredentials;
  }

  // Get Twilio credentials from Secret Manager
  const { accountSid, authToken } = await getTwilioCredentials(secretManagerClient, projectId);

  // Generate new TURN credentials from Twilio
  console.log('🔄 Generating new TURN credentials from Twilio...');
  const turnCredentials = await generateTurnCredentials(accountSid, authToken);
  
  // Cache the credentials
  cachedTurnCredentials = turnCredentials;
  turnCredentialsCacheTime = Date.now();
  
  console.log('✅ TURN credentials generated successfully', {
    ttl: turnCredentials.ttl,
    iceServersCount: turnCredentials.ice_servers?.length || 0,
  });

  return turnCredentials;
}

export function setupTurnEndpoints(
  app: express.Application,
  authenticateUser: express.RequestHandler,
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
) {
  // GET /api/turn/credentials - Get TURN server credentials
  app.get('/api/turn/credentials', authenticateUser, async (req, res) => {
    try {
      const userEmail = (req as any).userEmail;
      
      if (!userEmail) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Get TURN credentials
      const turnCredentials = await getTurnCredentials(secretManagerClient, projectId);

      // Format ICE servers for WebRTC
      // Twilio returns servers with 'url' or 'urls' property
      const iceServers = turnCredentials.ice_servers.map((server) => {
        const urls = server.urls || server.url;
        
        // Check if this is a TURN server (needs credentials) or STUN server
        if (typeof urls === 'string' && urls.startsWith('stun:')) {
          return { urls };
        }
        
        if (Array.isArray(urls) && urls.every(u => typeof u === 'string' && u.startsWith('stun:'))) {
          return { urls };
        }

        // TURN server - include credentials
        return {
          urls,
          username: server.username || turnCredentials.username,
          credential: server.credential || turnCredentials.password,
        };
      });

      res.json({
        iceServers,
        ttl: turnCredentials.ttl,
        expiresAt: new Date(Date.now() + turnCredentials.ttl * 1000).toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error fetching TURN credentials:', error);
      
      // Don't expose internal error details to client
      if (error.message?.includes('Twilio credentials')) {
        return res.status(503).json({ 
          error: 'TURN service not configured',
          message: 'Voice calls may not work through firewalls. Please contact support.',
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to get TURN credentials',
        message: 'Voice calls may not work through firewalls. Please try again later.',
      });
    }
  });

  console.log('✅ TURN endpoints registered');
}

