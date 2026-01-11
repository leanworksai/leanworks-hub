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

  return {
    status,
    loading,
    error,
    isFreePlan,
    hasAIAccess,
    refetch: loadStatus,
  };
}

