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
 */
export function getRTCConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    // Google's public STUN servers (free, no authentication)
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ];

  // Add TURN servers if configured via environment variables
  // For production, you should use a TURN server for better connectivity
  // behind NATs and firewalls
  const turnServerUrl = import.meta.env.VITE_TURN_SERVER_URL;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL;

  if (turnServerUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnServerUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return {
    iceServers,
  };
}

/**
 * Default RTC configuration
 */
export const defaultRTCConfig = getRTCConfiguration();

