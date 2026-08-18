import { useMemo, useState } from 'react';
import { deleteGame } from '../api/appsScript';
import { useBootstrap } from '../hooks/useBootstrap';
import GameSheet from './GameSheet';
import DayHistorySheet from './DayHistorySheet';
import type { BootstrapData, Game, Player } from '../types';

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

// Adds any players seen on a freshly saved game to the local list, so the
// autocomplete knows about them without waiting for another round trip.
function mergePlayers(existing: Player[], game: Game): Player[] {
  const known = new Set(existing.map((p) => p.player_key));
  const added = game.players
    .filter((p) => p.player_key && !known.has(p.player_key))
    .map((p) => ({
      player_key: p.player_key,
      nickname: p.nickname,
      department: p.department,
      first_seen: game.timestamp,
      last_seen: game.timestamp,
      games_count: 1,
    }));
  return added.length ? [...added, ...existing] : existing;
}

export default function CalendarView() {
  const todayKey = localDateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const { data, refreshing, error, refresh, update } = useBootstrap(month);
  const [historyDay, setHistoryDay] = useState<string | null>(null);
  const [form, setForm] = useState<{ date: string; editing: Game | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  // The change was saved, but the LINE group wasn't told about it. Worth
  // showing — the group is how people learn their balance moved.
  const [lineWarning, setLineWarning] = useState<string | null>(null);

  const games = useMemo(() => data?.games ?? [], [data]);
  const players = data?.players ?? [];
  const pricePerShuttle = data?.settings.price_per_shuttle ?? null;
  const loading = !data && refreshing;

  // Does this game still belong to the month on screen? Editing a game's date
  // can move it out of view entirely.
  const inMonth = (game: Game) => {
    const t = new Date(game.timestamp);
    return t.getFullYear() === month.getFullYear() && t.getMonth() === month.getMonth();
  };

  const applySaved = (saved: Game) => (current: BootstrapData): BootstrapData => {
    const others = current.games.filter((g) => g.game_id !== saved.game_id);
    const games = inMonth(saved) ? [...others, saved] : others;
    games.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return { ...current, games, players: mergePlayers(current.players, saved) };
  };

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

  // The write already returned the saved row, so merge it in rather than
  // re-reading the whole month — that refetch used to cost ~2 extra seconds.
  //
  // Merging two players is the exception: it renames a person across every game
  // and settlement in the sheet, so anything already on screen is out of date
  // and the month has to come back from the server.
  function handleSaved(saved: Game, warning: string | null, playersMerged: boolean) {
    setForm(null);
    setMutationError(null);
    setLineWarning(warning);
    update(applySaved(saved));
    if (playersMerged) void refresh();
  }

  async function handleDelete(game: Game) {
    if (!window.confirm(`ลบเกมนี้ใช่หรือไม่? (${game.players.map((p) => p.nickname).join(', ')})`))
      return;
    setDeletingId(game.game_id);
    setMutationError(null);
    setLineWarning(null);
    try {
      const result = await deleteGame(game.game_id);
      setLineWarning(result.line_warning);
      update((current) => ({
        ...current,
        games: current.games.filter((g) => g.game_id !== game.game_id),
      }));
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'ลบเกมไม่สำเร็จ');
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

        {(error || mutationError) && (
          <div className="error-banner">{mutationError ?? error}</div>
        )}

        {lineWarning && <div className="warning-banner">{lineWarning}</div>}

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
          {refreshing && data && <span className="calendar-refreshing">กำลังอัปเดต…</span>}
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
          pricePerShuttle={pricePerShuttle}
          onClose={(playersMerged) => {
            setForm(null);
            if (playersMerged) void refresh();
          }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
