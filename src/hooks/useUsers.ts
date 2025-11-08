import { useQuery } from '@tanstack/react-query';
import { usersService } from '@/services/firestore';

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
  return useQuery({
    queryKey: ['users'],
    queryFn: () => usersService.getAll() as Promise<User[]>,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

