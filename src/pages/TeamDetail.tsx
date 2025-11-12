import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, UserPlus, Mail, MoreVertical, Trash2, LogOut, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTeam, useRemoveTeamMember, useLeaveTeam, useInviteTeamMember } from "@/hooks/useTeams";
import { useAuth } from "@/contexts/AuthContext";
import { useUsers } from "@/hooks/useUsers";
import { useEffect, useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: users = [] } = useUsers();
  const { toast } = useToast();
  
  const { data: team, isLoading } = useTeam(teamId || '');
  const removeMemberMutation = useRemoveTeamMember();
  const leaveTeamMutation = useLeaveTeam();
  const inviteMemberMutation = useInviteTeamMember();

  const [removeMemberDialog, setRemoveMemberDialog] = useState<{ open: boolean; memberEmail: string; memberName: string }>({
    open: false,
    memberEmail: '',
    memberName: '',
  });
  const [leaveTeamDialog, setLeaveTeamDialog] = useState(false);
  const [addMemberDialog, setAddMemberDialog] = useState(false);
  const [selectedUserEmails, setSelectedUserEmails] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Get owner name from email
  const getOwnerName = (ownerEmail?: string): string | null => {
    if (!ownerEmail) return null;
    const owner = users.find(u => u.email.toLowerCase() === ownerEmail.toLowerCase());
    return owner ? `${owner.firstName} ${owner.lastName}` : null;
  };

  // Check if user is a member of the team
  const isUserMember = team && user?.email
    ? team.members.some(
        (member) => member.email.toLowerCase() === user.email?.toLowerCase()
      )
    : false;

  // Check if user is the owner
  const isUserOwner = team && user?.email && team.ownerEmail
    ? team.ownerEmail.toLowerCase() === user.email.toLowerCase()
    : false;

  // Redirect if user is not a member (after team data is loaded)
  useEffect(() => {
    if (!isLoading && team && user?.email && !isUserMember) {
      navigate("/teams");
    }
  }, [isLoading, team, user?.email, isUserMember, navigate]);

  // Handle remove member
  const handleRemoveMember = async () => {
    if (!teamName || !removeMemberDialog.memberEmail) return;
    
    try {
      await removeMemberMutation.mutateAsync({
        teamName,
        memberEmail: removeMemberDialog.memberEmail,
      });
      toast({
        title: "Member removed",
        description: `${removeMemberDialog.memberName} has been removed from the team.`,
      });
      setRemoveMemberDialog({ open: false, memberEmail: '', memberName: '' });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove member",
        variant: "destructive",
      });
    }
  };

  // Handle leave team
  const handleLeaveTeam = async () => {
    if (!teamName) return;
    
    try {
      await leaveTeamMutation.mutateAsync(teamName);
      toast({
        title: "Left team",
        description: "You have successfully left the team.",
      });
      navigate("/teams");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to leave team",
        variant: "destructive",
      });
    }
  };

  // Get existing member emails
  const existingMemberEmails = useMemo(() => {
    if (!team) return new Set<string>();
    return new Set(team.members.map(m => m.email.toLowerCase()));
  }, [team]);

  // Filter users: exclude existing members and filter by search query
  const availableUsers = useMemo(() => {
    if (!users) return [];
    return users.filter(user => {
      // Exclude existing members
      if (existingMemberEmails.has(user.email.toLowerCase())) {
        return false;
      }
      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
        const email = user.email?.toLowerCase() || "";
        const jobTitle = user.jobTitle?.toLowerCase() || "";
        return fullName.includes(query) || email.includes(query) || jobTitle.includes(query);
      }
      return true;
    });
  }, [users, existingMemberEmails, searchQuery]);

  // Toggle user selection
  const toggleUserSelection = (email: string) => {
    const newSelected = new Set(selectedUserEmails);
    if (newSelected.has(email)) {
      newSelected.delete(email);
    } else {
      newSelected.add(email);
    }
    setSelectedUserEmails(newSelected);
  };

  // Handle invite members
  const handleInviteMembers = async () => {
    if (!teamName || !team || selectedUserEmails.size === 0) return;

    try {
      // Get selected users
      const selectedUsers = users.filter(u => selectedUserEmails.has(u.email));
      
      // Send invitations to all selected users
      const invitationPromises = selectedUsers.map(user => 
        inviteMemberMutation.mutateAsync({
          teamName,
          inviteeEmail: user.email,
        })
      );

      await Promise.all(invitationPromises);

      toast({
        title: "Invitations sent",
        description: `Successfully sent ${selectedUsers.length} invitation(s). Users will receive notifications.`,
      });

      // Reset and close dialog
      setSelectedUserEmails(new Set());
      setSearchQuery("");
      setAddMemberDialog(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send invitations",
        variant: "destructive",
      });
    }
  };

  // Reset dialog state when it opens/closes
  useEffect(() => {
    if (!addMemberDialog) {
      setSelectedUserEmails(new Set());
      setSearchQuery("");
    }
  }, [addMemberDialog]);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/teams")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Teams
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading team...</p>
        </div>
      </div>
    );
  }

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

  // Show access denied if user is not a member
  if (!isLoading && user?.email && !isUserMember) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" onClick={() => navigate("/teams")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Teams
        </Button>
        <div className="text-center py-12">
          <p className="text-muted-foreground">You don't have access to this team.</p>
        </div>
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
        <div className="flex items-center gap-2">
          {isUserOwner && (
            <Button 
              className="bg-primary hover:bg-primary/90"
              onClick={() => setAddMemberDialog(true)}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          )}
          {!isUserOwner && isUserMember && (
            <Button 
              variant="outline" 
              onClick={() => setLeaveTeamDialog(true)}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Leave Team
            </Button>
          )}
        </div>
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
                  {team.ownerEmail && member.email.toLowerCase() === team.ownerEmail.toLowerCase() && (
                    <Badge variant="default" className="bg-primary text-primary-foreground">Owner</Badge>
                  )}
                  {isUserOwner && member.email.toLowerCase() !== user?.email?.toLowerCase() && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Edit Role</DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => setRemoveMemberDialog({
                            open: true,
                            memberEmail: member.email,
                            memberName: member.name,
                          })}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove from Team
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog open={removeMemberDialog.open} onOpenChange={(open) => 
        setRemoveMemberDialog({ ...removeMemberDialog, open })
      }>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removeMemberDialog.memberName}</strong> from this team? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              disabled={removeMemberMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove Member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leave Team Confirmation Dialog */}
      <AlertDialog open={leaveTeamDialog} onOpenChange={setLeaveTeamDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave <strong>{team?.name}</strong>? 
              You will lose access to this team and all its projects. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveTeam}
              disabled={leaveTeamMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {leaveTeamMutation.isPending ? "Leaving..." : "Leave Team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite Member Dialog */}
      <Dialog open={addMemberDialog} onOpenChange={setAddMemberDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Invite Members</DialogTitle>
            <DialogDescription>
              Select users from your domain to invite to the team. Invitations will be sent through notifications. Users who are already members are not shown.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or job title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto border rounded-lg">
              {availableUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {searchQuery ? "No users found matching your search." : "No available users to add."}
                </div>
              ) : (
                <div className="divide-y">
                  {availableUsers.map((user) => {
                    const fullName = `${user.firstName} ${user.lastName}`;
                    const initials = `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || user.email.charAt(0).toUpperCase();
                    const isSelected = selectedUserEmails.has(user.email);
                    
                    return (
                      <div
                        key={user.email}
                        className="flex items-center gap-3 p-4 hover:bg-secondary/50 cursor-pointer transition-colors"
                        onClick={() => toggleUserSelection(user.email)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleUserSelection(user.email)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Avatar>
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{fullName}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            {user.email}
                          </p>
                          {user.jobTitle && (
                            <p className="text-xs text-muted-foreground mt-1">{user.jobTitle}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selection Count */}
            {selectedUserEmails.size > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedUserEmails.size} user{selectedUserEmails.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddMemberDialog(false)}
              disabled={inviteMemberMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInviteMembers}
              disabled={selectedUserEmails.size === 0 || inviteMemberMutation.isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {inviteMemberMutation.isPending ? "Sending..." : `Send ${selectedUserEmails.size > 0 ? `${selectedUserEmails.size} ` : ''}Invitation${selectedUserEmails.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
