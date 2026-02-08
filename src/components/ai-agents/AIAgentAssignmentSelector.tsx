import { useState } from 'react';
import { useAIAgents, useAIAgentTeams } from '@/hooks/useAIAgents';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface AIAgentAssignmentSelectorProps {
  value?: {
    assigneeType: 'human' | 'ai_agent' | 'ai_team';
    assigneeId?: string;
    agentId?: string;
    agentTeamId?: string;
  };
  onChange?: (value: any) => void;
  isTeamView?: boolean;
}

export default function AIAgentAssignmentSelector({
  value,
  onChange,
  isTeamView = false,
}: AIAgentAssignmentSelectorProps) {
  const [assigneeType, setAssigneeType] = useState<'human' | 'ai_agent' | 'ai_team'>(
    value?.assigneeType || 'human'
  );

  const { data: agents = [] } = useAIAgents();
  const { data: teams = [] } = useAIAgentTeams();

  const handleAssigneeTypeChange = (newType: string) => {
    const type = newType as 'human' | 'ai_agent' | 'ai_team';
    setAssigneeType(type);
    onChange?.({
      assigneeType: type,
      assigneeId: undefined,
      agentId: undefined,
      agentTeamId: undefined,
    });
  };

  const handleAgentSelect = (agentId: string) => {
    onChange?.({
      assigneeType: 'ai_agent',
      assigneeId: undefined,
      agentId,
      agentTeamId: undefined,
    });
  };

  const handleTeamSelect = (teamId: string) => {
    onChange?.({
      assigneeType: 'ai_team',
      assigneeId: undefined,
      agentId: undefined,
      agentTeamId: teamId,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Assignee Type</Label>
        <Select value={assigneeType} onValueChange={handleAssigneeTypeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="human">Team Member</SelectItem>
            <SelectItem value="ai_agent">AI Agent</SelectItem>
            <SelectItem value="ai_team">AI Teammates</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {assigneeType === 'ai_agent' && (
        <div className="space-y-2">
          <Label>Select Agent</Label>
          <Select value={value?.agentId || ''} onValueChange={handleAgentSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an agent..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <div className="flex items-center gap-2">
                    <span>{agent.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {agent.status}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agents.length === 0 && (
            <p className="text-sm text-muted-foreground">No agents available. Create one in admin settings.</p>
          )}
        </div>
      )}

      {assigneeType === 'ai_team' && (
        <div className="space-y-2">
          <Label>Select Team</Label>
          <Select value={value?.agentTeamId || ''} onValueChange={handleTeamSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a team..." />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  <div className="flex items-center gap-2">
                    <span>{team.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {team.members.length} agents
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teams.length === 0 && (
            <p className="text-sm text-muted-foreground">No teams available. Create one in admin settings.</p>
          )}
        </div>
      )}
    </div>
  );
}
