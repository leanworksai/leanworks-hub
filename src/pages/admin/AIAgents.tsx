import { useState } from 'react';
import { useAIAgents, useCreateAIAgent, useDeleteAIAgent } from '@/hooks/useAIAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Eye, Key, Webhook, Globe, Server, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import AIAgentForm from '@/components/ai-agents/AIAgentForm';

type AgentTypeOption = 'webhook' | 'api' | 'mcp_server';

const AGENT_TYPE_OPTIONS: { value: AgentTypeOption; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'webhook', label: 'Webhook (Push)', description: 'We push events and triggers to your agent\'s URL. Best for real-time integrations.', icon: <Webhook className="h-5 w-5" /> },
  { value: 'api', label: 'API (Pull)', description: 'We call your API to submit work and poll for status. You control the execution flow.', icon: <Globe className="h-5 w-5" /> },
  { value: 'mcp_server', label: 'MCP Server', description: 'Model Context Protocol server. For advanced tool-augmented agents.', icon: <Server className="h-5 w-5" /> },
];

export default function AIAgentsPage() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStep, setDialogStep] = useState<1 | 2>(1);
  const [selectedAgentType, setSelectedAgentType] = useState<AgentTypeOption | null>(null);

  const { data: agents = [], isLoading } = useAIAgents();
  const createMutation = useCreateAIAgent();
  const deleteMutation = useDeleteAIAgent();

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setDialogStep(1);
      setSelectedAgentType(null);
    }
    setDialogOpen(open);
  };

  const handleCreate = async (formData: any) => {
    try {
      await createMutation.mutateAsync(formData);
      setDialogOpen(false);
      setDialogStep(1);
      setSelectedAgentType(null);
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  };

  const handleDelete = async (agentId: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      try {
        await deleteMutation.mutateAsync(agentId);
      } catch (error) {
        console.error('Failed to delete agent:', error);
      }
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'default';
      case 'inactive':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-12 items-center px-4 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h1 className="text-lg font-semibold">AI Agents</h1>
              <Badge variant="secondary" className="ml-1.5">—</Badge>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-muted-foreground">Loading agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header: same layout as Tasks / Plans / Projects */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-12 items-center px-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-lg font-semibold">AI Agents</h1>
            <Badge variant="secondary" className="ml-1.5">
              {agents.length}
            </Badge>
          </div>

          <Button variant="outline" size="sm" onClick={() => navigate('/ai-team/developer-portal')} className="gap-2">
            <Key className="h-4 w-4" />
            Developer Portal
          </Button>
          <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 gap-2">
                <Plus className="h-4 w-4" />
                Add Agent
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
              <DialogHeader className="shrink-0">
                <DialogTitle>
                  {dialogStep === 1 ? 'Create New AI Agent' : `Create New AI Agent — ${AGENT_TYPE_OPTIONS.find(o => o.value === selectedAgentType)?.label ?? selectedAgentType}`}
                </DialogTitle>
              </DialogHeader>
              <div className="overflow-y-auto min-h-0 flex-1 -mx-1 px-1">
                {dialogStep === 1 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Choose how your agent will integrate with the platform.</p>
                    <div className="grid gap-2">
                      {AGENT_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setSelectedAgentType(opt.value);
                            setDialogStep(2);
                          }}
                          className="flex items-start gap-3 rounded-lg border border-input bg-background p-4 text-left transition-colors hover:bg-accent/50 hover:border-primary/50"
                        >
                          <div className="rounded-md bg-primary/10 p-2 text-primary shrink-0">
                            {opt.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-sm text-muted-foreground mt-0.5">{opt.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mb-2 -ml-1"
                      onClick={() => setDialogStep(1)}
                    >
                      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                      Back
                    </Button>
                    <AIAgentForm
                      key={selectedAgentType ?? 'webhook'}
                      onSubmit={handleCreate}
                      isLoading={createMutation.isPending}
                      initialAgentType={selectedAgentType ?? 'webhook'}
                    />
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
      {agents.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground mb-4">No AI agents yet</p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>Create your first agent</Button>
              </DialogTrigger>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{agent.name}</CardTitle>
                    <Badge className="mt-2" variant={getStatusBadgeColor(agent.status) as any}>
                      {agent.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agent.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
                  )}
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Type:</span>
                    <Badge variant="outline" className="text-xs">
                      {agent.agentType}
                    </Badge>
                  </div>

                  {agent.capabilities.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Capabilities:</p>
                      <div className="flex flex-wrap gap-1">
                        {agent.capabilities.slice(0, 3).map((cap) => (
                          <Badge key={cap} variant="secondary" className="text-xs">
                            {cap}
                          </Badge>
                        ))}
                        {agent.capabilities.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{agent.capabilities.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t space-y-2">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">{agent.totalTasksCompleted}</span> tasks completed
                    </div>
                    {agent.averageResponseTimeMs && (
                      <div className="text-xs text-muted-foreground">
                        Avg response: <span className="font-medium">{agent.averageResponseTimeMs}ms</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2"
                      onClick={() => navigate(`/admin/ai-agents/${agent.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(agent.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
