import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usersService } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getAvatarColor } from '@/lib/utils';

interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  responsibilities?: string;
  domain: string;
  createdAt: string;
}

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        setError(null);
        const profileData = await usersService.getProfile();
        setProfile(profileData);
      } catch (err: any) {
        console.error('Failed to fetch profile:', err);
        setError(err.message || 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchProfile();
    }
  }, [user]);

  const getInitials = (firstName?: string, lastName?: string) => {
    if (!firstName && !lastName) return 'U';
    const first = firstName?.charAt(0).toUpperCase() || '';
    const last = lastName?.charAt(0).toUpperCase() || '';
    return first + last || 'U';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">
            View your profile information
          </p>
        </div>
        <Card className="bg-gradient-card border-border shadow-card">
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">
            View your profile information
          </p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          View your profile information
        </p>
      </div>

      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className={`${getAvatarColor(profile?.email || `${profile?.firstName}${profile?.lastName}`)} text-xl`}>
                {getInitials(profile?.firstName, profile?.lastName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-2xl">
                {profile?.firstName} {profile?.lastName}
              </CardTitle>
              <CardDescription className="text-base mt-1">
                {profile?.jobTitle}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Email</Label>
              <div className="text-base font-medium">{profile?.email || 'N/A'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Domain</Label>
              <div className="text-base font-medium">{profile?.domain || 'N/A'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">First Name</Label>
              <div className="text-base font-medium">{profile?.firstName || 'N/A'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Last Name</Label>
              <div className="text-base font-medium">{profile?.lastName || 'N/A'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Job Title</Label>
              <div className="text-base font-medium">{profile?.jobTitle || 'N/A'}</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Member Since</Label>
              <div className="text-base font-medium">{formatDate(profile?.createdAt)}</div>
            </div>
          </div>
          {profile?.responsibilities && (
            <div className="space-y-2 pt-4 border-t">
              <Label className="text-sm font-medium text-muted-foreground">Responsibilities</Label>
              <div className="text-base text-muted-foreground whitespace-pre-wrap">
                {profile.responsibilities}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

