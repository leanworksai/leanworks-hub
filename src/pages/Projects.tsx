import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreVertical, Users, Calendar } from "lucide-react";

const projects = [
  {
    name: "Mobile App Redesign",
    description: "Complete overhaul of the mobile experience",
    status: "In Progress",
    team: 8,
    dueDate: "Dec 15, 2024",
    statusColor: "bg-blue-500",
    summary: {
      accomplishment: "Completed user flow redesign and prototyping",
      decision: "Decided to adopt React Native for cross-platform support",
      risk: "Timeline might slip due to API dependencies",
      direction: "Moving towards beta testing phase",
    },
  },
  {
    name: "API Integration",
    description: "Third-party API connections and webhooks",
    status: "In Progress",
    team: 5,
    dueDate: "Jan 20, 2025",
    statusColor: "bg-blue-500",
    summary: {
      accomplishment: "Integrated Stripe and SendGrid APIs successfully",
      decision: "Using webhook retry mechanism for reliability",
      risk: "Rate limiting on third-party APIs",
      direction: "Focus on error handling and monitoring",
    },
  },
  {
    name: "Dashboard Analytics",
    description: "Real-time analytics and reporting dashboard",
    status: "Review",
    team: 6,
    dueDate: "Nov 30, 2024",
    statusColor: "bg-yellow-500",
    summary: {
      accomplishment: "All charts and metrics implemented",
      decision: "Using WebSockets for real-time updates",
      risk: "Performance optimization needed for large datasets",
      direction: "Final review and performance testing",
    },
  },
  {
    name: "User Authentication",
    description: "Enhanced security and SSO implementation",
    status: "Completed",
    team: 4,
    dueDate: "Nov 15, 2024",
    statusColor: "bg-green-500",
    summary: {
      accomplishment: "SSO integration with Google and Microsoft complete",
      decision: "Implemented JWT with refresh token rotation",
      risk: "None - project completed successfully",
      direction: "Monitoring production performance",
    },
  },
  {
    name: "Payment Gateway",
    description: "Stripe integration and checkout flow",
    status: "Planning",
    team: 3,
    dueDate: "Feb 10, 2025",
    statusColor: "bg-gray-500",
    summary: {
      accomplishment: "Requirements gathering and architecture design",
      decision: "Using Stripe Checkout for initial implementation",
      risk: "Regulatory compliance requirements need review",
      direction: "Starting development sprint next week",
    },
  },
  {
    name: "Email Campaign System",
    description: "Automated marketing email workflows",
    status: "In Progress",
    team: 4,
    dueDate: "Dec 28, 2024",
    statusColor: "bg-blue-500",
    summary: {
      accomplishment: "Template system and scheduler built",
      decision: "Using SendGrid for email delivery",
      risk: "Email deliverability rates need improvement",
      direction: "A/B testing implementation in progress",
    },
  },
];

export default function Projects() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage and track your active projects
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <Card key={project.name} className="bg-gradient-card border-border shadow-card">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-xl">{project.name}</CardTitle>
                  <CardDescription>{project.description}</CardDescription>
                </div>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground/70 mb-3">PROGRESS SUMMARY</p>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                  <li>{project.summary.accomplishment}</li>
                  <li>{project.summary.decision}</li>
                  <li>{project.summary.risk}</li>
                  <li>{project.summary.direction}</li>
                </ul>
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{project.team} members</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{project.dueDate}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
