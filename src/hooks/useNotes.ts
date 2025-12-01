import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesService } from '@/services/api';
import type { Note } from '@/data/notesData';
import { useAuth } from '@/contexts/AuthContext';

export const useNotes = () => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['notes'],
    queryFn: () => notesService.getAll(),
    enabled: !loading && !!user, // Only fetch when user is authenticated
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useNote = (noteId: string) => {
  const { user, loading } = useAuth();
  
  return useQuery({
    queryKey: ['notes', noteId],
    queryFn: () => notesService.getById(noteId),
    enabled: !loading && !!user && !!noteId, // Only fetch when user is authenticated and noteId is provided
    staleTime: 1000 * 60 * 5,
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

