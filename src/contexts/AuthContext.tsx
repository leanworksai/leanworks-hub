import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, initializeFirebase, checkAndWarnInvalidApiKey, isFirebaseConfigured } from '@/lib/firebase-client';
import { useToast } from '@/hooks/use-toast';
import { setAnalyticsUserId, setAnalyticsUserProperties, trackEvent, trackJourneyStage } from '@/lib/analytics';
import { getAuthToken } from '@/services/api';
import { calculateJourneyStage, calculateDaysSinceSignup } from '@/lib/journey-tracker';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Storage keys for persistence
const STORAGE_KEYS = {
  CUSTOM_TOKEN: 'leanworks_custom_token',
  USER_DATA: 'leanworks_user_data',
  CURRENT_ORG: 'leanworks_current_org',
};

// Store custom token for API requests (bypasses Firebase Auth if needed)
let storedCustomToken: string | null = null;

// Helper functions for localStorage
const storage = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('Failed to read from localStorage:', error);
      return null;
    }
  },
  set: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('Failed to write to localStorage:', error);
    }
  },
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('Failed to remove from localStorage:', error);
    }
  },
  clear: (): void => {
    try {
      // Clear auth-related keys but preserve org selection
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER_DATA);
      // Don't clear CURRENT_ORG - preserve user's org selection across sessions
    } catch (error) {
      console.warn('Failed to clear localStorage:', error);
    }
  },
};

// Helper to safely parse JSON response
async function parseJSONResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 100)}`);
  }
  return response.json();
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  authReady: boolean; // True when authentication is fully initialized and ready to use (token is available)
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string, jobTitle: string, responsibilities?: string) => Promise<void>;
  logout: () => Promise<void>;
  userDomain: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false); // True when auth is fully initialized and token is available
  const { toast } = useToast();

  // Restore authentication state from localStorage on mount
  useEffect(() => {
    const restoreAuthState = async (retryCount = 0) => {
      try {
        // Check for invalid API key in existing Firebase app (from cache or previous load)
        // This is especially important for Safari which aggressively caches
        checkAndWarnInvalidApiKey();
        
        // Ensure Firebase is initialized first
        // Force refresh on retry (useful for Safari cache issues)
        const forceRefresh = retryCount > 0;
        try {
          await initializeFirebase(forceRefresh);
          // Double-check after initialization to ensure we didn't get an invalid key
          checkAndWarnInvalidApiKey();
          
          // Final validation: if auth exists but has invalid key, we can't use it
          // The checkAndWarnInvalidApiKey function should have already handled this
          // But we do a final check here to be safe
          if (auth) {
            const apiKey = auth.app.options?.apiKey;
            if (apiKey && (!apiKey.startsWith('AIza') || apiKey.length <= 20 || 
                apiKey === 'AIzaSyBypassKeyForServiceAccount' || 
                apiKey === 'your-api-key')) {
              console.error('❌ Firebase Auth has invalid API key after initialization');
              console.error('❌ Firebase Auth will be disabled, but custom tokens will still work for API calls');
              // Note: We can't set auth to null here as it's imported, but checkAndWarnInvalidApiKey handles it
            }
          }
        } catch (initError: any) {
          // If initialization fails with API key error, try once more with force refresh
          if ((initError.message?.includes('No valid Firebase API key') || 
               initError.message?.includes('Invalid Firebase API key') ||
               initError.message?.includes('Existing Firebase app has invalid API key')) && 
              retryCount === 0) {
            console.warn('⚠️ Firebase initialization failed, retrying with force refresh...');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            return restoreAuthState(1);
          }
          // If retry also fails or it's a different error, log and continue
          console.error('❌ Firebase initialization failed:', initError.message);
          // Check again after error
          checkAndWarnInvalidApiKey();
        }

        // Restore custom token
        const savedToken = storage.get(STORAGE_KEYS.CUSTOM_TOKEN);
        if (savedToken) {
          storedCustomToken = savedToken;
          (window as any).__customToken = savedToken;
        }

        // Restore user data
        const savedUserData = storage.get(STORAGE_KEYS.USER_DATA);
        if (savedUserData) {
          try {
            const userData = JSON.parse(savedUserData);
            // Create a mock user object from saved data
            const restoredUser = {
              uid: userData.uid,
              email: userData.email,
              emailVerified: userData.emailVerified ?? false,
            } as User;
            setUser(restoredUser);
            // If we have saved data and a token, auth is ready
            if (savedToken) {
              setAuthReady(true);
            }
          } catch (parseError) {
            console.warn('Failed to parse saved user data:', parseError);
          }
        }

        // If Firebase Auth is available, try to restore session
        // But only if Firebase is properly configured (has a valid API key)
        if (auth && isFirebaseConfigured()) {
          // If we have a saved token, try to restore the session
          if (savedToken) {
            // Double-check API key is valid before attempting sign-in
            const apiKey = auth.app.options?.apiKey;
            const hasValidApiKey = apiKey && 
                                   apiKey.startsWith('AIza') && 
                                   apiKey.length > 20 &&
                                   apiKey !== 'AIzaSyBypassKeyForServiceAccount' &&
                                   apiKey !== 'your-api-key';
            
            if (hasValidApiKey) {
              try {
                await signInWithCustomToken(auth, savedToken);
                
                // Wait for auth.currentUser to be available
                let authReady = false;
                const maxWaitTime = 3000; // 3 seconds max wait
                const checkInterval = 50; // Check every 50ms
                const startTime = Date.now();

                while (!authReady && (Date.now() - startTime) < maxWaitTime) {
                  if (auth.currentUser?.email) {
                    authReady = true;
                    break;
                  }
                  await new Promise(resolve => setTimeout(resolve, checkInterval));
                }

                if (!auth.currentUser?.email) {
                  console.warn('Firebase Auth currentUser not available after restoring token');
                }
              } catch (error: any) {
                // If we get an API key error, try to force refresh Firebase config
                if (error.message?.includes('api-key-not-valid') && retryCount === 0) {
                  console.warn('⚠️ API key error during token restore, retrying with force refresh...');
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  // Force refresh Firebase config and retry
                  try {
                    await initializeFirebase(true);
                    if (auth) {
                      await signInWithCustomToken(auth, savedToken);
                    }
                  } catch (retryError) {
                    console.error('❌ Retry also failed:', retryError);
                    storage.remove(STORAGE_KEYS.CUSTOM_TOKEN);
                  }
                  return;
                }
                
                // If restoring fails (token expired, invalid, etc.), silently continue
                // The onAuthStateChanged listener will handle the state
                // Only log if it's not the expected API key error
                if (!error.message?.includes('api-key-not-valid') && 
                    !error.message?.includes('INVALID_CUSTOM_TOKEN') &&
                    !error.message?.includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN')) {
                  console.debug('Failed to restore Firebase Auth session (token may be expired):', error.message);
                }
                // Clear invalid token
                storage.remove(STORAGE_KEYS.CUSTOM_TOKEN);
              }
            } else {
              // Firebase not properly configured, skip token restoration
              console.warn('⚠️ Skipping token restoration - Firebase API key is invalid');
              console.warn('⚠️ Custom tokens will still work for API authentication');
            }
          }

          const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
              setUser(firebaseUser);
              // Save user data to localStorage
              storage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                emailVerified: firebaseUser.emailVerified,
              }));
              // Firebase Auth is ready, auth is ready
              setAuthReady(true);
            } else if (savedUserData) {
              // If Firebase Auth says no user but we have saved data, keep the saved user
              // This handles cases where Firebase Auth isn't fully initialized
            } else {
              setUser(null);
              // Clear cache if no user
              storage.clear();
              setAuthReady(false);
            }
            setLoading(false);
          });
          return unsubscribe;
        } else {
          // If auth is not initialized, use cached data
          // If no cached data, clear everything
          if (!savedUserData && !savedToken) {
            storage.clear();
          }
          // If we have saved data and a token, auth is ready even without Firebase Auth
          if (savedUserData && savedToken) {
            setAuthReady(true);
          }
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to restore auth state:', error);
        setLoading(false);
      }
    };

    restoreAuthState();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      // Get custom token from server (uses service account)
      // Server validates credentials and creates user if needed
      const url = import.meta.env.DEV ? `${API_BASE}/api/auth/login` : `${API_BASE}/auth/login`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await parseJSONResponse(response).catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || 'Failed to sign in');
      }

      const data = await parseJSONResponse(response);
      
      // Store custom token for API requests (accessible globally)
      storedCustomToken = data.customToken;
      (window as any).__customToken = data.customToken;
      
      // Persist custom token to localStorage
      storage.set(STORAGE_KEYS.CUSTOM_TOKEN, data.customToken);
      
      // Create user object
      const userData = {
        uid: data.user.uid,
        email: data.user.email,
        emailVerified: data.user.emailVerified ?? false,
      };
      
      // Persist user data to localStorage
      storage.set(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
      
      // Store default org ID if provided by login response
      if (data.defaultOrgId && data.organizations?.length > 0) {
        const defaultOrg = data.organizations.find((org: any) => org.id === data.defaultOrgId) || data.organizations[0];
        if (defaultOrg) {
          storage.set(STORAGE_KEYS.CURRENT_ORG, JSON.stringify({
            id: defaultOrg.id,
            name: defaultOrg.name,
            slug: defaultOrg.slug,
            type: defaultOrg.type,
          }));
        }
      }
      
      // Try to sign in with custom token (may fail if Firebase not initialized properly)
      // Only attempt if Firebase is properly configured
      if (auth && isFirebaseConfigured()) {
        try {
          console.log('Attempting to sign in with custom token...');
          
          await signInWithCustomToken(auth, data.customToken);
          console.log('signInWithCustomToken completed successfully');
          
          // Force refresh the ID token to ensure it includes the email claim
          // This is important for Firestore security rules that check request.auth.token.email
          if (auth.currentUser) {
            try {
              await auth.currentUser.getIdToken(true); // Force refresh
              console.log('✅ ID token refreshed after sign-in');
            } catch (tokenError: any) {
              console.warn('⚠️ Failed to refresh ID token (non-critical):', tokenError.message);
            }
          }
          
          // Wait for auth.currentUser to be available using onAuthStateChanged
          // This is more reliable than polling
          const firebaseAuthReady = await new Promise<boolean>((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                console.warn('Timeout waiting for auth.currentUser after signInWithCustomToken');
                resolve(false);
              }
            }, 5000); // 5 second timeout

            const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
              if (!resolved) {
                if (firebaseUser?.email) {
                  if (import.meta.env.DEV) {
                    console.log('✅ Firebase Auth currentUser is ready after sign-in');
                  }
                  resolved = true;
                  clearTimeout(timeout);
                  unsubscribe();
                  resolve(true);
                } else if (firebaseUser === null && resolved === false) {
                  // User is null, but we haven't resolved yet - wait a bit more
                  // This might happen during the transition
                }
              }
            });

            // Also check immediately in case it's already set
            if (auth.currentUser?.email) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                unsubscribe();
                resolve(true);
              }
            }
          });

          if (!firebaseAuthReady) {
            console.error('❌ Firebase Auth currentUser not available after sign-in');
            console.error('Auth state:', {
              hasAuth: !!auth,
              currentUser: auth.currentUser,
              currentUserEmail: auth.currentUser?.email,
            });
          } else {
            // Firebase Auth is ready, set authReady state
            setAuthReady(true);
          }
          
          // onAuthStateChanged will update the user state
        } catch (firebaseError: any) {
          // If we get an API key error, try to refresh and retry once
          if (firebaseError.message?.includes('api-key-not-valid') || 
              firebaseError.code?.includes('auth/api-key-not-valid')) {
            console.warn('⚠️ API key error detected, attempting to refresh Firebase config and retry...');
            try {
              await initializeFirebase(true); // Force refresh
              // Wait a bit for refresh to complete
              await new Promise(resolve => setTimeout(resolve, 500));
              // Retry sign-in
              if (auth) {
                await signInWithCustomToken(auth, data.customToken);
                console.log('✅ Sign-in successful after config refresh');
                return; // Success, exit early
              }
            } catch (retryError: any) {
              console.error('❌ Retry after config refresh also failed:', retryError);
              // Fall through to error handling below
            }
          }
          
          // Log the full error for debugging
          console.error('❌ Firebase Auth sign-in failed:', {
            message: firebaseError.message,
            code: firebaseError.code,
            stack: firebaseError.stack,
            customTokenLength: data.customToken?.length,
            customTokenPrefix: data.customToken?.substring(0, 20),
          });
          
          // Check for specific error types
          if (firebaseError.code === 'auth/invalid-custom-token' || 
              firebaseError.message?.includes('INVALID_CUSTOM_TOKEN')) {
            console.error('❌ Custom token is invalid. This might mean:');
            console.error('   - The token has expired');
            console.error('   - The token was created for a different Firebase project');
            console.error('   - The token format is incorrect');
          } else if (firebaseError.code === 'auth/custom-token-mismatch') {
            console.error('❌ Custom token project mismatch');
          } else if (firebaseError.code === 'auth/credential-too-old-login-again') {
            console.error('❌ Custom token is too old, user needs to log in again');
          }
          
          // If Firebase Auth fails, we'll still proceed with the custom token for API requests
          // The custom token will be used directly for API requests
          // Only log if it's not the expected API key error
          if (!firebaseError.message?.includes('api-key-not-valid') && 
              !firebaseError.code?.includes('auth/api-key-not-valid')) {
            console.warn('⚠️ Firebase Auth sign-in failed, but will use custom token for API requests');
            console.warn('⚠️ Note: Firestore operations may fail without auth.currentUser');
          }
          // Create a mock user object for state management
          setUser(userData as User);
          // Custom token is available, auth is ready
          setAuthReady(true);
          // Track login
          trackEvent('login', { method: 'email' });
          setAnalyticsUserId(userData.uid);
          
          // Set comprehensive user properties
          const defaultOrg = data.organizations?.find((org: any) => org.id === data.defaultOrgId) || data.organizations?.[0];
          setComprehensiveUserProperties(
            userData.email || '',
            defaultOrg?.id,
            defaultOrg?.type
          );
        }
      } else {
        // Firebase Auth is not available or not properly configured
        if (!auth) {
          console.warn('⚠️ Firebase Auth is not initialized (auth is null)');
          // Try to initialize if auth is null
          try {
            await initializeFirebase(true);
            if (auth && isFirebaseConfigured() && data.customToken) {
              try {
                await signInWithCustomToken(auth, data.customToken);
                console.log('✅ Sign-in successful after initialization');
                setAuthReady(true);
              } catch (initSignInError) {
                console.warn('⚠️ Sign-in failed after initialization, using mock user');
                setUser(userData as User);
                // Custom token is still available, auth is ready
                setAuthReady(true);
              }
            } else {
              setUser(userData as User);
              // Custom token is available, auth is ready
              setAuthReady(true);
            }
          } catch (initError) {
            console.error('❌ Failed to initialize Firebase:', initError);
            setUser(userData as User);
            // Custom token is available, auth is ready
            setAuthReady(true);
          }
        } else {
          // Auth exists but is not properly configured (invalid API key)
          console.warn('⚠️ Firebase Auth is not properly configured (invalid API key)');
          console.warn('⚠️ Using custom token for API authentication only');
          setUser(userData as User);
          // Custom token is available, auth is ready
          setAuthReady(true);
        }
      }

      toast({
        title: 'Success',
        description: 'Signed in successfully',
      });
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to sign in';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string, jobTitle: string, timezone: string, responsibilities?: string) => {
    try {
      // Create user via server API (uses service account)
      const url = import.meta.env.DEV ? `${API_BASE}/api/auth/signup` : `${API_BASE}/auth/signup`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, jobTitle, timezone, responsibilities }),
      });

      if (!response.ok) {
        const errorData = await parseJSONResponse(response).catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || 'Failed to sign up');
      }

      const data = await parseJSONResponse(response);

      toast({
        title: 'Success',
        description: data.message || 'Account created successfully!',
      });
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to sign up';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Sign out from Firebase Auth if available
      if (auth) {
        try {
          await signOut(auth);
        } catch (firebaseError) {
          console.warn('Firebase sign out failed, but continuing with logout:', firebaseError);
        }
      }
      
      // Clear stored tokens
      storedCustomToken = null;
      (window as any).__customToken = null;
      
      // Clear localStorage cache (including org selection on logout)
      storage.clear();
      // Also explicitly clear org selection on logout
      try {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_ORG);
      } catch (e) {
        // ignore
      }
      
      // Clear user state
      setUser(null);
      setAuthReady(false);
      
      // Track logout
      trackEvent('logout');
      setAnalyticsUserId(null);
      
      toast({
        title: 'Success',
        description: 'Signed out successfully',
      });
    } catch (error: any) {
      // Even if there's an error, clear everything
      storedCustomToken = null;
      (window as any).__customToken = null;
      storage.clear();
      // Also explicitly clear org selection on logout error
      try {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_ORG);
      } catch (e) {
        // ignore
      }
      setUser(null);
      setAuthReady(false);
      
      toast({
        title: 'Error',
        description: error.message || 'Failed to sign out',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const userDomain = user?.email ? extractDomain(user.email) : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authReady,
        signIn,
        signUp,
        logout,
        userDomain,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Extract domain from email
export function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

// Email whitelist validation is now handled on the server

/**
 * Set comprehensive analytics user properties
 */
async function setComprehensiveUserProperties(userEmail: string, orgId?: string, orgType?: string): Promise<void> {
  try {
    // Fetch user profile to get subscription plan and created_at
    const token = await getAuthToken();
    if (!token) return;

    const url = import.meta.env.DEV ? `${API_BASE}/api/users/profile` : `${API_BASE}/users/profile`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const profile = await response.json();
      const signupDate = profile.createdAt ? new Date(profile.createdAt) : null;
      const daysSinceSignup = calculateDaysSinceSignup(signupDate);

      // Calculate journey stage (simplified - would need more data for accurate calculation)
      const journeyStage = calculateJourneyStage({
        signupDate,
        firstProjectCreated: false, // Would need to check from API
        firstTaskCreated: false,
        firstAIChat: false,
        firstVoiceCall: false,
        projectsCount: 0,
        tasksCount: 0,
        daysSinceSignup,
      });

      // Set user properties
      const properties: Record<string, string | null> = {
        email: userEmail,
        org_id: orgId || null,
        org_type: orgType || null,
        plan_type: 'standard', // Default - would need to fetch from profile if available
        signup_date: signupDate ? signupDate.toISOString() : null,
        days_since_signup: daysSinceSignup.toString(),
        journey_stage: journeyStage,
      };

      setAnalyticsUserProperties(properties);
      trackJourneyStage(journeyStage);
    }
  } catch (error) {
    console.error('Failed to set comprehensive user properties:', error);
    // Set basic properties even if profile fetch fails
    setAnalyticsUserProperties({
      email: userEmail,
      org_id: orgId || null,
      org_type: orgType || null,
    });
  }
}


