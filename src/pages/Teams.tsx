import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MoreVertical, Mail, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const teams = [
  {
    name: "Engineering",
    members: 24,
    projects: 8,
    avatar: "E",
    description: "Core development team",
  },
  {
    name: "Design",
    members: 12,
    projects: 5,
    avatar: "D",
    description: "UI/UX and product design",
  },
  {
    name: "Product",
    members: 8,
    projects: 6,
    avatar: "P",
    description: "Product management",
  },
  {
    name: "Marketing",
    members: 6,
    projects: 3,
    avatar: "M",
    description: "Growth and marketing",
  },
];

const teamMembers = [
  { name: "Sarah Johnson", role: "Team Lead", email: "sarah@leanworks.ai", avatar: "SJ" },
  { name: "Michael Chen", role: "Developer", email: "michael@leanworks.ai", avatar: "MC" },
  { name: "Emma Davis", role: "Designer", email: "emma@leanworks.ai", avatar: "ED" },
  { name: "James Wilson", role: "Product Manager", email: "james@leanworks.ai", avatar: "JW" },
];

export default function Teams() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground">
            Manage your teams and members
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" />
          Create Team
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {teams.map((team) => (
          <Card key={team.name} className="bg-gradient-card border-border shadow-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 bg-primary">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {team.avatar}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-base">{team.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {team.description}
                  </CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-muted-foreground">Members</p>
                  <p className="text-xl font-bold">{team.members}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Projects</p>
                  <p className="text-xl font-bold">{team.projects}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              All members across your organization
            </CardDescription>
          </div>
          <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {teamMembers.map((member) => (
              <div
                key={member.email}
                className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {member.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {member.email}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">{member.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
