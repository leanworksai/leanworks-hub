import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Calendar } from "lucide-react";

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

export default function ProjectDetail() {
  const { projectName } = useParams();
  const navigate = useNavigate();
  
  const project = projects.find(
    (p) => p.name.toLowerCase().replace(/\s+/g, '-') === projectName
  );

  if (!project) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold">Project not found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Button variant="ghost" onClick={() => navigate("/projects")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Projects
      </Button>

      <div>
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <Badge className={`${project.statusColor} text-white`}>
            {project.status}
          </Badge>
        </div>
        <p className="text-muted-foreground text-lg">{project.description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-lg">Project Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-5 w-5" />
                <span className="font-medium">Team Size</span>
              </div>
              <span className="font-semibold">{project.team} members</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-5 w-5" />
                <span className="font-medium">Due Date</span>
              </div>
              <span className="font-semibold">{project.dueDate}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle className="text-lg">Progress Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Accomplishment</p>
                <p className="text-sm">{project.summary.accomplishment}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Decision</p>
                <p className="text-sm">{project.summary.decision}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Risk</p>
                <p className="text-sm">{project.summary.risk}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Direction</p>
                <p className="text-sm">{project.summary.direction}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
