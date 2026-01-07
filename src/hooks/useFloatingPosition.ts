import { useEffect, useRef } from 'react';
import { computePosition, autoUpdate, offset, flip, shift, Placement } from '@floating-ui/dom';

interface UseFloatingPositionOptions {
  placement?: Placement;
  offsetValue?: number;
  shiftPadding?: number;
  enabled?: boolean;
}

export function useFloatingPosition(
  referenceElement: HTMLElement | null,
  floatingElement: HTMLElement | null,
  options: UseFloatingPositionOptions = {}
) {
  const {
    placement = 'bottom-end',
    offsetValue = 5,
    shiftPadding = 5,
    enabled = true,
  } = options;

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !referenceElement || !floatingElement) {
      return;
    }

    // Set initial position to absolute so Floating UI can position it
    floatingElement.style.position = 'absolute';

    // Set up auto-updating position
    cleanupRef.current = autoUpdate(
      referenceElement,
      floatingElement,
      async () => {
        const { x, y } = await computePosition(referenceElement, floatingElement, {
          placement,
          middleware: [
            offset(offsetValue),
            flip(),
            shift({ padding: shiftPadding }),
          ],
        });

        // Apply the computed position
        Object.assign(floatingElement.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      }
    );

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [referenceElement, floatingElement, placement, offsetValue, shiftPadding, enabled]);
}

