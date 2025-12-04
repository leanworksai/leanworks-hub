import { initializeApp, getApps, FirebaseApp, deleteApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { initializeAnalytics } from './analytics';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Firebase web app configuration
// First try to fetch from backend API (Secret Manager), fallback to env vars
let firebaseConfig: any = null;
let configFetchPromise: Promise<any> | null = null;
let configFetchError: Error | null = null;

// Helper to validate API key format
function isValidApiKey(apiKey: string | undefined | null): boolean {
  if (!apiKey) return false;
  // Firebase API keys typically start with "AIza" and are longer than 20 chars
  return apiKey.startsWith('AIza') && apiKey.length > 20 && 
         apiKey !== 'AIzaSyBypassKeyForServiceAccount' &&
         apiKey !== 'your-api-key';
}

async function fetchFirebaseConfig(forceRefresh = false, retryCount = 0): Promise<any> {
  // Clear cache if force refresh is requested (useful for Safari cache issues)
  if (forceRefresh) {
    firebaseConfig = null;
    configFetchError = null;
  }

  // Return cached config if available and not forcing refresh
  if (firebaseConfig && !forceRefresh) {
    return firebaseConfig;
  }

  // If fetch is already in progress, return that promise
  if (configFetchPromise && !forceRefresh) {
    return configFetchPromise;
  }

  // Start fetching config
  configFetchPromise = (async () => {
    const maxRetries = 3;
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s

    try {
      // Try to fetch from backend API (Secret Manager)
      // Note: API_BASE already includes /api in production, but in dev it's just the base URL
      const apiUrl = import.meta.env.DEV 
        ? `${API_BASE}/api/firebase-config` 
        : `${API_BASE}/firebase-config`;
      
      // Add cache-busting query param for Safari (Safari is aggressive with caching)
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
        const config = await response.json();
        
        // Validate the config has a valid API key
        if (!isValidApiKey(config.apiKey)) {
          const errorMsg = `Invalid API key in config from backend: ${config.apiKey ? config.apiKey.substring(0, 20) + '...' : 'missing'}`;
          console.error('❌', errorMsg);
          console.error('❌ Backend returned invalid config. This should not happen. Check server logs.');
          throw new Error(errorMsg);
        }

        firebaseConfig = config;
        configFetchError = null;
        return config;
      } else {
        // Log the error response for debugging
        let errorText = '';
        try {
          errorText = await response.text();
          console.error(`❌ Backend returned error ${response.status}:`, errorText.substring(0, 200));
        } catch (e) {
          console.error(`❌ Backend returned error ${response.status} (could not read response body)`);
        }
        
        // If we get a 400 error, clear cache and retry
        if (response.status === 400 && retryCount < maxRetries) {
          console.warn(`⚠️ Got 400 error from backend, clearing cache and retrying (attempt ${retryCount + 1}/${maxRetries})...`);
          firebaseConfig = null;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return fetchFirebaseConfig(true, retryCount + 1);
        }
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}${errorText ? ` - ${errorText.substring(0, 100)}` : ''}`);
      }
    } catch (error: any) {
      // If retries exhausted or non-retryable error, try fallback
      if (retryCount < maxRetries && !error.message?.includes('Invalid API key')) {
        console.warn(`⚠️ Fetch failed, retrying (attempt ${retryCount + 1}/${maxRetries})...`, error.message);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return fetchFirebaseConfig(forceRefresh, retryCount + 1);
      }

      console.error('❌ Failed to fetch Firebase config from backend:', error.message);
      console.error('❌ This could be due to:');
      console.error('   1. Network/CORS issues');
      console.error('   2. Backend endpoint not accessible');
      console.error('   3. Backend returning invalid data');
      configFetchError = error;
      
      // Fallback to environment variables only if they have a valid API key
      const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (isValidApiKey(envApiKey)) {
        console.warn('⚠️ Using environment variable API key as fallback (backend fetch failed)');
        const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';
        const config = {
          apiKey: envApiKey,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : 'leanworks.firebaseapp.com'),
          projectId: projectId,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : 'leanworks.appspot.com'),
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
          appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abcdef',
        };
        firebaseConfig = config;
        console.log('✅ Using Firebase config from environment variables');
        return config;
      } else {
        // No valid API key available - throw error instead of using invalid key
        const errorMsg = 'No valid Firebase API key available. Backend config fetch failed and environment variable is also invalid.';
        console.error('❌', errorMsg);
        console.error('❌ This is a configuration error. Please:');
        console.error('   1. Check that the backend /api/firebase-config endpoint is working');
        console.error('   2. Or set a valid VITE_FIREBASE_API_KEY environment variable');
        throw new Error(errorMsg);
      }
    } finally {
      configFetchPromise = null;
    }
  })();

  return configFetchPromise;
}

// Initialize Firebase with error handling
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let initPromise: Promise<void> | null = null;

async function initializeFirebase(forceRefresh = false): Promise<void> {
  // First, check for existing invalid apps and clear them
  if (getApps().length > 0) {
    const existingApp = getApps()[0];
    const existingApiKey = existingApp.options?.apiKey;
    if (!isValidApiKey(existingApiKey)) {
      console.warn('⚠️ Found existing Firebase app with invalid API key, clearing references...');
      // We can't delete the app, but we can clear our references and prevent using it
      app = null;
      auth = null;
      db = null;
      firebaseConfig = null;
      // Clear init promise to force re-initialization
      initPromise = null;
      forceRefresh = true; // Force refresh to get new config
    }
  }
  
  // If forcing refresh, clear the init promise to allow re-initialization
  if (forceRefresh) {
    initPromise = null;
    firebaseConfig = null; // Clear cached config
    // Clear any existing apps if we're forcing refresh (for Safari cache issues)
    if (getApps().length > 0) {
      console.log('🔄 Force refresh requested, will re-initialize Firebase');
    }
  }

  if (initPromise && !forceRefresh) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Fetch config first
      const config = await fetchFirebaseConfig(forceRefresh);
      
      // Validate config before using it
      if (!isValidApiKey(config.apiKey)) {
        throw new Error('Invalid Firebase API key in configuration');
      }


      // Check if there are existing apps before initializing
      const existingApps = getApps();
      if (existingApps.length > 0) {
        const existingApp = existingApps[0];
        const existingApiKey = existingApp.options?.apiKey;
        
        // If existing app has invalid key, we cannot use it
        if (!isValidApiKey(existingApiKey)) {
          console.error('❌ Cannot initialize: Existing Firebase app has invalid API key');
          console.error('❌ This usually means the page needs to be refreshed to clear cached invalid config');
          throw new Error('Existing Firebase app has invalid API key. Please refresh the page.');
        }
        
        // If existing app has valid key, use it
        if (existingApiKey === config.apiKey) {
          app = existingApp;
        } else if (forceRefresh) {
          // Config differs but we're forcing refresh
          // We can't re-initialize, so warn but use existing app
          console.warn('⚠️ Config API key differs from existing app, but cannot re-initialize');
          console.warn('⚠️ Using existing app. If issues occur, please refresh the page.');
          app = existingApp;
        } else {
          // Config differs but not forcing refresh - use existing
          app = existingApp;
        }
      } else {
        // No existing apps, initialize new one
        app = initializeApp(config);
      }
      
      // Final validation before initializing services
      const finalApiKey = app.options?.apiKey;
      if (!isValidApiKey(finalApiKey)) {
        throw new Error('Invalid API key detected before initializing Firebase services');
      }
      
      // Initialize Firebase services
      auth = getAuth(app);
      // Try to use the same named database as backend
      // If this causes errors, the database might need to be configured for client access
      try {
        db = getFirestore(app, 'leanworks-prod');
        console.log('✅ Firestore client: Using named database "leanworks-prod"');
      } catch (dbError: any) {
        console.warn('⚠️ Firestore client: Failed to use named database, falling back to default', {
          error: dbError.message,
        });
        db = getFirestore(app);
        console.log('✅ Firestore client: Using default database');
      }
      
      // Ensure Firestore is online and wait for it to be ready
      try {
        const { enableNetwork, waitForPendingWrites } = await import('firebase/firestore');
        // Make sure we're online
        console.log('🔄 Firestore: Enabling network...');
        try {
          await enableNetwork(db);
          console.log('✅ Firestore: enableNetwork() succeeded');
        } catch (enableError: any) {
          console.error('❌ Firestore: enableNetwork() failed', {
            error: enableError,
            code: enableError?.code,
            message: enableError?.message,
          });
        }
        
        // Wait for any pending writes to complete
        try {
          await waitForPendingWrites(db);
          console.log('✅ Firestore: waitForPendingWrites() succeeded');
        } catch (waitError: any) {
          console.warn('⚠️ Firestore: waitForPendingWrites() failed (might be OK if no pending writes)', {
            error: waitError,
            code: waitError?.code,
            message: waitError?.message,
          });
        }
        
        console.log('✅ Firestore: Network setup complete');
      } catch (networkError: any) {
        console.error('❌ Firestore: Network setup failed', {
          error: networkError,
          message: networkError?.message,
        });
      }
      
      // Initialize Analytics
      try {
        await initializeAnalytics();
      } catch (analyticsError: any) {
        console.warn('⚠️ Analytics initialization failed (non-critical):', analyticsError.message);
      }
    } catch (error: any) {
      // If initialization fails due to invalid API key, don't proceed
      if (error.message?.includes('No valid Firebase API key') || 
          error.message?.includes('Invalid Firebase API key')) {
        console.error('❌ Firebase initialization failed: Invalid API key configuration');
        console.error('❌ This usually means the backend config endpoint is not accessible or returned invalid data');
        // Don't try to use invalid config - let the auth context handle it
        app = null;
        auth = null;
        db = null;
        throw error;
      }

      // For other errors, log but try to continue
      console.error('❌ Firebase initialization error:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });
      
      // Try to get existing app if available
      try {
        if (getApps().length > 0) {
          app = getApps()[0];
          const existingApiKey = app.options?.apiKey;
          if (isValidApiKey(existingApiKey)) {
            auth = getAuth(app);
            db = getFirestore(app);
            console.log('⚠️ Using existing Firebase app despite initialization error');
          } else {
            console.error('❌ Existing Firebase app has invalid API key, cannot use it');
            app = null;
            auth = null;
            db = null;
          }
        }
      } catch (e: any) {
        console.error('❌ Could not initialize Firebase services:', e.message);
        app = null;
        auth = null;
        db = null;
      }
    }
  })();

  return initPromise;
}

// Check for existing invalid Firebase apps on module load
// This prevents using cached invalid configs (common in Safari)
function checkExistingInvalidApps(): boolean {
  if (typeof window === 'undefined') return false;
  
  if (getApps().length > 0) {
    const existingApp = getApps()[0];
    const existingApiKey = existingApp.options?.apiKey;
    if (!isValidApiKey(existingApiKey)) {
      console.error('❌ Detected existing Firebase app with invalid API key on page load');
      console.error('❌ API key:', existingApiKey?.substring(0, 30) + '...');
      console.error('❌ This is likely from a cached invalid config (common in Safari)');
      console.error('❌ Attempting to clear invalid app...');
      
      // Try to delete the invalid app so we can re-initialize with valid config
      try {
        // Note: We can't easily delete Firebase apps, but we can prevent using them
        // Clear our references
        app = null;
        auth = null;
        db = null;
        firebaseConfig = null;
        console.log('✅ Cleared references to invalid Firebase app');
        return true; // Indicates we found and cleared an invalid app
      } catch (error) {
        console.error('❌ Could not clear invalid Firebase app:', error);
        return true; // Still indicate we found an invalid app
      }
    }
  }
  return false;
}

// Check immediately on module load (before any initialization)
const hasInvalidApp = checkExistingInvalidApps();

// Runtime check to detect if Firebase was initialized with invalid API key
// This prevents using Firebase Auth when the API key is invalid
function checkAndWarnInvalidApiKey() {
  // Check any existing apps first
  if (getApps().length > 0) {
    const existingApp = getApps()[0];
    const existingApiKey = existingApp.options?.apiKey;
    if (!isValidApiKey(existingApiKey)) {
      // If we detect an invalid app, clear our references
      // Note: We can't prevent Firebase SDK from making background API calls,
      // but we can prevent our code from using Firebase Auth
      // The app will still work with custom tokens for API authentication
      if (app === existingApp) {
        // Only log once to avoid console spam
        if (!(window as any).__firebaseInvalidKeyWarned) {
          console.warn('⚠️ Firebase has invalid API key - Firebase Auth disabled');
          console.warn('⚠️ App will work with custom tokens for API authentication');
          console.warn('⚠️ Firebase API errors in console are non-critical and can be ignored');
          (window as any).__firebaseInvalidKeyWarned = true;
        }
        app = null;
        auth = null;
        db = null;
      }
      return; // Don't proceed with any Firebase Auth operations
    }
  }
  
  // Check our app reference
  if (app && auth) {
    const apiKey = app.options?.apiKey;
    if (!isValidApiKey(apiKey)) {
      if (!(window as any).__firebaseInvalidKeyWarned) {
        console.warn('⚠️ Firebase has invalid API key - Firebase Auth disabled');
        console.warn('⚠️ App will work with custom tokens for API authentication');
        (window as any).__firebaseInvalidKeyWarned = true;
      }
      // Set to null so auth context knows not to use it
      app = null;
      auth = null;
      db = null;
    }
  }
}

// DO NOT initialize Firebase immediately at module load
// Let AuthContext handle initialization after checking for invalid apps
// This prevents Safari from caching invalid configs
// initializeFirebase().catch(console.error); // REMOVED - let AuthContext handle it

// Export with fallback - these will be null if initialization failed
// but we'll handle that in the auth context
export { auth, db, initializeFirebase, checkAndWarnInvalidApiKey };

// Export a function to check if Firebase is properly configured
export function isFirebaseConfigured(): boolean {
  if (!auth || !app) return false;
  const apiKey = app.options?.apiKey;
  return isValidApiKey(apiKey);
}

// Export test function for debugging (accessible from browser console)
if (typeof window !== 'undefined') {
  (window as any).testFirestoreWrite = async () => {
    if (!db) {
      console.error('❌ Firestore db is null');
      return;
    }
    if (!auth?.currentUser) {
      console.error('❌ User not authenticated');
      return;
    }
    
    try {
      const { doc, setDoc, getDoc } = await import('firebase/firestore');
      const testRef = doc(db, 'orgs/test/calls', 'test-' + Date.now());
      console.log('🧪 Testing Firestore write...', { path: testRef.path });
      
      const testData = { test: true, timestamp: new Date(), user: auth.currentUser.email };
      await setDoc(testRef, testData);
      console.log('✅ Firestore write test succeeded!');
      
      // Verify it was written
      const verify = await getDoc(testRef);
      console.log('✅ Firestore read test - document exists:', verify.exists());
    } catch (err: any) {
      console.error('❌ Firestore write test failed:', {
        error: err,
        code: err.code,
        message: err.message,
      });
    }
  };
}

export default app;

