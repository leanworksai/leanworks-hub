import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react';
import { trackEvent, trackConversion } from '@/lib/analytics';

// API base URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '/api';

type VerificationState = 'loading' | 'success' | 'error' | 'no-token';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  
  const [state, setState] = useState<VerificationState>(token ? 'loading' : 'no-token');
  const [message, setMessage] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  
  // Resend form state
  const [resendEmail, setResendEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    }
  }, [token]);

  const verifyEmail = async (verificationToken: string) => {
    try {
      const url = import.meta.env.DEV 
        ? `${API_BASE}/api/auth/verify-email?token=${verificationToken}`
        : `${API_BASE}/auth/verify-email?token=${verificationToken}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setState('success');
        setMessage(data.message || 'Email verified successfully!');
        setVerifiedEmail(data.email || '');
        
        // Track email verification
        trackEvent('email_verified', {
          email: data.email || '',
          verification_method: 'email_link',
        });
        trackConversion('email_verification_completed');
      } else {
        setState('error');
        setMessage(data.error || 'Failed to verify email');
      }
    } catch (error: any) {
      setState('error');
      setMessage(error.message || 'An error occurred during verification');
    }
  };

  const handleResendVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendLoading(true);
    setResendMessage('');
    setResendError('');

    try {
      const url = import.meta.env.DEV 
        ? `${API_BASE}/api/auth/resend-verification`
        : `${API_BASE}/auth/resend-verification`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setResendMessage(data.message || 'Verification email sent!');
        setResendEmail('');
        
        // Track resend verification
        trackEvent('email_verification_resend', {
          email: resendEmail,
        });
      } else {
        setResendError(data.error || 'Failed to send verification email');
      }
    } catch (error: any) {
      setResendError(error.message || 'An error occurred');
    } finally {
      setResendLoading(false);
    }
  };

  const handleGoToLogin = () => {
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          {state === 'loading' && (
            <>
              <div className="flex justify-center mb-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
              </div>
              <CardTitle className="text-2xl font-bold">Verifying Email</CardTitle>
              <CardDescription>Please wait while we verify your email address...</CardDescription>
            </>
          )}
          
          {state === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-green-100 p-3">
                  <CheckCircle2 className="h-12 w-12 text-green-600" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-green-600">Email Verified!</CardTitle>
              <CardDescription>{message}</CardDescription>
            </>
          )}
          
          {state === 'error' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-red-100 p-3">
                  <XCircle className="h-12 w-12 text-red-600" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold text-red-600">Verification Failed</CardTitle>
              <CardDescription>{message}</CardDescription>
            </>
          )}
          
          {state === 'no-token' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-blue-100 p-3">
                  <Mail className="h-12 w-12 text-blue-600" />
                </div>
              </div>
              <CardTitle className="text-2xl font-bold">Email Verification</CardTitle>
              <CardDescription>
                Enter your email address to receive a new verification link
              </CardDescription>
            </>
          )}
        </CardHeader>
        
        <CardContent>
          {state === 'success' && (
            <div className="space-y-4">
              {verifiedEmail && (
                <p className="text-sm text-center text-muted-foreground">
                  Verified email: <span className="font-medium">{verifiedEmail}</span>
                </p>
              )}
              <Button onClick={handleGoToLogin} className="w-full">
                Continue to Login
              </Button>
            </div>
          )}
          
          {(state === 'error' || state === 'no-token') && (
            <div className="space-y-4">
              <form onSubmit={handleResendVerification} className="space-y-4">
                {resendMessage && (
                  <Alert className="border-green-200 bg-green-50">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-700">{resendMessage}</AlertDescription>
                  </Alert>
                )}
                
                {resendError && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{resendError}</AlertDescription>
                  </Alert>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    required
                    disabled={resendLoading}
                  />
                </div>
                
                <Button type="submit" className="w-full" disabled={resendLoading}>
                  {resendLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Resend Verification Email'
                  )}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
        
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-sm text-center text-muted-foreground">
            {state === 'success' ? (
              <>
                Need help?{' '}
                <a href="mailto:support@leanworks.ai" className="text-primary hover:underline">
                  Contact support
                </a>
              </>
            ) : (
              <>
                Already verified?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </div>
          {(state === 'error' || state === 'no-token') && (
            <div className="text-sm text-center text-muted-foreground">
              Don't have an account?{' '}
              <Link to="/signup" className="text-primary hover:underline">
                Sign up
              </Link>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

