import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Check, Sparkles, Zap, Crown, MessageSquare, AtSign, BarChart3, FileEdit, Loader2, ExternalLink, Infinity, TrendingUp, CheckSquare, Puzzle, FileText, HelpCircle } from 'lucide-react';
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
    price: '$0',
    originalPrice: '$9.89',
    priceSubtext: 'per user/month',
    promotionText: 'Beta Tester Offer',
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
  { 
    icon: TrendingUp, 
    title: 'Automated Project Progress Tracking',
    description: 'AI automatically monitors and tracks your project progress in real-time. Get intelligent updates on milestones, deadlines, and team performance without manual tracking.',
    highlight: 'Auto-tracking'
  },
  { 
    icon: CheckSquare, 
    title: 'Assisted Task Management',
    description: 'Let AI help you organize, prioritize, and manage tasks efficiently. Get smart suggestions for task assignments, deadlines, and dependencies based on your workflow patterns.',
    highlight: 'Smart assistance'
  },
  { 
    icon: Puzzle, 
    title: 'Rich Integrations',
    description: 'Seamlessly connect with your favorite tools like Slack, GitHub, Jira, and more. AI helps sync data across platforms and provides unified insights from all your integrations.',
    highlight: 'Connected workspace'
  },
  { 
    icon: FileText, 
    title: 'Doc Writing & Updates',
    description: 'AI-powered documentation that writes and updates itself. Generate comprehensive docs, keep them current with project changes, and ensure your team always has the latest information.',
    highlight: 'Auto-updates'
  },
  { 
    icon: HelpCircle, 
    title: 'Answer Any Project Question',
    description: 'Ask anything about your project and get instant, accurate answers. From task status to team workload, project history to future planning - AI understands your entire project context.',
    highlight: 'Instant answers'
  },
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
    <div className="space-y-8 animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Subscription Plans
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">Choose the perfect plan for your team</p>
        </div>
        {status?.stripeSubscriptionId && (
          <Button 
            variant="outline" 
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="shrink-0"
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
      <Card className="bg-gradient-to-br from-primary/5 via-background to-background border border-primary/20">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-3 text-2xl">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                  {currentPlan === 'pro' ? (
                    <Crown className="h-5 w-5 text-amber-500" />
                  ) : currentPlan === 'standard' ? (
                    <Zap className="h-5 w-5 text-primary" />
                  ) : (
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <span>Current Plan</span>
                <Badge 
                  variant={currentPlan === 'pro' ? 'default' : currentPlan === 'standard' ? 'secondary' : 'outline'}
                  className="text-sm px-3 py-1"
                >
                  {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                </Badge>
              </CardTitle>
              <CardDescription className="flex items-center gap-3 text-base">
                {status?.isTrialActive && (
                  <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                    Trial: {status.trialDaysRemaining} day{status.trialDaysRemaining !== 1 ? 's' : ''} remaining
                  </Badge>
                )}
                {status?.stripeSubscriptionId && (
                  <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
                    Active subscription
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="font-medium text-foreground">LeanWorks AI Usage Today</span>
                <span className="font-semibold text-primary">
                  {status?.aiUsageLimit !== null 
                    ? `${status?.aiDailyUsage || 0} / ${status?.aiUsageLimit} uses`
                    : (
                      <span className="flex items-center gap-1">
                        <Infinity className="h-4 w-4" />
                        Unlimited
                      </span>
                    )
                  }
                </span>
              </div>
              {status?.aiUsageLimit !== null && (
                <Progress 
                  value={((status?.aiDailyUsage || 0) / (status?.aiUsageLimit || 1)) * 100} 
                  className="h-3"
                />
              )}
              {status?.aiUsageLimit === null && (
                <div className="h-3 bg-primary/20 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-primary to-primary/60 animate-pulse" style={{ width: '100%' }} />
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
                "bg-gradient-to-br from-card to-card/50 border relative overflow-hidden transition-all duration-300",
                plan.highlight && "border-primary bg-gradient-to-br from-primary/5 via-card to-card",
                isCurrentPlan && "ring-2 ring-primary ring-offset-1",
                !plan.highlight && !isCurrentPlan && "hover:border-primary/50"
              )}
            >
              {plan.highlight && (
                <div className="absolute top-0 right-0 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-xs font-bold px-4 py-1.5 rounded-bl-lg">
                  ⭐ Popular
                </div>
              )}
              {isCurrentPlan && (
                <div className="absolute top-0 left-0 bg-gradient-to-r from-green-500 to-green-600 text-white text-xs font-bold px-4 py-1.5 rounded-br-lg">
                  ✓ Current
                </div>
              )}
              <CardHeader className={cn("pt-10", plan.highlight && "pt-12")}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={cn(
                    "h-12 w-12 rounded-xl flex items-center justify-center border",
                    plan.id === 'pro' && "bg-amber-500/10 border-amber-500/20",
                    plan.id === 'standard' && "bg-primary/10 border-primary/20",
                    plan.id === 'free' && "bg-muted border-border"
                  )}>
                    <Icon className={cn(
                      "h-6 w-6",
                      plan.id === 'pro' && "text-amber-500",
                      plan.id === 'standard' && "text-primary",
                      plan.id === 'free' && "text-muted-foreground"
                    )} />
                  </div>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                </div>
                <div className="mt-4">
                  {plan.originalPrice ? (
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                        <span className="text-muted-foreground text-sm">{plan.priceSubtext}</span>
                        {plan.promotionText && (
                          <Badge variant="secondary" className="ml-2 bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-600 dark:text-green-400 border-green-500/20">
                            {plan.promotionText}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg text-muted-foreground line-through">
                          {plan.originalPrice}
                        </span>
                        <span className="text-sm text-muted-foreground">{plan.priceSubtext}</span>
                        <Badge variant="outline" className="text-xs border-green-500/30 text-green-600 dark:text-green-400">
                          100% OFF
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold">{plan.price}</span>
                      <span className="text-muted-foreground">{plan.priceSubtext}</span>
                    </div>
                  )}
                </div>
                <CardDescription className="mt-3 text-base">{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <div className="h-5 w-5 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      </div>
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="pt-2">
                  {plan.id === 'free' ? (
                    <Button 
                      variant="outline" 
                      className="w-full h-11 text-base font-medium" 
                      disabled
                    >
                      {isCurrentPlan ? 'Current Plan' : 'Free Forever'}
                    </Button>
                  ) : plan.id === 'pro' ? (
                    <Button 
                      variant="outline" 
                      className="w-full h-11 text-base font-medium" 
                      disabled
                    >
                      {isCurrentPlan ? 'Current Plan' : 'Coming Soon'}
                    </Button>
                  ) : plan.id === 'standard' ? (
                    // Only Standard plan is clickable
                    isCurrentPlan ? (
                      <Button 
                        variant="outline" 
                        className="w-full h-11 text-base font-medium" 
                        disabled
                      >
                        Current Plan
                      </Button>
                    ) : isUpgradeFromFree ? (
                      // Upgrading from free tier - create new subscription via checkout
                      <Button 
                        className={cn(
                          "w-full h-11 text-base font-semibold transition-all",
                          plan.highlight && "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary"
                        )}
                        onClick={() => handleUpgrade(plan.id as 'standard' | 'pro')}
                        disabled={checkoutLoading === plan.id}
                      >
                        {checkoutLoading === plan.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
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
                          "w-full h-11 text-base font-semibold transition-all",
                          isUpgrade && "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary",
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
                            {hasActiveSubscription ? 'Switching...' : 'Processing...'}
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
                          "w-full h-11 text-base font-semibold transition-all",
                          plan.highlight && "bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary"
                        )}
                        onClick={() => handleUpgrade(plan.id as 'standard' | 'pro')}
                        disabled={checkoutLoading === plan.id}
                      >
                        {checkoutLoading === plan.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          `Upgrade to ${plan.name}`
                        )}
                      </Button>
                    )
                  ) : (
                    // Fallback for any other plans
                    <Button 
                      variant="outline" 
                      className="w-full h-11 text-base font-medium" 
                      disabled
                    >
                      Unavailable
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* LeanWorks AI Features */}
      <Card className="bg-gradient-to-br from-primary/5 via-background to-background border border-primary/20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <CardHeader className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-3 text-3xl font-bold">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  LeanWorks AI
                </span>
              </CardTitle>
              <CardDescription className="text-base mt-3 max-w-2xl">
                <span className="font-medium text-foreground">Transform your workflow</span> with AI that automates project tracking, assists with task management, integrates with your tools, keeps docs updated, and answers any question about your projects.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {AI_FEATURES.map((feature, i) => {
              const FeatureIcon = feature.icon;
              return (
                <div 
                  key={i} 
                  className="group relative p-6 rounded-xl bg-gradient-to-br from-background to-background/50 border border-border/50 hover:border-primary/50 transition-all duration-300 hover:scale-[1.01]"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />
                  <div className="relative space-y-3">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center flex-shrink-0 transition-all">
                          <FeatureIcon className="h-6 w-6 text-primary" />
                        </div>
                        {feature.highlight && (
                          <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20 ml-auto">
                            {feature.highlight}
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-semibold text-foreground leading-tight">{feature.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-8 p-6 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground mb-1">
                  Ready to supercharge your productivity?
                </p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Standard or Pro to unlock the full power of LeanWorks AI and transform how you work.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


