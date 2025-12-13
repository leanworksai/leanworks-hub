import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Check, Sparkles, Zap, Crown, MessageSquare, AtSign, BarChart3, FileEdit, Loader2, ExternalLink } from 'lucide-react';
import { subscriptionService, type SubscriptionStatus } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const PLANS = [
  {
    id: 'free' as const,
    name: 'Free Tier',
    price: '$0',
    priceSubtext: 'forever',
    description: 'Get started with essential features',
    features: [
      'Max 10 members in org',
      'Project management',
      'Messaging',
      'Docs',
      'Voice chat (30 mins limit)',
    ],
    aiFeatures: false,
    icon: Sparkles,
    highlight: false,
  },
  {
    id: 'standard' as const,
    name: 'Standard',
    price: '$9.89',
    priceSubtext: 'per user/month',
    description: 'For growing teams',
    features: [
      'Unlimited users',
      'Project management',
      'Messaging',
      'Docs',
      'Voice chat',
      'LeanWorks AI (20 times/day)',
    ],
    aiFeatures: true,
    icon: Zap,
    highlight: true,
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$19.89',
    priceSubtext: 'per user/month',
    description: 'For power users & teams',
    features: [
      'Unlimited users',
      'Project management',
      'Messaging',
      'Docs',
      'Voice chat',
      'LeanWorks AI (Unlimited)',
    ],
    aiFeatures: true,
    icon: Crown,
    highlight: false,
  },
];

const AI_FEATURES = [
  { icon: MessageSquare, text: 'Chat with Lean AI assistant' },
  { icon: AtSign, text: '@mention Lean in channels' },
  { icon: BarChart3, text: 'View project/task progress insights' },
  { icon: FileEdit, text: 'Use AI to draft task details' },
];

export default function Subscription() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [switchLoading, setSwitchLoading] = useState<string | null>(null);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    // Handle success/cancel from Stripe redirect
    if (searchParams.get('success') === 'true') {
      toast({
        title: 'Payment successful!',
        description: 'Your subscription has been activated. Welcome to the team!',
      });
      // Reload status to show new plan
      loadStatus();
    } else if (searchParams.get('canceled') === 'true') {
      toast({
        title: 'Payment canceled',
        description: 'Your subscription was not changed.',
        variant: 'destructive',
      });
    }
  }, [searchParams, toast]);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await subscriptionService.getStatus();
      setStatus(data);
    } catch (err: any) {
      console.error('Failed to load subscription status:', err);
      setError(err.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (plan: 'standard' | 'pro') => {
    try {
      setCheckoutLoading(plan);
      const { url } = await subscriptionService.createCheckoutSession(plan);
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      console.error('Failed to create checkout session:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to start checkout',
        variant: 'destructive',
      });
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      setPortalLoading(true);
      const { url } = await subscriptionService.createPortalSession();
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      console.error('Failed to create portal session:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to open subscription portal',
        variant: 'destructive',
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleSwitchPlan = async (plan: 'standard' | 'pro') => {
    try {
      setSwitchLoading(plan);
      await subscriptionService.switchPlan(plan);
      toast({
        title: 'Plan switched!',
        description: `You are now on the ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan.`,
      });
      // Reload status to show new plan
      loadStatus();
    } catch (err: any) {
      console.error('Failed to switch plan:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to switch plan',
        variant: 'destructive',
      });
    } finally {
      setSwitchLoading(null);
    }
  };

  const handleDowngradeToFree = async () => {
    try {
      setDowngradeLoading(true);
      const result = await subscriptionService.downgradeToFree();
      toast({
        title: 'Downgraded to Free',
        description: result.message || 'You are now on the free plan.',
      });
      // Reload status to show new plan
      loadStatus();
    } catch (err: any) {
      console.error('Failed to downgrade to free:', err);
      toast({
        title: 'Error',
        description: err.message || 'Failed to downgrade to free plan',
        variant: 'destructive',
      });
    } finally {
      setDowngradeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
          <p className="text-muted-foreground">Manage your subscription and billing</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-gradient-card border-border shadow-card">
              <CardHeader>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-8 w-20 mt-2" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full mt-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
          <p className="text-muted-foreground">Manage your subscription and billing</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={loadStatus}>Try Again</Button>
      </div>
    );
  }

  const currentPlan = status?.plan || 'free';

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
          <p className="text-muted-foreground">Manage your subscription and billing</p>
        </div>
        {status?.stripeSubscriptionId && (
          <Button 
            variant="outline" 
            onClick={handleManageSubscription}
            disabled={portalLoading}
          >
            {portalLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                Manage Billing
              </>
            )}
          </Button>
        )}
      </div>

      {/* Current Plan Status */}
      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Current Plan
                <Badge variant={currentPlan === 'pro' ? 'default' : currentPlan === 'standard' ? 'secondary' : 'outline'}>
                  {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                {status?.isTrialActive && (
                  <span className="text-amber-500 font-medium">
                    Trial: {status.trialDaysRemaining} day{status.trialDaysRemaining !== 1 ? 's' : ''} remaining
                  </span>
                )}
                {status?.stripeSubscriptionId && (
                  <span className="text-muted-foreground text-xs ml-2">
                    Active subscription
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">LeanWorks AI Usage Today</span>
                <span className="font-medium">
                  {status?.aiUsageLimit !== null 
                    ? `${status?.aiDailyUsage || 0} / ${status?.aiUsageLimit} uses`
                    : `${status?.aiDailyUsage || 0} uses (Unlimited)`
                  }
                </span>
              </div>
              {status?.aiUsageLimit !== null && (
                <Progress 
                  value={((status?.aiDailyUsage || 0) / (status?.aiUsageLimit || 1)) * 100} 
                  className="h-2"
                />
              )}
              {status?.aiUsageLimit === null && (
                <div className="h-2 bg-primary/20 rounded-full overflow-hidden">
                  <div className="h-full bg-primary animate-pulse" style={{ width: '100%' }} />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const isCurrentPlan = currentPlan === plan.id;
          const hasActiveSubscription = !!status?.stripeSubscriptionId;
          
          // Determine what action is available for this plan
          const isPaidPlan = plan.id === 'standard' || plan.id === 'pro';
          const isOnPaidPlan = currentPlan === 'standard' || currentPlan === 'pro';
          const isUpgradeFromFree = isPaidPlan && currentPlan === 'free';
          const isSwitchBetweenPaid = isPaidPlan && isOnPaidPlan && currentPlan !== plan.id;
          const isUpgrade = plan.id === 'pro' && currentPlan === 'standard';
          const isDowngrade = plan.id === 'standard' && currentPlan === 'pro';

          return (
            <Card 
              key={plan.id} 
              className={cn(
                "bg-gradient-card border-border shadow-card relative overflow-hidden transition-all",
                plan.highlight && "border-primary shadow-lg scale-[1.02]",
                isCurrentPlan && "ring-2 ring-primary"
              )}
            >
              {plan.highlight && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-bl-lg">
                  Popular
                </div>
              )}
              {isCurrentPlan && (
                <div className="absolute top-0 left-0 bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-br-lg">
                  Current
                </div>
              )}
              <CardHeader className="pt-8">
                <div className="flex items-center gap-2">
                  <Icon className={cn(
                    "h-5 w-5",
                    plan.id === 'pro' && "text-amber-500",
                    plan.id === 'standard' && "text-primary",
                    plan.id === 'free' && "text-muted-foreground"
                  )} />
                  <CardTitle>{plan.name}</CardTitle>
                </div>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground ml-1">{plan.priceSubtext}</span>
                </div>
                <CardDescription className="mt-2">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                {plan.id === 'free' ? (
                  isCurrentPlan ? (
                    <Button 
                      variant="outline" 
                      className="w-full" 
                      disabled
                    >
                      Current Plan
                    </Button>
                  ) : isOnPaidPlan ? (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={handleDowngradeToFree}
                      disabled={downgradeLoading}
                    >
                      {downgradeLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Downgrading...
                        </>
                      ) : (
                        'Switch to Free'
                      )}
                    </Button>
                  ) : (
                    <Button 
                      variant="outline" 
                      className="w-full" 
                      disabled
                    >
                      Free Forever
                    </Button>
                  )
                ) : isCurrentPlan ? (
                  <Button 
                    variant="outline" 
                    className="w-full" 
                    disabled
                  >
                    Current Plan
                  </Button>
                ) : isUpgradeFromFree ? (
                  // Upgrading from free tier - create new subscription via checkout
                  <Button 
                    className={cn(
                      "w-full",
                      plan.highlight && "bg-primary hover:bg-primary/90"
                    )}
                    onClick={() => handleUpgrade(plan.id as 'standard' | 'pro')}
                    disabled={checkoutLoading === plan.id}
                  >
                    {checkoutLoading === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </Button>
                ) : isSwitchBetweenPaid ? (
                  // Switching between paid plans (standard ↔ pro)
                  // If they have an active subscription, use switch API, otherwise use checkout
                  <Button 
                    className={cn(
                      "w-full",
                      isUpgrade && "bg-primary hover:bg-primary/90",
                      isDowngrade && "bg-muted hover:bg-muted/80"
                    )}
                    variant={isDowngrade ? "outline" : "default"}
                    onClick={() => {
                      if (hasActiveSubscription) {
                        handleSwitchPlan(plan.id as 'standard' | 'pro');
                      } else {
                        handleUpgrade(plan.id as 'standard' | 'pro');
                      }
                    }}
                    disabled={switchLoading === plan.id || checkoutLoading === plan.id}
                  >
                    {(switchLoading === plan.id || checkoutLoading === plan.id) ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {hasActiveSubscription ? 'Switching...' : 'Loading...'}
                      </>
                    ) : isUpgrade ? (
                      `Upgrade to ${plan.name}`
                    ) : (
                      `Switch to ${plan.name}`
                    )}
                  </Button>
                ) : (
                  // Fallback: should not reach here, but show upgrade option
                  <Button 
                    className={cn(
                      "w-full",
                      plan.highlight && "bg-primary hover:bg-primary/90"
                    )}
                    onClick={() => handleUpgrade(plan.id as 'standard' | 'pro')}
                    disabled={checkoutLoading === plan.id}
                  >
                    {checkoutLoading === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* LeanWorks AI Features */}
      <Card className="bg-gradient-card border-border shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            LeanWorks AI Features
          </CardTitle>
          <CardDescription>
            Powered by advanced AI to supercharge your productivity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {AI_FEATURES.map((feature, i) => {
              const FeatureIcon = feature.icon;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <FeatureIcon className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-sm">{feature.text}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


