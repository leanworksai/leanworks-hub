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
    name: 'Free',
    price: '$0',
    priceSubtext: 'forever',
    description: 'Get started with essential features',
    features: [
      'All basic features',
      'Max 5 members in org',
      'Voice chat (30 mins limit)',
      'LeanWorks AI (10 credits/day)',
    ],
    aiFeatures: true,
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
      'All basic features',
      'Unlimited members',
      'Unlimited voice chat',
      'LeanWorks AI (30 credits/day)',
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
      'All basic features',
      'Unlimited members',
      'Unlimited voice chat',
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

  const handleSwitchPlan = async (plan: 'free' | 'standard' | 'pro') => {
    try {
      setSwitchLoading(plan);
      const result = await subscriptionService.switchPlan(plan);
      
      // If checkout is required, redirect to Stripe checkout
      if (result.requiresCheckout && result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      
      const planName = plan === 'free' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1);
      toast({
        title: 'Plan switched!',
        description: `You are now on the ${planName} plan.`,
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Subscription Plans
          </h1>
        </div>
        {status?.stripeSubscriptionId && (
          <Button 
            variant="outline" 
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="shrink-0 h-10 px-4 shadow-sm hover:bg-muted/80 transition-colors"
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
      <Card className="bg-gradient-to-br from-background via-muted/20 to-background border-border/50 shadow-sm mb-10 overflow-hidden relative">
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,#fff,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]" />
        <CardHeader className="pb-6 relative z-10">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium text-muted-foreground uppercase tracking-wider text-xs">Current Plan</h2>
                {status?.stripeSubscriptionId && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 px-2 py-0.5 h-5">
                    Active
                  </Badge>
                )}
                {status?.isTrialActive && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 px-2 py-0.5 h-5">
                    Trial: {status.trialDaysRemaining} day{status.trialDaysRemaining !== 1 ? 's' : ''} left
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
                  {currentPlan === 'pro' ? (
                    <Crown className="h-6 w-6" />
                  ) : currentPlan === 'standard' ? (
                    <Zap className="h-6 w-6" />
                  ) : (
                    <Sparkles className="h-6 w-6" />
                  )}
                </div>
                <span className="text-3xl font-bold text-foreground">
                  {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10">
          <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div className="space-y-1">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  LeanWorks AI Usage
                </h3>
                <p className="text-sm text-muted-foreground">Credits renew daily</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-primary">
                  {status?.aiUsageLimit !== null 
                    ? status?.aiDailyUsage || 0
                    : <Infinity className="h-6 w-6 inline-block" />
                  }
                </span>
                <span className="text-muted-foreground ml-1">
                  / {status?.aiUsageLimit !== null ? status?.aiUsageLimit : 'Unlimited'} credits
                </span>
              </div>
            </div>
            
            {status?.aiUsageLimit !== null ? (
              <div className="space-y-2">
                <Progress 
                  value={((status?.aiDailyUsage || 0) / (status?.aiUsageLimit || 1)) * 100} 
                  className="h-3 bg-secondary"
                  // Dynamic color based on usage would be handled via CSS or inline styles if supported by component, 
                  // but standard Progress usually takes class for color. 
                  // We'll use a custom indicator below.
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            ) : (
              <div className="h-3 bg-primary/10 rounded-full w-full relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/40 to-primary/10 animate-pulse" />
              </div>
            )}
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
          const isSwitchToFree = plan.id === 'free' && isOnPaidPlan;
          const isUpgrade = plan.id === 'pro' && currentPlan === 'standard';
          const isDowngrade = plan.id === 'standard' && currentPlan === 'pro';

          return (
            <Card 
              key={plan.id} 
              className={cn(
                "flex flex-col relative overflow-hidden transition-all duration-300 border-border",
                plan.highlight 
                  ? "border-primary shadow-lg scale-105 z-10 bg-card" 
                  : "bg-card/50 hover:bg-card hover:shadow-md border-border/60",
                isCurrentPlan && !plan.highlight && "border-primary/50 bg-primary/5"
              )}
            >
              {plan.highlight && (
                <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-primary to-primary/60" />
              )}
              {isCurrentPlan && (
                <div className="absolute top-3 right-3">
                  <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400">
                    <Check className="w-3 h-3 mr-1" /> Current Plan
                  </Badge>
                </div>
              )}
              
              <CardHeader className={cn("pb-8", plan.highlight ? "pt-8" : "pt-6")}>
                <div className="mb-4">
                  <h3 className="text-lg font-medium text-muted-foreground">{plan.name}</h3>
                </div>
                
                <div className="flex items-baseline gap-1 mb-2">
                  {plan.id !== 'free' && <span className="text-3xl font-bold text-foreground">$</span>}
                  <span className="text-5xl font-bold tracking-tight text-foreground">
                    {plan.id === 'free' ? '0' : plan.price.replace('$', '')}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    {plan.id === 'free' ? '/ forever' : '/ month'}
                  </span>
                </div>
                
                <CardDescription className="text-base mt-2">{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col gap-6">
                <div className="space-y-4 flex-1">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className={cn(
                        "mt-0.5 rounded-full p-0.5", 
                        plan.highlight ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted"
                      )}>
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm text-foreground/80">{feature}</span>
                    </div>
                  ))}
                </div>
                
                <div className="mt-auto pt-6">
                  {plan.id === 'free' ? (
                    // Free plan button
                    isCurrentPlan ? (
                      <Button 
                        variant="outline" 
                        className="w-full h-12 text-base" 
                        disabled
                      >
                        Current Plan
                      </Button>
                    ) : isSwitchToFree ? (
                      <Button 
                        variant="outline" 
                        className="w-full h-12 text-base hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" 
                        onClick={() => handleSwitchPlan('free')}
                        disabled={switchLoading === 'free'}
                      >
                        {switchLoading === 'free' ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Switching...
                          </>
                        ) : (
                          'Downgrade to Free'
                        )}
                      </Button>
                    ) : (
                      <Button 
                        variant="outline" 
                        className="w-full h-12 text-base" 
                        disabled
                      >
                        Free Forever
                      </Button>
                    )
                  ) : isCurrentPlan ? (
                    <Button 
                      variant="outline" 
                      className="w-full h-12 text-base border-primary/20 text-primary bg-primary/5" 
                      disabled
                    >
                      Current Plan
                    </Button>
                  ) : isUpgradeFromFree ? (
                    <Button 
                      className={cn(
                        "w-full h-12 text-base font-semibold shadow-md transition-all hover:scale-[1.02]",
                        plan.highlight ? "bg-primary hover:bg-primary/90" : ""
                      )}
                      variant={plan.highlight ? "default" : "outline"}
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
                    <Button 
                      className={cn(
                        "w-full h-12 text-base font-semibold transition-all",
                        isUpgrade && "bg-primary hover:bg-primary/90 shadow-md",
                        isDowngrade && "bg-muted hover:bg-muted/80 text-muted-foreground"
                      )}
                      variant={isDowngrade ? "ghost" : "default"}
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
                    <Button 
                      className={cn(
                        "w-full h-12 text-base font-semibold",
                        plan.highlight && "bg-primary hover:bg-primary/90"
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


