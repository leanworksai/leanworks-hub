import { getAnalytics, logEvent, Analytics, setUserId, setUserProperties, isSupported } from 'firebase/analytics';
import { getApp } from 'firebase/app';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Firebase Analytics
let analytics: Analytics | null = null;
let analyticsInitialized = false;

// Google Analytics 4
let ga4Initialized = false;
let ga4MeasurementId: string | null = null;
let ga4ConfigFetchPromise: Promise<string | null> | null = null;

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

/**
 * Fetch GA4 Measurement ID from backend (Secret Manager) or fallback to env var
 * Uses different measurement IDs for dev vs production
 */
async function fetchGA4Config(forceRefresh = false): Promise<string | null> {
  // Return cached ID if available and not forcing refresh
  if (ga4MeasurementId && !forceRefresh) {
    return ga4MeasurementId;
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
 * Initialize Google Analytics 4
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

    // Load gtag script dynamically
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);

    // Initialize dataLayer and gtag
    (window as any).dataLayer = (window as any).dataLayer || [];
    function gtag(...args: any[]) {
      (window as any).dataLayer.push(args);
    }
    (window as any).gtag = gtag;

    gtag('js', new Date());
    gtag('config', measurementId, {
      send_page_view: false, // We'll handle page views manually
    });

    ga4Initialized = true;
    console.log('✅ Google Analytics 4 initialized');
  } catch (error: any) {
    console.error('❌ Failed to initialize Google Analytics 4:', error);
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
  initializeGA4().catch(error => {
    console.error('Failed to initialize GA4:', error);
  });
  
  // Initialize session
  initializeSession();
  
  // Initialize is_logged_in property (defaults to false for anonymous users)
  // This will be updated when user logs in via setAnalyticsUserId
  setAnalyticsUserProperties({
    is_logged_in: false,
  });
}

/**
 * Initialize or restore session
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

    // Track session start
    trackEventDual('session_start', {
      session_id: sessionId,
    });
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
 * Send event to Google Analytics 4
 */
function gtagEvent(eventName: string, eventParams?: Record<string, any>): void {
  if (!ga4Initialized || !ga4MeasurementId) {
    return;
  }

  try {
    const gtag = (window as any).gtag;
    if (gtag) {
      gtag('event', eventName, {
        ...eventParams,
        session_id: currentSession?.sessionId,
      });
    }
  } catch (error: any) {
    console.error('Failed to send GA4 event:', error);
  }
}

/**
 * Send event to both Firebase Analytics and GA4
 */
function trackEventDual(
  eventName: string,
  eventParams?: {
    [key: string]: string | number | boolean | null | undefined;
  }
): void {
  // Update session activity
  updateSessionActivity();

  // Add journey context to event params
  const enrichedParams = {
    ...eventParams,
    session_id: currentSession?.sessionId || 'unknown',
    previous_page: journeyState.previousPage || null,
    navigation_method: journeyState.navigationMethod,
  };

  // Send to Firebase Analytics (only in production)
  if (!import.meta.env.DEV && analytics) {
    try {
      logEvent(analytics, eventName, enrichedParams);
    } catch (error: any) {
      console.error('Failed to send Firebase event:', error);
    }
  }

  // Send to GA4 (always enabled)
  gtagEvent(eventName, enrichedParams);
}

/**
 * Track a page view
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

  // Track page view to both platforms
  trackEventDual('page_view', {
    page_title: pageName,
    page_location: pagePathValue,
    page_path: pagePathValue,
    time_on_previous_page: timeOnPreviousPage,
  });

  // Also send GA4 page_view event (standard GA4 event)
  if (ga4Initialized && ga4MeasurementId) {
    try {
      const gtag = (window as any).gtag;
      if (gtag) {
        gtag('event', 'page_view', {
          page_title: pageName,
          page_location: window.location.href,
          page_path: pagePathValue,
        });
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
      if (gtag) {
        gtag('config', ga4MeasurementId, {
          user_id: userId || undefined,
        });
        // Automatically set is_logged_in property for easy segmentation
        gtag('set', {
          is_logged_in: isLoggedIn,
        });
      }
    } catch (error: any) {
      console.error('Failed to set GA4 user ID:', error);
    }
  }
}

/**
 * Set user properties for analytics
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
  if (ga4Initialized && ga4MeasurementId) {
    try {
      const gtag = (window as any).gtag;
      if (gtag) {
        // GA4 uses set to update user properties
        Object.entries(properties).forEach(([key, value]) => {
          if (value !== null) {
            gtag('set', { [key]: value });
          }
        });
      }
    } catch (error: any) {
      console.error('Failed to set GA4 user properties:', error);
    }
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
