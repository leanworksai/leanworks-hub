import { getAnalytics, logEvent, Analytics, setUserId, setUserProperties, isSupported } from 'firebase/analytics';
import { getApp } from 'firebase/app';

let analytics: Analytics | null = null;
let analyticsInitialized = false;

/**
 * Initialize Firebase Analytics
 */
export async function initializeAnalytics(): Promise<void> {
  if (analyticsInitialized || analytics) {
    return;
  }

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

/**
 * Track a page view
 */
export function trackPageView(pageName: string, pagePath?: string): void {
  if (!analytics) {
    console.warn('Analytics not initialized, skipping page view tracking');
    return;
  }

  try {
    logEvent(analytics, 'page_view', {
      page_title: pageName,
      page_location: pagePath || window.location.pathname,
      page_path: pagePath || window.location.pathname,
    });
  } catch (error: any) {
    console.error('Failed to track page view:', error);
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
  if (!analytics) {
    console.warn('Analytics not initialized, skipping event tracking');
    return;
  }

  try {
    logEvent(analytics, eventName, eventParams);
  } catch (error: any) {
    console.error('Failed to track event:', error);
  }
}

/**
 * Set user ID for analytics
 */
export function setAnalyticsUserId(userId: string | null): void {
  if (!analytics) {
    return;
  }

  try {
    if (userId) {
      setUserId(analytics, userId);
    } else {
      setUserId(analytics, null);
    }
  } catch (error: any) {
    console.error('Failed to set analytics user ID:', error);
  }
}

/**
 * Set user properties for analytics
 */
export function setAnalyticsUserProperties(properties: {
  [key: string]: string | null;
}): void {
  if (!analytics) {
    return;
  }

  try {
    setUserProperties(analytics, properties);
  } catch (error: any) {
    console.error('Failed to set analytics user properties:', error);
  }
}

/**
 * Track button clicks
 */
export function trackClick(buttonName: string, location?: string): void {
  trackEvent('click', {
    button_name: buttonName,
    location: location || window.location.pathname,
  });
}

/**
 * Track form submissions
 */
export function trackFormSubmit(formName: string, success: boolean = true): void {
  trackEvent('form_submit', {
    form_name: formName,
    success: success,
  });
}

/**
 * Track navigation
 */
export function trackNavigation(from: string, to: string): void {
  trackEvent('navigation', {
    from: from,
    to: to,
  });
}

/**
 * Track modal interactions
 */
export function trackModal(modalName: string, action: 'open' | 'close'): void {
  trackEvent('modal', {
    modal_name: modalName,
    action: action,
  });
}

/**
 * Track tab switches
 */
export function trackTabSwitch(tabName: string, location?: string): void {
  trackEvent('tab_switch', {
    tab_name: tabName,
    location: location || window.location.pathname,
  });
}

/**
 * Track search
 */
export function trackSearch(searchTerm: string, resultCount?: number): void {
  trackEvent('search', {
    search_term: searchTerm,
    result_count: resultCount,
  });
}

/**
 * Track item creation
 */
export function trackCreate(itemType: string, location?: string): void {
  trackEvent('create', {
    item_type: itemType,
    location: location || window.location.pathname,
  });
}

/**
 * Track item update
 */
export function trackUpdate(itemType: string, itemId?: string): void {
  trackEvent('update', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track item deletion
 */
export function trackDelete(itemType: string, itemId?: string): void {
  trackEvent('delete', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track item view
 */
export function trackView(itemType: string, itemId?: string): void {
  trackEvent('view', {
    item_type: itemType,
    item_id: itemId,
  });
}

/**
 * Track sidebar navigation
 */
export function trackSidebarNavigation(itemName: string, url: string): void {
  trackEvent('sidebar_navigation', {
    item_name: itemName,
    url: url,
    location: window.location.pathname,
  });
}

/**
 * Track organization switch
 */
export function trackOrgSwitch(orgId: string, orgName: string, orgType: string): void {
  trackEvent('org_switch', {
    org_id: orgId,
    org_name: orgName,
    org_type: orgType,
  });
}

/**
 * Track context selection (projects, tasks, teams, docs)
 */
export function trackContextSelect(contextType: 'project' | 'task' | 'team' | 'doc', itemId: string, action: 'select' | 'deselect'): void {
  trackEvent('context_select', {
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
  trackEvent('ai_chat', {
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
  trackEvent('voice_call', {
    action: action,
    call_type: callType,
    ...additionalParams,
  });
}

/**
 * Track integration actions
 */
export function trackIntegration(action: 'connect' | 'disconnect' | 'configure', integrationName: string, success: boolean = true): void {
  trackEvent('integration', {
    action: action,
    integration_name: integrationName,
    success: success,
  });
}

/**
 * Track file/image uploads
 */
export function trackUpload(fileType: 'image' | 'document' | 'other', location?: string, success: boolean = true): void {
  trackEvent('upload', {
    file_type: fileType,
    success: success,
    location: location || window.location.pathname,
  });
}

/**
 * Track selection mode
 */
export function trackSelectionMode(action: 'enable' | 'disable', mode: 'single' | 'multiple'): void {
  trackEvent('selection_mode', {
    action: action,
    mode: mode,
    location: window.location.pathname,
  });
}

/**
 * Track filter/search interactions
 */
export function trackFilter(filterType: string, filterValue: string | number | boolean, location?: string): void {
  trackEvent('filter', {
    filter_type: filterType,
    filter_value: String(filterValue),
    location: location || window.location.pathname,
  });
}

/**
 * Track share actions
 */
export function trackShare(itemType: string, itemId: string, shareType: 'link' | 'email' | 'team', location?: string): void {
  trackEvent('share', {
    item_type: itemType,
    item_id: itemId,
    share_type: shareType,
    location: location || window.location.pathname,
  });
}

