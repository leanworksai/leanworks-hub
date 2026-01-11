import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Debounce a value - returns the debounced value after delay
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Debounce a callback function - only calls the callback after delay has passed
 * without another call being made
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay]
  ) as T;
}

/**
 * Debounce a promise callback - handles async operations with debouncing
 * Returns a tuple with [debouncedFunction, isPending] to track if debounce is active
 */
export function useDebouncedPromise<T extends (...args: any[]) => Promise<any>>(
  callback: T,
  delay: number
): [(...args: Parameters<T>) => Promise<void>, boolean] {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const debouncedCallback = useCallback(
    async (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setIsPending(true);

      timeoutRef.current = setTimeout(async () => {
        try {
          await callback(...args);
        } catch (error) {
          console.error('Debounced callback error:', error);
        } finally {
          setIsPending(false);
        }
      }, delay);
    },
    [callback, delay]
  );

  return [debouncedCallback, isPending];
}
