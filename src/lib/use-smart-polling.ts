import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Module-level stale-while-revalidate cache shared across pages.
 * Only ever written client-side (inside poll effects), so SSR/hydration
 * always sees an empty cache and stays consistent.
 */
const pollCache = new Map<string, unknown>();

export function getPollCache<T>(key: string): T | null {
  return pollCache.has(key) ? (pollCache.get(key) as T) : null;
}

export function setPollCache(key: string, value: unknown): void {
  pollCache.set(key, value);
}

/**
 * Hook that polls a fetch function at a given interval,
 * automatically pausing when the browser tab is not visible.
 *
 * Pass `cacheKey` to share the latest result across pages: on mount the
 * hook returns the cached value instantly (no loading flash when
 * navigating between tabs) and refreshes it in the background.
 */
export function useSmartPolling<T>(
  fetchFn: () => Promise<T>,
  {
    intervalMs = 20_000,
    enabled = true,
    cacheKey,
  }: { intervalMs?: number; enabled?: boolean; cacheKey?: string } = {},
) {
  const [data, setData] = useState<T | null>(() => (cacheKey ? getPollCache<T>(cacheKey) : null));
  const [loading, setLoading] = useState(() => !(cacheKey && pollCache.has(cacheKey)));
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const poll = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      if (cacheKeyRef.current) setPollCache(cacheKeyRef.current, result);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;

    function schedule() {
      if (stopped) return;
      timerRef.current = setTimeout(async () => {
        if (!document.hidden) {
          await poll();
        }
        schedule();
      }, intervalMs);
    }

    // Initial fetch
    poll().then(() => schedule());

    // Pause/resume on visibility change
    function onVisibility() {
      if (!document.hidden && enabled) {
        // Tab became visible — poll immediately
        poll();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, poll]);

  return { data, loading, error, refetch: poll };
}
