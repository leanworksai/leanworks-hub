import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trackClick, trackFormSubmit } from '@/lib/analytics';
import { CheckCircle2, Mail, Building2, User } from 'lucide-react';

// Common timezones list
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

interface InvitationPreview {
  invitationId: string;
  orgName: string;
  orgSlug: string;
  inviterName: string;
  inviterEmail: string;
  inviteeEmail: string;
  expiresAt: string;
}

export default function Signup() {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get('invitation');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [timezone, setTimezone] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [invitationPreview, setInvitationPreview] = useState<InvitationPreview | null>(null);
  const [loadingInvitation, setLoadingInvitation] = useState(false);
  const { signUp, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/projects', { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Fetch invitation preview if invitation ID is present
  useEffect(() => {
    if (invitationId && !authLoading && !user) {
      setLoadingInvitation(true);
      const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';
      
      fetch(`${API_BASE}/api/orgs/invitations/${invitationId}/preview`)
        .then(async (res) => {
          if (!res.ok) {
            const error = await res.json().catch(() => ({ error: 'Failed to load invitation' }));
            throw new Error(error.error || 'Invalid or expired invitation');
          }
          return res.json();
        })
        .then((data: InvitationPreview) => {
          setInvitationPreview(data);
          // Pre-fill email if available
          if (data.inviteeEmail) {
            setEmail(data.inviteeEmail);
          }
          // Store invitation ID for auto-accept after signup
          localStorage.setItem('pending_invitation', data.invitationId);
        })
        .catch((err) => {
          console.error('Failed to load invitation:', err);
          setError(err.message || 'Invalid or expired invitation link');
          // Remove invalid invitation from URL
          navigate('/signup', { replace: true });
        })
        .finally(() => {
          setLoadingInvitation(false);
        });
    }
  }, [invitationId, authLoading, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate required fields
    if (!firstName.trim()) {
      setError('First name is required');
      setLoading(false);
      return;
    }

    if (!lastName.trim()) {
      setError('Last name is required');
      setLoading(false);
      return;
    }

    if (!jobTitle.trim()) {
      setError('Job title is required');
      setLoading(false);
      return;
    }

    if (!timezone) {
      setError('Timezone is required');
      setLoading(false);
      return;
    }

    // Validate password
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }

    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      trackClick('signup_submit', '/signup');
      await signUp(email, password, firstName, lastName, jobTitle, timezone, responsibilities);
      trackFormSubmit('signup', true);
      // Show success message instead of redirecting
      setSubmittedEmail(email);
      setSignupSuccess(true);
      // Keep invitation ID in localStorage for auto-accept after email verification
      if (invitationId) {
        localStorage.setItem('pending_invitation', invitationId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show success message after signup
  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-green-100 p-3">
                <Mail className="h-12 w-12 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
            <CardDescription>
              We've sent a verification link to your email
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4 text-center">
              <p className="text-sm text-muted-foreground">Verification email sent to:</p>
              <p className="font-medium text-lg">{submittedEmail}</p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Click the link in your email to verify your account</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span>The verification link expires in 24 hours</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Check your spam folder if you don't see it</span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button onClick={() => navigate('/login')} className="w-full">
              Go to Login
            </Button>
            <div className="text-sm text-center text-muted-foreground">
              Didn't receive the email?{' '}
              <Link to="/verify-email" className="text-primary hover:underline">
                Resend verification
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Create Account</CardTitle>
          <CardDescription className="text-center">
            Sign up with your authorized email to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingInvitation && (
            <Alert className="mb-4">
              <AlertDescription>Loading invitation details...</AlertDescription>
            </Alert>
          )}
          {invitationPreview && (
            <Alert className="mb-4 border-primary/50 bg-primary/5">
              <Building2 className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <User className="h-3 w-3" />
                  <span className="font-medium">{invitationPreview.inviterName}</span>
                </div>
                <span>invited you to join <strong>{invitationPreview.orgName}</strong></span>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="jobTitle">Job Title</Label>
              <Input
                id="jobTitle"
                type="text"
                placeholder="Software Engineer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone} required disabled={loading}>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="responsibilities">Responsibilities (Optional)</Label>
              <Textarea
                id="responsibilities"
                placeholder="Describe your responsibilities..."
                value={responsibilities}
                onChange={(e) => setResponsibilities(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Sign Up'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-center text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

