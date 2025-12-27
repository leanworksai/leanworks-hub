import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackTimeOnPage } from '@/lib/analytics';

/**
 * Hook to automatically track time spent on a page
 * Sends time_on_page event when user navigates away
 */
export function useTimeOnPage(): void {
  const location = useLocation();
  const startTimeRef = useRef<number>(Date.now());
  const pagePathRef = useRef<string>(location.pathname);

  useEffect(() => {
    // Reset timer when pathname changes
    startTimeRef.current = Date.now();
    pagePathRef.current = location.pathname;

    // Track time on page when component unmounts or pathname changes
    return () => {
      const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (timeSpent > 0 && pagePathRef.current) {
        trackTimeOnPage(pagePathRef.current, timeSpent);
      }
    };
  }, [location.pathname]);
}

