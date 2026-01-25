import { useState, useMemo, useEffect, useCallback, memo } from "react";
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
import { Users, UserCheck, Search, Mail, X, Globe, Shield, CheckCircle2, Loader2, CheckCircle } from "lucide-react";
import { useUsers } from "@/hooks/useUsers";
import { useUserMap } from "@/hooks/useUserMap";
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

function LimitVisibilityDialogComponent({
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
  const { data: users = [], isLoading: usersLoading } = useUsers();
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
  const toggleMemberSelection = useCallback((email: string) => {
    const newSelected = new Set(visibleToMembers);
    if (newSelected.has(email.toLowerCase())) {
      newSelected.delete(email.toLowerCase());
    } else {
      newSelected.add(email.toLowerCase());
    }
    setVisibleToMembers(newSelected);
  }, [visibleToMembers]);

  // Check if a member is selected
  const isMemberSelected = useCallback((email: string): boolean => {
    return visibleToMembers.has(email.toLowerCase());
  }, [visibleToMembers]);

  // Select all filtered members
  const selectAllFiltered = useCallback(() => {
    const newSelected = new Set(visibleToMembers);
    filteredUsers.forEach(user => {
      if (user.email) {
        newSelected.add(user.email.toLowerCase());
      }
    });
    setVisibleToMembers(newSelected);
  }, [filteredUsers, visibleToMembers]);

  // Deselect all filtered members
  const deselectAllFiltered = useCallback(() => {
    const newSelected = new Set(visibleToMembers);
    filteredUsers.forEach(user => {
      if (user.email) {
        newSelected.delete(user.email.toLowerCase());
      }
    });
    setVisibleToMembers(newSelected);
  }, [filteredUsers, visibleToMembers]);

  // Check if all filtered members are selected
  const allFilteredSelected = useMemo(() => {
    if (filteredUsers.length === 0) return false;
    return filteredUsers.every(user => 
      user.email && visibleToMembers.has(user.email.toLowerCase())
    );
  }, [filteredUsers, visibleToMembers]);

  // Clear search
  const clearSearch = useCallback(() => {
    setMemberSearchQuery("");
  }, []);

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
        const userEntry = userMap.get(email.toLowerCase());
        return {
          email,
          name: userEntry ? userEntry.displayName || email : email,
          initials: userEntry ? userEntry.initials : email.substring(0, 2).toUpperCase(),
          jobTitle: userEntry?.jobTitle,
        };
      });
  }, [visibleToMembers, userMap]);

  return (
    <>
      <Dialog open={open} onOpenChange={(open) => {
        trackModal('limit_visibility', open ? 'open' : 'close');
        onOpenChange(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {title}
            </DialogTitle>
            {itemName && (
              <DialogDescription>
                Control who can view "{itemName}"
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Visibility Options */}
            <div className="space-y-3">
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
                    "relative flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    visibility === 'all_members'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                  onClick={() => setVisibility('all_members')}
                >
                  <RadioGroupItem
                    value="all_members"
                    id="all_members"
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Globe className={cn(
                        "h-4 w-4",
                        visibility === 'all_members' ? "text-primary" : "text-muted-foreground"
                      )} />
                      <Label
                        htmlFor="all_members"
                        className="text-sm font-medium cursor-pointer"
                      >
                        All Members
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-6">
                      Visible to all {users.length} member{users.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Limited to Specific Members Option */}
                <div
                  className={cn(
                    "relative flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    visibility === 'specific_members'
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                  onClick={() => setVisibility('specific_members')}
                >
                  <RadioGroupItem
                    value="specific_members"
                    id="specific_members"
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <UserCheck className={cn(
                        "h-4 w-4",
                        visibility === 'specific_members' ? "text-primary" : "text-muted-foreground"
                      )} />
                      <Label
                        htmlFor="specific_members"
                        className="text-sm font-medium cursor-pointer"
                      >
                        Specific Members
                      </Label>
                    </div>
                    {visibility === 'specific_members' && (
                      <div className="ml-6 mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {visibleToMembers.size} member{visibleToMembers.size !== 1 ? 's' : ''} selected
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMemberDialogOpen(true);
                            }}
                            className="h-7 text-xs"
                          >
                            {visibleToMembers.size > 0 ? 'Change' : 'Select'}
                          </Button>
                        </div>
                        {visibleToMembers.size > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {selectedMembersInfo.slice(0, 5).map((member) => (
                              <Badge
                                key={member.email}
                                variant="secondary"
                                className="flex items-center gap-1.5 px-2 py-0.5 h-auto text-xs"
                              >
                                <Avatar className="h-4 w-4">
                                  <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                                    {member.initials}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="truncate max-w-[80px]">{member.name}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newSet = new Set(visibleToMembers);
                                    newSet.delete(member.email);
                                    setVisibleToMembers(newSet);
                                  }}
                                  className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5"
                                  aria-label={`Remove ${member.name}`}
                                >
                                  <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                </button>
                              </Badge>
                            ))}
                            {visibleToMembers.size > 5 && (
                              <Badge variant="outline" className="px-2 py-0.5 text-xs">
                                +{visibleToMembers.size - 5}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </RadioGroup>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)} 
              disabled={isSaving}
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || (visibility === 'specific_members' && visibleToMembers.size === 0)}
              size="sm"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Member Selection Dialog */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Select Members
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={memberSearchQuery}
                onChange={(e) => setMemberSearchQuery(e.target.value)}
                className="pl-8 pr-8 h-9 text-sm"
              />
              {memberSearchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 rounded hover:bg-muted p-1"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {visibleToMembers.size} selected
              </span>
              <div className="flex items-center gap-1.5">
                {filteredUsers.length > 0 && (
                  <>
                    {!allFilteredSelected ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={selectAllFiltered}
                        className="h-7 text-xs px-2"
                      >
                        Select all
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={deselectAllFiltered}
                        className="h-7 text-xs px-2"
                      >
                        Deselect all
                      </Button>
                    )}
                  </>
                )}
                {visibleToMembers.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleToMembers(new Set())}
                    className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto border rounded-md">
              {usersLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {memberSearchQuery ? "No members found" : "No members available"}
                  </p>
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
                          "flex items-center gap-3 p-2.5 cursor-pointer transition-colors",
                          isSelected
                            ? "bg-primary/5"
                            : "hover:bg-secondary/50"
                        )}
                        onClick={() => toggleMemberSelection(user.email || '')}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleMemberSelection(user.email || '')}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4"
                        />
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={cn(
                            "text-xs",
                            isSelected 
                              ? "bg-primary text-primary-foreground" 
                              : "bg-muted"
                          )}>
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{fullName}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setMemberDialogOpen(false)}
              size="sm"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => setMemberDialogOpen(false)}
              size="sm"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const LimitVisibilityDialog = memo(LimitVisibilityDialogComponent);
