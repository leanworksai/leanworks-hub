import { useQuery } from '@tanstack/react-query';
import { usersService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export interface User {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  responsibilities?: string;
  domain: string;
  createdAt?: string;
}

export const useUsers = () => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['users', currentOrg?.id],
    queryFn: () => usersService.getAll() as Promise<User[]>,
    enabled: authReady && !orgLoading && !!currentOrg, // Only fetch when auth is ready and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

