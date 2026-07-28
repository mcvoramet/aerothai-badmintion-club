import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteGame, getGamesInRange } from '../api/appsScript';
import GameSheet from './GameSheet';
import DayHistorySheet from './DayHistorySheet';
import type { Game, Player } from '../types';

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface Props {
  players: Player[];
  onPlayersChanged: () => void;
}

export default function CalendarView({ players, onPlayersChanged }: Props) {
  const todayKey = localDateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [games, setGames] = useState<Game[]>([]);
  const [historyDay, setHistoryDay] = useState<string | null>(null);
  const [form, setForm] = useState<{ date: string; editing: Game | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    try {
      setGames(await getGamesInRange(start.toISOString(), end.toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดปฏิทินไม่สำเร็จ');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const gamesByDay = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const game of games) {
      const key = localDateKey(new Date(game.timestamp));
      const list = map.get(key);
      if (list) list.push(game);
      else map.set(key, [game]);
    }
    return map;
  }, [games]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const result: (number | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    return result;
  }, [month]);

  const monthTotals = useMemo(
    () => ({
      games: games.length,
      shuttles: games.reduce((s, g) => s + g.shuttles_used, 0),
      cost: games.reduce((s, g) => s + g.total_cost, 0),
    }),
    [games]
  );

  function shiftMonth(delta: number) {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  async function handleSaved() {
    setForm(null);
    await load();
    onPlayersChanged();
  }

  async function handleDelete(game: Game) {
    if (!window.confirm(`ลบเกมนี้ใช่หรือไม่? (${game.players.map((p) => p.nickname).join(', ')})`))
      return;
    setDeletingId(game.game_id);
    try {
      await deleteGame(game.game_id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบเกมไม่สำเร็จ');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="card">
        <div className="calendar-header">
          <button
            type="button"
            className="calendar-nav"
            onClick={() => shiftMonth(-1)}
            aria-label="เดือนก่อนหน้า"
          >
            ‹
          </button>
          <span className="calendar-title">
            {MONTHS[month.getMonth()]} {month.getFullYear() + 543}
          </span>
          <button
            type="button"
            className="calendar-nav"
            onClick={() => shiftMonth(1)}
            aria-label="เดือนถัดไป"
          >
            ›
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="calendar-grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} className="calendar-day empty" />;
            const key = localDateKey(new Date(month.getFullYear(), month.getMonth(), day));
            const dayGames = gamesByDay.get(key);
            const isToday = key === todayKey;
            const classes = [
              'calendar-day',
              dayGames ? 'has-games' : '',
              isToday ? 'today' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={key}
                type="button"
                className={classes}
                onClick={() => setHistoryDay(key)}
                aria-label={isToday ? `วันนี้ ${day}` : `วันที่ ${day}`}
              >
                <span className="calendar-day-num">{day}</span>
                {dayGames ? (
                  <span className="calendar-count">{dayGames.length}</span>
                ) : (
                  <span className="calendar-count placeholder" />
                )}
              </button>
            );
          })}
        </div>

        <div className="calendar-legend">
          <span>
            <i className="legend-today" /> วันนี้
          </span>
          <span>
            <i className="legend-games" /> มีเกม (ตัวเลข = จำนวนเกม) · แตะเพื่อดูประวัติ
          </span>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block calendar-cta"
          onClick={() => setForm({ date: todayKey, editing: null })}
        >
          ＋ บันทึกเกม
        </button>
      </div>

      <div className="card calendar-month-summary">
        <h2>สรุปเดือนนี้ ({MONTHS[month.getMonth()]})</h2>
        {loading ? (
          <p className="balance-label">กำลังโหลด...</p>
        ) : (
          <div className="calendar-summary-stats">
            <div className="calendar-stat">
              <div className="calendar-stat-value">{monthTotals.games}</div>
              <div className="calendar-stat-label">เกม</div>
            </div>
            <div className="calendar-stat">
              <div className="calendar-stat-value">{monthTotals.shuttles}</div>
              <div className="calendar-stat-label">ลูกขนไก่</div>
            </div>
            <div className="calendar-stat">
              <div className="calendar-stat-value">{monthTotals.cost.toFixed(0)}</div>
              <div className="calendar-stat-label">บาทรวม</div>
            </div>
          </div>
        )}
      </div>

      {historyDay && !form && (
        <DayHistorySheet
          dateKey={historyDay}
          games={gamesByDay.get(historyDay) ?? []}
          busyId={deletingId}
          onClose={() => setHistoryDay(null)}
          onEdit={(game) => setForm({ date: historyDay, editing: game })}
          onDelete={handleDelete}
        />
      )}

      {form && (
        <GameSheet
          initialDate={form.date}
          editingGame={form.editing}
          players={players}
          onClose={() => setForm(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
