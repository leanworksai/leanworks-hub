import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eventsService } from '@/services/api';
import type { Event } from '@/data/eventsData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useEvents = () => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['events', currentOrg?.id],
    queryFn: () => eventsService.getAll(),
    enabled: authReady && !orgLoading && !!currentOrg, // Only fetch when auth is ready and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Hook to get events accessible to the current user
// Backend already filters events based on visibility rules
export const useUserEvents = () => {
  // Backend already handles access control - it only returns events where:
  // 1. User is the event creator, OR
  // 2. Event visibility is 'all_members' (default - visible to all org members), OR
  // 3. Event visibility is 'specific_members' and user is in visible_to_members, OR
  // 4. User is in attendees
  // So we can just return the events directly without additional filtering
  return useEvents();
};

export const useEvent = (eventId: string) => {
  const { user, loading, authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['events', eventId, currentOrg?.id],
    queryFn: () => eventsService.getById(eventId),
    enabled: authReady && !orgLoading && !!currentOrg && !!eventId, // Only fetch when auth is ready and eventId is provided
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateEvent = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (event: Omit<Event, 'id'> & { id?: string }) => eventsService.create(event as Event),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
};

export const useUpdateEvent = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ eventId, updates }: { eventId: string; updates: Partial<Event> }) =>
      eventsService.update(eventId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['events', variables.eventId] });
    },
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (eventId: string) => eventsService.delete(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
};

