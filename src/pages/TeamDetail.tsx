import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, UserPlus, Mail, MoreVertical, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const teamData = {
  Engineering: {
    name: "Engineering",
    description: "Core development team",
    avatar: "E",
    members: [
      { name: "Sarah Johnson", role: "Team Lead", email: "sarah@leanworks.ai", avatar: "SJ" },
      { name: "Michael Chen", role: "Senior Developer", email: "michael@leanworks.ai", avatar: "MC" },
      { name: "Alex Rivera", role: "Frontend Developer", email: "alex@leanworks.ai", avatar: "AR" },
      { name: "David Kim", role: "Backend Developer", email: "david@leanworks.ai", avatar: "DK" },
    ],
  },
  Design: {
    name: "Design",
    description: "UI/UX and product design",
    avatar: "D",
    members: [
      { name: "Emma Davis", role: "Design Lead", email: "emma@leanworks.ai", avatar: "ED" },
      { name: "Sophie Turner", role: "UI Designer", email: "sophie@leanworks.ai", avatar: "ST" },
      { name: "Lucas Brown", role: "UX Researcher", email: "lucas@leanworks.ai", avatar: "LB" },
    ],
  },
  Product: {
    name: "Product",
    description: "Product management",
    avatar: "P",
    members: [
      { name: "James Wilson", role: "Product Manager", email: "james@leanworks.ai", avatar: "JW" },
      { name: "Olivia Martinez", role: "Product Owner", email: "olivia@leanworks.ai", avatar: "OM" },
    ],
  },
  Marketing: {
    name: "Marketing",
    description: "Growth and marketing",
    avatar: "M",
    members: [
      { name: "Ryan Taylor", role: "Marketing Lead", email: "ryan@leanworks.ai", avatar: "RT" },
      { name: "Nina Patel", role: "Content Strategist", email: "nina@leanworks.ai", avatar: "NP" },
    ],
  },
};

export default function TeamDetail() {
  const { teamName } = useParams<{ teamName: string }>();
  const navigate = useNavigate();
  
  const team = teamName ? teamData[teamName as keyof typeof teamData] : null;

  if (!team) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/teams")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Teams
        </Button>
        <p>Team not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/teams")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <Avatar className="h-12 w-12 bg-primary">
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {team.avatar}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
            <p className="text-muted-foreground">{team.description}</p>
          </div>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <UserPlus className="mr-2 h-4 w-4" />
          Add Member
        </Button>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            Manage members in this team
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {team.members.map((member) => (
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
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{member.role}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>Edit Role</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove from Team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
