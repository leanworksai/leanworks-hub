import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, X, Users, Clock } from "lucide-react";
import { useJoinRequests, useApproveJoinRequest, useRejectJoinRequest } from "@/hooks/useTeams";
import type { TeamJoinRequest } from "@/data/teamsData";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function Notifications() {
  const { user } = useAuth();
  const { data: joinRequests = [], isLoading: isLoadingRequests } = useJoinRequests();
  const approveRequestMutation = useApproveJoinRequest();
  const rejectRequestMutation = useRejectJoinRequest();

  // Filter requests where current user is the owner (can manage)
  const manageableRequests = joinRequests.filter(
    (request: TeamJoinRequest) => 
      request.ownerEmail?.toLowerCase() === user?.email?.toLowerCase() && 
      request.status === 'pending'
  );

  // Get pending requests count
  const pendingRequestsCount = manageableRequests.length;

  // Helper to get user avatar initials
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

  // Format date
  const formatDate = (date: string | Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return d.toLocaleDateString();
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

  if (isLoadingRequests) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Manage team join requests and other notifications
          </p>
        </div>
        {pendingRequestsCount > 0 && (
          <Badge variant="secondary" className="text-sm px-3 py-1">
            <Bell className="mr-2 h-4 w-4" />
            {pendingRequestsCount} pending
          </Badge>
        )}
      </div>

      <div className="space-y-4">
        {manageableRequests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Bell className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No pending requests</h3>
              <p className="text-sm text-muted-foreground text-center max-w-md">
                You don't have any pending team join requests to review at this time.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {manageableRequests.map((request: TeamJoinRequest) => (
              <Card 
                key={request.id} 
                className="bg-gradient-card border-border shadow-card hover:shadow-lg transition-all"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          {getUserInitials(request.userName, request.userEmail)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-base">{request.userName}</p>
                          <Badge variant="outline" className="text-xs">
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {request.userEmail}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>
                            Wants to join <span className="font-medium text-foreground">{request.teamName}</span>
                          </span>
                        </div>
                        {request.createdAt && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatDate(request.createdAt)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectRequest(request.id)}
                        disabled={rejectRequestMutation.isPending}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/90"
                        onClick={() => handleApproveRequest(request.id)}
                        disabled={approveRequestMutation.isPending}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

