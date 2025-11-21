/**
 * WebRTC Configuration
 * STUN/TURN server configuration for peer-to-peer connections
 */

export interface RTCConfiguration {
  iceServers: RTCIceServer[];
}

/**
 * Get WebRTC configuration with STUN/TURN servers
 * 
 * For production, you may want to:
 * 1. Use a managed TURN service (Twilio, Cloudflare, etc.)
 * 2. Host your own coturn server on GCP Compute Engine
 * 3. Use environment variables for TURN credentials
 * 
 * Note: TURN servers are essential for connections through symmetric NATs and firewalls.
 * Without TURN, peer connections will fail in many network configurations.
 */
export function getRTCConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
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
  ];

  // Add TURN servers if configured via environment variables
  // TURN servers are REQUIRED for connections through symmetric NATs and firewalls
  // Without TURN, many peer connections will fail
  const turnServerUrl = import.meta.env.VITE_TURN_SERVER_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnServerUrl && turnUsername && turnCredential) {
    // Support both single URL string and array of URLs
    const urls = Array.isArray(turnServerUrl) ? turnServerUrl : [turnServerUrl];
    
    iceServers.push({
      urls: urls,
      username: turnUsername,
      credential: turnCredential,
    });
    
    console.log('✅ TURN server configured for WebRTC');
  } else {
    console.warn('⚠️ No TURN server configured. Peer connections may fail behind NATs/firewalls.');
    console.warn('⚠️ Set VITE_TURN_SERVER_URL, VITE_TURN_USERNAME, and VITE_TURN_CREDENTIAL environment variables.');
  }

  return {
    iceServers,
  };
}

/**
 * Default RTC configuration
 */
export const defaultRTCConfig = getRTCConfiguration();

