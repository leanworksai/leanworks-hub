import { getAnalytics, logEvent, Analytics, setUserId, setUserProperties, isSupported } from 'firebase/analytics';
import { getApp } from 'firebase/app';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Firebase Analytics
let analytics: Analytics | null = null;
let analyticsInitialized = false;

// Google Analytics 4
let ga4Initialized = false;
let ga4ConfigComplete = false; // Track if config command has completed
let ga4MeasurementId: string | null = null;
let ga4ConfigFetchPromise: Promise<string | null> | null = null;

// Event queue for events fired before config completes
interface QueuedEvent {
  eventName: string;
  eventParams?: Record<string, any>;
  timestamp: number;
  retryCount?: number;
}

const eventQueue: QueuedEvent[] = [];
const MAX_QUEUE_SIZE = 100;
const MAX_QUEUE_AGE = 60000; // 1 minute
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Track if GA4 is blocked by ad blocker
let ga4Blocked = false;

// Session management
interface SessionData {
  sessionId: string;
  startTime: number;
  eventCount: number;
  lastActivity: number;
}

let currentSession: SessionData | null = null;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Journey tracking state
interface JourneyState {
  previousPage: string | null;
  previousPageStartTime: number | null;
  navigationMethod: 'direct' | 'sidebar' | 'back' | 'link' | 'unknown';
}

let journeyState: JourneyState = {
  previousPage: null,
  previousPageStartTime: null,
  navigationMethod: 'unknown',
};

// UTM parameter tracking
interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string; // Google Click Identifier
  first_touch_source?: string;
  first_touch_medium?: string;
  first_touch_campaign?: string;
  last_touch_source?: string;
  last_touch_medium?: string;
  last_touch_campaign?: string;
}

let currentUTMParams: UTMParams = {};

/**
 * Fetch GA4 Measurement ID from backend (Secret Manager) or fallback to env var
 * Uses different measurement IDs for dev vs production
 */
async function fetchGA4Config(forceRefresh = false): Promise<string | null> {
  // Return cached ID if available and not forcing refresh
  if (ga4MeasurementId && !forceRefresh) {
    // Verify environment hasn't changed
    const isDev = import.meta.env.DEV;
    const cachedIsDev = ga4MeasurementId === 'G-CTKJB29L9E';
    if (isDev === cachedIsDev) {
      return ga4MeasurementId;
    } else {
      // Environment changed, clear cache and re-fetch
      console.warn('⚠️ Environment changed, clearing GA4 cache');
      ga4MeasurementId = null;
      ga4Initialized = false;
    }
  }

  // If fetch is already in progress, return that promise
  if (ga4ConfigFetchPromise && !forceRefresh) {
    return ga4ConfigFetchPromise;
  }

  // Start fetching config
  ga4ConfigFetchPromise = (async () => {
    // In development mode, use dev measurement ID directly
    if (import.meta.env.DEV) {
      const devMeasurementId = 'G-CTKJB29L9E';
      ga4MeasurementId = devMeasurementId;
      console.log('✅ GA4 Measurement ID (DEV):', devMeasurementId);
      return devMeasurementId;
    }

    // In production, try to fetch from backend or use prod measurement ID
    try {
      // Try to fetch from backend API (Secret Manager)
      const apiUrl = `${API_BASE}/ga4-config`;
      
      // Add cache-busting query param for Safari
      const cacheBuster = forceRefresh ? `?t=${Date.now()}` : '';
      const response = await fetch(`${apiUrl}${cacheBuster}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const measurementId = data.measurementId?.trim();
        
        // Validate format (should start with G-)
        if (measurementId && measurementId.startsWith('G-')) {
          ga4MeasurementId = measurementId;
          console.log('✅ GA4 Measurement ID fetched from backend');
          return measurementId;
        } else {
          throw new Error(`Invalid GA4 Measurement ID format from backend: ${measurementId?.substring(0, 20)}`);
        }
      } else {
        // If backend returns 404, fallback to hardcoded prod measurement ID
        if (response.status === 404) {
          console.warn('⚠️ GA4 Measurement ID not configured in backend, using production default');
        } else {
          console.warn(`⚠️ Backend returned error ${response.status} for GA4 config, using production default`);
        }
        // Fallback to production measurement ID
        const prodMeasurementId = 'G-T3D2R7Z6HN';
        ga4MeasurementId = prodMeasurementId;
        console.log('✅ GA4 Measurement ID (PROD):', prodMeasurementId);
        return prodMeasurementId;
      }
    } catch (error: any) {
      // Fallback to environment variable or production measurement ID
      const envMeasurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID?.trim();
      if (envMeasurementId && envMeasurementId.startsWith('G-')) {
        console.warn('⚠️ Using GA4 Measurement ID from environment variable (backend fetch failed)');
        ga4MeasurementId = envMeasurementId;
        return envMeasurementId;
      }
      
      // Last resort: use production measurement ID
      const prodMeasurementId = 'G-T3D2R7Z6HN';
      console.warn('⚠️ Using production GA4 Measurement ID as fallback');
      ga4MeasurementId = prodMeasurementId;
      return prodMeasurementId;
    } finally {
      ga4ConfigFetchPromise = null;
    }
  })();

  return ga4ConfigFetchPromise;
}

/**
 * Load GA4 script with retry mechanism
 */
async function loadGA4Script(measurementId: string, retries = 2): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        console.log(`🔄 Retrying GA4 script load (attempt ${attempt + 1}/${retries + 1})...`);
      }

      // Remove any existing GA4 scripts to prevent duplicate tracking
      const existingScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]');
      existingScripts.forEach(script => script.remove());

      // Load gtag script dynamically
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
      script.id = `ga4-script-${measurementId}`;
      
      // Wait for script to load before initializing
      await new Promise<void>((resolve, reject) => {
        let resolved = false;
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            // Check if script actually loaded despite timeout
            const scriptElement = document.getElementById(script.id);
            if (scriptElement && (window as any).dataLayer && (window as any).dataLayer.length > 0) {
              // Script might have loaded, check for gtag
              if ((window as any).gtag) {
                resolve();
                return;
              }
            }
            reject(new Error('GA4 script load timeout'));
          }
        }, 15000); // Increased timeout to 15 seconds
        
        script.onload = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            // Poll for gtag availability (script might need a moment to initialize)
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds max (50 * 100ms)
            const checkGtag = () => {
              attempts++;
              // Check if Google's gtag is available (it will be different from our fallback)
              const hasGtag = typeof (window as any).gtag === 'function';
              const hasDataLayer = Array.isArray((window as any).dataLayer);
              
              if (hasGtag && hasDataLayer) {
                resolve();
              } else if (attempts < maxAttempts) {
                setTimeout(checkGtag, 100);
              } else {
                // Script loaded but gtag not available - use our fallback
                console.warn('⚠️ GA4 script loaded but gtag not initialized, using fallback');
                resolve();
              }
            };
            setTimeout(checkGtag, 100);
          }
        };
        
        script.onerror = (event) => {
          if (!resolved) {
            // Wait a moment to see if script actually loaded (sometimes onerror fires incorrectly)
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                
                // Double-check if script actually loaded despite onerror
                const scriptElement = document.getElementById(script.id);
                const hasGtag = typeof (window as any).gtag === 'function';
                const hasDataLayer = Array.isArray((window as any).dataLayer);
                
                // If gtag is available, script actually loaded successfully
                if (hasGtag && hasDataLayer && scriptElement) {
                  resolve();
                  return;
                }
                
                // Check if script was blocked (common with ad blockers)
                const isBlocked = !scriptElement || !scriptElement.src || scriptElement.src === '';
                if (isBlocked) {
                  ga4Blocked = true;
                  console.warn('⚠️ GA4 script blocked by ad blocker or privacy extension');
                  console.warn('   Analytics will continue to work with fallback methods');
                }
                const errorMsg = isBlocked 
                  ? 'GA4 script blocked (likely by ad blocker or privacy extension)'
                  : 'Failed to load GA4 script (network error or CORS issue)';
                reject(new Error(errorMsg));
              }
            }, 500); // Give it 500ms to see if script actually loaded
          }
        };
        
        // Append script to head
        document.head.appendChild(script);
      });

      // If we get here, script loaded successfully
      return;
    } catch (error: any) {
      lastError = error;
      // If this is the last attempt, throw the error
      if (attempt === retries) {
        throw error;
      }
    }
  }
  
  // Should never reach here, but just in case
  if (lastError) {
    throw lastError;
  }
}

/**
 * Extract UTM parameters from URL
 */
function extractUTMParameters(): UTMParams {
  const params: UTMParams = {};
  const urlParams = new URLSearchParams(window.location.search);
  
  // Extract UTM parameters
  const utmSource = urlParams.get('utm_source');
  const utmMedium = urlParams.get('utm_medium');
  const utmCampaign = urlParams.get('utm_campaign');
  const utmTerm = urlParams.get('utm_term');
  const utmContent = urlParams.get('utm_content');
  const gclid = urlParams.get('gclid');
  
  if (utmSource) params.utm_source = utmSource;
  if (utmMedium) params.utm_medium = utmMedium;
  if (utmCampaign) params.utm_campaign = utmCampaign;
  if (utmTerm) params.utm_term = utmTerm;
  if (utmContent) params.utm_content = utmContent;
  if (gclid) params.gclid = gclid;
  
  // Check session storage for first-touch attribution
  try {
    const storedFirstTouch = sessionStorage.getItem('analytics_first_touch');
    if (storedFirstTouch) {
      const firstTouch = JSON.parse(storedFirstTouch);
      params.first_touch_source = firstTouch.source;
      params.first_touch_medium = firstTouch.medium;
      params.first_touch_campaign = firstTouch.campaign;
    } else if (utmSource || utmMedium || utmCampaign) {
      // Store first-touch attribution
      const firstTouch = {
        source: utmSource || 'direct',
        medium: utmMedium || 'none',
        campaign: utmCampaign || 'none',
        timestamp: Date.now(),
      };
      sessionStorage.setItem('analytics_first_touch', JSON.stringify(firstTouch));
      params.first_touch_source = firstTouch.source;
      params.first_touch_medium = firstTouch.medium;
      params.first_touch_campaign = firstTouch.campaign;
    }
    
    // Update last-touch attribution
    if (utmSource || utmMedium || utmCampaign) {
      params.last_touch_source = utmSource || 'direct';
      params.last_touch_medium = utmMedium || 'none';
      params.last_touch_campaign = utmCampaign || 'none';
    } else {
      // Get from session storage if available
      const storedLastTouch = sessionStorage.getItem('analytics_last_touch');
      if (storedLastTouch) {
        const lastTouch = JSON.parse(storedLastTouch);
        params.last_touch_source = lastTouch.source;
        params.last_touch_medium = lastTouch.medium;
        params.last_touch_campaign = lastTouch.campaign;
      }
    }
  } catch (error) {
    // Ignore storage errors
  }
  
  return params;
}

/**
 * Initialize Consent Mode v2
 */
function initializeConsentMode(): void {
  try {
    // Set default consent states (denied by default for privacy)
    // These can be updated when user accepts consent
    const defaultConsent = {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      functionality_storage: 'granted', // Required for basic functionality
      personalization_storage: 'denied',
      security_storage: 'granted', // Required for security
    };
    
    const gtag = (window as any).gtag;
    if (gtag) {
      gtag('consent', 'default', defaultConsent);
      if (import.meta.env.DEV) {
        console.log('✅ Consent Mode initialized with default states');
      }
    }
  } catch (error) {
    console.warn('Failed to initialize Consent Mode:', error);
  }
}

/**
 * Process queued events after config completes
 * Includes retry logic for failed events
 */
function processEventQueue(): void {
  if (eventQueue.length === 0) return;
  
  const now = Date.now();
  const validEvents: QueuedEvent[] = [];
  const expiredEvents: QueuedEvent[] = [];
  
  // Filter events by age
  for (const queuedEvent of eventQueue) {
    if (now - queuedEvent.timestamp < MAX_QUEUE_AGE) {
      validEvents.push(queuedEvent);
    } else {
      expiredEvents.push(queuedEvent);
    }
  }
  
  // Clear expired events
  if (expiredEvents.length > 0 && import.meta.env.DEV) {
    console.warn(`⚠️ Dropped ${expiredEvents.length} expired queued events`);
  }
  
  // Process valid events
  if (validEvents.length > 0) {
    // Clear queue first
    eventQueue.length = 0;
    
    // Send events
    for (const queuedEvent of validEvents) {
      try {
        gtagEvent(queuedEvent.eventName, queuedEvent.eventParams);
      } catch (error) {
        // If event fails, add back to queue with retry count
        const retryCount = (queuedEvent.retryCount || 0) + 1;
        if (retryCount < MAX_RETRIES) {
          eventQueue.push({
            ...queuedEvent,
            retryCount,
            timestamp: now, // Update timestamp for retry
          });
        } else if (import.meta.env.DEV) {
          console.warn(`⚠️ Event "${queuedEvent.eventName}" failed after ${MAX_RETRIES} retries`);
        }
      }
    }
    
    if (validEvents.length > 0 && import.meta.env.DEV) {
      console.log(`✅ Processed ${validEvents.length} queued events`);
    }
  } else {
    // Clear queue if all events expired
    eventQueue.length = 0;
  }
}

/**
 * Retry failed events periodically
 */
function retryFailedEvents(): void {
  if (eventQueue.length === 0 || !ga4ConfigComplete) return;
  
  const now = Date.now();
  const eventsToRetry: QueuedEvent[] = [];
  
  // Find events that should be retried
  for (const queuedEvent of eventQueue) {
    const age = now - queuedEvent.timestamp;
    const retryCount = queuedEvent.retryCount || 0;
    
    // Retry if enough time has passed and we haven't exceeded max retries
    if (age >= RETRY_DELAY && retryCount < MAX_RETRIES && age < MAX_QUEUE_AGE) {
      eventsToRetry.push(queuedEvent);
    }
  }
  
  // Retry events
  for (const queuedEvent of eventsToRetry) {
    const index = eventQueue.indexOf(queuedEvent);
    if (index > -1) {
      eventQueue.splice(index, 1);
      try {
        gtagEvent(queuedEvent.eventName, queuedEvent.eventParams);
      } catch (error) {
        // Add back with incremented retry count
        eventQueue.push({
          ...queuedEvent,
          retryCount: (queuedEvent.retryCount || 0) + 1,
          timestamp: now,
        });
      }
    }
  }
}

// Set up periodic retry for failed events
if (typeof window !== 'undefined') {
  setInterval(() => {
    retryFailedEvents();
  }, RETRY_DELAY);
}

/**
 * Initialize Google Analytics 4
 * Ensures only one GA4 instance is loaded based on environment
 * CRITICAL: Config command must fire before any events
 */
async function initializeGA4(): Promise<void> {
  if (ga4Initialized) {
    return;
  }

  try {
    // Fetch GA4 Measurement ID from backend (or fallback to env var)
    const measurementId = await fetchGA4Config();
    
    if (!measurementId) {
      console.warn('⚠️ GA4 Measurement ID not found, skipping GA4 initialization');
      return;
    }

    // Clear any existing dataLayer to prevent conflicts
    if ((window as any).dataLayer) {
      // Keep only non-GA4 entries if any
      const filtered = ((window as any).dataLayer || []).filter((entry: any) => {
        // Keep entries that aren't GA4 configs
        return !(Array.isArray(entry) && entry[0] === 'config' && typeof entry[1] === 'string' && entry[1].startsWith('G-'));
      });
      (window as any).dataLayer = filtered;
    }

    // Initialize dataLayer first (before loading script)
    (window as any).dataLayer = (window as any).dataLayer || [];
    
    // Create gtag function immediately (Google's script will override it if it loads)
    if (!(window as any).gtag) {
      function gtag(...args: any[]) {
        (window as any).dataLayer.push(args);
      }
      (window as any).gtag = gtag;
    }

    // Initialize Consent Mode BEFORE config
    initializeConsentMode();

    // CRITICAL: Set config command immediately in dataLayer (before script loads)
    // This ensures config fires before any events
    const gtag = (window as any).gtag;
    gtag('js', new Date());
    
    // Extract UTM parameters before config
    currentUTMParams = extractUTMParameters();
    
    // Set config with enhanced measurement and debug mode
    const configParams: Record<string, any> = {
      send_page_view: false, // We'll handle page views manually
      // Enhanced measurement
      allow_enhanced_conversions: true,
      // Debug mode in development
      ...(import.meta.env.DEV ? { debug_mode: true } : {}),
    };
    
    // Add UTM parameters to config for proper attribution
    if (currentUTMParams.utm_source) {
      configParams.campaign_source = currentUTMParams.utm_source;
    }
    if (currentUTMParams.utm_medium) {
      configParams.campaign_medium = currentUTMParams.utm_medium;
    }
    if (currentUTMParams.utm_campaign) {
      configParams.campaign_name = currentUTMParams.utm_campaign;
    }
    
    gtag('config', measurementId, configParams);
    
    // Mark config as complete
    ga4ConfigComplete = true;

    // Load script with retry mechanism (after config is set)
    await loadGA4Script(measurementId);

    ga4Initialized = true;
    const env = import.meta.env.DEV ? 'DEV' : 'PROD';
    console.log(`✅ Google Analytics 4 initialized (${env}): ${measurementId}`);
    
    // Process any queued events
    processEventQueue();
  } catch (error: any) {
    // Log as warning instead of error since GA4 is not critical for app functionality
    const errorMessage = error?.message || 'Unknown error';
    
    // Check if it's an ad blocker issue
    if (errorMessage.includes('blocked') || ga4Blocked) {
      console.warn('⚠️ Google Analytics 4 blocked by ad blocker or privacy extension');
      console.warn('   Analytics will continue to work with fallback methods');
      ga4Blocked = true;
    } else {
      console.warn(`⚠️ Google Analytics 4 initialization skipped: ${errorMessage}`);
      console.warn('   Analytics will continue to work, but GA4 events will not be sent.');
    }
    
    ga4Initialized = false; // Reset on error to allow retry
    ga4ConfigComplete = false;
    
    // Still process queued events even if initialization failed
    // They'll be stored for retry when GA4 becomes available
    if (eventQueue.length > 0 && import.meta.env.DEV) {
      console.log(`📦 ${eventQueue.length} events queued for retry when GA4 becomes available`);
    }
  }
}

/**
 * Initialize Firebase Analytics
 * Note: Firebase Analytics is disabled in development mode to avoid polluting production data
 */
export async function initializeAnalytics(): Promise<void> {
  if (analyticsInitialized || analytics) {
    return;
  }

  // Skip Firebase Analytics in development mode
  if (import.meta.env.DEV) {
    console.log('🔍 [DEV] Firebase Analytics disabled - using GA4 only');
    analyticsInitialized = true; // Mark as initialized to prevent retries
  } else {
    // Only initialize Firebase Analytics in production
    try {
      const supported = await isSupported();
      if (!supported) {
        console.warn('⚠️ Firebase Analytics is not supported in this environment');
        return;
      }

      const app = getApp();
      analytics = getAnalytics(app);
      analyticsInitialized = true;
      console.log('✅ Firebase Analytics initialized');
    } catch (error: any) {
      console.error('❌ Failed to initialize Firebase Analytics:', error);
    }
  }

  // Also initialize GA4 (async, but don't wait for it)
  // IMPORTANT: Session initialization happens after GA4 config to ensure proper attribution
  initializeGA4().then(() => {
    // Initialize session after GA4 is ready to ensure session_start has proper attribution
    initializeSession();
  }).catch(error => {
    console.error('Failed to initialize GA4:', error);
    // Still initialize session even if GA4 fails
    initializeSession();
  });
  
  // Initialize is_logged_in property (defaults to false for anonymous users)
  // This will be updated when user logs in via setAnalyticsUserId
  // Also set custom dimensions
  const userType = determineUserType();
  setAnalyticsUserProperties({
    is_logged_in: false,
    user_type: userType,
  });
}

/**
 * Initialize or restore session
 * Enhanced with UTM parameters and attribution data
 */
function initializeSession(): void {
  try {
    const savedSession = sessionStorage.getItem('analytics_session');
    const now = Date.now();

    if (savedSession) {
      const session: SessionData = JSON.parse(savedSession);
      // Check if session is still valid (not expired)
      if (now - session.lastActivity < SESSION_TIMEOUT) {
        currentSession = {
          ...session,
          lastActivity: now,
        };
        sessionStorage.setItem('analytics_session', JSON.stringify(currentSession));
        return;
      }
    }

    // Create new session
    const sessionId = `session_${now}_${Math.random().toString(36).substr(2, 9)}`;
    currentSession = {
      sessionId,
      startTime: now,
      eventCount: 0,
      lastActivity: now,
    };
    sessionStorage.setItem('analytics_session', JSON.stringify(currentSession));

    // Extract UTM parameters if not already extracted
    if (Object.keys(currentUTMParams).length === 0) {
      currentUTMParams = extractUTMParameters();
    }

    // Track session start with full attribution data
    // This must fire after config completes, so it will be queued if needed
    const sessionStartParams: Record<string, any> = {
      session_id: sessionId,
      // Attribution parameters
      ...currentUTMParams,
      // Referrer information
      page_referrer: document.referrer || 'direct',
      // User agent info (anonymized)
      user_agent: navigator.userAgent ? navigator.userAgent.substring(0, 100) : 'unknown',
    };

    trackEventDual('session_start', sessionStartParams);
  } catch (error) {
    console.error('Failed to initialize session:', error);
  }
}

/**
 * Update session activity
 */
function updateSessionActivity(): void {
  if (currentSession) {
    currentSession.lastActivity = Date.now();
    currentSession.eventCount += 1;
    try {
      sessionStorage.setItem('analytics_session', JSON.stringify(currentSession));
    } catch (error) {
      // Ignore storage errors
    }
  }
}

/**
 * Validate event parameters
 */
function validateEventParams(eventName: string, eventParams?: Record<string, any>): Record<string, any> {
  const validated: Record<string, any> = { ...eventParams };
  
  // Remove null/undefined values
  Object.keys(validated).forEach(key => {
    if (validated[key] === null || validated[key] === undefined) {
      delete validated[key];
    }
  });
  
  // Add default parameters for common events
  if (eventName === 'page_view') {
    if (!validated.page_title) validated.page_title = document.title;
    if (!validated.page_location) validated.page_location = window.location.href;
    if (!validated.page_path) validated.page_path = window.location.pathname;
  }
  
  // Warn in development if critical parameters are missing
  if (import.meta.env.DEV) {
    const missingParams: string[] = [];
    if (eventName === 'page_view' && !validated.page_path) {
      missingParams.push('page_path');
    }
    if (missingParams.length > 0) {
      console.warn(`⚠️ Event "${eventName}" missing parameters:`, missingParams);
    }
  }
  
  return validated;
}

/**
 * Send event to Google Analytics 4
 * Only sends to the initialized measurement ID
 * Queues events if config hasn't completed yet
 * Includes retry logic and graceful error handling
 */
function gtagEvent(eventName: string, eventParams?: Record<string, any>): void {
  // Validate parameters
  const validatedParams = validateEventParams(eventName, eventParams);
  
  // If config hasn't completed, queue the event
  if (!ga4ConfigComplete || !ga4Initialized || !ga4MeasurementId) {
    // Only queue if we have space and it's not too old
    if (eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({
        eventName,
        eventParams: validatedParams,
        timestamp: Date.now(),
        retryCount: 0,
      });
      if (import.meta.env.DEV) {
        console.log(`📦 Queued event "${eventName}" (config not ready)`);
      }
    } else if (import.meta.env.DEV) {
      console.warn(`⚠️ Event queue full, dropping event "${eventName}"`);
    }
    return;
  }

  // If GA4 is blocked, silently fail (don't spam console)
  if (ga4Blocked) {
    return;
  }

  try {
    const gtag = (window as any).gtag;
    if (!gtag) {
      // Queue if gtag not available
      if (eventQueue.length < MAX_QUEUE_SIZE) {
        eventQueue.push({
          eventName,
          eventParams: validatedParams,
          timestamp: Date.now(),
          retryCount: 0,
        });
        if (import.meta.env.DEV) {
          console.log(`📦 Queued event "${eventName}" (gtag not available)`);
        }
      }
      return;
    }

    // Verify the script is still loaded for the correct measurement ID
    const scriptId = `ga4-script-${ga4MeasurementId}`;
    const script = document.getElementById(scriptId);
    if (!script) {
      // Script might have been removed (e.g., by ad blocker)
      // Queue for retry
      if (eventQueue.length < MAX_QUEUE_SIZE) {
        eventQueue.push({
          eventName,
          eventParams: validatedParams,
          timestamp: Date.now(),
          retryCount: 0,
        });
      }
      if (import.meta.env.DEV) {
        console.warn(`⚠️ GA4 script not found, queued event "${eventName}" for retry`);
      }
      return;
    }

    // Enrich with UTM parameters and session data
    const enrichedParams = {
      ...validatedParams,
      session_id: currentSession?.sessionId,
      ...currentUTMParams,
    };

    // Send event - it will automatically go to the measurement ID set in gtag('config')
    gtag('event', eventName, enrichedParams);
    
    if (import.meta.env.DEV) {
      console.log(`📊 GA4 Event: ${eventName}`, enrichedParams);
    }
  } catch (error: any) {
    // Don't log errors if GA4 is known to be blocked
    if (!ga4Blocked) {
      console.error('Failed to send GA4 event:', error);
    }
    
    // Try to queue for retry (unless we know it's blocked)
    if (!ga4Blocked && eventQueue.length < MAX_QUEUE_SIZE) {
      eventQueue.push({
        eventName,
        eventParams: validatedParams,
        timestamp: Date.now(),
        retryCount: 0,
      });
    }
  }
}

/**
 * Send event to both Firebase Analytics and GA4
 * Enhanced with UTM parameters and better error handling
 */
function trackEventDual(
  eventName: string,
  eventParams?: {
    [key: string]: string | number | boolean | null | undefined;
  }
): void {
  // Update session activity
  updateSessionActivity();

  // Add journey context and UTM parameters to event params
  const enrichedParams = {
    ...eventParams,
    session_id: currentSession?.sessionId || 'unknown',
    previous_page: journeyState.previousPage || null,
    navigation_method: journeyState.navigationMethod,
    // Include UTM parameters for attribution
    ...currentUTMParams,
  };

  // Send to Firebase Analytics (only in production)
  if (!import.meta.env.DEV && analytics) {
    try {
      logEvent(analytics, eventName, enrichedParams);
    } catch (error: any) {
      console.error('Failed to send Firebase event:', error);
    }
  }

  // Send to GA4 (always enabled, will queue if config not ready)
  gtagEvent(eventName, enrichedParams);
}

/**
 * Track a page view
 * Enhanced with performance metrics, referrer info, and proper timing
 */
export function trackPageView(pageName: string, pagePath?: string): void {
  const pagePathValue = pagePath || window.location.pathname;
  const now = Date.now();

  // Calculate time on previous page
  let timeOnPreviousPage: number | null = null;
  if (journeyState.previousPageStartTime) {
    timeOnPreviousPage = Math.round((now - journeyState.previousPageStartTime) / 1000);
  }

  // Track navigation if we have a previous page
  if (journeyState.previousPage && journeyState.previousPage !== pagePathValue) {
    trackNavigation(journeyState.previousPage, pagePathValue);
  }

  // Update journey state
  journeyState.previousPage = pagePathValue;
  journeyState.previousPageStartTime = now;

  // Get performance metrics if available
  let pageLoadTime: number | null = null;
  let domContentLoaded: number | null = null;
  if (typeof window !== 'undefined' && window.performance && window.performance.timing) {
    const perf = window.performance.timing;
    pageLoadTime = perf.loadEventEnd - perf.navigationStart;
    domContentLoaded = perf.domContentLoadedEventEnd - perf.navigationStart;
  } else if (typeof window !== 'undefined' && window.performance && window.performance.getEntriesByType) {
    const navTiming = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navTiming) {
      pageLoadTime = navTiming.loadEventEnd - navTiming.fetchStart;
      domContentLoaded = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
    }
  }

  // Get referrer information
  const referrer = document.referrer || 'direct';
  const referrerDomain = referrer !== 'direct' ? new URL(referrer).hostname : 'direct';

  // Track page view to both platforms with enhanced data
  trackEventDual('page_view', {
    page_title: pageName,
    page_location: window.location.href,
    page_path: pagePathValue,
    time_on_previous_page: timeOnPreviousPage,
    page_referrer: referrer,
    referrer_domain: referrerDomain,
    page_load_time: pageLoadTime,
    dom_content_loaded: domContentLoaded,
    // Include UTM parameters if present
    ...currentUTMParams,
  });

  // Also send GA4 page_view event (standard GA4 event)
  // This is handled by trackEventDual, but we ensure it's sent correctly
  if (ga4Initialized && ga4MeasurementId && ga4ConfigComplete) {
    try {
      const gtag = (window as any).gtag;
      if (gtag) {
        // Verify script is still loaded for the correct measurement ID
        const scriptId = `ga4-script-${ga4MeasurementId}`;
        if (document.getElementById(scriptId)) {
          gtag('event', 'page_view', {
            page_title: pageName,
            page_location: window.location.href,
            page_path: pagePathValue,
            page_referrer: referrer,
            ...currentUTMParams,
          });
        }
      }
    } catch (error) {
      // Ignore
    }
  }
}

/**
 * Track a custom event
 */
export function trackEvent(
  eventName: string,
  eventParams?: {
    [key: string]: string | number | boolean | null | undefined;
  }
): void {
  trackEventDual(eventName, eventParams);
}

/**
 * Set user ID for analytics
 * Automatically sets is_logged_in user property for easy segmentation
 * 
 * Usage in GA4/Firebase Analytics:
 * - Create segment: Filter by user property "is_logged_in" = true (for logged-in users)
 * - Create segment: Filter by user property "is_logged_in" = false (for anonymous users)
 */
export function setAnalyticsUserId(userId: string | null): void {
  const isLoggedIn = !!userId;

  // Firebase Analytics (only in production)
  if (!import.meta.env.DEV && analytics) {
    try {
      if (userId) {
        setUserId(analytics, userId);
      } else {
        setUserId(analytics, null);
      }
      // Automatically set is_logged_in property for easy segmentation
      setUserProperties(analytics, {
        is_logged_in: isLoggedIn,
      });
    } catch (error: any) {
      console.error('Failed to set Firebase Analytics user ID:', error);
    }
  }

  // GA4 (always enabled)
  if (ga4Initialized && ga4MeasurementId) {
    try {
      const gtag = (window as any).gtag;
      if (!gtag) {
        return;
      }

      // Verify the script is still loaded for the correct measurement ID
      const scriptId = `ga4-script-${ga4MeasurementId}`;
      if (!document.getElementById(scriptId)) {
        console.warn('⚠️ GA4 script not found, skipping user ID update');
        return;
      }

      gtag('config', ga4MeasurementId, {
        user_id: userId || undefined,
      });
      // Automatically set is_logged_in property and user type for easy segmentation
      const userType = determineUserType();
      gtag('set', {
        is_logged_in: isLoggedIn,
        user_type: userType,
      });
    } catch (error: any) {
      console.error('Failed to set GA4 user ID:', error);
    }
  }
}

/**
 * Set user properties for analytics
 * Enhanced with custom dimensions support
 */
export function setAnalyticsUserProperties(properties: {
  [key: string]: string | number | null;
}): void {
  // Firebase Analytics (only in production)
  if (!import.meta.env.DEV && analytics) {
    try {
      setUserProperties(analytics, properties);
    } catch (error: any) {
      console.error('Failed to set Firebase Analytics user properties:', error);
    }
  }

  // GA4 - set as user properties (always enabled)
  if (ga4Initialized && ga4MeasurementId && ga4ConfigComplete) {
    try {
      const gtag = (window as any).gtag;
      if (!gtag) {
        return;
      }

      // Verify the script is still loaded for the correct measurement ID
      const scriptId = `ga4-script-${ga4MeasurementId}`;
      if (!document.getElementById(scriptId)) {
        console.warn('⚠️ GA4 script not found, skipping user properties update');
        return;
      }

      // GA4 uses set to update user properties
      // Batch updates for better performance
      const validProperties: Record<string, any> = {};
      Object.entries(properties).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          validProperties[key] = value;
        }
      });
      
      if (Object.keys(validProperties).length > 0) {
        gtag('set', validProperties);
      }
    } catch (error: any) {
      console.error('Failed to set GA4 user properties:', error);
    }
  }
}

/**
 * Set custom dimensions for better segmentation
 * Tracks user type, subscription tier, and feature usage patterns
 */
export function setCustomDimensions(dimensions: {
  user_type?: 'new' | 'returning';
  subscription_tier?: string;
  feature_usage_level?: 'low' | 'medium' | 'high' | 'power';
  [key: string]: string | number | null | undefined;
}): void {
  setAnalyticsUserProperties(dimensions);
}

/**
 * Determine user type (new vs returning) based on first visit
 */
function determineUserType(): 'new' | 'returning' {
  try {
    const firstVisit = localStorage.getItem('analytics_first_visit');
    if (!firstVisit) {
      // First visit - mark as new user
      localStorage.setItem('analytics_first_visit', Date.now().toString());
      return 'new';
    }
    return 'returning';
  } catch {
    return 'returning'; // Default to returning if storage fails
  }
}

/**
 * Set navigation method for next page view
 */
export function setNavigationMethod(method: 'direct' | 'sidebar' | 'back' | 'link' | 'unknown'): void {
  journeyState.navigationMethod = method;
}

/**
 * Track button clicks
 */
export function trackClick(buttonName: string, location?: string): void {
  trackEventDual('click', {
    button_name: buttonName,
    location: location || window.location.pathname,
  });
}

/**
 * Track form submissions
 */
export function trackFormSubmit(formName: string, success: boolean = true): void {
  trackEventDual('form_submit', {
    form_name: formName,
    success: success,
  });
}

/**
 * Track navigation
 */
export function trackNavigation(from: string, to: string): void {
  trackEventDual('navigation', {
    from: from,
    to: to,
    navigation_method: journeyState.navigationMethod,
  });
}

/**
 * Track modal interactions
 */
export function trackModal(modalName: string, action: 'open' | 'close'): void {
  trackEventDual('modal', {
    modal_name: modalName,
    action: action,
  });
}

/**
 * Track tab switches
 */
export function trackTabSwitch(tabName: string, location?: string): void {
  trackEventDual('tab_switch', {
    tab_name: tabName,
    location: location || window.location.pathname,
  });
}

/**
 * Track search
 */
export function trackSearch(searchTerm: string, resultCount?: number): void {
  trackEventDual('search', {
    search_term: searchTerm,
    result_count: resultCount,
  });
}

/**
 * Track item creation
 */
export function trackCreate(itemType: string, location?: string): void {
  trackEventDual('create', {
    item_type: itemType,
    location: location || window.location.pathname,
  });
}

/**
 * Track item update
 */
export function trackUpdate(itemType: string, itemId?: string): void {
  trackEventDual('update', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track item deletion
 */
export function trackDelete(itemType: string, itemId?: string): void {
  trackEventDual('delete', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track item view
 */
export function trackView(itemType: string, itemId?: string): void {
  trackEventDual('view', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track sidebar navigation
 */
export function trackSidebarNavigation(itemName: string, url: string): void {
  setNavigationMethod('sidebar');
  trackEventDual('sidebar_navigation', {
    item_name: itemName,
    url: url,
    location: window.location.pathname,
  });
}

/**
 * Track organization switch
 */
export function trackOrgSwitch(orgId: string, orgName: string, orgType: string): void {
  trackEventDual('org_switch', {
    org_id: orgId,
    org_name: orgName,
    org_type: orgType,
  });
}

/**
 * Track context selection (projects, tasks, teams, docs)
 */
export function trackContextSelect(contextType: 'project' | 'task' | 'team' | 'doc', itemId: string, action: 'select' | 'deselect'): void {
  trackEventDual('context_select', {
    context_type: contextType,
    item_id: itemId,
    action: action,
    location: window.location.pathname,
  });
}

/**
 * Track AI chat interactions
 */
export function trackAIChat(action: 'open' | 'close' | 'send_message' | 'like_message' | 'use_context', additionalParams?: {
  [key: string]: string | number | boolean | null | undefined;
}): void {
  trackEventDual('ai_chat', {
    action: action,
    ...additionalParams,
  });
}

/**
 * Track voice call interactions
 */
export function trackVoiceCall(action: 'initiate' | 'answer' | 'end' | 'mute' | 'unmute' | 'reject', callType: 'direct' | 'group', additionalParams?: {
  [key: string]: string | number | boolean | null | undefined;
}): void {
  trackEventDual('voice_call', {
    action: action,
    call_type: callType,
    ...additionalParams,
  });
}

/**
 * Track integration actions
 */
export function trackIntegration(action: 'connect' | 'disconnect' | 'configure', integrationName: string, success: boolean = true): void {
  trackEventDual('integration', {
    action: action,
    integration_name: integrationName,
    success: success,
  });
}

/**
 * Track file/image uploads
 */
export function trackUpload(fileType: 'image' | 'document' | 'other', location?: string, success: boolean = true): void {
  trackEventDual('upload', {
    file_type: fileType,
    success: success,
    location: location || window.location.pathname,
  });
}

/**
 * Track selection mode
 */
export function trackSelectionMode(action: 'enable' | 'disable', mode: 'single' | 'multiple'): void {
  trackEventDual('selection_mode', {
    action: action,
    mode: mode,
    location: window.location.pathname,
  });
}

/**
 * Track filter/search interactions
 */
export function trackFilter(filterType: string, filterValue: string | number | boolean, location?: string): void {
  trackEventDual('filter', {
    filter_type: filterType,
    filter_value: String(filterValue),
    location: location || window.location.pathname,
  });
}

/**
 * Track share actions
 */
export function trackShare(itemType: string, itemId: string, shareType: 'link' | 'email' | 'team', location?: string): void {
  trackEventDual('share', {
    item_type: itemType,
    item_id: itemId,
    share_type: shareType,
    location: location || window.location.pathname,
  });
}

/**
 * Track journey stage
 */
export function trackJourneyStage(stage: 'onboarding' | 'active' | 'power_user'): void {
  trackEventDual('journey_stage', {
    stage: stage,
  });
  
  // Also set as user property
  setAnalyticsUserProperties({ journey_stage: stage });
}

/**
 * Track time on page
 */
export function trackTimeOnPage(pagePath: string, timeSeconds: number): void {
  trackEventDual('time_on_page', {
    page_path: pagePath,
    time_seconds: timeSeconds,
  });
}

/**
 * Track scroll depth
 */
export function trackScrollDepth(pagePath: string, depth: 25 | 50 | 75 | 100): void {
  trackEventDual('scroll_depth', {
    page_path: pagePath,
    depth_percent: depth,
  });
}

/**
 * Track session end
 */
export function trackSessionEnd(): void {
  if (currentSession) {
    const duration = Math.round((Date.now() - currentSession.startTime) / 1000);
    trackEventDual('session_end', {
      session_id: currentSession.sessionId,
      duration_seconds: duration,
      event_count: currentSession.eventCount,
    });
    currentSession = null;
    try {
      sessionStorage.removeItem('analytics_session');
    } catch (error) {
      // Ignore
    }
  }
}

/**
 * Track errors
 */
export function trackError(errorType: string, errorMessage: string, errorContext?: Record<string, any>): void {
  trackEventDual('error', {
    error_type: errorType,
    error_message: errorMessage,
    component: errorContext?.component || 'unknown',
    action: errorContext?.action || 'unknown',
    user_action: errorContext?.user_action || 'unknown',
    ...errorContext,
    location: window.location.pathname,
  });
}

/**
 * Track API errors with endpoint and status code
 */
export function trackAPIError(endpoint: string, statusCode: number, errorMessage: string, errorContext?: Record<string, any>): void {
  trackEventDual('api_error', {
    endpoint: endpoint,
    status_code: statusCode,
    error_message: errorMessage,
    ...errorContext,
    location: window.location.pathname,
  });
}

/**
 * Track validation errors
 */
export function trackValidationError(formName: string, field: string, errorType: string, errorContext?: Record<string, any>): void {
  trackEventDual('validation_error', {
    form_name: formName,
    field: field,
    error_type: errorType,
    ...errorContext,
    location: window.location.pathname,
  });
}

/**
 * Track conversion events
 */
export function trackConversion(conversionName: string, value?: number, currency?: string): void {
  trackEventDual('conversion', {
    conversion_name: conversionName,
    value: value,
    currency: currency || 'USD',
  });
}

/**
 * Track engagement score
 */
export function trackEngagement(score: number, factors: Record<string, number>): void {
  trackEventDual('engagement', {
    engagement_score: score,
    ...factors,
  });
}

/**
 * Track message like/unlike
 */
export function trackMessageLike(messageId: string, action: 'like' | 'unlike', messageRole: 'user' | 'assistant'): void {
  trackEventDual('message_like', {
    message_id: messageId,
    action: action,
    message_role: messageRole,
  });
}

/**
 * Track draft response generation
 */
export function trackDraftResponse(messageId: string, success: boolean = true): void {
  trackEventDual('draft_response', {
    message_id: messageId,
    success: success,
  });
}

/**
 * Track image upload in chat
 */
export function trackImageUpload(chatId: string, imageCount: number, success: boolean = true): void {
  trackEventDual('image_upload', {
    chat_id: chatId,
    image_count: imageCount,
    success: success,
    location: window.location.pathname,
  });
}

/**
 * Track image removal from chat
 */
export function trackImageRemove(chatId: string): void {
  trackEventDual('image_remove', {
    chat_id: chatId,
    location: window.location.pathname,
  });
}

/**
 * Track context removal (project, task, team, doc)
 */
export function trackContextRemove(contextType: 'project' | 'task' | 'team' | 'doc', itemId: string): void {
  trackEventDual('context_remove', {
    context_type: contextType,
    item_id: itemId,
    location: window.location.pathname,
  });
}

/**
 * Track emoji picker usage
 */
export function trackEmojiPicker(action: 'open' | 'close' | 'select', emoji?: string): void {
  trackEventDual('emoji_picker', {
    action: action,
    emoji: emoji,
    location: window.location.pathname,
  });
}

/**
 * Track mention usage
 */
export function trackMention(action: 'detect' | 'select' | 'insert', mentionCount?: number): void {
  trackEventDual('mention', {
    action: action,
    mention_count: mentionCount,
    location: window.location.pathname,
  });
}

/**
 * Track load more messages
 */
export function trackLoadMoreMessages(chatId: string, increment: number, totalVisible: number): void {
  trackEventDual('load_more_messages', {
    chat_id: chatId,
    increment: increment,
    total_visible: totalVisible,
    location: window.location.pathname,
  });
}

/**
 * Track first-time feature usage
 * Detects and tracks when a user uses a feature for the first time
 */
export function trackFirstFeatureUse(feature: 'project' | 'task' | 'ai_chat' | 'voice_call', daysSinceSignup?: number): void {
  const storageKey = `first_${feature}_used`;
  const hasUsedBefore = localStorage.getItem(storageKey);
  
  if (hasUsedBefore) {
    return; // Already tracked
  }
  
  // Mark as used
  localStorage.setItem(storageKey, Date.now().toString());
  
  // Track the first-time use
  trackEventDual('first_feature_use', {
    feature: feature,
    days_since_signup: daysSinceSignup || null,
  });
  
  // Set user property for cohort analysis
  const firstUseDate = new Date().toISOString();
  setAnalyticsUserProperties({
    [`first_${feature}_date`]: firstUseDate,
  });
  
  // Track as conversion for onboarding funnel
  trackConversion(`first_${feature}_created`);
}

/**
 * Track home page CTA button clicks
 */
export function trackHomePageCTA(ctaName: string, location: string): void {
  trackEventDual('home_page_cta_click', {
    cta_name: ctaName,
    location: location,
    page_path: '/',
  });
}

/**
 * Track home page section visibility
 */
export function trackSectionView(sectionName: string): void {
  trackEventDual('home_page_section_view', {
    section_name: sectionName,
    page_path: '/',
  });
}

/**
 * Track demo interactions (open, close, submit)
 */
export function trackDemoInteraction(action: 'open' | 'close' | 'submit'): void {
  trackEventDual('home_page_demo', {
    action: action,
    page_path: '/',
  });
}

/**
 * Track home page scroll depth
 * Enhanced version that includes page context
 */
export function trackHomePageScroll(depth: number): void {
  trackEventDual('home_page_scroll_depth', {
    depth_percent: depth,
    page_path: '/',
  });
}

// Track session end on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    trackSessionEnd();
  });
}
