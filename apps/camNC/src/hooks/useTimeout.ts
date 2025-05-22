import { useEffect, useRef, useState } from 'react';

/**
 * Returns true if the timeout has been reached.
 * @param ms - The timeout in milliseconds.
 * @returns True if the timeout has been reached, false otherwise.
 */
export function useTimeout(ms: number) {
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setHasTimedOut(true);
    }, ms);
    timeoutRef.current = timerId;
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [ms]);

  function clearTimeout() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    setHasTimedOut(false);
  }

  return [hasTimedOut, clearTimeout] as const;
}
