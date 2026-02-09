import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import aiAgentService from '@/services/aiAgents';
import type {
  AIAgent,
  AIAgentTeam,
  TaskAIAssignment,
  AIAgentActivity,
  CreateAIAgentInput,
  UpdateAIAgentInput,
  CreateAIAgentTeamInput,
  AddAgentToTeamInput,
} from '@/types/ai-agents';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';

// Query keys
const queryKeys = {
  all: ['aiAgents'] as const,
  agents: () => [...queryKeys.all, 'agents'] as const,
  agent: (id: string) => [...queryKeys.agents(), id] as const,
  agentAssignments: (id: string) => [...queryKeys.agent(id), 'assignments'] as const,
  agentActivity: (id: string) => [...queryKeys.agent(id), 'activity'] as const,
  teams: () => [...queryKeys.all, 'teams'] as const,
  team: (id: string) => [...queryKeys.teams(), id] as const,
};

// ============================================================================
// AGENT HOOKS
// ============================================================================

export function useAIAgents(limit?: number) {
  const { authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  return useQuery({
    queryKey: [...queryKeys.agents(), currentOrg?.id],
    queryFn: () => aiAgentService.listAgents(limit),
    enabled: authReady && !orgLoading && !!currentOrg, // Avoid 400/500 when no org selected
  });
}

export function useAIAgent(agentId: string | undefined) {
  return useQuery({
    queryKey: agentId ? queryKeys.agent(agentId) : queryKeys.all,
    queryFn: () => aiAgentService.getAgent(agentId!),
    enabled: !!agentId,
  });
}

export function useAIAgentAssignments(agentId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: agentId ? queryKeys.agentAssignments(agentId) : queryKeys.all,
    queryFn: () => aiAgentService.getAgentAssignments(agentId!, limit),
    enabled: !!agentId,
  });
}

export function useAIAgentActivity(agentId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: agentId ? queryKeys.agentActivity(agentId) : queryKeys.all,
    queryFn: () => aiAgentService.getAgentActivity(agentId!, limit),
    enabled: !!agentId,
  });
}

export function useCreateAIAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAIAgentInput) => aiAgentService.createAgent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
    },
  });
}

export function useUpdateAIAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: UpdateAIAgentInput }) =>
      aiAgentService.updateAgent(agentId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent(data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
    },
  });
}

export function useDeleteAIAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) => aiAgentService.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
    },
  });
}

// ============================================================================
// TEAM HOOKS
// ============================================================================

export function useAIAgentTeams(limit?: number) {
  const { authReady } = useAuth();
  const { currentOrg, loading: orgLoading } = useOrg();
  return useQuery({
    queryKey: [...queryKeys.teams(), currentOrg?.id],
    queryFn: () => aiAgentService.listTeams(limit),
    enabled: authReady && !orgLoading && !!currentOrg, // Avoid 400/500 when no org selected
  });
}

export function useAIAgentTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: teamId ? queryKeys.team(teamId) : queryKeys.all,
    queryFn: () => aiAgentService.getTeam(teamId!),
    enabled: !!teamId,
  });
}

export function useCreateAIAgentTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAIAgentTeamInput) => aiAgentService.createTeam(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useUpdateAIAgentTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ teamId, input }: { teamId: string; input: Partial<CreateAIAgentTeamInput> }) =>
      aiAgentService.updateTeam(teamId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team(data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useDeleteAIAgentTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (teamId: string) => aiAgentService.deleteTeam(teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useAddAgentToTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ teamId, input }: { teamId: string; input: AddAgentToTeamInput }) =>
      aiAgentService.addAgentToTeam(teamId, input),
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useRemoveAgentFromTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ teamId, agentId }: { teamId: string; agentId: string }) =>
      aiAgentService.removeAgentFromTeam(teamId, agentId),
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}
