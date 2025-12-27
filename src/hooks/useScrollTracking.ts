import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackScrollDepth } from '@/lib/analytics';

/**
 * Hook to track scroll depth on a page
 * Tracks when user scrolls to 25%, 50%, 75%, and 100% of page height
 */
export function useScrollTracking(enabled: boolean = true): void {
  const location = useLocation();
  const trackedDepthsRef = useRef<Set<number>>(new Set());
  const pagePathRef = useRef<string>(location.pathname);

  useEffect(() => {
    // Reset tracked depths when pathname changes
    trackedDepthsRef.current.clear();
    pagePathRef.current = location.pathname;

    if (!enabled) {
      return;
    }

    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      
      // Calculate scroll percentage
      const scrollPercentage = Math.round(
        ((scrollTop + windowHeight) / documentHeight) * 100
      );

      // Track milestones: 25%, 50%, 75%, 100%
      const milestones: (25 | 50 | 75 | 100)[] = [25, 50, 75, 100];
      
      milestones.forEach((milestone) => {
        if (
          scrollPercentage >= milestone &&
          !trackedDepthsRef.current.has(milestone)
        ) {
          trackedDepthsRef.current.add(milestone);
          trackScrollDepth(pagePathRef.current, milestone);
        }
      });
    };

    // Throttle scroll events
    let ticking = false;
    const throttledHandleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', throttledHandleScroll, { passive: true });
    
    // Check initial scroll position
    handleScroll();

    return () => {
      window.removeEventListener('scroll', throttledHandleScroll);
    };
  }, [location.pathname, enabled]);
}

