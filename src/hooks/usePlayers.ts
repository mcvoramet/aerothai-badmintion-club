import { useCallback, useEffect, useState } from 'react';
import { getPlayers } from '../api/appsScript';
import type { Player } from '../types';

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlayers();
      setPlayers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายชื่อผู้เล่นไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { players, loading, error, refresh };
}
