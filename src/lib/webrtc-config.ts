/**
 * WebRTC Configuration
 * STUN/TURN server configuration for peer-to-peer connections
 */

export interface RTCConfiguration {
  iceServers: RTCIceServer[];
}

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Cache for TURN credentials fetched from backend
let cachedTurnConfig: RTCConfiguration | null = null;
let turnConfigCacheTime: number = 0;
let turnConfigExpiresAt: number = 0;
const TURN_CONFIG_CACHE_TTL = 10 * 60 * 60 * 1000; // 10 hours (credentials last 24 hours)

// Track if we're currently fetching to avoid duplicate requests
let fetchPromise: Promise<RTCConfiguration> | null = null;

/**
 * Get default STUN-only configuration (fallback when TURN is unavailable)
 */
export function getDefaultSTUNConfiguration(): RTCConfiguration {
  return {
    iceServers: [
      // Google's public STUN servers (free, no authentication)
      // STUN helps discover public IP addresses but cannot relay traffic
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302',
        ],
      },
      // Additional STUN servers for redundancy
      {
        urls: 'stun:stun.stunprotocol.org:3478',
      },
    ],
  };
}

/**
 * Fetch TURN credentials from backend (Twilio)
 * Returns cached credentials if still valid
 */
async function fetchTurnCredentials(authToken: string): Promise<RTCConfiguration | null> {
  try {
    const apiUrl = import.meta.env.DEV
      ? `${API_BASE}/api/turn/credentials`
      : `${API_BASE}/turn/credentials`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.warn('⚠️ Failed to fetch TURN credentials:', response.status, errorData);
      return null;
    }

    const data = await response.json();
    
    if (!data.iceServers || !Array.isArray(data.iceServers)) {
      console.warn('⚠️ Invalid TURN credentials response');
      return null;
    }

    // Store expiration time from server
    if (data.expiresAt) {
      turnConfigExpiresAt = new Date(data.expiresAt).getTime();
    } else if (data.ttl) {
      turnConfigExpiresAt = Date.now() + (data.ttl * 1000);
    }

    console.log('✅ TURN credentials fetched from backend', {
      iceServersCount: data.iceServers.length,
      ttl: data.ttl,
      expiresAt: data.expiresAt,
    });

    return {
      iceServers: data.iceServers,
    };
  } catch (error) {
    console.error('❌ Error fetching TURN credentials:', error);
    return null;
  }
}

/**
 * Check if cached TURN config is still valid
 */
function isCacheValid(): boolean {
  if (!cachedTurnConfig) return false;
  
  const now = Date.now();
  
  // Check if cache TTL has expired
  if (now - turnConfigCacheTime > TURN_CONFIG_CACHE_TTL) return false;
  
  // Check if credentials have expired (with 30 min buffer)
  if (turnConfigExpiresAt && now > turnConfigExpiresAt - 30 * 60 * 1000) return false;
  
  return true;
}

/**
 * Get WebRTC configuration with STUN/TURN servers
 * Fetches TURN credentials from backend (Twilio) with caching
 * Falls back to STUN-only if TURN credentials are unavailable
 * 
 * @param authToken - Firebase auth token for API authentication
 * @returns RTCConfiguration with ICE servers
 */
export async function getRTCConfiguration(authToken?: string): Promise<RTCConfiguration> {
  // Return cached config if still valid
  if (isCacheValid() && cachedTurnConfig) {
    console.log('✅ Using cached TURN configuration');
    return cachedTurnConfig;
  }

  // If we're already fetching, wait for that request
  if (fetchPromise) {
    console.log('⏳ Waiting for in-flight TURN credentials request...');
    return fetchPromise;
  }

  // Get default STUN config as base
  const defaultConfig = getDefaultSTUNConfiguration();

  // If no auth token, use STUN-only
  if (!authToken) {
    console.warn('⚠️ No auth token provided, using STUN-only configuration');
    return defaultConfig;
  }

  // Fetch TURN credentials from backend
  fetchPromise = (async () => {
    try {
      const turnConfig = await fetchTurnCredentials(authToken);

      if (turnConfig && turnConfig.iceServers.length > 0) {
        // Merge STUN servers with TURN servers
        // Put TURN servers first for priority, then add Google STUN as fallback
        const mergedConfig: RTCConfiguration = {
          iceServers: [
            ...turnConfig.iceServers,
            // Add Google STUN as additional fallback
            {
              urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
              ],
            },
          ],
        };

        // Cache the config
        cachedTurnConfig = mergedConfig;
        turnConfigCacheTime = Date.now();

        console.log('✅ TURN configuration ready', {
          totalIceServers: mergedConfig.iceServers.length,
          hasTurn: mergedConfig.iceServers.some(s => {
            const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
            return urls.some(u => u?.startsWith('turn:') || u?.startsWith('turns:'));
          }),
        });

        return mergedConfig;
      }

      // TURN fetch failed, use STUN-only
      console.warn('⚠️ TURN credentials unavailable, using STUN-only configuration');
      console.warn('⚠️ Voice calls may not work through firewalls');
      return defaultConfig;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Synchronous version that returns cached config or default STUN
 * Use this when you need immediate config without waiting
 * Prefer getRTCConfiguration() for better connectivity
 */
export function getRTCConfigurationSync(): RTCConfiguration {
  if (isCacheValid() && cachedTurnConfig) {
    return cachedTurnConfig;
  }
  return getDefaultSTUNConfiguration();
}

/**
 * Clear cached TURN configuration
 * Call this when user logs out or credentials need refresh
 */
export function clearTurnConfigCache(): void {
  cachedTurnConfig = null;
  turnConfigCacheTime = 0;
  turnConfigExpiresAt = 0;
  fetchPromise = null;
  console.log('🔄 TURN configuration cache cleared');
}

/**
 * Default RTC configuration (STUN-only, for backwards compatibility)
 * @deprecated Use getRTCConfiguration() for better connectivity
 */
export const defaultRTCConfig = getDefaultSTUNConfiguration();
