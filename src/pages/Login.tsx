import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { trackClick, trackFormSubmit } from '@/lib/analytics';
import { Mail, Loader2 } from 'lucide-react';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/projects', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailNotVerified(false);
    setResendMessage('');
    setLoading(true);
    trackClick('login_submit', '/login');

    try {
      await signIn(email, password);
      trackFormSubmit('login', true);
      navigate('/projects');
    } catch (err: any) {
      trackFormSubmit('login', false);
      // Check if this is an email verification error
      if (err.message?.includes('verify your email')) {
        setEmailNotVerified(true);
        setUnverifiedEmail(email);
      } else {
        setError(err.message || 'Failed to sign in');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    setResendMessage('');

    try {
      const url = import.meta.env.DEV 
        ? `${API_BASE}/api/auth/resend-verification`
        : `${API_BASE}/auth/resend-verification`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unverifiedEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setResendMessage('Verification email sent! Please check your inbox.');
      } else {
        setResendMessage(data.error || 'Failed to send verification email');
      }
    } catch (error: any) {
      setResendMessage(error.message || 'An error occurred');
    } finally {
      setResendLoading(false);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Sign In</CardTitle>
          <CardDescription className="text-center">
            Enter your email to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {emailNotVerified ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-amber-100 p-3">
                  <Mail className="h-8 w-8 text-amber-600" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-lg">Email Not Verified</h3>
                <p className="text-sm text-muted-foreground">
                  Please verify your email address before signing in.
                </p>
                <p className="text-sm text-muted-foreground">
                  Check your inbox for a verification link sent to:
                </p>
                <p className="font-medium">{unverifiedEmail}</p>
              </div>
              {resendMessage && (
                <Alert className={resendMessage.includes('sent') ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}>
                  <AlertDescription className={resendMessage.includes('sent') ? 'text-green-700' : 'text-amber-700'}>
                    {resendMessage}
                  </AlertDescription>
                </Alert>
              )}
              <Button 
                onClick={handleResendVerification} 
                className="w-full" 
                variant="outline"
                disabled={resendLoading}
              >
                {resendLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Resend Verification Email'
                )}
              </Button>
              <Button 
                onClick={() => {
                  setEmailNotVerified(false);
                  setResendMessage('');
                }} 
                className="w-full"
                variant="ghost"
              >
                Try Different Email
              </Button>
            </div>
          ) : (
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
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-center text-muted-foreground">
            Don't have an account?{' '}
            <Link to="/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

