import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, initializeFirebase, isFirebaseConfigured } from '@/lib/firebase-client';
import { useToast } from '@/hooks/use-toast';
import { setAnalyticsUserId, trackEvent } from '@/lib/analytics';

// Check if demo mode is enabled
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

const STORAGE_KEYS = {
  CURRENT_ORG: 'leanworks_current_org',
  LEGACY_CUSTOM_TOKEN: 'leanworks_custom_token',
  LEGACY_USER_DATA: 'leanworks_user_data',
};

interface LoginOrganization {
  id: string;
  name: string;
  slug: string;
  type: string;
}

interface LoginResponse {
  customToken?: string;
  defaultOrgId?: string;
  organizations?: LoginOrganization[];
}

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

function getErrorDetails(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    };
  }
  return { message: 'Unknown error' };
}

function clearLegacyAuthCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.LEGACY_CUSTOM_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_USER_DATA);
  } catch (error) {
    console.warn('Failed to clear legacy authentication cache:', error);
  }
}

function saveDefaultOrganization(data: LoginResponse): void {
  if (!data.defaultOrgId || !data.organizations?.length) return;
  const defaultOrg = data.organizations.find((org) => org.id === data.defaultOrgId)
    || data.organizations[0];
  if (!defaultOrg) return;

  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_ORG, JSON.stringify({
      id: defaultOrg.id,
      name: defaultOrg.name,
      slug: defaultOrg.slug,
      type: defaultOrg.type,
    }));
  } catch (error) {
    console.warn('Failed to persist organization selection:', error);
  }
}

// Helper to safely parse JSON response
async function parseJSONResponse<T>(response: Response): Promise<T> {
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
  signUp: (email: string, password: string, firstName: string, lastName: string, jobTitle: string, timezone: string, responsibilities?: string) => Promise<void>;
  logout: () => Promise<void>;
  userDomain: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false); // True when auth is fully initialized and token is available
  const { toast } = useToast();

  // Firebase Auth owns durable session persistence. One-time custom tokens are
  // never cached by the application.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const restoreAuthState = async (retryCount = 0) => {
      try {
        // In demo mode, auto-login the demo user
        if (DEMO_MODE) {
          console.log('🎭 Demo mode: Auto-logging in demo user');

          const mockUser = {
            uid: 'demo-user-id',
            email: 'demo@example.com',
            displayName: 'Demo User',
            emailVerified: true,
            isAnonymous: false,
            metadata: {},
            providerData: [],
            refreshToken: 'demo-token',
            toJSON: () => ({}),
            getIdToken: async () => 'mock-token-demo',
            getIdTokenResult: async () => ({ token: 'mock-token-demo', expirationTime: new Date(Date.now() + 3600000).toISOString(), issuedAtTime: new Date().toISOString(), signInProvider: 'custom', signInTime: new Date().toISOString(), claims: {} }),
            reload: async () => {},
            getDisplayName: () => 'Demo User',
            getEmail: () => 'demo@example.com',
            getPhotoURL: () => null,
            getPhoneNumber: () => null,
            getProviderData: () => [],
            getRecreateEmailVerificationLink: async () => '',
            getRecreateSignInLink: async () => '',
            getRecreatePasswordEmailLink: async () => '',
            reauthenticateWithCredential: async () => ({}),
            reauthenticateWithPhoneNumber: async () => ({}),
            reauthenticateWithPopup: async () => ({}),
            reauthenticateWithRedirect: async () => {},
            reauthenticateAndRetrieveDataWithCredential: async () => ({}),
            reauthenticateWithProvider: async () => ({}),
            linkWithCredential: async () => ({}),
            linkWithPhoneNumber: async () => ({}),
            linkWithPopup: async () => ({}),
            linkWithRedirect: async () => {},
            linkWithProvider: async () => ({}),
            unlinkProvider: async () => ({}),
            updateProfile: async () => {},
            updateEmail: async () => {},
            updatePassword: async () => {},
            updatePhoneNumber: async () => {},
            sendEmailVerification: async () => {},
            sendPasswordResetEmail: async () => {},
            delete: async () => {},
          } as unknown as User;

          setUser(mockUser);
          setAuthReady(true);
          setLoading(false);

          console.log('✅ Demo mode: User authenticated');
          return;
        }

        clearLegacyAuthCache();
        
        // Ensure Firebase is initialized first
        // Force refresh on retry (useful for Safari cache issues)
        const forceRefresh = retryCount > 0;
        try {
          await initializeFirebase(forceRefresh);
          
          // Final validation: fail closed if a stale Firebase app has bad config.
          if (auth) {
            const apiKey = auth.app.options?.apiKey;
            if (apiKey && (!apiKey.startsWith('AIza') || apiKey.length <= 20 || 
                apiKey === 'AIzaSyBypassKeyForServiceAccount' || 
                apiKey === 'your-api-key')) {
              console.error('❌ Firebase Auth has invalid API key after initialization');
              console.error('❌ Firebase Auth will be disabled until configuration is corrected');
              throw new Error('Firebase Auth is not configured with a valid API key');
            }
          }
        } catch (initError: unknown) {
          const { message } = getErrorDetails(initError);
          // If initialization fails with API key error, try once more with force refresh
          if ((message.includes('No valid Firebase API key') ||
               message.includes('Invalid Firebase API key') ||
               message.includes('Existing Firebase app has invalid API key')) &&
              retryCount === 0) {
            console.warn('⚠️ Firebase initialization failed, retrying with force refresh...');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            return restoreAuthState(1);
          }
          // If retry also fails or it's a different error, log and continue
          console.error('❌ Firebase initialization failed:', message);
        }

        // If Firebase Auth is available, try to restore session
        // But only if Firebase is properly configured (has a valid API key)
        if (auth && isFirebaseConfigured()) {
          unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (!active) return;
            if (firebaseUser) {
              setUser(firebaseUser);
              setAuthReady(true);
            } else {
              setUser(null);
              setAuthReady(false);
            }
            setLoading(false);
          });
          return unsubscribe;
        } else {
          setUser(null);
          setAuthReady(false);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to restore auth state:', error);
        if (active) {
          setUser(null);
          setAuthReady(false);
          setLoading(false);
        }
      }
    };

    void restoreAuthState();
    return () => {
      active = false;
      unsubscribe?.();
    };
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
        const errorData = await parseJSONResponse<ApiErrorResponse>(response)
          .catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || 'Failed to sign in');
      }

      const data = await parseJSONResponse<LoginResponse>(response);
      if (!data.customToken) {
        throw new Error('Authentication server did not return a sign-in token');
      }
      
      if (!auth || !isFirebaseConfigured()) {
        await initializeFirebase(true);
      }
      if (!auth || !isFirebaseConfigured()) {
        throw new Error('Firebase authentication is not configured');
      }

      let credential;
      try {
        credential = await signInWithCustomToken(auth, data.customToken);
      } catch (firebaseError: unknown) {
        const { message, code } = getErrorDetails(firebaseError);
        const isApiKeyError = message.includes('api-key-not-valid')
          || code?.includes('auth/api-key-not-valid');
        if (!isApiKeyError) throw firebaseError;

        await initializeFirebase(true);
        if (!auth || !isFirebaseConfigured()) throw firebaseError;
        credential = await signInWithCustomToken(auth, data.customToken);
      }

      // Exchange the one-time custom token for a verified, refreshable ID-token
      // session. The custom token is deliberately never logged or persisted.
      await credential.user.getIdToken(true);
      saveDefaultOrganization(data);
      setUser(credential.user);
      setAuthReady(true);
      trackEvent('login', { method: 'email' });
      setAnalyticsUserId(credential.user.uid);

      toast({
        title: 'Success',
        description: 'Signed in successfully',
      });
    } catch (error: unknown) {
      if (auth?.currentUser) {
        await signOut(auth).catch(() => undefined);
      }
      clearLegacyAuthCache();
      setUser(null);
      setAuthReady(false);
      const errorMessage = getErrorDetails(error).message || 'Failed to sign in';
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
        const errorData = await parseJSONResponse<ApiErrorResponse>(response)
          .catch(() => ({ error: `Server error: ${response.status} ${response.statusText}` }));
        throw new Error(errorData.error || 'Failed to sign up');
      }

      const data = await parseJSONResponse<ApiErrorResponse>(response);

      toast({
        title: 'Success',
        description: data.message || 'Account created successfully!',
      });
    } catch (error: unknown) {
      const errorMessage = getErrorDetails(error).message || 'Failed to sign up';
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
      if (auth) {
        await signOut(auth);
      }
    } finally {
      clearLegacyAuthCache();
      try {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_ORG);
      } catch {
        // Storage can be unavailable in privacy modes; state is still cleared.
      }
      setUser(null);
      setAuthReady(false);
      trackEvent('logout');
      setAnalyticsUserId(null);
    }

    toast({ title: 'Success', description: 'Signed out successfully' });
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
