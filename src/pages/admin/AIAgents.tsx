import { useState } from 'react';
import { useAIAgents, useCreateAIAgent, useDeleteAIAgent } from '@/hooks/useAIAgents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import AIAgentForm from '@/components/ai-agents/AIAgentForm';

export default function AIAgentsPage() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  
  const { data: agents = [], isLoading } = useAIAgents();
  const createMutation = useCreateAIAgent();
  const deleteMutation = useDeleteAIAgent();

  const handleCreate = async (formData: any) => {
    try {
      await createMutation.mutateAsync(formData);
      setDialogOpen(false);
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
    return <div className="p-8 text-center">Loading agents...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">AI Agents</h1>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Agent
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New AI Agent</DialogTitle>
            </DialogHeader>
            <AIAgentForm onSubmit={handleCreate} isLoading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

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
  );
}
