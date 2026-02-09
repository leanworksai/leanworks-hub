/**
 * Agent Developer Portal
 *
 * Provides agent registration, API key management, monitoring dashboard,
 * and a playground for testing agent integrations.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import {
  Key, Activity, Play, ArrowLeft, Copy, Eye, EyeOff, Trash2,
  Bot, BarChart3, Clock, CheckCircle2, AlertCircle, Loader2, FileText, Route,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAIAgents, useAIAgentActivity } from '@/hooks/useAIAgents';
import aiAgentService from '@/services/aiAgents';
import { useToast } from '@/hooks/use-toast';

export default function AgentDeveloperPortal() {
  const navigate = useNavigate();
  const { data: agents = [], isLoading } = useAIAgents();
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [routingLog, setRoutingLog] = useState<any[]>([]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const loadApiKeys = async (agentId: string) => {
    try {
      const keys = await aiAgentService.listApiKeys(agentId);
      setApiKeys(keys);
    } catch {
      setApiKeys([]);
    }
  };

  const loadRoutingLog = async (agentId: string) => {
    try {
      const log = await aiAgentService.getRoutingLog(agentId, 20);
      setRoutingLog(log);
    } catch {
      setRoutingLog([]);
    }
  };

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setGeneratedKey(null);
    loadApiKeys(agentId);
    loadRoutingLog(agentId);
  };

  const handleGenerateKey = async () => {
    if (!selectedAgentId) return;
    setIsGenerating(true);
    try {
      const result = await aiAgentService.generateApiKey(selectedAgentId, newKeyLabel || undefined);
      setGeneratedKey(result.key);
      setNewKeyLabel('');
      await loadApiKeys(selectedAgentId);
      toast({ title: 'API key generated', description: 'Copy it now — it won\'t be shown again.' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to generate API key', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!selectedAgentId) return;
    try {
      await aiAgentService.revokeApiKey(selectedAgentId, keyId);
      await loadApiKeys(selectedAgentId);
      toast({ title: 'Key revoked' });
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke key', variant: 'destructive' });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 pb-4 border-b shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate('/ai-team')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Agent Developer Portal</h1>
          <p className="text-sm text-muted-foreground">Manage API keys, monitor agents, and test integrations</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Agent Selector (Left Panel) */}
          <div className="col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Your Agents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                  </div>
                ) : agents.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No agents registered</p>
                ) : (
                  agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent.id)}
                      className={`w-full flex items-center gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                        selectedAgentId === agent.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border/60 hover:bg-accent/50'
                      }`}
                    >
                      <span className="text-lg">{agent.avatar || '🤖'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{agent.name}</div>
                        <Badge variant={agent.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-4">
                          {agent.status}
                        </Badge>
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Content (Right Panel) */}
          <div className="col-span-9">
            {!selectedAgent ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <Bot className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">Select an agent to manage</p>
                </CardContent>
              </Card>
            ) : (
              <Tabs defaultValue="keys" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="keys" className="gap-1.5">
                    <Key className="h-3.5 w-3.5" /> API Keys
                  </TabsTrigger>
                  <TabsTrigger value="skill" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> Skill
                  </TabsTrigger>
                  <TabsTrigger value="routing" className="gap-1.5">
                    <Route className="h-3.5 w-3.5" /> Lean Routing
                  </TabsTrigger>
                  <TabsTrigger value="dashboard" className="gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" /> Dashboard
                  </TabsTrigger>
                  <TabsTrigger value="playground" className="gap-1.5">
                    <Play className="h-3.5 w-3.5" /> Playground
                  </TabsTrigger>
                </TabsList>

                {/* API Keys Tab */}
                <TabsContent value="keys" className="space-y-4">
                  {/* Generate New Key */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Generate API Key</CardTitle>
                      <CardDescription>
                        API keys are used to authenticate your agent with the platform.
                        Keys are shown once after generation.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Key label (optional)"
                          value={newKeyLabel}
                          onChange={e => setNewKeyLabel(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button onClick={handleGenerateKey} disabled={isGenerating}>
                          {isGenerating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Key className="h-4 w-4 mr-1.5" />}
                          Generate
                        </Button>
                      </div>

                      {generatedKey && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-2">
                            Copy this key now — it won't be shown again
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 font-mono break-all">
                              {showKey ? generatedKey : generatedKey.substring(0, 18) + '•'.repeat(20)}
                            </code>
                            <Button size="icon" variant="ghost" onClick={() => setShowKey(!showKey)}>
                              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => copyToClipboard(generatedKey)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Existing Keys */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Active Keys</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {apiKeys.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No API keys generated yet</p>
                      ) : (
                        <div className="space-y-2">
                          {apiKeys.map(key => (
                            <div key={key.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                              <div className="flex items-center gap-3">
                                <code className="text-xs font-mono text-muted-foreground">{key.prefix}•••</code>
                                {key.label && <span className="text-xs text-muted-foreground">{key.label}</span>}
                                <Badge variant={key.isActive ? 'default' : 'secondary'} className="text-[10px]">
                                  {key.isActive ? 'Active' : 'Revoked'}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                {key.lastUsedAt && (
                                  <span className="text-[10px] text-muted-foreground">
                                    Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                                  </span>
                                )}
                                {key.isActive && (
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRevokeKey(key.id)}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Skill Tab */}
                <TabsContent value="skill" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">SKILL.md</CardTitle>
                      <CardDescription>
                        This agent's skill definition. Lean (AI TPM) reads this to decide when and how to trigger the agent.
                        {selectedAgent.skillVersion && (
                          <Badge variant="outline" className="ml-2 text-[10px]">v{selectedAgent.skillVersion}</Badge>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {selectedAgent.skillMd ? (
                        <div className="space-y-4">
                          {selectedAgent.skillSummary && (
                            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                              <span className="text-xs font-medium text-muted-foreground mr-2">Summary:</span>
                              {selectedAgent.skillSummary}
                            </div>
                          )}
                          <pre className="bg-muted rounded-md p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
                            {selectedAgent.skillMd}
                          </pre>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12">
                          <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
                          <p className="text-sm text-muted-foreground mb-1">No SKILL.md defined</p>
                          <p className="text-xs text-muted-foreground">
                            Add a SKILL.md when creating or editing this agent to enable Lean's intelligent routing.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Lean Routing Tab */}
                <TabsContent value="routing" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Lean Routing Decisions</CardTitle>
                      <CardDescription>
                        Recent decisions by Lean (AI TPM) about whether to trigger this agent for platform events.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {routingLog.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12">
                          <Route className="h-10 w-10 text-muted-foreground/30 mb-3" />
                          <p className="text-sm text-muted-foreground mb-1">No routing decisions yet</p>
                          <p className="text-xs text-muted-foreground">
                            Lean will log decisions here when platform events are processed.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {routingLog.map((entry: any) => (
                            <div key={entry.id} className="border rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge variant={entry.decision === 'triggered' ? 'default' : 'secondary'} className="text-[10px]">
                                    {entry.decision}
                                  </Badge>
                                  <span className="text-sm font-medium">{entry.eventType}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  {entry.confidence != null && (
                                    <span>Confidence: {(entry.confidence * 100).toFixed(0)}%</span>
                                  )}
                                  {entry.latencyMs != null && (
                                    <span>{entry.latencyMs}ms</span>
                                  )}
                                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                                </div>
                              </div>
                              {entry.reasoning && (
                                <p className="text-sm text-muted-foreground">{entry.reasoning}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Dashboard Tab */}
                <TabsContent value="dashboard" className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">{selectedAgent.totalTasksCompleted || 0}</p>
                            <p className="text-xs text-muted-foreground">Tasks Completed</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-blue-500/10">
                            <Clock className="h-5 w-5 text-blue-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">
                              {selectedAgent.averageResponseTimeMs
                                ? `${(selectedAgent.averageResponseTimeMs / 1000).toFixed(1)}s`
                                : 'N/A'}
                            </p>
                            <p className="text-xs text-muted-foreground">Avg Response Time</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-green-500/10">
                            <Activity className="h-5 w-5 text-green-500" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold capitalize">{selectedAgent.status}</p>
                            <p className="text-xs text-muted-foreground">Status</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Agent Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">ID</span><code className="text-xs font-mono">{selectedAgent.id}</code></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{selectedAgent.agentType}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Capabilities</span>
                        <span>{((selectedAgent.capabilities || []) as any[]).map((c: any) => typeof c === 'string' ? c : c.domain).join(', ') || 'None'}</span>
                      </div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{new Date(selectedAgent.createdAt).toLocaleDateString()}</span></div>
                      {selectedAgent.lastTriggeredAt && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Last Triggered</span><span>{new Date(selectedAgent.lastTriggeredAt).toLocaleString()}</span></div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Playground Tab */}
                <TabsContent value="playground">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Integration Playground</CardTitle>
                      <CardDescription>
                        Test your agent integration. Copy the code snippets below to get started.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium mb-2">Quick Start — Authenticate</h4>
                        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto">
{`curl -H "Authorization: Bearer <your-api-key>" \\
     -H "X-Org-Id: <your-org-id>" \\
     ${window.location.origin}/api/agent/v1/me`}
                        </pre>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium mb-2">List Tasks</h4>
                        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto">
{`curl -H "Authorization: Bearer <your-api-key>" \\
     -H "X-Org-Id: <your-org-id>" \\
     ${window.location.origin}/api/agent/v1/tasks`}
                        </pre>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium mb-2">Post a Comment</h4>
                        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto">
{`curl -X POST \\
     -H "Authorization: Bearer <your-api-key>" \\
     -H "X-Org-Id: <your-org-id>" \\
     -H "Content-Type: application/json" \\
     -d '{"comment": "Analysis complete."}' \\
     ${window.location.origin}/api/agent/v1/tasks/<taskId>/comments`}
                        </pre>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium mb-2">Subscribe to Events</h4>
                        <pre className="bg-muted rounded-md p-3 text-xs font-mono overflow-x-auto">
{`curl -X POST \\
     -H "Authorization: Bearer <your-api-key>" \\
     -H "X-Org-Id: <your-org-id>" \\
     -H "Content-Type: application/json" \\
     -d '{"eventPattern": "task.*", "deliveryMethod": "webhook", "webhookUrl": "https://your-agent.com/webhook"}' \\
     ${window.location.origin}/api/agent/v1/subscriptions`}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
