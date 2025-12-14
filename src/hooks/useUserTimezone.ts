import { useQuery } from '@tanstack/react-query';
import { usersService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Hook to get the current user's timezone from their profile
 * Falls back to browser timezone if not set
 */
export function useUserTimezone(): string {
  const { user } = useAuth();
  
  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => usersService.getProfile(),
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });
  
  // Return user's timezone if available, otherwise fall back to browser timezone
  return profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
