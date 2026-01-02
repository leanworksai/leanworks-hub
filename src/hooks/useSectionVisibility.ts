import { useEffect, useRef } from 'react';
import { trackSectionView } from '@/lib/analytics';

interface UseSectionVisibilityOptions {
  threshold?: number;
  rootMargin?: string;
}

/**
 * Hook to track when sections enter the viewport
 * Uses Intersection Observer API to detect section visibility
 * Tracks each section only once per page view using sessionStorage
 */
export function useSectionVisibility(
  sectionRefs: Record<string, React.RefObject<HTMLElement>>,
  options: UseSectionVisibilityOptions = {}
): void {
  const { threshold = 0.5, rootMargin = '0px' } = options;
  const trackedSectionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Restore tracked sections from sessionStorage to persist across re-renders
    const storageKey = 'home_page_tracked_sections';
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const sections = JSON.parse(stored) as string[];
        trackedSectionsRef.current = new Set(sections);
      }
    } catch (error) {
      // Ignore storage errors
    }

    // Create Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const sectionName = entry.target.getAttribute('data-section-name');
            if (sectionName && !trackedSectionsRef.current.has(sectionName)) {
              // Track section view
              trackSectionView(sectionName);
              
              // Mark as tracked
              trackedSectionsRef.current.add(sectionName);
              
              // Save to sessionStorage
              try {
                sessionStorage.setItem(
                  storageKey,
                  JSON.stringify(Array.from(trackedSectionsRef.current))
                );
              } catch (error) {
                // Ignore storage errors
              }
            }
          }
        });
      },
      {
        threshold,
        rootMargin,
      }
    );

    // Observe all section refs
    Object.entries(sectionRefs).forEach(([sectionName, ref]) => {
      if (ref.current) {
        // Set data attribute for identification
        ref.current.setAttribute('data-section-name', sectionName);
        observer.observe(ref.current);
      }
    });

    // Cleanup
    return () => {
      observer.disconnect();
    };
  }, [sectionRefs, threshold, rootMargin]);
}

