import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usersService } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAvatarColor } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Common timezones list (shared with Signup)
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'America/Toronto', label: 'Eastern Time - Toronto' },
  { value: 'America/Vancouver', label: 'Pacific Time - Vancouver' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
  { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
  { value: 'Europe/Zurich', label: 'Zurich (CET/CEST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Asia/Mumbai', label: 'Mumbai (IST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZDT/NZST)' },
];

interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  timezone?: string;
  responsibilities?: string;
  domain: string;
  createdAt: string;
}

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const userTimezone = useUserTimezone();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    jobTitle: '',
    timezone: '',
    responsibilities: '',
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        setError(null);
        const profileData = await usersService.getProfile();
        setProfile(profileData);
        setFormData({
          jobTitle: profileData.jobTitle || '',
          timezone: profileData.timezone || '',
          responsibilities: profileData.responsibilities || '',
        });
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

  const handleSave = async () => {
    if (!profile) return;

    try {
      setSaving(true);
      setError(null);

      if (!formData.jobTitle.trim()) {
        setError('Job title is required');
        setSaving(false);
        return;
      }

      if (!formData.timezone) {
        setError('Timezone is required');
        setSaving(false);
        return;
      }

      await usersService.updateProfile({
        jobTitle: formData.jobTitle.trim(),
        timezone: formData.timezone,
        responsibilities: formData.responsibilities.trim() || undefined,
      });

      // Update local profile state
      setProfile({
        ...profile,
        jobTitle: formData.jobTitle.trim(),
        timezone: formData.timezone,
        responsibilities: formData.responsibilities.trim() || undefined,
      });

      setIsEditing(false);
      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      });
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setError(err.message || 'Failed to update profile');
      toast({
        title: 'Error',
        description: err.message || 'Failed to update profile',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setFormData({
        jobTitle: profile.jobTitle || '',
        timezone: profile.timezone || '',
        responsibilities: profile.responsibilities || '',
      });
    }
    setIsEditing(false);
    setError(null);
  };

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
          <div className="flex items-center justify-between">
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
                  {isEditing ? formData.jobTitle : profile?.jobTitle}
                </CardDescription>
              </div>
            </div>
            {!isEditing && (
              <Button onClick={() => setIsEditing(true)} variant="outline">
                Edit Profile
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
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
              <Label htmlFor="jobTitle" className="text-sm font-medium text-muted-foreground">Job Title</Label>
              {isEditing ? (
                <Input
                  id="jobTitle"
                  value={formData.jobTitle}
                  onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                  placeholder="Software Engineer"
                  disabled={saving}
                />
              ) : (
                <div className="text-base font-medium">{profile?.jobTitle || 'N/A'}</div>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Member Since</Label>
              <div className="text-base font-medium">{formatDate(profile?.createdAt)}</div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone" className="text-sm font-medium text-muted-foreground">Timezone</Label>
            {isEditing ? (
              <Select
                value={formData.timezone}
                onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                disabled={saving}
              >
                <SelectTrigger id="timezone">
                  <SelectValue placeholder="Select your timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-base font-medium">
                {profile?.timezone
                  ? TIMEZONES.find((tz) => tz.value === profile.timezone)?.label || profile.timezone
                  : 'N/A'}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="responsibilities" className="text-sm font-medium text-muted-foreground">
              Responsibilities {!isEditing && !profile?.responsibilities && '(Optional)'}
            </Label>
            {isEditing ? (
              <Textarea
                id="responsibilities"
                value={formData.responsibilities}
                onChange={(e) => setFormData({ ...formData, responsibilities: e.target.value })}
                placeholder="Describe your responsibilities..."
                disabled={saving}
                rows={3}
              />
            ) : (
              <div className="text-base text-muted-foreground whitespace-pre-wrap">
                {profile?.responsibilities || 'N/A'}
              </div>
            )}
          </div>
          {isEditing && (
            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button onClick={handleCancel} variant="outline" disabled={saving}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

