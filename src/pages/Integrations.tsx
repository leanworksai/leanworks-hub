import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { SlackConnectDialog } from "@/components/SlackConnectDialog";
import { AtlassianConnectDialog } from "@/components/AtlassianConnectDialog";
import { OutlookConnectDialog } from "@/components/OutlookConnectDialog";
import { integrationsService } from "@/services/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const integrations = [
  {
    id: "slack",
    name: "Slack",
    description: "Team communication and notifications",
    category: "Communication",
    icon: "💬",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Project tracking and issue management",
    category: "Project Management",
    icon: "📊",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code repository and version control",
    category: "Development",
    icon: "🔧",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Email and calendar integration",
    category: "Communication",
    icon: "📧",
  },
];

export default function Integrations() {
  const [connectedIntegrations, setConnectedIntegrations] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [slackDialogOpen, setSlackDialogOpen] = useState(false);
  const [atlassianDialogOpen, setAtlassianDialogOpen] = useState(false);
  const [outlookDialogOpen, setOutlookDialogOpen] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    loadIntegrations();
  }, [user]);

  const loadIntegrations = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const integrations = await integrationsService.getAll();
      const connected = new Set(
        integrations.filter(i => i.connected).map(i => i.id)
      );
      setConnectedIntegrations(connected);
    } catch (error) {
      console.error("Failed to load integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = (integrationId: string) => {
    if (integrationId === "slack") {
      setSlackDialogOpen(true);
    } else if (integrationId === "atlassian") {
      setAtlassianDialogOpen(true);
    } else if (integrationId === "outlook") {
      setOutlookDialogOpen(true);
    } else if (integrationId === "github") {
      window.open("https://github.com/apps/leanworks", "_blank");
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    try {
      await integrationsService.disconnect(integrationId);
      setConnectedIntegrations(prev => {
        const next = new Set(prev);
        next.delete(integrationId);
        return next;
      });
      toast({
        title: "Success",
        description: "Integration disconnected successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to disconnect integration",
        variant: "destructive",
      });
    }
  };

  const handleConnectionSuccess = (integrationId: string) => {
    setConnectedIntegrations(prev => new Set(prev).add(integrationId));
    setSlackDialogOpen(false);
    setAtlassianDialogOpen(false);
    setOutlookDialogOpen(false);
    toast({
      title: "Success",
      description: "Integration connected successfully",
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        </div>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle>Connected Integrations</CardTitle>
          <CardDescription>
            {connectedIntegrations.size} integration{connectedIntegrations.size !== 1 ? 's' : ''} currently active
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const isConnected = connectedIntegrations.has(integration.id);
          return (
            <Card key={integration.id} className="bg-gradient-card border-border shadow-card">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-2xl">
                      {integration.icon}
                    </div>
                    <div>
                      <CardTitle className="text-base">{integration.name}</CardTitle>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {integration.category}
                      </Badge>
                    </div>
                  </div>
                  {isConnected && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {integration.description}
                </p>
                {isConnected ? (
                  <Button
                    variant="outline"
                    className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => handleDisconnect(integration.id)}
                    disabled={loading}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button 
                    className="w-full bg-primary hover:bg-primary/90"
                    onClick={() => handleConnect(integration.id)}
                    disabled={loading}
                  >
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SlackConnectDialog
        open={slackDialogOpen}
        onOpenChange={setSlackDialogOpen}
        onSuccess={() => handleConnectionSuccess("slack")}
      />

      <AtlassianConnectDialog
        open={atlassianDialogOpen}
        onOpenChange={setAtlassianDialogOpen}
        onSuccess={() => handleConnectionSuccess("atlassian")}
      />

      <OutlookConnectDialog
        open={outlookDialogOpen}
        onOpenChange={setOutlookDialogOpen}
        onSuccess={() => handleConnectionSuccess("outlook")}
      />
    </div>
  );
}
