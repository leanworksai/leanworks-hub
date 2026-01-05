import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Lock, Users, UserCheck, Search, Mail, X } from "lucide-react";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
import type { Doc } from "@/data/docsData";

interface ShareDocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: Doc | null;
  currentVisibility: 'private' | 'specific_members' | 'all_members';
  currentVisibleToMembers: string[];
  onSave: (visibility: 'private' | 'specific_members' | 'all_members', visibleToMembers: string[]) => Promise<void>;
}

export function ShareDocDialog({
  open,
  onOpenChange,
  doc,
  currentVisibility,
  currentVisibleToMembers,
  onSave,
}: ShareDocDialogProps) {
  const [visibility, setVisibility] = useState<'private' | 'specific_members' | 'all_members'>(currentVisibility);
  const [visibleToMembers, setVisibleToMembers] = useState<Set<string>>(new Set(currentVisibleToMembers));
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { data: users = [] } = useUsers();
  const userMap = useUserMap();

  // Update state when props change
  useEffect(() => {
    setVisibility(currentVisibility);
    setVisibleToMembers(new Set(currentVisibleToMembers));
  }, [currentVisibility, currentVisibleToMembers, open]);

  // Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!memberSearchQuery.trim()) {
      return users;
    }
    const query = memberSearchQuery.toLowerCase();
    return users.filter((user) => {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase();
      const email = user.email?.toLowerCase() || "";
      const jobTitle = user.jobTitle?.toLowerCase() || "";
      return (
        fullName.includes(query) ||
        email.includes(query) ||
        jobTitle.includes(query)
      );
    });
  }, [users, memberSearchQuery]);

  // Toggle member selection
  const toggleMemberSelection = (email: string) => {
    const newSelected = new Set(visibleToMembers);
    if (newSelected.has(email.toLowerCase())) {
      newSelected.delete(email.toLowerCase());
    } else {
      newSelected.add(email.toLowerCase());
    }
    setVisibleToMembers(newSelected);
  };

  // Check if a member is selected
  const isMemberSelected = (email: string): boolean => {
    return visibleToMembers.has(email.toLowerCase());
  };

  const handleSave = async () => {
    // Validate specific_members visibility
    if (visibility === 'specific_members' && visibleToMembers.size === 0) {
      return; // Don't save if no members selected
    }

    setIsSaving(true);
    try {
      await onSave(visibility, Array.from(visibleToMembers));
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Share Document
            </DialogTitle>
            <DialogDescription>
              {doc ? `Control who can view "${doc.title}"` : "Control who can view this document"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6">
            <div className="space-y-3">
              <Label htmlFor="share-visibility" className="text-base font-semibold">
                Who can view this document?
              </Label>
              <Select
                value={visibility}
                onValueChange={(value: 'private' | 'specific_members' | 'all_members') => {
                  setVisibility(value);
                  if (value !== 'specific_members') {
                    setVisibleToMembers(new Set());
                  }
                }}
              >
                <SelectTrigger id="share-visibility" className="w-full h-11">
                  <div className="flex items-center gap-2 flex-1">
                    {visibility === 'private' && <Lock className="h-4 w-4 text-muted-foreground" />}
                    {visibility === 'specific_members' && <UserCheck className="h-4 w-4 text-muted-foreground" />}
                    {visibility === 'all_members' && <Users className="h-4 w-4 text-muted-foreground" />}
                    <SelectValue>
                      {visibility === 'private' && 'Private'}
                      {visibility === 'specific_members' && 'Specific Members'}
                      {visibility === 'all_members' && 'All Org Members'}
                    </SelectValue>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Lock className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">Private</span>
                        <span className="text-xs text-muted-foreground">Only you can view this document</span>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="specific_members">
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <UserCheck className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">Specific Members</span>
                        <span className="text-xs text-muted-foreground">Choose which members can view</span>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="all_members">
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">All Org Members</span>
                        <span className="text-xs text-muted-foreground">Everyone in your organization can view</span>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {visibility === 'specific_members' && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-base font-semibold">Selected Members</Label>
                      <p className="text-sm text-muted-foreground">
                        {visibleToMembers.size > 0
                          ? `${visibleToMembers.size} member${visibleToMembers.size !== 1 ? 's' : ''} selected`
                          : 'No members selected'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMemberDialogOpen(true)}
                      className="gap-2"
                    >
                      <UserCheck className="h-4 w-4" />
                      {visibleToMembers.size > 0 ? 'Manage Members' : 'Select Members'}
                    </Button>
                  </div>

                  {visibleToMembers.size > 0 && (
                    <div className="flex flex-wrap gap-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                      {Array.from(visibleToMembers).map((email) => {
                        const userEntry = userMap.get(email.toLowerCase());
                        const name = userEntry ? userEntry.displayName : email;
                        const initials = userEntry ? userEntry.initials : email.substring(0, 2).toUpperCase();
                        return (
                          <Badge
                            key={email}
                            variant="secondary"
                            className="flex items-center gap-2 px-3 py-1.5 pr-1.5 h-auto"
                          >
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{name}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newSet = new Set(visibleToMembers);
                                newSet.delete(email);
                                setVisibleToMembers(newSet);
                              }}
                              className="ml-1 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                              aria-label={`Remove ${name}`}
                            >
                              <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {visibility === 'private' && (
              <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg">
                <Lock className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Private Document
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Only you will be able to view and access this document. Other organization members won't see it in their docs list.
                  </p>
                </div>
              </div>
            )}

            {visibility === 'all_members' && (
              <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg">
                <Users className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-green-900 dark:text-green-100">
                    Visible to All Members
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300">
                    All members of your organization can view this document. It will appear in everyone's docs list.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || (visibility === 'specific_members' && visibleToMembers.size === 0)}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member Selection Dialog */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5" />
              Select Members
            </DialogTitle>
            <DialogDescription>
              Choose which organization members can view this document. You can search and select multiple members.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or job title..."
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {visibleToMembers.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg">
                <Badge variant="default" className="gap-1.5">
                  <UserCheck className="h-3 w-3" />
                  {visibleToMembers.size} member{visibleToMembers.size !== 1 ? 's' : ''} selected
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVisibleToMembers(new Set())}
                  className="ml-auto h-7 text-xs"
                >
                  Clear all
                </Button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto border rounded-lg bg-background">
              {filteredUsers.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {memberSearchQuery ? "No members found" : "No members available"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {memberSearchQuery
                          ? "Try adjusting your search terms"
                          : "There are no members in your organization"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredUsers.map((user) => {
                    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
                    const initials = `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || 'U';
                    const isSelected = isMemberSelected(user.email || '');

                    return (
                      <div
                        key={user.email}
                        className={`
                          flex items-center gap-3 p-4 cursor-pointer transition-colors
                          ${isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-secondary/50'}
                        `}
                        onClick={() => toggleMemberSelection(user.email || '')}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleMemberSelection(user.email || '')}
                          onClick={(e) => e.stopPropagation()}
                          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{fullName}</p>
                            {isSelected && (
                              <Badge variant="secondary" className="h-5 text-xs px-1.5">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground flex items-center gap-1.5 truncate mt-0.5">
                            <Mail className="h-3 w-3 flex-shrink-0" />
                            {user.email}
                          </p>
                          {user.jobTitle && (
                            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                              {user.jobTitle}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMemberDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

