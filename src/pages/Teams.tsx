import { useState, useMemo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { teamsService } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Mail, Briefcase, Check, ChevronsUpDown, Edit, Trash2, Bell, UserPlus, X } from "lucide-react";
import { MoreOptionsMenu } from "@/components/MoreOptionsMenu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTeams, useUserTeams, useCreateTeam, useUpdateTeam, useUpdateTeamDetail, useDeleteTeam, useTeam, useRequestJoinTeam, useJoinRequests, useApproveJoinRequest, useRejectJoinRequest } from "@/hooks/useTeams";
import { useUsers } from "@/hooks/useUsers";
import type { Team, TeamDetailData, TeamMember, TeamJoinRequest } from "@/data/teamsData";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { v4 as uuidv4 } from 'uuid';
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDateInTimezone } from "@/lib/dateTimeUtils";

export default function Teams() {
  const navigate = useNavigate();
  const { toggleTeam, isTeamSelected, selectedTeams } = useSelectedTeams();
  const { data: allTeams = [], isLoading: isLoadingAllTeams } = useTeams(); // All teams in domain
  const { data: userTeams = [], isLoading: isLoadingUserTeams } = useUserTeams(); // Teams user is member of
  const { data: users = [], isLoading: isLoadingUsers } = useUsers();
  const { user } = useAuth();
  const userTimezone = useUserTimezone();
  const createTeamMutation = useCreateTeam();
  const updateTeamMutation = useUpdateTeam();
  const updateTeamDetailMutation = useUpdateTeamDetail();
  const deleteTeamMutation = useDeleteTeam();
  const requestJoinMutation = useRequestJoinTeam();
  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests();
  const approveRequestMutation = useApproveJoinRequest();
  const rejectRequestMutation = useRejectJoinRequest();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [teamToEdit, setTeamToEdit] = useState<Team | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<string | null>(null); // Stores team ID
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });
  const [selectedMemberEmails, setSelectedMemberEmails] = useState<Set<string>>(new Set());
  const [membersOpen, setMembersOpen] = useState(false);
  const [showRequestsDialog, setShowRequestsDialog] = useState(false);
  
  // Load team details when editing
  const { data: teamDetail } = useTeam(teamToEdit?.id || "");
  
  // Fetch team details for all teams to check membership
  const teamDetailsQueries = useQueries({
    queries: allTeams.length > 0 && user?.email
      ? allTeams.map((team) => ({
          queryKey: ['teams', team.id],
          queryFn: () => teamsService.getById(team.id),
          enabled: !!team.id && !!user?.email,
          staleTime: 1000 * 60 * 5,
        }))
      : [],
  });
  
  // Determine which teams user is a member of
  const userTeamNames = new Set(
    userTeams.map(team => team.name)
  );
  
  // Get pending requests count
  const pendingRequestsCount = joinRequests.length;
  
  // Auto-select current user when create dialog opens
  useEffect(() => {
    if (isDialogOpen && user?.email && users.length > 0) {
      const currentUser = users.find(u => u.email.toLowerCase() === user.email?.toLowerCase());
      if (currentUser) {
        setSelectedMemberEmails(prev => {
          const newSet = new Set(prev);
          newSet.add(currentUser.email);
          return newSet;
        });
      }
    }
  }, [isDialogOpen, user?.email, users]);

  // Populate form when editing
  useEffect(() => {
    if (teamToEdit && teamDetail && isEditDialogOpen) {
      setFormData({
        name: teamToEdit.name,
        description: teamToEdit.description,
      });
      // Convert existing members to email set
      const existingEmails = new Set(
        teamDetail.members.map(member => member.email)
      );
      setSelectedMemberEmails(existingEmails);
    }
  }, [teamToEdit, teamDetail, isEditDialogOpen]);

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) {
      return users;
    }
    const query = searchQuery.toLowerCase();
    return users.filter((user) => {
      const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
      const email = user.email?.toLowerCase() || "";
      const jobTitle = user.jobTitle?.toLowerCase() || "";
      return (
        fullName.includes(query) ||
        email.includes(query) ||
        jobTitle.includes(query)
      );
    });
  }, [users, searchQuery]);

  // Helper function to get user avatar initials
  const getUserInitials = (user: { firstName: string; lastName: string; email: string }) => {
    const firstName = user.firstName || "";
    const lastName = user.lastName || "";
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (firstName) {
      return firstName.charAt(0).toUpperCase();
    }
    if (user.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return "U";
  };

  // Convert selected users to TeamMember format
  const convertUsersToTeamMembers = (selectedEmails: Set<string>): TeamMember[] => {
    return Array.from(selectedEmails)
      .map(email => {
        const user = users.find(u => u.email === email);
        if (!user) return null;
        return {
          name: `${user.firstName} ${user.lastName}`,
          role: user.jobTitle || "Member",
          email: user.email,
          avatar: getUserInitials(user),
        };
      })
      .filter((member): member is TeamMember => member !== null);
  };

  // Toggle member selection
  const toggleMemberSelection = (email: string) => {
    const newSelected = new Set(selectedMemberEmails);
    if (newSelected.has(email)) {
      newSelected.delete(email);
    } else {
      newSelected.add(email);
    }
    setSelectedMemberEmails(newSelected);
  };

  // Get selected user names for display
  const getSelectedUserNames = (): string[] => {
    return users
      .filter(user => selectedMemberEmails.has(user.email))
      .map(user => `${user.firstName} ${user.lastName}`);
  };

  // Get owner name from email
  const getOwnerName = (ownerEmail?: string): string | null => {
    if (!ownerEmail) return null;
    const owner = users.find(u => u.email.toLowerCase() === ownerEmail.toLowerCase());
    return owner ? `${owner.firstName} ${owner.lastName}` : null;
  };

  const handleCreateTeam = async () => {
    if (!formData.name.trim()) {
      toast.error("Team name is required");
      return;
    }

    if (!user?.email) {
      toast.error("You must be logged in to create a team");
      return;
    }

    // Get first letter of team name for avatar
    const avatar = formData.name.charAt(0).toUpperCase();
    
    // Convert selected users to team members
    const teamMembers = convertUsersToTeamMembers(selectedMemberEmails);
    
    // Find current user in users list and add them as a member if not already included
    const currentUser = users.find(u => u.email.toLowerCase() === user.email?.toLowerCase());
    if (currentUser) {
      const currentUserEmail = currentUser.email.toLowerCase();
      const isCurrentUserInMembers = teamMembers.some(
        member => member.email.toLowerCase() === currentUserEmail
      );
      
      if (!isCurrentUserInMembers) {
        // Add current user as a member
        const currentUserMember: TeamMember = {
          name: `${currentUser.firstName} ${currentUser.lastName}`,
          role: currentUser.jobTitle || "Member",
          email: currentUser.email,
          avatar: getUserInitials(currentUser),
        };
        teamMembers.push(currentUserMember);
      }
    }
    
    const teamId = uuidv4(); // Generate unique ID
    
    const newTeam: Team = {
      id: teamId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      members: teamMembers.length,
      projects: 0,
      avatar,
      ownerEmail: user.email,
    };

    const newTeamDetail: TeamDetailData = {
      id: teamId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      avatar,
      members: teamMembers,
      ownerEmail: user.email,
    };

    try {
      await createTeamMutation.mutateAsync({ team: newTeam, teamDetail: newTeamDetail });
      setIsDialogOpen(false);
      setFormData({ name: "", description: "" });
      setSelectedMemberEmails(new Set());
      toast.success("Team created successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create team");
    }
  };

  const handleEditTeam = async () => {
    if (!teamToEdit) return;
    
    if (!formData.name.trim()) {
      toast.error("Team name is required");
      return;
    }

    const avatar = formData.name.charAt(0).toUpperCase();
    const teamMembers = convertUsersToTeamMembers(selectedMemberEmails);
    
    try {
      // Update team basic info
      await updateTeamMutation.mutateAsync({
        teamName: teamToEdit.name,
        updates: {
          name: formData.name.trim(),
          description: formData.description.trim(),
          members: teamMembers.length,
          avatar,
        },
      });

      // Update team detail
      await updateTeamDetailMutation.mutateAsync({
        teamName: teamToEdit.name,
        updates: {
          name: formData.name.trim(),
          description: formData.description.trim(),
          avatar,
          members: teamMembers,
        },
      });

      setIsEditDialogOpen(false);
      setTeamToEdit(null);
      setFormData({ name: "", description: "" });
      setSelectedMemberEmails(new Set());
      toast.success("Team updated successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update team");
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, teamId: string) => {
    e.stopPropagation();
    setTeamToDelete(teamId);
  };

  const handleDeleteConfirm = async () => {
    if (!teamToDelete) return;

    try {
      await deleteTeamMutation.mutateAsync(teamToDelete);
      toast.success("Team deleted successfully!");
      setTeamToDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete team");
    }
  };

  const handleEditClick = (e: React.MouseEvent, team: Team) => {
    e.stopPropagation();
    setTeamToEdit(team);
    setIsEditDialogOpen(true);
  };

  // Check if user is member of a team
  const isUserMemberOfTeam = (teamName: string): boolean => {
    return userTeamNames.has(teamName);
  };
  
  // Check if user has pending request for a team
  const hasPendingRequest = (teamName: string): boolean => {
    return joinRequests.some(
      (req: TeamJoinRequest) => req.teamName === teamName && req.status === 'pending'
    );
  };
  
  // Handle join request
  const handleJoinTeam = async (teamName: string) => {
    try {
      await requestJoinMutation.mutateAsync(teamName);
      toast.success('Join request sent successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to send join request');
    }
  };
  
  // Handle approve request
  const handleApproveRequest = async (requestId: string) => {
    try {
      await approveRequestMutation.mutateAsync(requestId);
      toast.success('Join request approved!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve request');
    }
  };
  
  // Handle reject request
  const handleRejectRequest = async (requestId: string) => {
    try {
      await rejectRequestMutation.mutateAsync(requestId);
      toast.success('Join request rejected');
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject request');
    }
  };

  const isLoading = isLoadingAllTeams || isLoadingUserTeams;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading teams...</p>
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Teams</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {pendingRequestsCount > 0 && (
            <Button 
              variant="outline"
              onClick={() => setShowRequestsDialog(true)}
              className="relative flex-1 sm:flex-initial"
            >
              <Bell className="mr-2 h-4 w-4" />
              Requests
              {pendingRequestsCount > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                  {pendingRequestsCount}
                </span>
              )}
            </Button>
          )}
          <Button 
            className="bg-primary hover:bg-primary/90 flex-1 sm:flex-initial"
            onClick={() => setIsDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Team
          </Button>
        </div>
      </div>

      <Tabs defaultValue="my-teams" className="w-full">
        <TabsList>
          <TabsTrigger value="all-teams">All Teams</TabsTrigger>
          <TabsTrigger value="my-teams">My Teams</TabsTrigger>
        </TabsList>

        <TabsContent value="all-teams" className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {allTeams.map((team) => {
              const isMember = isUserMemberOfTeam(team.name);
              const hasPending = hasPendingRequest(team.name);
              
              return (
                <Card 
                  key={team.name} 
                  className="bg-gradient-card border-border shadow-card cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] min-h-[180px]"
                    onClick={() => {
                      if (isMember) {
                        navigate(`/teams/${team.id}`);
                      }
                    }}
                >
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 px-6 pt-6">
                    <div className="flex items-start gap-3 flex-1 min-w-0 pr-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg font-semibold leading-tight break-words">{team.name}</CardTitle>
                      </div>
                    </div>
                    <MoreOptionsMenu
                      items={[
                        {
                          icon: isTeamSelected(team.name) ? X : Plus,
                          label: isTeamSelected(team.name) ? "Remove from Context" : "Add to Context",
                          onClick: (e) => {
                            toggleTeam(team);
                          },
                        },
                        {
                          label: "View Details",
                          onClick: () => navigate(`/teams/${team.id}`),
                          show: isMember,
                        },
                        {
                          icon: Edit,
                          label: "Edit",
                          onClick: (e) => handleEditClick(e, team),
                          show: isMember,
                        },
                        {
                          icon: Trash2,
                          label: "Delete",
                          onClick: (e) => handleDeleteClick(e, team.id),
                          isDestructive: true,
                          show: isMember,
                        },
                      ]}
                    />
                  </CardHeader>
                  <CardContent className="px-6 pb-6">
                    <div className="flex justify-between items-start gap-6 mb-4">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Members</p>
                        <p className="text-2xl font-bold">{team.members}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Projects</p>
                        <p className="text-2xl font-bold">{team.projects}</p>
                      </div>
                    </div>
                    {!isMember && (
                      <div className="mt-4">
                        {hasPending ? (
                          <Button 
                            variant="outline" 
                            className="w-full" 
                            disabled
                            onClick={(e) => e.stopPropagation()}
                          >
                            Request Pending
                          </Button>
                        ) : (
                          <Button 
                            className="w-full bg-primary hover:bg-primary/90"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJoinTeam(team.name);
                            }}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            Join Team
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="my-teams" className="space-y-4">
          {userTeams.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">You are not a member of any teams yet.</p>
              <p className="text-sm text-muted-foreground mt-2">
                Switch to "All Teams" to join teams in your organization.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {userTeams.map((team) => {
                return (
                  <Card 
                    key={team.name} 
                    className="bg-gradient-card border-border shadow-card cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] min-h-[180px]"
                    onClick={() => {
                      navigate(`/teams/${team.id}`);
                    }}
                  >
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 px-6 pt-6">
                      <div className="flex items-start gap-3 flex-1 min-w-0 pr-2">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg font-semibold leading-tight break-words">{team.name}</CardTitle>
                        </div>
                      </div>
                      <MoreOptionsMenu
                        items={[
                          {
                            icon: isTeamSelected(team.name) ? X : Plus,
                            label: isTeamSelected(team.name) ? "Remove from Context" : "Add to Context",
                            onClick: (e) => {
                              toggleTeam(team);
                            },
                          },
                          {
                            label: "View Details",
                            onClick: () => navigate(`/teams/${team.id}`),
                          },
                          {
                            icon: Edit,
                            label: "Edit",
                            onClick: (e) => handleEditClick(e, team),
                          },
                          {
                            icon: Trash2,
                            label: "Delete",
                            onClick: (e) => handleDeleteClick(e, team.id),
                            isDestructive: true,
                          },
                        ]}
                      />
                    </CardHeader>
                    <CardContent className="px-6 pb-6">
                      <div className="flex justify-between items-start gap-6 mb-4">
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground mb-2 font-medium">Members</p>
                          <p className="text-2xl font-bold">{team.members}</p>
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground mb-2 font-medium">Projects</p>
                          <p className="text-2xl font-bold">{team.projects}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) {
          setFormData({ name: "", description: "" });
          setSelectedMemberEmails(new Set());
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>
              Add a new team to your organization. You can optionally add members now.
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
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Brief description of the team"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Team Members</Label>
              <Popover open={membersOpen} onOpenChange={setMembersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={membersOpen}
                    className="w-full justify-between"
                  >
                    {selectedMemberEmails.size > 0 ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {getSelectedUserNames().slice(0, 3).map((name, idx) => {
                            const user = users.find(u => `${u.firstName} ${u.lastName}` === name);
                            return (
                              <Avatar key={idx} className="h-5 w-5 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {user ? getUserInitials(user) : "U"}
                                </AvatarFallback>
                              </Avatar>
                            );
                          })}
                          {selectedMemberEmails.size > 3 && (
                            <span className="text-sm text-muted-foreground">
                              +{selectedMemberEmails.size - 3} more
                            </span>
                          )}
                          {selectedMemberEmails.size <= 3 && selectedMemberEmails.size > 0 && (
                            <span className="text-sm truncate">
                              {getSelectedUserNames().join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      "Select members..."
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Search users..." />
                    <CommandList>
                      {isLoadingUsers ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading users...</div>
                      ) : users.length === 0 ? (
                        <CommandEmpty>No users found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {users.map((user) => {
                            const isSelected = selectedMemberEmails.has(user.email);
                            const fullName = `${user.firstName} ${user.lastName}`;
                            return (
                              <CommandItem
                                key={user.email}
                                value={fullName}
                                onSelect={() => {
                                  toggleMemberSelection(user.email);
                                }}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 shrink-0 ${
                                    isSelected ? "opacity-100" : "opacity-0"
                                  }`}
                                />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Avatar className="h-6 w-6 shrink-0">
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                      {getUserInitials(user)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate">
                                      {fullName}
                                    </span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {user.jobTitle || user.email}
                                    </span>
                                  </div>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedMemberEmails.size > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedMemberEmails.size} member{selectedMemberEmails.size !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsDialogOpen(false);
                setFormData({ name: "", description: "" });
                setSelectedMemberEmails(new Set());
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

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) {
          setTeamToEdit(null);
          setFormData({ name: "", description: "" });
          setSelectedMemberEmails(new Set());
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Team</DialogTitle>
            <DialogDescription>
              Update team information and members.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Team Name *</Label>
              <Input
                id="edit-name"
                placeholder="e.g., Sales, Operations"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description *</Label>
              <Input
                id="edit-description"
                placeholder="Brief description of the team"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Team Members</Label>
              <Popover open={membersOpen} onOpenChange={setMembersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={membersOpen}
                    className="w-full justify-between"
                  >
                    {selectedMemberEmails.size > 0 ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {getSelectedUserNames().slice(0, 3).map((name, idx) => {
                            const user = users.find(u => `${u.firstName} ${u.lastName}` === name);
                            return (
                              <Avatar key={idx} className="h-5 w-5 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                  {user ? getUserInitials(user) : "U"}
                                </AvatarFallback>
                              </Avatar>
                            );
                          })}
                          {selectedMemberEmails.size > 3 && (
                            <span className="text-sm text-muted-foreground">
                              +{selectedMemberEmails.size - 3} more
                            </span>
                          )}
                          {selectedMemberEmails.size <= 3 && selectedMemberEmails.size > 0 && (
                            <span className="text-sm truncate">
                              {getSelectedUserNames().join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      "Select members..."
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0">
                  <Command>
                    <CommandInput placeholder="Search users..." />
                    <CommandList>
                      {isLoadingUsers ? (
                        <div className="p-4 text-sm text-muted-foreground">Loading users...</div>
                      ) : users.length === 0 ? (
                        <CommandEmpty>No users found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {users.map((user) => {
                            const isSelected = selectedMemberEmails.has(user.email);
                            const fullName = `${user.firstName} ${user.lastName}`;
                            return (
                              <CommandItem
                                key={user.email}
                                value={fullName}
                                onSelect={() => {
                                  toggleMemberSelection(user.email);
                                }}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 shrink-0 ${
                                    isSelected ? "opacity-100" : "opacity-0"
                                  }`}
                                />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Avatar className="h-6 w-6 shrink-0">
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                      {getUserInitials(user)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate">
                                      {fullName}
                                    </span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {user.jobTitle || user.email}
                                    </span>
                                  </div>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedMemberEmails.size > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedMemberEmails.size} member{selectedMemberEmails.size !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setTeamToEdit(null);
                setFormData({ name: "", description: "" });
                setSelectedMemberEmails(new Set());
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleEditTeam} className="bg-primary hover:bg-primary/90">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!teamToDelete} onOpenChange={(open) => !open && setTeamToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{teamToDelete ? (allTeams.find(t => t.id === teamToDelete)?.name || userTeams.find(t => t.id === teamToDelete)?.name || 'this team') : 'this team'}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Join Requests Dialog */}
      <Dialog open={showRequestsDialog} onOpenChange={setShowRequestsDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Team Join Requests</DialogTitle>
            <DialogDescription>
              Review and manage pending join requests for your teams
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[500px] overflow-y-auto">
            {isLoadingRequests ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Loading requests...</p>
              </div>
            ) : joinRequests.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No pending requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {joinRequests.map((request: TeamJoinRequest) => (
                  <Card key={request.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback>
                              {request.userName.split(' ').map(n => n[0]).join('').toUpperCase() || request.userEmail[0].toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{request.userName}</p>
                            <p className="text-sm text-muted-foreground">{request.userEmail}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Wants to join <span className="font-medium">{request.teamName}</span>
                            </p>
                            {request.createdAt && (
                              <p className="text-xs text-muted-foreground">
                                {formatDateInTimezone(request.createdAt, userTimezone)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejectRequest(request.id)}
                          disabled={rejectRequestMutation.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary/90"
                          onClick={() => handleApproveRequest(request.id)}
                          disabled={approveRequestMutation.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
