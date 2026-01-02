import { useEffect, useRef } from 'react';
import { trackHomePageScroll } from '@/lib/analytics';

interface UseScrollDepthOptions {
  milestones?: number[];
  throttleMs?: number;
}

/**
 * Hook to track scroll depth milestones on the home page
 * Tracks scroll depth at 25%, 50%, 75%, and 100%
 * Only tracks each milestone once per page view
 */
export function useScrollDepth(
  options: UseScrollDepthOptions = {}
): void {
  const { milestones = [25, 50, 75, 100], throttleMs = 100 } = options;
  const trackedMilestonesRef = useRef<Set<number>>(new Set());
  const lastScrollTopRef = useRef<number>(0);
  const throttleTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Restore tracked milestones from sessionStorage
    const storageKey = 'home_page_tracked_scroll_milestones';
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const milestoneNumbers = JSON.parse(stored) as number[];
        trackedMilestonesRef.current = new Set(milestoneNumbers);
      }
    } catch (error) {
      // Ignore storage errors
    }

    const handleScroll = () => {
      // Throttle scroll events
      if (throttleTimeoutRef.current !== null) {
        return;
      }

      throttleTimeoutRef.current = window.setTimeout(() => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const documentHeight = document.documentElement.scrollHeight;

        // Calculate scroll depth percentage
        const scrollDepth = Math.round(
          ((scrollTop + viewportHeight) / documentHeight) * 100
        );

        // Check each milestone
        milestones.forEach((milestone) => {
          if (
            scrollDepth >= milestone &&
            !trackedMilestonesRef.current.has(milestone) &&
            scrollTop > lastScrollTopRef.current // Only track when scrolling down
          ) {
            // Track milestone
            trackHomePageScroll(milestone);

            // Mark as tracked
            trackedMilestonesRef.current.add(milestone);

            // Save to sessionStorage
            try {
              sessionStorage.setItem(
                storageKey,
                JSON.stringify(Array.from(trackedMilestonesRef.current))
              );
            } catch (error) {
              // Ignore storage errors
            }
          }
        });

        lastScrollTopRef.current = scrollTop;
        throttleTimeoutRef.current = null;
      }, throttleMs);
    };

    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Check initial scroll position on mount
    handleScroll();

    // Cleanup
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (throttleTimeoutRef.current !== null) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, [milestones, throttleMs]);
}

