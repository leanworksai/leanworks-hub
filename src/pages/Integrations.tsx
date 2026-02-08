import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IntegrationConnectDialog } from "@/components/IntegrationConnectDialog";
import { integrationConfigs } from "@/config/integrations";
import { integrationsService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";

// Integration logo component with fallback
function IntegrationLogo({ logo, name }: { logo?: string; name: string }) {
  const [imgError, setImgError] = useState(false);
  
  if (!logo || imgError) {
    // Fallback: first letter of integration name in a colored circle
    const firstLetter = name.charAt(0).toUpperCase();
    const colors: Record<string, string> = {
      'S': 'bg-purple-600',
      'A': 'bg-blue-600',
      'G': 'bg-blue-600',
      'O': 'bg-blue-500',
      'N': 'bg-black',
      'L': 'bg-indigo-600',
      'C': 'bg-violet-600',
      'B': 'bg-amber-600',
    };
    const bgColor = colors[firstLetter] || 'bg-gray-600';
    
    return (
      <div className={`h-full w-full flex items-center justify-center text-white text-sm font-semibold ${bgColor}`}>
        {firstLetter}
      </div>
    );
  }
  
  return (
    <img 
      src={logo} 
      alt={`${name} logo`}
      className="h-full w-full object-contain p-2"
      onError={() => setImgError(true)}
    />
  );
}

const integrations = [
  {
    id: "slack",
    name: "Slack",
    description: "Team communication and notifications",
    category: "Communication",
    logo: "/integration-logos/slack.png",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Project tracking and issue management",
    category: "Project Management",
    logo: "/integration-logos/atlassian.svg",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code repository and version control",
    category: "Development",
    logo: "/integration-logos/github.png",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Email and calendar integration",
    category: "Communication",
    logo: "/integration-logos/outlook.png",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Workspace and knowledge management",
    category: "Productivity",
    logo: "/integration-logos/notion.png",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issue tracking and project management",
    category: "Project Management",
    logo: "/integration-logos/linear.svg",
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Task and project management",
    category: "Project Management",
    logo: "/integration-logos/clickup.svg",
  },
  {
    id: "workday",
    name: "Workday",
    description: "HRIS and employee data",
    category: "HR",
    logo: "/integration-logos/workday.svg",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Files and folders in Google Drive (list, search, upload, download)",
    category: "Cloud & Data",
    logo: "/integration-logos/google-drive.svg",
  },
  {
    id: "google_cloud_storage",
    name: "Google Cloud Storage",
    description: "List, upload, download, and signed URLs for GCS buckets",
    category: "Cloud & Data",
    logo: "/integration-logos/google-cloud-storage.svg",
  },
  {
    id: "bigquery",
    name: "BigQuery",
    description: "Query datasets and run read-only SQL in BigQuery",
    category: "Cloud & Data",
    logo: "/integration-logos/bigquery.svg",
  },
];

export default function Integrations() {
  const [connectedIntegrations, setConnectedIntegrations] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [openDialogId, setOpenDialogId] = useState<string | null>(null);
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const { toast } = useToast();
  
  // Check if user is org owner (only owners can connect/disconnect)
  const isOrgOwner = currentOrg?.isOwner || false;

  const loadIntegrations = useCallback(async () => {
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
  }, [user]);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  // Handle GitHub installation callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubStatus = params.get('github');
    const installationId = params.get('installation_id');
    
    if (githubStatus === 'connected') {
      toast({
        title: "Success",
        description: "GitHub integration connected successfully",
      });
      // Small delay to ensure Firestore write has completed
      setTimeout(() => {
        loadIntegrations(); // Reload to show connected status
      }, 500);
      // Clean up URL
      window.history.replaceState({}, '', '/integrations');
    } else if (githubStatus === 'error') {
      console.error('[Integrations] GitHub callback error');
      toast({
        title: "Error",
        description: "Failed to connect GitHub integration",
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, '', '/integrations');
    }
  }, [toast, loadIntegrations]);

  const handleConnect = async (integrationId: string) => {
    if (integrationId === "github") {
      // GitHub uses OAuth flow, not a form dialog
      if (!currentOrg?.slug) {
        toast({
          title: "Error",
          description: "Please select an organization before connecting GitHub.",
          variant: "destructive",
        });
        return;
      }

      try {
        // First check if GitHub app is already installed
        const result = await integrationsService.checkGitHubInstallation();

        if (result.installation) {
          // Installation exists, save it directly
          await integrationsService.saveGitHubInstallation(result.installation.id);

          toast({
            title: "Success",
            description: `GitHub connected successfully using existing installation for ${result.installation.account.login}`,
          });

          // Reload integrations to show connected status
          loadIntegrations();
          return;
        }
      } catch (error: any) {
        console.warn('[GitHub Connect] Could not check existing installations, proceeding with normal flow:', error);
        // Continue with normal flow if check fails
      }

      // No existing installation found, redirect to GitHub installation
      // GitHub App installation URL with state parameter containing org slug
      // The callback URL should be configured in GitHub App settings as:
      // https://leanworks.ai/api/integrations/github/callback
      const githubAppUrl = `https://github.com/apps/leanworksai/installations/new?state=${encodeURIComponent(currentOrg.slug)}`;
      window.open(githubAppUrl, "_blank");
    } else if (integrationConfigs[integrationId]) {
      // Open the appropriate dialog for form-based integrations
      setOpenDialogId(integrationId);
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
    setOpenDialogId(null);
    toast({
      title: "Success",
      description: "Integration connected successfully",
    });
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header: same layout as Tasks / Plans / Projects */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-12 items-center px-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Integrations</h1>
            <Badge variant="secondary" className="ml-1.5">
              {loading ? '—' : integrations.length}
            </Badge>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading integrations...</p>
          </div>
        ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const isConnected = connectedIntegrations.has(integration.id);
          return (
            <Card key={integration.id} className="bg-gradient-card border-border shadow-card">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary overflow-hidden">
                      <IntegrationLogo logo={integration.logo} name={integration.name} />
                    </div>
                    <div>
                      <CardTitle className="text-base">{integration.name}</CardTitle>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {integration.category}
                      </Badge>
                    </div>
                  </div>
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
                    disabled={loading || !isOrgOwner}
                    title={!isOrgOwner ? "Only organization owners can disconnect integrations" : undefined}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button 
                    className="w-full bg-primary hover:bg-primary/90"
                    onClick={() => handleConnect(integration.id)}
                    disabled={loading || !isOrgOwner}
                    title={!isOrgOwner ? "Only organization owners can connect integrations" : undefined}
                  >
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
        </div>
        )}
      </div>

      {/* Render dialog for the currently selected integration */}
      {openDialogId && integrationConfigs[openDialogId] && (
        <IntegrationConnectDialog
          open={openDialogId !== null}
          onOpenChange={(open) => !open && setOpenDialogId(null)}
          onSuccess={() => handleConnectionSuccess(openDialogId)}
          config={integrationConfigs[openDialogId]}
        />
      )}
    </div>
  );
}
