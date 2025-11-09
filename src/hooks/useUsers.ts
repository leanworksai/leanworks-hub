import { useQuery } from '@tanstack/react-query';
import { usersService } from '@/services/firestore';
import { useAuth } from '@/contexts/AuthContext';

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
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['users'],
    queryFn: () => usersService.getAll() as Promise<User[]>,
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

