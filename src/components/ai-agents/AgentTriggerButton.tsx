/**
 * AgentTriggerButton
 *
 * Reusable component that renders a button to trigger an AI agent
 * on any entity (task, project, plan). Shows a popover with agent
 * selection and optional prompt input.
 */

import { useState } from 'react';
import { Bot, Loader2, ChevronDown, Send, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAIAgents } from '@/hooks/useAIAgents';
import aiAgentService from '@/services/aiAgents';
import { useToast } from '@/hooks/use-toast';

interface AgentTriggerButtonProps {
  entityType: 'task' | 'project' | 'plan';
  entityId: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export function AgentTriggerButton({
  entityType,
  entityId,
  variant = 'outline',
  size = 'sm',
  className,
}: AgentTriggerButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: agents = [], isLoading } = useAIAgents();
  const activeAgents = agents.filter((a) => a.status === 'active');

  const handleTrigger = async () => {
    if (!selectedAgentId) return;

    setIsTriggering(true);
    setTriggerResult(null);

    try {
      let result;
      if (entityType === 'task') {
        result = await aiAgentService.triggerOnTask(entityId, selectedAgentId, prompt || undefined);
      } else if (entityType === 'project') {
        result = await aiAgentService.triggerOnProject(entityId, selectedAgentId, prompt || undefined);
      } else if (entityType === 'plan') {
        result = await aiAgentService.triggerOnPlan(entityId, selectedAgentId, prompt || undefined);
      }

      setTriggerResult(result?.triggerId || 'triggered');
      toast({
        title: 'Agent triggered',
        description: `Agent has been triggered on this ${entityType}.`,
      });

      // Reset after a delay
      setTimeout(() => {
        setOpen(false);
        setSelectedAgentId(null);
        setPrompt('');
        setTriggerResult(null);
      }, 2000);
    } catch (error) {
      toast({
        title: 'Trigger failed',
        description: error instanceof Error ? error.message : 'Failed to trigger agent',
        variant: 'destructive',
      });
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Bot className="h-4 w-4 mr-1.5" />
          Ask AI Agent
          <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm">Trigger AI Agent</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select an agent to analyze this {entityType}
            </p>
          </div>

          {/* Agent Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading agents...
              </div>
            ) : activeAgents.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active agents available</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-auto">
                {activeAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedAgentId === agent.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 hover:bg-accent/50'
                    }`}
                  >
                    <span className="text-base">{agent.avatar || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-xs">{agent.name}</div>
                      {agent.capabilities && agent.capabilities.length > 0 && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {(agent.capabilities as any[]).map((c: any) => typeof c === 'string' ? c : c.domain).join(', ')}
                        </div>
                      )}
                    </div>
                    {selectedAgentId === agent.id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Optional Prompt */}
          {selectedAgentId && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Instructions (optional)
              </label>
              <Textarea
                placeholder={`What should the agent do with this ${entityType}?`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                className="text-sm resize-none"
              />
            </div>
          )}

          {/* Trigger Button */}
          <Button
            onClick={handleTrigger}
            disabled={!selectedAgentId || isTriggering}
            className="w-full"
            size="sm"
          >
            {isTriggering ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Triggering...
              </>
            ) : triggerResult ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Triggered!
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Trigger Agent
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AgentTriggerButton;
