import { useMemo } from 'react';
import { useUsers } from './useUsers';
import { createUserMap, type UserMapEntry } from '@/lib/utils';

/**
 * Global user map hook - scoped per organization
 * Returns a memoized Map for efficient user lookups
 * Automatically updates when org changes or users refresh
 * 
 * @example
 * const userMap = useUserMap();
 * const displayName = userMap.get(email.toLowerCase())?.displayName || email;
 * const firstName = userMap.get(email.toLowerCase())?.firstName || '';
 */
export function useUserMap(): Map<string, UserMapEntry> {
  const { data: users = [] } = useUsers();
  
  return useMemo(() => {
    return createUserMap(users);
  }, [users]);
}

