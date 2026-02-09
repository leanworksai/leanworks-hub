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
import { FileText, Eye, EyeOff } from 'lucide-react';

const SKILL_MD_TEMPLATE = `---
name: my-agent
version: "1.0"
---
# My Agent

## When to trigger me
- Describe the conditions under which this agent should be triggered

## What I need
- List the data/context the agent requires to do its work

## What I do
1. Describe the agent's behavior step by step

## Don't trigger me when
- List exclusion conditions
`;

interface AIAgentFormProps {
  onSubmit: (data: any) => Promise<void>;
  isLoading?: boolean;
  /** When set, agent type is fixed and the type selector is hidden (e.g. after two-stage dialog step 1). */
  initialAgentType?: 'webhook' | 'api' | 'mcp_server';
}

export default function AIAgentForm({ onSubmit, isLoading = false, initialAgentType }: AIAgentFormProps) {
  const [agentType, setAgentType] = useState<'webhook' | 'api' | 'mcp_server'>(initialAgentType ?? 'webhook');
  const [showSkillPreview, setShowSkillPreview] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    capabilities: [] as string[],
    config: {
      webhookUrl: '',
      callbackUrl: '',
      timeout: 300000,
    } as any,
    authConfig: { webhookSecret: '' } as { webhookSecret?: string },
    skillMd: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = { ...formData, agentType };
      if (formData.authConfig?.webhookSecret) {
        payload.authConfig = { webhookSecret: formData.authConfig.webhookSecret };
      }
      await onSubmit(payload);
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

      {!initialAgentType && (
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
      )}

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

          <div className="space-y-2">
            <Label htmlFor="webhookSecret">Webhook signing secret (optional)</Label>
            <Input
              id="webhookSecret"
              type="password"
              autoComplete="off"
              placeholder="Secret only you know — we'll sign outbound requests with HMAC-SHA256"
              value={formData.authConfig?.webhookSecret ?? ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  authConfig: { ...prev.authConfig, webhookSecret: e.target.value || undefined },
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              If set, we sign every webhook request with this secret. Verify using the X-LeanWorks-Signature header (sha256=...).
            </p>
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

      {/* SKILL.md Section */}
      <div className="space-y-2 border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="skillMd" className="text-sm font-medium">
              Skill Definition (SKILL.md) *
            </Label>
          </div>
          <div className="flex items-center gap-2">
            {formData.skillMd && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowSkillPreview(!showSkillPreview)}
              >
                {showSkillPreview ? (
                  <><EyeOff className="h-3 w-3 mr-1" /> Edit</>
                ) : (
                  <><Eye className="h-3 w-3 mr-1" /> Preview</>
                )}
              </Button>
            )}
            {!formData.skillMd && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFormData((prev) => ({ ...prev, skillMd: SKILL_MD_TEMPLATE }))}
              >
                Use template
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Describe when and how Lean (AI TPM) should trigger this agent. Lean reads this file to make intelligent routing decisions.
        </p>
        {showSkillPreview && formData.skillMd ? (
          <div className="bg-background rounded border p-3 text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
            {formData.skillMd}
          </div>
        ) : (
          <Textarea
            id="skillMd"
            placeholder={`---\nname: my-agent\nversion: "1.0"\n---\n# My Agent\n\n## When to trigger me\n...`}
            value={formData.skillMd}
            onChange={(e) => setFormData((prev) => ({ ...prev, skillMd: e.target.value }))}
            rows={10}
            className="font-mono text-sm leading-relaxed"
            required
          />
        )}
        {formData.skillMd && (
          <p className="text-xs text-muted-foreground text-right">
            {formData.skillMd.length.toLocaleString()} / 10,000 characters
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Creating...' : 'Create Agent'}
      </Button>
    </form>
  );
}
