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
import { cn } from '@/lib/utils';
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
  Check,
  Building
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
    <div className="container mx-auto py-4 sm:py-8 space-y-6 sm:space-y-8 px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/50 pb-6 sm:pb-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Organizations</h1>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-200">
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
                  className="focus-visible:ring-primary"
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
                  className="focus-visible:ring-primary resize-none"
                />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={isSubmitting} className="w-full sm:w-auto">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : 'Create Organization'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {allOrgs.length === 0 ? (
          <Card className="border-dashed border-2 bg-muted/20">
            <CardContent className="py-16 sm:py-24 text-center">
              <div className="bg-primary/5 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ring-8 ring-primary/5">
                <Building2 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No organizations yet</h3>
              <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
                Organizations help you group projects and collaborate with specific team members.
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)} variant="default" size="lg" className="shadow-md hover:shadow-lg transition-all">
                <Plus className="mr-2 h-5 w-5" />
                Create your first organization
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3">
            {allOrgs.map(org => (
              <Card
                key={org.id}
                className={cn(
                  "group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-primary/40 flex flex-col border-border/60 bg-card/50 hover:bg-card",
                  currentOrg?.id === org.id 
                    ? "ring-2 ring-primary/20 border-primary/40 bg-gradient-to-br from-primary/[0.03] to-transparent" 
                    : "hover:-translate-y-1"
                )}
                onClick={() => openMembersDialog(org)}
              >
                {/* Active Indicator Strip */}
                {currentOrg?.id === org.id && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary to-primary/60" />
                )}

                <CardHeader className="pb-4 space-y-4 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-10 w-10 rounded-lg flex items-center justify-center border shadow-sm",
                          currentOrg?.id === org.id 
                            ? "bg-primary/10 border-primary/20 text-primary" 
                            : "bg-muted border-border text-muted-foreground group-hover:text-foreground group-hover:border-foreground/20 transition-colors"
                        )}>
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-lg font-bold truncate leading-tight group-hover:text-primary transition-colors duration-300">
                            {org.name}
                          </CardTitle>
                          {org.type === 'personal' && (
                            <p className="text-xs text-muted-foreground mt-0.5">Personal Workspace</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 pl-1">
                        <code className="text-[10px] px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded text-muted-foreground font-mono truncate max-w-[150px]">
                          {org.slug}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary"
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
                    
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {currentOrg?.id === org.id && (
                          <Badge 
                            className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20 px-2 py-0.5 h-5 text-[10px] font-bold uppercase tracking-wider shadow-none flex items-center shrink-0"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                            Active
                          </Badge>
                        )}
                      </div>
                      <Badge 
                        variant={org.isOwner ? "default" : "secondary"} 
                        className={cn(
                          "px-2 py-0.5 h-5 text-[10px] font-medium uppercase tracking-wider flex items-center shrink-0 shadow-none border",
                          org.isOwner 
                            ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20" 
                            : "bg-muted text-muted-foreground border-transparent"
                        )}
                      >
                        {org.isOwner ? (
                          <><Crown className="h-3 w-3 mr-1" /> Owner</>
                        ) : (
                          <><User className="h-3 w-3 mr-1" /> Member</>
                        )}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 pb-4">
                  {org.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                      {org.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground/40 italic font-light">
                      No description provided
                    </p>
                  )}
                  
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      <span className="font-medium">{org.memberCount || 1}</span> {org.memberCount === 1 ? 'member' : 'members'}
                    </div>
                    <div className="w-1 h-1 rounded-full bg-border" />
                    <div className="flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5" />
                      <span className="capitalize">{org.type}</span>
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="pt-3 pb-3 px-4 border-t border-border/40 flex gap-2 flex-wrap bg-muted/30 group-hover:bg-muted/50 transition-colors mt-auto" onClick={(e) => e.stopPropagation()}>
                  {currentOrg?.id !== org.id ? (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => switchOrg(org.id)} 
                      className="flex-1 h-8 text-xs bg-background hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-200 shadow-sm"
                    >
                      Switch Organization
                    </Button>
                  ) : (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      disabled
                      className="flex-1 h-8 text-xs bg-primary/5 text-primary cursor-default opacity-100 font-medium"
                    >
                      Currently Active
                    </Button>
                  )}
                  
                  <div className="flex items-center gap-1 border-l border-border/50 pl-2 ml-1">
                    {org.isOwner && (
                      <>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => openInviteDialog(org)}
                          className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
                          title="Invite Members"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                        {org.type !== 'personal' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" 
                            onClick={() => handleDeleteOrg(org)}
                            title="Delete Organization"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                    {!org.isOwner && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" 
                        onClick={() => handleLeaveOrg(org)}
                        title="Leave Organization"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
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

