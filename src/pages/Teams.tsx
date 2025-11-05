import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, MoreVertical } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTeams, addTeam, type Team, type TeamDetailData } from "@/data/teamsData";
import { toast } from "@/components/ui/sonner";

export default function Teams() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    members: "0",
    projects: "0",
  });

  useEffect(() => {
    setTeams(getTeams());
  }, []);

  const handleCreateTeam = () => {
    if (!formData.name.trim()) {
      toast.error("Team name is required");
      return;
    }

    if (!formData.description.trim()) {
      toast.error("Team description is required");
      return;
    }

    // Get first letter of team name for avatar
    const avatar = formData.name.charAt(0).toUpperCase();
    
    const newTeam: Team = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      members: parseInt(formData.members) || 0,
      projects: parseInt(formData.projects) || 0,
      avatar,
    };

    const newTeamDetail: TeamDetailData = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      avatar,
      members: [], // Empty members array, can be added later
    };

    try {
      addTeam(newTeam, newTeamDetail);
      setTeams(getTeams());
      setIsDialogOpen(false);
      setFormData({ name: "", description: "", members: "0", projects: "0" });
      toast.success("Team created successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create team");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-muted-foreground">
            Manage your teams and members
          </p>
        </div>
        <Button 
          className="bg-primary hover:bg-primary/90"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Team
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>
              Add a new team to your organization. You can add members later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Team Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Sales, Operations"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                placeholder="Brief description of the team"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="members">Members</Label>
                <Input
                  id="members"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={formData.members}
                  onChange={(e) => setFormData({ ...formData, members: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="projects">Projects</Label>
                <Input
                  id="projects"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={formData.projects}
                  onChange={(e) => setFormData({ ...formData, projects: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setFormData({ name: "", description: "", members: "0", projects: "0" });
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateTeam} className="bg-primary hover:bg-primary/90">
              Create Team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {teams.map((team) => (
          <Card 
            key={team.name} 
            className="bg-gradient-card border-border shadow-card cursor-pointer transition-all hover:shadow-lg hover:scale-105"
            onClick={() => navigate(`/teams/${team.name}`)}
          >
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
              <Button 
                variant="ghost" 
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
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
    </div>
  );
}
