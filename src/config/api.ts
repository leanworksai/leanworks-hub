/**
 * API Configuration
 * Manages endpoints for both hub (CRUD) and AI backends
 */

// Check if demo mode is enabled
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Main hub API (leanworks-hub)
export const HUB_API_URL = DEMO_MODE
  ? 'http://localhost:3001/api'
  : (import.meta.env.VITE_HUB_API_URL || 'http://localhost:3001/api');

// AI API (leanworks Python service)
export const AI_API_URL = DEMO_MODE
  ? 'http://localhost:3001/api'  // Demo server handles AI requests too
  : (import.meta.env.VITE_AI_API_URL || 'http://localhost:8080/api');

export const AI_API_KEY = import.meta.env.VITE_AI_API_KEY || '';

export const API_CONFIG = {
  hub: HUB_API_URL,
  ai: AI_API_URL,
  aiApiKey: AI_API_KEY,
  demoMode: DEMO_MODE,
};
