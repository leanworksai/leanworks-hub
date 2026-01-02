/**
 * Utility functions for detecting and tracking first-time feature usage
 */

/**
 * Check if user has used a feature before
 */
export function hasUsedFeature(feature: string): boolean {
  const storageKey = `first_${feature}_used`;
  return !!localStorage.getItem(storageKey);
}

/**
 * Get days since signup (helper for first-time tracking)
 */
export function getDaysSinceSignup(signupDate: Date | string | null): number {
  if (!signupDate) return 0;
  
  const signup = signupDate instanceof Date ? signupDate : new Date(signupDate);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - signup.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Get user signup date from profile or localStorage
 */
export async function getUserSignupDate(): Promise<Date | null> {
  try {
    // Try to get from localStorage first
    const cached = localStorage.getItem('user_signup_date');
    if (cached) {
      return new Date(cached);
    }
    
    // Try to fetch from API
    const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';
    const { getAuthToken } = await import('@/services/api');
    const token = await getAuthToken();
    
    if (token) {
      const url = import.meta.env.DEV ? `${API_BASE}/api/users/profile` : `${API_BASE}/users/profile`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const profile = await response.json();
        if (profile.createdAt) {
          const signupDate = new Date(profile.createdAt);
          localStorage.setItem('user_signup_date', signupDate.toISOString());
          return signupDate;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to get user signup date:', error);
  }
  
  return null;
}

