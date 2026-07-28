import { useEffect, useState } from 'react';
import { getSummary } from '../api/appsScript';
import type { StatsPeriod, StatsSummary } from '../types';

const PERIOD_OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: 'daily', label: 'วันนี้' },
  { value: 'weekly', label: 'สัปดาห์นี้' },
  { value: 'monthly', label: 'เดือนนี้' },
  { value: 'all', label: 'ทั้งหมด' },
];

export default function StatsView() {
  const [period, setPeriod] = useState<StatsPeriod>('monthly');
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getSummary(period);
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'โหลดสถิติไม่สำเร็จ');
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const label = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? '';

  return (
    <div className="card">
      <h2>สถิติการใช้ลูกขนไก่</h2>

      <div className="sheet-field" style={{ marginBottom: '1rem' }}>
        <label htmlFor="stats-period">ช่วงเวลา</label>
        <select
          id="stats-period"
          className="select-input"
          value={period}
          onChange={(e) => setPeriod(e.target.value as StatsPeriod)}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="balance-label">กำลังโหลด...</p>}

      {summary && !loading && !error && (
        <>
          <div className="stat-hero">
            <div className="stat-hero-value">{summary.shuttles_used}</div>
            <div className="stat-hero-label">ลูกขนไก่ที่ใช้ ({label})</div>
          </div>

          <div className="calendar-summary-stats">
            <div className="calendar-stat">
              <div className="calendar-stat-value">{summary.total_cost.toFixed(0)}</div>
              <div className="calendar-stat-label">ค่าใช้จ่าย (บาท)</div>
            </div>
            <div className="calendar-stat">
              <div className="calendar-stat-value">{summary.players_involved}</div>
              <div className="calendar-stat-label">ผู้เล่นที่ร่วม</div>
            </div>
            <div className="calendar-stat">
              <div className="calendar-stat-value">{summary.games}</div>
              <div className="calendar-stat-label">เกม</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
