import { useState, useEffect } from 'react';
import { useOrg, Organization, OrgMember } from '@/contexts/OrgContext';
import { trackEvent, trackModal } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { 
  Building2, 
  Plus, 
  Crown, 
  User, 
  Trash2, 
  LogOut, 
  Send,
  AlertCircle,
  Users,
  UserMinus,
  Loader2,
  Mail,
  Copy,
  Check
} from 'lucide-react';

export default function Organizations() {
  const { 
    organizations, 
    currentOrg, 
    switchOrg,
    loading, 
    error,
    createOrg,
    updateOrg,
    deleteOrg,
    leaveOrg,
    inviteToOrg,
    getOrgMembers,
    removeMember,
    refreshOrgs,
  } = useOrg();
  const { toast } = useToast();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgDescription, setNewOrgDescription] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) {
      toast({ title: 'Error', description: 'Organization name is required', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const newOrg = await createOrg(newOrgName.trim(), newOrgDescription.trim() || undefined);
      
      // Track organization creation
      trackEvent('org_created', {
        org_id: newOrg.id,
        org_name: newOrg.name,
        org_type: newOrg.type,
      });
      
      toast({ title: 'Success', description: `Organization "${newOrg.name}" created successfully` });
      setIsCreateDialogOpen(false);
      setNewOrgName('');
      setNewOrgDescription('');
      // Switch to the new org
      await switchOrg(newOrg.id);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInviteUser = async () => {
    if (!selectedOrg) return;
    if (!inviteEmail.trim()) {
      toast({ title: 'Error', description: 'Email is required', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      await inviteToOrg(selectedOrg.id, inviteEmail.trim(), inviteMessage.trim() || undefined);
      
      // Track team invitation
      trackEvent('team_invite_sent', {
        team_id: selectedOrg.id,
        invitee_email: inviteEmail.trim(),
        org_name: selectedOrg.name,
      });
      
      toast({ title: 'Success', description: `Invitation sent to ${inviteEmail}` });
      setIsInviteDialogOpen(false);
      setInviteEmail('');
      setInviteMessage('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleLeaveOrg = async (org: Organization) => {
    if (org.isOwner) {
      toast({ title: 'Error', description: 'Owners cannot leave. Transfer ownership or delete the organization.', variant: 'destructive' });
      return;
    }
    
    try {
      await leaveOrg(org.id);
      
      // Track organization leave
      trackEvent('org_left', {
        org_id: org.id,
        org_name: org.name,
        org_type: org.type,
      });
      
      toast({ title: 'Success', description: `You've left ${org.name}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeleteOrg = async (org: Organization) => {
    if (org.type === 'personal') {
      toast({ title: 'Error', description: 'Cannot delete personal workspace', variant: 'destructive' });
      return;
    }
    
    if (!window.confirm(`Are you sure you want to delete "${org.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      await deleteOrg(org.id);
      toast({ title: 'Success', description: `Organization "${org.name}" has been deleted` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const openInviteDialog = (org: Organization) => {
    setSelectedOrg(org);
    setIsInviteDialogOpen(true);
  };

  const openMembersDialog = async (org: Organization) => {
    setSelectedOrg(org);
    setIsMembersDialogOpen(true);
    setMembersLoading(true);
    setMembers([]);
    
    try {
      const orgMembers = await getOrgMembers(org.id);
      setMembers(orgMembers);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to load members', variant: 'destructive' });
    } finally {
      setMembersLoading(false);
    }
  };

  const handleRemoveMember = async (memberEmail: string) => {
    if (!selectedOrg) return;
    
    const member = members.find(m => m.email === memberEmail);
    if (member?.role === 'owner') {
      toast({ title: 'Error', description: 'Cannot remove the organization owner', variant: 'destructive' });
      return;
    }
    
    if (!window.confirm(`Are you sure you want to remove ${member?.name || memberEmail} from this organization?`)) {
      return;
    }
    
    setRemovingMember(memberEmail);
    try {
      await removeMember(selectedOrg.id, memberEmail);
      setMembers(prev => prev.filter(m => m.email !== memberEmail));
      toast({ title: 'Success', description: `${member?.name || memberEmail} has been removed from the organization` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to remove member', variant: 'destructive' });
    } finally {
      setRemovingMember(null);
    }
  };

  const openInviteFromMembers = () => {
    setIsMembersDialogOpen(false);
    setIsInviteDialogOpen(true);
  };

  const handleCopySlug = async (slug: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click when clicking copy button
    try {
      await navigator.clipboard.writeText(slug);
      setCopiedSlug(slug);
      toast({ title: 'Copied!', description: 'Organization slug copied to clipboard' });
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to copy slug', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // Filter out personal orgs from the main list (they're always shown separately if needed)
  // But for now, show all orgs together without categorization
  const allOrgs = organizations;

  return (
    <div className="container mx-auto py-4 sm:py-6 space-y-4 sm:space-y-6 px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Organizations</h1>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
              <DialogDescription>
                Create a new organization to collaborate with your team.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input
                  id="org-name"
                  placeholder="Acme Corp"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-description">Description (optional)</Label>
                <Textarea
                  id="org-description"
                  placeholder="A brief description of your organization"
                  value={newOrgDescription}
                  onChange={(e) => setNewOrgDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={isSubmitting} className="w-full sm:w-auto">
                {isSubmitting ? 'Creating...' : 'Create Organization'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {allOrgs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No organizations yet</h3>
              <p className="text-muted-foreground mb-4">
                Create an organization to collaborate with your team
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Organization
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {allOrgs.map(org => (
              <Card
                key={org.id}
                className="bg-gradient-card border-border shadow-card cursor-pointer transition-all hover:shadow-lg hover:border-primary/30"
                onClick={() => openMembersDialog(org)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 truncate">
                        {org.name}
                        {currentOrg?.id === org.id && (
                          <Badge variant="secondary" className="text-xs shrink-0">Current</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1">
                        {org.isOwner ? (
                          <>
                            <Crown className="h-3 w-3" />
                            Owner
                          </>
                        ) : (
                          <>
                            <User className="h-3 w-3" />
                            Member
                          </>
                        )}
                        {org.memberCount !== undefined && (
                          <span className="ml-2 flex items-center gap-1 text-xs">
                            <Users className="h-3 w-3" />
                            {org.memberCount}
                          </span>
                        )}
                      </CardDescription>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-muted-foreground font-mono">{org.slug}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => handleCopySlug(org.slug, e)}
                          title="Copy slug"
                        >
                          {copiedSlug === org.slug ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {org.description && (
                  <CardContent className="pt-0 pb-3">
                    <p className="text-sm text-muted-foreground line-clamp-2">{org.description}</p>
                  </CardContent>
                )}
                <CardFooter className="pt-0 flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  {currentOrg?.id !== org.id && (
                    <Button variant="outline" size="sm" onClick={() => switchOrg(org.id)} className="flex-1 sm:flex-initial">
                      Switch
                    </Button>
                  )}
                  {org.isOwner && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => openInviteDialog(org)}>
                        <Send className="h-3 w-3 sm:mr-1" />
                        <span className="sm:inline hidden">Invite</span>
                      </Button>
                      {org.type !== 'personal' && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteOrg(org)}>
                          <Trash2 className="h-3 w-3 sm:mr-0" />
                          <span className="sm:hidden ml-1">Delete</span>
                        </Button>
                      )}
                    </>
                  )}
                  {!org.isOwner && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleLeaveOrg(org)}>
                      <LogOut className="h-3 w-3 mr-1" />
                      Leave
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Invite Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-w-md">
          <DialogHeader>
            <DialogTitle>Invite to {selectedOrg?.name}</DialogTitle>
            <DialogDescription>
              Send an invitation to join your organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-message">Message (optional)</Label>
              <Textarea
                id="invite-message"
                placeholder="Add a personal message to your invitation"
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button onClick={handleInviteUser} disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members Dialog */}
      <Dialog open={isMembersDialogOpen} onOpenChange={setIsMembersDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {selectedOrg?.name} Members
            </DialogTitle>
            <DialogDescription>
              {selectedOrg?.isOwner 
                ? 'View and manage organization members' 
                : 'View organization members'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 min-h-0 py-4 overflow-hidden">
            {membersLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading members...</span>
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No members found</p>
              </div>
            ) : (
              <ScrollArea className="h-full pr-4">
                <div className="space-y-3">
                  {members.map((member) => (
                    <div 
                      key={member.email}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className={`text-sm ${
                            member.role === 'owner' 
                              ? 'bg-primary/15 text-primary' 
                              : 'bg-primary/10'
                          }`}>
                            {member.firstName?.[0]?.toUpperCase() || member.email[0].toUpperCase()}
                            {member.lastName?.[0]?.toUpperCase() || ''}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate text-foreground">
                              {member.name || member.email}
                            </p>
                            {member.role === 'owner' && (
                              <Badge variant="secondary" className="shrink-0 text-xs bg-primary/10 text-primary border-0">
                                <Crown className="h-3 w-3 mr-1" />
                                Owner
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span className="truncate">{member.email}</span>
                          </div>
                          {member.jobTitle && (
                            <p className="text-xs text-muted-foreground mt-0.5">{member.jobTitle}</p>
                          )}
                        </div>
                      </div>
                      
                      {selectedOrg?.isOwner && member.role !== 'owner' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={() => handleRemoveMember(member.email)}
                          disabled={removingMember === member.email}
                        >
                          {removingMember === member.email ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <UserMinus className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          
          <Separator className="flex-shrink-0" />
          
          <DialogFooter className="flex-shrink-0 flex-col sm:flex-row gap-2">
            <div className="flex-1 text-sm text-muted-foreground">
              {members.length} member{members.length !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-2">
              {selectedOrg?.isOwner && (
                <Button variant="outline" onClick={openInviteFromMembers}>
                  <Send className="h-4 w-4 mr-2" />
                  Invite Member
                </Button>
              )}
              <Button variant="secondary" onClick={() => setIsMembersDialogOpen(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

