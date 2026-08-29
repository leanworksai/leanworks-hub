/**
 * API Configuration
 * Manages endpoints for both hub (CRUD) and AI backends
 */

// Check if demo mode is enabled
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Main hub API (leanworks-hub)
export const HUB_API_URL = DEMO_MODE
  ? 'http://localhost:3001/api'
  : (import.meta.env.VITE_HUB_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api'));

export const API_CONFIG = {
  hub: HUB_API_URL,
  demoMode: DEMO_MODE,
};
