import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Bell, Search, X, CheckSquare, User, Settings, LogOut, Check, Clock, Users, Building2, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { toast } from "./ui/sonner";
import { getAvatarColor, cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useEffect, useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { formatDateInTimezone, formatRelativeTime } from "@/lib/dateTimeUtils";
import { useOrg } from "@/contexts/OrgContext";
import { usersService } from "@/services/api";
import { useSelectedProjects } from "@/contexts/SelectedProjectsContext";
import { useSelectedTasks } from "@/contexts/SelectedTasksContext";
import { useSelectedTeams } from "@/contexts/SelectedTeamsContext";
import { useSelectionMode } from "@/contexts/SelectionModeContext";
import { useJoinRequests, useApproveJoinRequest, useRejectJoinRequest, useInvitations, useAcceptInvitation, useDeclineInvitation, useSystemNotifications, useMarkNotificationRead, useDismissNotification } from "@/hooks/useTeams";
import type { TeamJoinRequest, TeamInvitation } from "@/data/teamsData";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { currentOrg, organizations, switchOrg, pendingInvitations: orgInvitations, acceptInvitation: acceptOrgInvitation, declineInvitation: declineOrgInvitation } = useOrg();
  const userTimezone = useUserTimezone();
  const { selectedProjects, clearSelection: clearProjects } = useSelectedProjects();
  const { selectedTasks, clearSelection: clearTasks } = useSelectedTasks();
  const { selectedTeams, clearSelection: clearTeams } = useSelectedTeams();
  const { isSelectionMode, toggleSelectionMode } = useSelectionMode();
  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests();
  const { data: invitations = [], isLoading: isLoadingInvitations } = useInvitations();
  const { data: systemNotifications = [], isLoading: isLoadingSystemNotifications } = useSystemNotifications();
  const markNotificationRead = useMarkNotificationRead();
  const dismissNotification = useDismissNotification();
  const approveRequestMutation = useApproveJoinRequest();
  const rejectRequestMutation = useRejectJoinRequest();
  const acceptInvitationMutation = useAcceptInvitation();
  const declineInvitationMutation = useDeclineInvitation();

  // Filter requests where current user is the owner (can manage)
  const manageableRequests = joinRequests.filter(
    (request: TeamJoinRequest) => 
      request.ownerEmail?.toLowerCase() === user?.email?.toLowerCase() && 
      request.status === 'pending'
  );

  // Filter invitations for the current user
  const userInvitations = invitations.filter(
    (invitation: TeamInvitation) => invitation.status === 'pending'
  );

  // Get total pending notifications count (unified notifications + team invitations + join requests)
  const pendingRequestsCount = manageableRequests.length;
  const pendingInvitationsCount = userInvitations.length;
  // Count org invitations from unified notifications table
  const orgInvitationsFromNotifications = systemNotifications.filter(n => n.type === 'org_invitation' && n.status === 'unread').length;
  // Count legacy org invitations (from org_invitations table) that aren't in notifications yet
  const legacyOrgInvitationsCount = orgInvitations.length;
  const unreadSystemNotificationsCount = systemNotifications.filter(n => n.status === 'unread' && n.type !== 'org_invitation').length;
  // Total: system notifications + org invitations (from notifications) + legacy org invitations + team invitations + join requests
  const totalNotificationsCount = pendingRequestsCount + pendingInvitationsCount + Math.max(orgInvitationsFromNotifications, legacyOrgInvitationsCount) + unreadSystemNotificationsCount;


  useEffect(() => {
    const fetchProfile = async () => {
      if (user) {
        try {
          const profile = await usersService.getProfile();
          setUserProfile(profile);
        } catch (error) {
          console.error('Failed to fetch user profile:', error);
        }
      }
    };
    fetchProfile();
  }, [user]);

  const totalSelections = selectedProjects.length + selectedTasks.length + selectedTeams.length;

  const handleClearAllSelections = () => {
    clearProjects();
    clearTasks();
    clearTeams();
  };

  const handleToggleSelectionMode = () => {
    toggleSelectionMode();
    // If disabling selection mode, clear all selections
    if (isSelectionMode) {
      handleClearAllSelections();
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Failed to logout:', error);
      navigate('/login', { replace: true });
    }
  };

  const getInitials = (firstName?: string, lastName?: string) => {
    if (!firstName && !lastName) return 'U';
    const first = firstName?.charAt(0).toUpperCase() || '';
    const last = lastName?.charAt(0).toUpperCase() || '';
    return first + last || 'U';
  };

  // Helper to get user avatar initials for notifications
  const getUserInitials = (name: string, email: string) => {
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return name[0].toUpperCase();
    }
    return email[0].toUpperCase();
  };

  // Format date for notifications (timezone-aware)
  const formatDate = (date: string | Date) => {
    return formatRelativeTime(date, userTimezone);
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

  // Handle accept invitation
  const handleAcceptInvitation = async (invitationId: string) => {
    try {
      await acceptInvitationMutation.mutateAsync(invitationId);
      toast.success('Invitation accepted! You are now a member of the team.');
      navigate('/teams');
    } catch (error: any) {
      toast.error(error.message || 'Failed to accept invitation');
    }
  };

  // Handle decline invitation
  const handleDeclineInvitation = async (invitationId: string) => {
    try {
      await declineInvitationMutation.mutateAsync(invitationId);
      toast.success('Invitation declined');
    } catch (error: any) {
      toast.error(error.message || 'Failed to decline invitation');
    }
  };

  // Handle accept org invitation
  const handleAcceptOrgInvitation = async (invitationId: string) => {
    try {
      const org = await acceptOrgInvitation(invitationId);
      toast.success(`You've joined ${org.name}`);
      await switchOrg(org.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to accept invitation');
    }
  };

  // Handle decline org invitation
  const handleDeclineOrgInvitation = async (invitationId: string) => {
    try {
      await declineOrgInvitation(invitationId);
      toast.success('Invitation declined');
    } catch (error: any) {
      toast.error(error.message || 'Failed to decline invitation');
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-lg">
            <div className="flex h-16 items-center gap-2 sm:gap-4 px-3 sm:px-6">
              <SidebarTrigger className="-ml-2" />
              
              <div className="flex-1 flex items-center gap-2 sm:gap-4 min-w-0">
                <div className="relative w-full max-w-md hidden sm:block">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search projects, teams..."
                    className="pl-9 bg-secondary/50 border-border"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                <Button
                  variant={isSelectionMode ? "default" : "outline"}
                  size="sm"
                  onClick={handleToggleSelectionMode}
                  className="hidden sm:inline-flex"
                >
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Select
                </Button>
                <Button
                  variant={isSelectionMode ? "default" : "outline"}
                  size="icon"
                  onClick={handleToggleSelectionMode}
                  className="sm:hidden"
                >
                  <CheckSquare className="h-4 w-4" />
                </Button>
                {isSelectionMode && totalSelections > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllSelections}
                    className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive hidden sm:inline-flex"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Clear All ({totalSelections})
                  </Button>
                )}
                {isSelectionMode && totalSelections > 0 && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleClearAllSelections}
                    className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive sm:hidden"
                    title={`Clear All (${totalSelections})`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="h-5 w-5" />
                      {totalNotificationsCount > 0 && (
                        <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
                          {totalNotificationsCount > 9 ? '9+' : totalNotificationsCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[calc(100vw-2rem)] sm:w-80 max-w-sm" align="end" forceMount>
                    <DropdownMenuLabel className="flex items-center justify-between">
                      <span>Notifications</span>
                      {totalNotificationsCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {totalNotificationsCount} pending
                        </Badge>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {isLoadingRequests || isLoadingInvitations || isLoadingSystemNotifications ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        Loading notifications...
                      </div>
                    ) : totalNotificationsCount === 0 ? (
                      <div className="p-6 text-center">
                        <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No pending notifications</p>
                      </div>
                    ) : (
                      <div className="max-h-96 overflow-y-auto">
                        {/* Unified Notifications - sorted by date, deduplicated */}
                        {(() => {
                          // Collect all notifications
                          const allNotifications: any[] = [
                            // System notifications (deployment, etc.)
                            ...systemNotifications
                              .filter(n => n.status !== 'dismissed' && n.type !== 'org_invitation')
                              .map(n => ({ ...n, notificationType: 'system' as const })),
                            // Org invitations from notifications table
                            ...systemNotifications
                              .filter(n => n.status !== 'dismissed' && n.type === 'org_invitation')
                              .map(n => ({ ...n, notificationType: 'org_invitation' as const })),
                            // Legacy org invitations (from org_invitations table - only if not already in notifications)
                            ...orgInvitations
                              .filter(inv => {
                                // Only include if there's no matching notification with same invitation_id
                                const hasMatchingNotification = systemNotifications.some(n => {
                                  if (n.type === 'org_invitation' && n.metadata) {
                                    const metadata = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : n.metadata;
                                    return metadata.invitation_id === inv.id;
                                  }
                                  return false;
                                });
                                return !hasMatchingNotification;
                              })
                              .map(inv => ({ ...inv, notificationType: 'org_invitation_legacy' as const }))
                          ];

                          // Deduplicate by invitation_id for org invitations
                          const seenInvitationIds = new Set<string>();
                          const deduplicated = allNotifications.filter((notif: any) => {
                            if (notif.notificationType === 'org_invitation' && notif.metadata) {
                              const metadata = typeof notif.metadata === 'string' ? JSON.parse(notif.metadata) : notif.metadata;
                              if (metadata.invitation_id) {
                                if (seenInvitationIds.has(metadata.invitation_id)) {
                                  return false;
                                }
                                seenInvitationIds.add(metadata.invitation_id);
                              }
                            } else if (notif.notificationType === 'org_invitation_legacy') {
                              if (seenInvitationIds.has(notif.id)) {
                                return false;
                              }
                              seenInvitationIds.add(notif.id);
                            }
                            return true;
                          });

                          // Sort by date (most recent first)
                          deduplicated.sort((a, b) => {
                            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                            return dateB - dateA;
                          });

                          return deduplicated.map((notification: any) => {
                            // Handle org invitations (from unified notifications table)
                            if (notification.notificationType === 'org_invitation' && notification.metadata) {
                              const metadata = typeof notification.metadata === 'string' 
                                ? JSON.parse(notification.metadata) 
                                : notification.metadata;
                              return (
                                <div
                                  key={notification.id}
                                  className="relative p-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                                >
                                  {notification.status === 'unread' && (
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r" />
                                  )}
                                  <div className="flex items-start gap-3">
                                    <Avatar className="h-9 w-9 flex-shrink-0 border border-border">
                                      <AvatarFallback className={`${getAvatarColor(metadata.inviter_email || metadata.inviter_name)} text-xs`}>
                                        {getUserInitials(metadata.inviter_name, metadata.inviter_email)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-0.5">
                                            <p className="font-medium text-sm truncate">{metadata.inviter_name}</p>
                                            {notification.status === 'unread' && (
                                              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                                            )}
                                          </div>
                                          <p className="text-xs text-muted-foreground truncate">
                                            {metadata.inviter_email}
                                          </p>
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                          onClick={() => dismissNotification.mutate(notification.id)}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Building2 className="h-3 w-3 flex-shrink-0" />
                                        <span className="truncate">
                                          Invited you to join <span className="font-medium text-foreground">{metadata.org_name}</span>
                                        </span>
                                      </div>
                                      {notification.createdAt && (
                                        <p className="text-xs text-muted-foreground">
                                          {formatDate(new Date(notification.createdAt))}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-2 pt-1">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="flex-1 h-8 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50"
                                          onClick={() => {
                                            if (metadata.invitation_id) {
                                              handleDeclineOrgInvitation(metadata.invitation_id);
                                            }
                                            dismissNotification.mutate(notification.id);
                                          }}
                                        >
                                          <X className="mr-1.5 h-3 w-3" />
                                          Decline
                                        </Button>
                                        <Button
                                          size="sm"
                                          className="flex-1 h-8 text-xs bg-primary hover:bg-primary/90"
                                          onClick={() => {
                                            if (metadata.invitation_id) {
                                              handleAcceptOrgInvitation(metadata.invitation_id);
                                            }
                                            if (notification.status === 'unread') {
                                              markNotificationRead.mutate(notification.id);
                                            }
                                          }}
                                        >
                                          <Check className="mr-1.5 h-3 w-3" />
                                          Accept
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Handle legacy org invitations (from org_invitations table)
                            if (notification.notificationType === 'org_invitation_legacy') {
                              return (
                                <div
                                  key={notification.id}
                                  className="relative p-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                                >
                                  <div className="flex items-start gap-3">
                                    <Avatar className="h-9 w-9 flex-shrink-0 border border-border">
                                      <AvatarFallback className={`${getAvatarColor(notification.inviterEmail || notification.inviterName)} text-xs`}>
                                        {getUserInitials(notification.inviterName, notification.inviterEmail)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium text-sm truncate">{notification.inviterName}</p>
                                          <p className="text-xs text-muted-foreground truncate">
                                            {notification.inviterEmail}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Building2 className="h-3 w-3 flex-shrink-0" />
                                        <span className="truncate">
                                          Invited you to join <span className="font-medium text-foreground">{notification.orgName}</span>
                                        </span>
                                      </div>
                                      {notification.createdAt && (
                                        <p className="text-xs text-muted-foreground">
                                          {formatDate(new Date(notification.createdAt))}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-2 pt-1">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="flex-1 h-8 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50"
                                          onClick={() => handleDeclineOrgInvitation(notification.id)}
                                        >
                                          <X className="mr-1.5 h-3 w-3" />
                                          Decline
                                        </Button>
                                        <Button
                                          size="sm"
                                          className="flex-1 h-8 text-xs bg-primary hover:bg-primary/90"
                                          onClick={() => handleAcceptOrgInvitation(notification.id)}
                                        >
                                          <Check className="mr-1.5 h-3 w-3" />
                                          Accept
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            
                            // Handle system notifications (deployment, etc.)
                            return (
                              <div
                                key={notification.id}
                                className="relative p-3 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                              >
                                {notification.status === 'unread' && (
                                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r" />
                                )}
                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                          <p className="font-medium text-sm">
                                            {notification.title}
                                          </p>
                                          {notification.status === 'unread' && (
                                            <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                                          )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                          {notification.message}
                                        </p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => dismissNotification.mutate(notification.id)}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      {notification.createdAt && (
                                        <p className="text-xs text-muted-foreground">
                                          {formatDate(new Date(notification.createdAt))}
                                        </p>
                                      )}
                                      {notification.status === 'unread' && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                          onClick={() => markNotificationRead.mutate(notification.id)}
                                        >
                                          Mark as read
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          });
                        })()}

                        {/* Team Invitations */}
                        {userInvitations.map((invitation: TeamInvitation) => (
                          <div
                            key={invitation.id}
                            className="p-4 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <Avatar className="h-10 w-10 flex-shrink-0">
                                <AvatarFallback className={`${getAvatarColor(invitation.inviterEmail || invitation.inviterName)} text-xs`}>
                                  {getUserInitials(invitation.inviterName, invitation.inviterEmail)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-semibold text-sm truncate">{invitation.inviterName}</p>
                                  <Badge variant="outline" className="text-xs flex-shrink-0">
                                    <Clock className="mr-1 h-3 w-3" />
                                    Org Invitation
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mb-1">
                                  {invitation.inviterEmail}
                                </p>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Building2 className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    Invited you to join <span className="font-medium text-foreground">{invitation.orgName}</span>
                                  </span>
                                </div>
                                {invitation.createdAt && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {formatDate(invitation.createdAt)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeclineOrgInvitation(invitation.id)}
                              >
                                <X className="mr-2 h-3 w-3" />
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 bg-primary hover:bg-primary/90"
                                onClick={() => handleAcceptOrgInvitation(invitation.id)}
                              >
                                <Check className="mr-2 h-3 w-3" />
                                Accept
                              </Button>
                            </div>
                          </div>
                        ))}

                        {/* Team Invitations */}
                        {userInvitations.map((invitation: TeamInvitation) => (
                          <div
                            key={invitation.id}
                            className="p-4 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <Avatar className="h-10 w-10 flex-shrink-0">
                                <AvatarFallback className={`${getAvatarColor(invitation.inviterEmail || invitation.inviterName)} text-xs`}>
                                  {getUserInitials(invitation.inviterName, invitation.inviterEmail)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-semibold text-sm truncate">{invitation.inviterName}</p>
                                  <Badge variant="outline" className="text-xs flex-shrink-0">
                                    <Clock className="mr-1 h-3 w-3" />
                                    Invitation
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mb-1">
                                  {invitation.inviterEmail}
                                </p>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Users className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    Invited you to join <span className="font-medium text-foreground">{invitation.teamName}</span>
                                  </span>
                                </div>
                                {invitation.createdAt && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {formatDate(invitation.createdAt)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeclineInvitation(invitation.id)}
                                disabled={declineInvitationMutation.isPending}
                              >
                                <X className="mr-2 h-3 w-3" />
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 bg-primary hover:bg-primary/90"
                                onClick={() => handleAcceptInvitation(invitation.id)}
                                disabled={acceptInvitationMutation.isPending}
                              >
                                <Check className="mr-2 h-3 w-3" />
                                Accept
                              </Button>
                            </div>
                          </div>
                        ))}
                        
                        {/* Join Requests (for team owners) */}
                        {manageableRequests.map((request: TeamJoinRequest) => (
                          <div
                            key={request.id}
                            className="p-4 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors"
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <Avatar className="h-10 w-10 flex-shrink-0">
                                <AvatarFallback className={`${getAvatarColor(request.userEmail || request.userName)} text-xs`}>
                                  {getUserInitials(request.userName, request.userEmail)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-semibold text-sm truncate">{request.userName}</p>
                                  <Badge variant="outline" className="text-xs flex-shrink-0">
                                    <Clock className="mr-1 h-3 w-3" />
                                    Request
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mb-1">
                                  {request.userEmail}
                                </p>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Users className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    Wants to join <span className="font-medium text-foreground">{request.teamName}</span>
                                  </span>
                                </div>
                                {request.createdAt && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {formatDate(request.createdAt)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleRejectRequest(request.id)}
                                disabled={rejectRequestMutation.isPending}
                              >
                                <X className="mr-2 h-3 w-3" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 bg-primary hover:bg-primary/90"
                                onClick={() => handleApproveRequest(request.id)}
                                disabled={approveRequestMutation.isPending}
                              >
                                <Check className="mr-2 h-3 w-3" />
                                Approve
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                      <Avatar>
                        <AvatarFallback className={getAvatarColor(userProfile?.email || `${userProfile?.firstName}${userProfile?.lastName}`)}>
                          {getInitials(userProfile?.firstName, userProfile?.lastName)}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {userProfile?.firstName && userProfile?.lastName
                            ? `${userProfile.firstName} ${userProfile.lastName}`
                            : user?.email}
                        </p>
                        {userProfile?.firstName && userProfile?.lastName && (
                          <p className="text-xs text-muted-foreground">{user?.email}</p>
                        )}
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/profile')}>
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </DropdownMenuItem>
                    {/* Subscription menu item hidden - everyone is on standard tier */}
                    {/* <DropdownMenuItem onClick={() => navigate('/subscription')}>
                      <CreditCard className="mr-2 h-4 w-4" />
                      <span>Subscription</span>
                    </DropdownMenuItem> */}
                    <DropdownMenuItem onClick={() => navigate('/settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Logout</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
