import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AIAgentFormProps {
  onSubmit: (data: any) => Promise<void>;
  isLoading?: boolean;
}

export default function AIAgentForm({ onSubmit, isLoading = false }: AIAgentFormProps) {
  const [agentType, setAgentType] = useState<'webhook' | 'api' | 'mcp_server'>('webhook');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    capabilities: [] as string[],
    config: {
      webhookUrl: '',
      callbackUrl: '',
      timeout: 300000,
    } as any,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit({
        ...formData,
        agentType,
      });
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  const updateConfig = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Agent Name *</Label>
        <Input
          id="name"
          placeholder="e.g., Code Generator Agent"
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="What does this agent do?"
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="type">Agent Type *</Label>
        <Select value={agentType} onValueChange={(value: any) => setAgentType(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">Webhook (Push)</SelectItem>
            <SelectItem value="api">API (Pull)</SelectItem>
            <SelectItem value="mcp_server">MCP Server</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {agentType === 'webhook' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Webhook URL *</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://agent.example.com/webhook"
              value={formData.config.webhookUrl}
              onChange={(e) => updateConfig('webhookUrl', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="callbackUrl">Callback URL *</Label>
            <Input
              id="callbackUrl"
              type="url"
              placeholder="https://leanworks.com/api/webhooks/ai-agents/{agentId}/callback"
              value={formData.config.callbackUrl}
              onChange={(e) => updateConfig('callbackUrl', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              placeholder="300000"
              value={formData.config.timeout}
              onChange={(e) => updateConfig('timeout', parseInt(e.target.value))}
            />
          </div>
        </>
      )}

      {agentType === 'api' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL *</Label>
            <Input
              id="baseUrl"
              type="url"
              placeholder="https://api.agent.example.com"
              value={formData.config.baseUrl || ''}
              onChange={(e) => updateConfig('baseUrl', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="submitEndpoint">Submit Endpoint *</Label>
            <Input
              id="submitEndpoint"
              placeholder="/tasks"
              value={formData.config.endpoints?.submit || ''}
              onChange={(e) => updateConfig('endpoints', { ...formData.config.endpoints, submit: e.target.value })}
              required
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="capabilities">Capabilities (comma-separated)</Label>
        <Input
          id="capabilities"
          placeholder="e.g., code_generation, testing, documentation"
          onChange={(e) => {
            const caps = e.target.value.split(',').map((c) => c.trim()).filter(Boolean);
            setFormData((prev) => ({ ...prev, capabilities: caps }));
          }}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Agent'}
      </Button>
    </form>
  );
}
