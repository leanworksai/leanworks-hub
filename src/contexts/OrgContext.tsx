import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getAuthToken } from '@/services/api';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

// Storage key for current org
const CURRENT_ORG_KEY = 'leanworks_current_org';

// Organization types
export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: 'personal' | 'team';
  role: 'owner' | 'member';
  description?: string;
  avatar?: string;
  isOwner: boolean;
  createdAt?: string;
  joinedAt?: string;
  memberCount?: number;
}

export interface OrgInvitation {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgType: 'personal' | 'team';
  inviterEmail: string;
  inviterName: string;
  message?: string;
  createdAt: string;
  expiresAt: string;
}

export interface OrgMember {
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: 'owner' | 'member';
  jobTitle?: string;
  joinedAt: string;
}

interface OrgContextType {
  // Current organization
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization | null) => void;
  switchOrg: (orgId: string) => Promise<void>;
  
  // All user's organizations
  organizations: Organization[];
  loading: boolean;
  error: string | null;
  
  // Organization actions
  refreshOrgs: () => Promise<void>;
  createOrg: (name: string, description?: string) => Promise<Organization>;
  updateOrg: (orgId: string, updates: { name?: string; description?: string; avatar?: string }) => Promise<void>;
  deleteOrg: (orgId: string) => Promise<void>;
  leaveOrg: (orgId: string) => Promise<void>;
  
  // Invitation actions
  pendingInvitations: OrgInvitation[];
  refreshInvitations: () => Promise<void>;
  acceptInvitation: (invitationId: string) => Promise<Organization>;
  declineInvitation: (invitationId: string) => Promise<void>;
  inviteToOrg: (orgId: string, email: string, message?: string) => Promise<void>;
  
  // Member actions
  getOrgMembers: (orgId: string) => Promise<OrgMember[]>;
  removeMember: (orgId: string, memberEmail: string) => Promise<void>;
  
  // Helper to get auth headers with org context
  getOrgHeaders: () => Record<string, string>;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

// Helper to get stored token (fallback for synchronous use)
function getStoredToken(): string | null {
  try {
    return localStorage.getItem('leanworks_custom_token') || (window as any).__customToken || null;
  } catch {
    return null;
  }
}

// Helper for API calls
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  orgId?: string
): Promise<T> {
  // Use the shared getAuthToken for consistent token retrieval
  const token = await getAuthToken();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (orgId) {
    headers['X-Org-Id'] = orgId;
  }
  
  const url = import.meta.env.DEV ? `${API_BASE}/api${endpoint}` : `/api${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }
  
  return data;
}

// Helper to restore org from localStorage (synchronous)
function restoreOrgFromStorage(): Organization | null {
  try {
    const saved = localStorage.getItem(CURRENT_ORG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Return a minimal org object that will be replaced by full org data
      return {
        id: parsed.id,
        name: parsed.name,
        slug: parsed.slug,
        type: parsed.type,
        role: 'member', // Will be updated when orgs are fetched
        isOwner: false, // Will be updated when orgs are fetched
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  // Initialize from localStorage to avoid flash of "no org" on page refresh
  const [currentOrg, setCurrentOrgState] = useState<Organization | null>(() => restoreOrgFromStorage());
  const currentOrgRef = useRef<Organization | null>(currentOrg);
  const [pendingInvitations, setPendingInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    currentOrgRef.current = currentOrg;
  }, [currentOrg]);

  // Get auth headers with org context
  const getOrgHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {};
    const token = getStoredToken();
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (currentOrg) {
      headers['X-Org-Id'] = currentOrg.id;
    }
    
    return headers;
  }, [currentOrg]);

  // Set current org and persist to storage
  const setCurrentOrg = useCallback((org: Organization | null) => {
    console.log('OrgContext: setCurrentOrg called with:', org ? `${org.name} (${org.id})` : 'null');
    setCurrentOrgState(org);
    if (org) {
      try {
        const orgData = {
          id: org.id,
          name: org.name,
          slug: org.slug,
          type: org.type,
        };
        localStorage.setItem(CURRENT_ORG_KEY, JSON.stringify(orgData));
        console.log('OrgContext: Saved to localStorage:', orgData);
      } catch (e) {
        console.warn('Failed to persist current org:', e);
      }
    } else {
      try {
        localStorage.removeItem(CURRENT_ORG_KEY);
        console.log('OrgContext: Removed org from localStorage');
      } catch (e) {
        // ignore
      }
    }
  }, []);

  // Switch to a different org
  const switchOrg = useCallback(async (orgId: string) => {
    const org = organizations.find(o => o.id === orgId);
    if (org) {
      setCurrentOrg(org);
    } else {
      // Fetch org details if not in list
      try {
        const orgDetails = await apiCall<Organization>(`/orgs/${orgId}`);
        setCurrentOrg(orgDetails);
      } catch (err) {
        console.error('Failed to fetch org:', err);
        throw err;
      }
    }
  }, [organizations, setCurrentOrg]);

  // Fetch user's organizations
  const refreshOrgs = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      // Don't clear currentOrg when user is null - preserve it for when user logs in
      // Only clear if we explicitly want to reset (e.g., on logout)
      setLoading(false);
      return;
    }

    // Wait for token to be available
    const token = await getAuthToken();
    if (!token) {
      console.log('OrgContext: No token available yet, waiting...');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const orgs = await apiCall<Organization[]>('/orgs');
      setOrganizations(orgs);
      
      // Restore or set default org
      if (orgs.length > 0) {
        // Always check localStorage for saved org preference
        let savedOrgId: string | null = null;
        let savedOrgData: any = null;
        try {
          const saved = localStorage.getItem(CURRENT_ORG_KEY);
          console.log('OrgContext: Reading from localStorage:', saved);
          if (saved) {
            savedOrgData = JSON.parse(saved);
            savedOrgId = savedOrgData?.id || null;
            console.log('OrgContext: Parsed saved org data:', savedOrgData);
          }
        } catch (e) {
          console.error('OrgContext: Error parsing saved org:', e);
          // ignore
        }
        
        // Priority: Use saved org if it exists in the fetched orgs list
        if (savedOrgId) {
          // Normalize IDs for comparison (trim and lowercase)
          const normalizedSavedId = savedOrgId.trim();
          const savedOrg = orgs.find(o => {
            const normalizedOrgId = o.id.trim();
            return normalizedOrgId === normalizedSavedId;
          });
          
        if (savedOrg) {
            // Found saved org in the list - always use it (this preserves user's selection)
            console.log('OrgContext: ✅ Restoring saved org:', savedOrg.name, savedOrg.id);
          setCurrentOrg(savedOrg);
            return; // Early return to avoid fallback logic
          } else {
            console.warn('OrgContext: ⚠️ Saved org ID not found in fetched orgs:', {
              savedOrgId: normalizedSavedId,
              savedOrgIdLength: normalizedSavedId.length,
              availableOrgs: orgs.map(o => ({ 
                id: o.id, 
                idLength: o.id.length,
                name: o.name,
                matches: o.id.trim() === normalizedSavedId
              }))
            });
          }
        } else {
          console.log('OrgContext: ℹ️ No saved org ID found in localStorage');
        }
        
        // If no saved org or saved org not found, check if current org is still valid
        const currentOrgId = currentOrgRef.current?.id;
        if (currentOrgId) {
          const normalizedCurrentId = currentOrgId.trim();
          const currentOrgStillValid = orgs.find(o => o.id.trim() === normalizedCurrentId);
          if (currentOrgStillValid) {
            // Current org is still valid - but update it with full data if it matches saved org
            if (savedOrgId && normalizedCurrentId === savedOrgId.trim()) {
              // Current org matches saved org, update with full org data
              console.log('OrgContext: ✅ Current org matches saved org, updating with full data:', currentOrgStillValid.name);
              setCurrentOrg(currentOrgStillValid);
            } else {
              // Current org is valid but doesn't match saved org - keep it
              console.log('OrgContext: ✅ Keeping current org:', currentOrgRef.current.name, currentOrgRef.current.id);
            }
            return;
          }
        }
        
        // Current org is invalid or not set - fall back to personal workspace or first org
        // BUT only if there's no saved org preference (if saved org exists but wasn't found, don't override)
        const personalOrg = orgs.find(o => o.type === 'personal');
        const fallbackOrg = personalOrg || orgs[0];
        console.log('OrgContext: ⚠️ Falling back to:', fallbackOrg.name, fallbackOrg.id, '(saved org not found or no saved org)');
        setCurrentOrg(fallbackOrg);
      } else {
        setCurrentOrg(null);
      }
    } catch (err: any) {
      console.error('Failed to fetch organizations:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, setCurrentOrg]);

  // Fetch pending invitations
  const refreshInvitations = useCallback(async () => {
    if (!user) {
      setPendingInvitations([]);
      return;
    }

    // Wait for token to be available
    const token = await getAuthToken();
    if (!token) {
      return;
    }

    try {
      const invitations = await apiCall<OrgInvitation[]>('/orgs/invitations/pending');
      setPendingInvitations(invitations);
    } catch (err) {
      console.error('Failed to fetch invitations:', err);
    }
  }, [user]);

  // Create a new organization
  const createOrg = useCallback(async (name: string, description?: string): Promise<Organization> => {
    const newOrg = await apiCall<Organization>('/orgs', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    
    // Refresh orgs list
    await refreshOrgs();
    
    return newOrg;
  }, [refreshOrgs]);

  // Update organization
  const updateOrg = useCallback(async (
    orgId: string, 
    updates: { name?: string; description?: string; avatar?: string }
  ) => {
    await apiCall(`/orgs/${orgId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }, orgId);
    
    // Refresh orgs list
    await refreshOrgs();
  }, [refreshOrgs]);

  // Delete organization
  const deleteOrg = useCallback(async (orgId: string) => {
    await apiCall(`/orgs/${orgId}`, {
      method: 'DELETE',
    }, orgId);
    
    // If we deleted the current org, switch to personal
    if (currentOrg?.id === orgId) {
      const personalOrg = organizations.find(o => o.type === 'personal' && o.id !== orgId);
      if (personalOrg) {
        setCurrentOrg(personalOrg);
      }
    }
    
    // Refresh orgs list
    await refreshOrgs();
  }, [currentOrg, organizations, refreshOrgs, setCurrentOrg]);

  // Leave organization
  const leaveOrg = useCallback(async (orgId: string) => {
    await apiCall(`/orgs/${orgId}/leave`, {
      method: 'POST',
    }, orgId);
    
    // If we left the current org, switch to personal
    if (currentOrg?.id === orgId) {
      const personalOrg = organizations.find(o => o.type === 'personal');
      if (personalOrg) {
        setCurrentOrg(personalOrg);
      }
    }
    
    // Refresh orgs list
    await refreshOrgs();
  }, [currentOrg, organizations, refreshOrgs, setCurrentOrg]);

  // Accept invitation
  const acceptInvitation = useCallback(async (invitationId: string): Promise<Organization> => {
    const result = await apiCall<{ success: boolean; orgId: string; orgName: string; orgSlug: string }>(
      `/orgs/invitations/${invitationId}/accept`,
      { method: 'POST' }
    );
    
    // Refresh orgs and invitations
    await Promise.all([refreshOrgs(), refreshInvitations()]);
    
    // Return the org info
    const org = organizations.find(o => o.id === result.orgId);
    if (org) return org;
    
    // If not found in current list, return basic info
    return {
      id: result.orgId,
      name: result.orgName,
      slug: result.orgSlug,
      type: 'team',
      role: 'member',
      isOwner: false,
    };
  }, [refreshOrgs, refreshInvitations, organizations]);

  // Decline invitation
  const declineInvitation = useCallback(async (invitationId: string) => {
    await apiCall(`/orgs/invitations/${invitationId}/decline`, {
      method: 'POST',
    });
    
    // Refresh invitations
    await refreshInvitations();
  }, [refreshInvitations]);

  // Invite user to org
  const inviteToOrg = useCallback(async (orgId: string, email: string, message?: string) => {
    await apiCall(`/orgs/${orgId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, message }),
    }, orgId);
  }, []);

  // Get org members
  const getOrgMembersFunc = useCallback(async (orgId: string): Promise<OrgMember[]> => {
    const org = await apiCall<{ members: OrgMember[] }>(`/orgs/${orgId}`, {}, orgId);
    return org.members;
  }, []);

  // Remove member
  const removeMember = useCallback(async (orgId: string, memberEmail: string) => {
    await apiCall(`/orgs/${orgId}/members/${encodeURIComponent(memberEmail)}`, {
      method: 'DELETE',
    }, orgId);
  }, []);

  // Load orgs when user changes
  useEffect(() => {
    refreshOrgs();
    refreshInvitations();
  }, [user, refreshOrgs, refreshInvitations]);

  return (
    <OrgContext.Provider
      value={{
        currentOrg,
        setCurrentOrg,
        switchOrg,
        organizations,
        loading,
        error,
        refreshOrgs,
        createOrg,
        updateOrg,
        deleteOrg,
        leaveOrg,
        pendingInvitations,
        refreshInvitations,
        acceptInvitation,
        declineInvitation,
        inviteToOrg,
        getOrgMembers: getOrgMembersFunc,
        removeMember,
        getOrgHeaders,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (context === undefined) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}

// Hook to get current org ID for API calls
export function useCurrentOrgId(): string | null {
  const { currentOrg } = useOrg();
  return currentOrg?.id || null;
}

// Hook to check if user is owner of current org
export function useIsOrgOwner(): boolean {
  const { currentOrg } = useOrg();
  return currentOrg?.isOwner || false;
}

