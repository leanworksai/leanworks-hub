import { useState, useEffect } from 'react';
import { subscriptionService, type SubscriptionStatus } from '@/services/api';

export function useSubscription() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

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

  const isFreePlan = status?.plan === 'free';
  const hasAIAccess = status?.plan === 'standard' || status?.plan === 'pro';
  // Credit-based access: has credits if unlimited (null) or remaining > 0
  const hasCredits = status?.aiUsageRemaining === null || (status?.aiUsageRemaining ?? 0) > 0;
  const creditsRemaining = status?.aiUsageRemaining ?? 0;
  const creditsLimit = status?.aiUsageLimit ?? null;

  return {
    status,
    loading,
    error,
    isFreePlan,
    hasAIAccess,
    hasCredits,
    creditsRemaining,
    creditsLimit,
    refetch: loadStatus,
  };
}

