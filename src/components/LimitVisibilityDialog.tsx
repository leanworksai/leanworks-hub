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
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Users, UserCheck, Search, Mail, X, EyeOff, Globe, Shield, CheckCircle2 } from "lucide-react";
import { useUsers } from "@/hooks/useUsers";
import { cn } from "@/lib/utils";
import { trackModal } from "@/lib/analytics";

interface LimitVisibilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemName?: string;
  currentVisibility: 'all_members' | 'specific_members';
  currentVisibleToMembers: string[];
  onSave: (visibility: 'all_members' | 'specific_members', visibleToMembers: string[]) => Promise<void>;
}

export function LimitVisibilityDialog({
  open,
  onOpenChange,
  title,
  itemName,
  currentVisibility,
  currentVisibleToMembers,
  onSave,
}: LimitVisibilityDialogProps) {
  const [visibility, setVisibility] = useState<'all_members' | 'specific_members'>(currentVisibility);
  const [visibleToMembers, setVisibleToMembers] = useState<Set<string>>(new Set(currentVisibleToMembers));
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { data: users = [] } = useUsers();

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

  // Get selected members info for preview
  const selectedMembersInfo = useMemo(() => {
    return Array.from(visibleToMembers)
      .map(email => {
        const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
        return {
          email,
          name: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : email,
          initials: user
            ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || email.substring(0, 2).toUpperCase()
            : email.substring(0, 2).toUpperCase(),
        };
      })
      .slice(0, 5); // Show first 5 for preview
  }, [visibleToMembers, users]);

  return (
    <>
      <Dialog open={open} onOpenChange={(open) => {
        trackModal('limit_visibility', open ? 'open' : 'close');
        onOpenChange(open);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Shield className="h-5 w-5 text-primary" />
              Limit Visibility
            </DialogTitle>
            <DialogDescription className="text-base">
              {itemName ? `Control who can view "${itemName}"` : "Control who can view this item"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 py-2">
            {/* Visibility Options */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Who can view this item?</Label>
              <RadioGroup
                value={visibility}
                onValueChange={(value: 'all_members' | 'specific_members') => {
                  setVisibility(value);
                  if (value !== 'specific_members') {
                    setVisibleToMembers(new Set());
                  }
                }}
                className="space-y-3"
              >
                {/* All Members Option */}
                <div
                  className={cn(
                    "relative flex items-start space-x-3 rounded-lg border-2 p-4 cursor-pointer transition-all",
                    visibility === 'all_members'
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                  onClick={() => setVisibility('all_members')}
                >
                  <RadioGroupItem
                    value="all_members"
                    id="all_members"
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                        visibility === 'all_members'
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <Globe className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <Label
                          htmlFor="all_members"
                          className="text-base font-semibold cursor-pointer"
                        >
                          All Organization Members
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Everyone in your organization can view this item
                        </p>
                      </div>
                      {visibility === 'all_members' && (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="ml-[52px] flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>Default setting - visible to all {users.length} members</span>
                    </div>
                  </div>
                </div>

                {/* Limited to Specific Members Option */}
                <div
                  className={cn(
                    "relative flex items-start space-x-3 rounded-lg border-2 p-4 cursor-pointer transition-all",
                    visibility === 'specific_members'
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                  onClick={() => setVisibility('specific_members')}
                >
                  <RadioGroupItem
                    value="specific_members"
                    id="specific_members"
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                        visibility === 'specific_members'
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <UserCheck className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <Label
                          htmlFor="specific_members"
                          className="text-base font-semibold cursor-pointer"
                        >
                          Limited to Specific Members
                        </Label>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Only selected members can view this item
                        </p>
                      </div>
                      {visibility === 'specific_members' && (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    {visibility === 'specific_members' && (
                      <div className="ml-[52px] space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="gap-1.5">
                              <UserCheck className="h-3 w-3" />
                              {visibleToMembers.size} member{visibleToMembers.size !== 1 ? 's' : ''} selected
                            </Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMemberDialogOpen(true);
                            }}
                            className="gap-2"
                          >
                            <UserCheck className="h-4 w-4" />
                            {visibleToMembers.size > 0 ? 'Change Members' : 'Select Members'}
                          </Button>
                        </div>
                        
                        {visibleToMembers.size > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Selected members:</p>
                            <div className="flex flex-wrap gap-2">
                              {selectedMembersInfo.map((member) => (
                                <Badge
                                  key={member.email}
                                  variant="secondary"
                                  className="flex items-center gap-2 px-2.5 py-1.5 h-auto"
                                >
                                  <Avatar className="h-5 w-5">
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                                      {member.initials}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm font-medium">{member.name}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newSet = new Set(visibleToMembers);
                                      newSet.delete(member.email);
                                      setVisibleToMembers(newSet);
                                    }}
                                    className="ml-1 rounded-full hover:bg-destructive/20 p-0.5 transition-colors"
                                    aria-label={`Remove ${member.name}`}
                                  >
                                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                  </button>
                                </Badge>
                              ))}
                              {visibleToMembers.size > 5 && (
                                <Badge variant="outline" className="px-2.5 py-1.5">
                                  +{visibleToMembers.size - 5} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg">
                            <EyeOff className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <p className="text-xs text-amber-800 dark:text-amber-200">
                              No members selected. Please select at least one member to limit visibility.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Info Box */}
            <div className={cn(
              "flex items-start gap-3 p-4 rounded-lg border",
              visibility === 'all_members'
                ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900"
                : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900"
            )}>
              {visibility === 'all_members' ? (
                <>
                  <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Public to Organization
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      All {users.length} members of your organization can view this item. This is the default and recommended setting for collaboration.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                      Limited Visibility
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Only the {visibleToMembers.size} selected member{visibleToMembers.size !== 1 ? 's' : ''} can view this item. Other organization members won't see it.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || (visibility === 'specific_members' && visibleToMembers.size === 0)}
              className="min-w-[120px]"
            >
              {isSaving ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
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
              Choose which organization members can view this item. You can search and select multiple members.
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
                        className={cn(
                          "flex items-center gap-3 p-4 cursor-pointer transition-colors",
                          isSelected
                            ? "bg-primary/5 border-l-2 border-l-primary"
                            : "hover:bg-secondary/50"
                        )}
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
