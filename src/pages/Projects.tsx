import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreVertical, Users, Calendar } from "lucide-react";

const projects = [
  {
    name: "Mobile App Redesign",
    description: "Complete overhaul of the mobile experience",
    status: "In Progress",
    progress: 68,
    team: 8,
    dueDate: "Dec 15, 2024",
    statusColor: "bg-blue-500",
  },
  {
    name: "API Integration",
    description: "Third-party API connections and webhooks",
    status: "In Progress",
    progress: 45,
    team: 5,
    dueDate: "Jan 20, 2025",
    statusColor: "bg-blue-500",
  },
  {
    name: "Dashboard Analytics",
    description: "Real-time analytics and reporting dashboard",
    status: "Review",
    progress: 92,
    team: 6,
    dueDate: "Nov 30, 2024",
    statusColor: "bg-yellow-500",
  },
  {
    name: "User Authentication",
    description: "Enhanced security and SSO implementation",
    status: "Completed",
    progress: 100,
    team: 4,
    dueDate: "Nov 15, 2024",
    statusColor: "bg-green-500",
  },
  {
    name: "Payment Gateway",
    description: "Stripe integration and checkout flow",
    status: "Planning",
    progress: 15,
    team: 3,
    dueDate: "Feb 10, 2025",
    statusColor: "bg-gray-500",
  },
  {
    name: "Email Campaign System",
    description: "Automated marketing email workflows",
    status: "In Progress",
    progress: 55,
    team: 4,
    dueDate: "Dec 28, 2024",
    statusColor: "bg-blue-500",
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

      <div className="flex gap-2">
        {["All Projects", "In Progress", "Review", "Completed"].map((filter) => (
          <Badge
            key={filter}
            variant={filter === "All Projects" ? "default" : "secondary"}
            className="cursor-pointer px-4 py-1.5"
          >
            {filter}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <Card key={project.name} className="bg-gradient-card border-border shadow-card">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${project.statusColor}`} />
                    <Badge variant="secondary" className="text-xs">
                      {project.status}
                    </Badge>
                  </div>
                  <CardTitle className="text-xl">{project.name}</CardTitle>
                  <CardDescription>{project.description}</CardDescription>
                </div>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{project.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
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
