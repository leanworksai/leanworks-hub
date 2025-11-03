import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink } from "lucide-react";

const integrations = [
  {
    name: "Slack",
    description: "Team communication and notifications",
    category: "Communication",
    connected: true,
    icon: "💬",
  },
  {
    name: "Jira",
    description: "Project tracking and issue management",
    category: "Project Management",
    connected: true,
    icon: "📊",
  },
  {
    name: "GitHub",
    description: "Code repository and version control",
    category: "Development",
    connected: true,
    icon: "🔧",
  },
  {
    name: "Notion",
    description: "Documentation and knowledge base",
    category: "Documentation",
    connected: false,
    icon: "📝",
  },
  {
    name: "Linear",
    description: "Modern issue tracking and project planning",
    category: "Project Management",
    connected: false,
    icon: "📈",
  },
  {
    name: "Figma",
    description: "Design collaboration and prototyping",
    category: "Design",
    connected: false,
    icon: "🎨",
  },
  {
    name: "Google Drive",
    description: "Cloud storage and file sharing",
    category: "Storage",
    connected: false,
    icon: "☁️",
  },
  {
    name: "Asana",
    description: "Task and project management",
    category: "Project Management",
    connected: false,
    icon: "✓",
  },
];

const categories = ["All", "Communication", "Project Management", "Development", "Design", "Storage", "Documentation"];

export default function Integrations() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground">
            Connect your favorite tools and services
          </p>
        </div>
        <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
          <ExternalLink className="mr-2 h-4 w-4" />
          Browse All
        </Button>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle>Connected Integrations</CardTitle>
          <CardDescription>
            {integrations.filter(i => i.connected).length} integrations currently active
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Badge
                key={category}
                variant={category === "All" ? "default" : "secondary"}
                className="cursor-pointer"
              >
                {category}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <Card key={integration.name} className="bg-gradient-card border-border shadow-card">
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
                {integration.connected && (
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
              {integration.connected ? (
                <Button
                  variant="outline"
                  className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  Disconnect
                </Button>
              ) : (
                <Button className="w-full bg-primary hover:bg-primary/90">
                  Connect
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
