import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  User,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import { useToast } from '@/hooks/use-toast';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Storage keys for persistence
const STORAGE_KEYS = {
  CUSTOM_TOKEN: 'leanworks_custom_token',
  USER_DATA: 'leanworks_user_data',
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
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
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
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string, jobTitle: string, responsibilities?: string) => Promise<void>;
  logout: () => Promise<void>;
  userDomain: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Restore authentication state from localStorage on mount
  useEffect(() => {
    const restoreAuthState = async () => {
      try {
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
          } catch (parseError) {
            console.warn('Failed to parse saved user data:', parseError);
          }
        }

        // If Firebase Auth is available, try to restore session
        if (auth) {
          const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
              setUser(firebaseUser);
              // Save user data to localStorage
              storage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                emailVerified: firebaseUser.emailVerified,
              }));
            } else if (savedUserData) {
              // If Firebase Auth says no user but we have saved data, keep the saved user
              // This handles cases where Firebase Auth isn't fully initialized
              console.log('Firebase Auth reports no user, but using cached user data');
            } else {
              setUser(null);
              // Clear cache if no user
              storage.clear();
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
      
      // Try to sign in with custom token (may fail if Firebase not initialized properly)
      if (auth) {
        try {
          await signInWithCustomToken(auth, data.customToken);
          // onAuthStateChanged will update the user state
        } catch (firebaseError: any) {
          // If Firebase Auth fails (e.g., invalid API key), we'll still proceed
          // The custom token will be used directly for API requests
          console.warn('Firebase Auth sign-in failed, but will use custom token for API:', firebaseError.message);
          // Create a mock user object for state management
          setUser(userData as User);
        }
      } else {
        // If auth is null, create mock user
        setUser(userData as User);
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

  const signUp = async (email: string, password: string, firstName: string, lastName: string, jobTitle: string, responsibilities?: string) => {
    try {
      // Create user via server API (uses service account)
      const url = import.meta.env.DEV ? `${API_BASE}/api/auth/signup` : `${API_BASE}/auth/signup`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, jobTitle, responsibilities }),
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
      
      // Clear localStorage cache
      storage.clear();
      
      // Clear user state
      setUser(null);
      
      toast({
        title: 'Success',
        description: 'Signed out successfully',
      });
    } catch (error: any) {
      // Even if there's an error, clear everything
      storedCustomToken = null;
      (window as any).__customToken = null;
      storage.clear();
      setUser(null);
      
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

