/**
 * Mock Firebase Auth for demo mode
 * Provides a mock auth object that mimics Firebase authentication
 */

export interface MockUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified: boolean;
}

export interface MockAuth {
  currentUser: MockUser | null;
  onAuthStateChanged: (callback: (user: MockUser | null) => void) => () => void;
  signInWithEmailAndPassword: (email: string, password: string) => Promise<{ user: MockUser }>;
  createUserWithEmailAndPassword: (email: string, password: string) => Promise<{ user: MockUser }>;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  updateProfile: (updates: Partial<MockUser>) => Promise<void>;
}

const DEMO_USER: MockUser = {
  uid: 'demo-user-id',
  email: 'demo@example.com',
  displayName: 'Demo User',
  photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
  emailVerified: true,
};

// Create mock auth instance
export const createMockAuth = (): MockAuth => {
  let currentUser: MockUser | null = DEMO_USER;
  const listeners: ((user: MockUser | null) => void)[] = [];

  const notifyListeners = () => {
    listeners.forEach(listener => listener(currentUser));
  };

  return {
    currentUser,

    onAuthStateChanged(callback: (user: MockUser | null) => void) {
      // Immediately call with current user
      callback(currentUser);

      // Add to listeners
      listeners.push(callback);

      // Return unsubscribe function
      return () => {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      };
    },

    async signInWithEmailAndPassword(email: string, password: string) {
      // Mock validation
      if (!email || !password) {
        throw new Error('Invalid email or password');
      }

      currentUser = {
        uid: `user-${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        emailVerified: true,
      };

      notifyListeners();

      return { user: currentUser };
    },

    async createUserWithEmailAndPassword(email: string, password: string) {
      // Mock validation
      if (!email || !password) {
        throw new Error('Invalid email or password');
      }

      if (password.length < 6) {
        throw new Error('Password should be at least 6 characters');
      }

      currentUser = {
        uid: `user-${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        emailVerified: false,
      };

      notifyListeners();

      return { user: currentUser };
    },

    async signOut() {
      currentUser = null;
      notifyListeners();
    },

    async getIdToken(forceRefresh?: boolean) {
      if (!currentUser) {
        throw new Error('No user signed in');
      }

      // Generate a mock token
      return `mock-token-${currentUser.uid}-${Date.now()}`;
    },

    async updateProfile(updates: Partial<MockUser>) {
      if (!currentUser) {
        throw new Error('No user signed in');
      }

      currentUser = {
        ...currentUser,
        ...updates,
      };

      notifyListeners();
    },
  };
};

// Export a singleton instance
export const mockAuth = createMockAuth();

// Mock Firebase config
export const mockFirebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo-project',
  storageBucket: 'demo.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:demo',
  databaseURL: 'https://demo.firebaseio.com',
};

// Helper to check if demo mode is enabled
export const isDemoMode = (): boolean => {
  try {
    return import.meta.env.VITE_DEMO_MODE === 'true';
  } catch {
    return typeof process !== 'undefined' && process.env.DEMO_MODE === 'true';
  }
};

// Mock Firestore instance
export const mockFirestore = {
  collection: (collectionName: string) => ({
    doc: (docId: string) => ({
      get: async () => ({
        exists: true,
        id: docId,
        data: () => ({}),
      }),
      set: async (data: any) => ({
        writeTime: new Date().toISOString(),
      }),
      update: async (data: any) => ({
        writeTime: new Date().toISOString(),
      }),
      delete: async () => ({
        writeTime: new Date().toISOString(),
      }),
    }),
    add: async (data: any) => ({
      id: `doc-${Date.now()}`,
    }),
    query: async () => ({
      docs: [],
    }),
  }),
};

// Mock Firebase Storage
export const mockStorage = {
  ref: (path: string) => ({
    child: (childPath: string) => ({
      getDownloadURL: async () =>
        `https://storage.googleapis.com/demo-bucket/${path}/${childPath}`,
      put: async (data: any) => ({
        ref: {
          fullPath: `${path}/${childPath}`,
        },
      }),
      delete: async () => ({}),
    }),
    getDownloadURL: async () =>
      `https://storage.googleapis.com/demo-bucket/${path}`,
    put: async (data: any) => ({
      ref: {
        fullPath: path,
      },
    }),
    delete: async () => ({}),
  }),
};
