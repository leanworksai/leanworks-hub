import { useState } from 'react';
import { useOrg, Organization } from '@/contexts/OrgContext';
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
import { useToast } from '@/hooks/use-toast';
import { 
  Building2, 
  Plus, 
  Crown, 
  User, 
  Trash2, 
  LogOut, 
  Send,
  AlertCircle
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
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgDescription, setNewOrgDescription] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) {
      toast({ title: 'Error', description: 'Organization name is required', variant: 'destructive' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const newOrg = await createOrg(newOrgName.trim(), newOrgDescription.trim() || undefined);
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

  const teamOrgs = organizations.filter(org => org.type === 'team');
  const personalOrg = organizations.find(org => org.type === 'personal');

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent>
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Organization'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {/* Personal Workspace */}
        {personalOrg && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Personal Workspace</h2>
            <Card className="bg-gradient-card border-border shadow-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10">
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {personalOrg.name}
                        {currentOrg?.id === personalOrg.id && (
                          <Badge variant="secondary" className="text-xs">Current</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>Your personal workspace</CardDescription>
                    </div>
                  </div>
                  {currentOrg?.id !== personalOrg.id && (
                    <Button variant="outline" size="sm" onClick={() => switchOrg(personalOrg.id)}>
                      Switch
                    </Button>
                  )}
                </div>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Team Organizations */}
        <div>
          {teamOrgs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No team organizations yet</h3>
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
              {teamOrgs.map(org => (
                <Card key={org.id} className="bg-gradient-card border-border shadow-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10">
                          {org.avatar || org.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
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
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  {org.description && (
                    <CardContent className="pt-0 pb-3">
                      <p className="text-sm text-muted-foreground line-clamp-2">{org.description}</p>
                    </CardContent>
                  )}
                  <CardFooter className="pt-0 flex gap-2">
                    {currentOrg?.id !== org.id && (
                      <Button variant="outline" size="sm" onClick={() => switchOrg(org.id)}>
                        Switch
                      </Button>
                    )}
                    {org.isOwner && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openInviteDialog(org)}>
                          <Send className="h-3 w-3 mr-1" />
                          Invite
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteOrg(org)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
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
      </div>

      {/* Invite Dialog */}
      <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
        <DialogContent>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInviteUser} disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

