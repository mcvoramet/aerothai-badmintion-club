import { useCallback, useEffect, useRef, useState } from 'react';
import { bootstrap } from '../api/appsScript';
import { readCache, writeCache } from '../lib/cache';
import type { BootstrapData } from '../types';

const keyFor = (year: number, monthIndex: number) => `bootstrap:${year}-${monthIndex + 1}`;

/**
 * Settings + players + the visible month's games in a single request, served
 * stale-while-revalidate: cached data renders immediately, then a background
 * refresh replaces it.
 *
 * `update` applies a local change (a saved or deleted game) without a refetch.
 * Write endpoints already return the affected row, so re-reading the whole
 * month afterwards would just be extra seconds of waiting.
 */
export function useBootstrap(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const key = keyFor(year, monthIndex);

  const [data, setData] = useState<BootstrapData | null>(() => readCache<BootstrapData>(key));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow response for a month the user has already left.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    setError(null);
    try {
      const start = new Date(year, monthIndex, 1).toISOString();
      const end = new Date(year, monthIndex + 1, 1).toISOString();
      const fresh = await bootstrap(start, end);
      if (id !== requestId.current) return;
      setData(fresh);
      writeCache(key, fresh);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [key, year, monthIndex]);

  useEffect(() => {
    // Show whatever we already have for this month before the network answers.
    setData(readCache<BootstrapData>(key));
    void refresh();
  }, [key, refresh]);

  const update = useCallback(
    (fn: (current: BootstrapData) => BootstrapData) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        writeCache(key, next);
        return next;
      });
    },
    [key]
  );

  return { data, refreshing, error, refresh, update };
}
