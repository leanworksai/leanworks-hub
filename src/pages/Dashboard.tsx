import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, Puzzle, TrendingUp } from "lucide-react";

const stats = [
  {
    title: "Active Projects",
    value: "12",
    change: "+2 this month",
    icon: BarChart3,
  },
  {
    title: "Team Members",
    value: "48",
    change: "+6 this month",
    icon: Users,
  },
  {
    title: "Integrations",
    value: "8",
    change: "3 connected",
    icon: Puzzle,
  },
  {
    title: "Efficiency",
    value: "94%",
    change: "+12% from last month",
    icon: TrendingUp,
  },
];

const recentProjects = [
  { name: "Mobile App Redesign", status: "In Progress", progress: 68 },
  { name: "API Integration", status: "In Progress", progress: 45 },
  { name: "Dashboard Analytics", status: "Review", progress: 92 },
  { name: "User Authentication", status: "Completed", progress: 100 },
];

export default function Dashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's an overview of your workspace.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="bg-gradient-card border-border shadow-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle>Recent Projects</CardTitle>
            <CardDescription>
              Your most recently updated projects
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentProjects.map((project) => (
                <div
                  key={project.name}
                  className="flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {project.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {project.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {project.progress}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-card border-border shadow-card">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common tasks and workflows
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-3 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                  <BarChart3 className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-medium">Create New Project</p>
                  <p className="text-sm text-muted-foreground">
                    Start a new project workspace
                  </p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-3 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                  <Users className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-medium">Invite Team Member</p>
                  <p className="text-sm text-muted-foreground">
                    Add someone to your workspace
                  </p>
                </div>
              </button>
              <button className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-3 text-left transition-colors hover:bg-secondary">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                  <Puzzle className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-medium">Connect Integration</p>
                  <p className="text-sm text-muted-foreground">
                    Link your favorite tools
                  </p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
