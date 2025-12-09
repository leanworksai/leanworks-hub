import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesService } from '@/services/api';
import type { Note } from '@/data/notesData';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

export const useNotes = () => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['notes', currentOrg?.id],
    queryFn: () => notesService.getAll(),
    enabled: !loading && !orgLoading && !!user && !!currentOrg, // Only fetch when user is authenticated and org is selected
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useNote = (noteId: string) => {
  const { user, loading } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  
  return useQuery({
    queryKey: ['notes', noteId, currentOrg?.id],
    queryFn: () => notesService.getById(noteId),
    enabled: !loading && !orgLoading && !!user && !!currentOrg && !!noteId, // Only fetch when user is authenticated and noteId is provided
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus to avoid unnecessary requests
  });
};

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (note: Note) => notesService.create(note),
    onSuccess: () => {
      // Invalidate and refetch to show the new note immediately
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.refetchQueries({ queryKey: ['notes'] });
    },
  });
};

export const useUpdateNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ noteId, updates }: { noteId: string; updates: Partial<Note> }) =>
      notesService.update(noteId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['notes', variables.noteId] });
      // Refetch the specific note to ensure fresh data
      queryClient.refetchQueries({ queryKey: ['notes', variables.noteId] });
    },
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (noteId: string) => notesService.delete(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
};

