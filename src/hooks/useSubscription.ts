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
      // HARD CODED: Override to always return standard tier
      setStatus({
        ...data,
        plan: 'standard' as const,
        aiUsageLimit: 20,
        aiUsageRemaining: data.aiUsageLimit !== null 
          ? Math.max(0, 20 - (data.aiDailyUsage || 0))
          : 20 - (data.aiDailyUsage || 0),
      });
    } catch (err: any) {
      console.error('Failed to load subscription status:', err);
      setError(err.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  // HARD CODED: Everyone is on standard tier
  const isFreePlan = false;
  const hasAIAccess = true; // Standard tier has AI access

  return {
    status,
    loading,
    error,
    isFreePlan,
    hasAIAccess,
    refetch: loadStatus,
  };
}

