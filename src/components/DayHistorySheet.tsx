import { useEffect } from 'react';
import type { Game } from '../types';

interface Props {
  dateKey: string;
  games: Game[];
  onClose: () => void;
  onEdit: (game: Game) => void;
  onDelete: (game: Game) => void;
  busyId: string | null;
}

function thaiLongDate(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function DayHistorySheet({
  dateKey,
  games,
  onClose,
  onEdit,
  onDelete,
  busyId,
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const shuttles = games.reduce((s, g) => s + g.shuttles_used, 0);
  const cost = games.reduce((s, g) => s + g.total_cost, 0);
  const players = new Set(games.flatMap((g) => g.players.map((p) => p.player_key)));

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div>
            <div className="sheet-title">ประวัติการเล่น</div>
            <div className="sheet-subtitle">{thaiLongDate(dateKey)}</div>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </div>

        {games.length === 0 ? (
          <div className="empty-state">
            ไม่มีเกมในวันนี้
            <div className="balance-label" style={{ marginTop: '0.5rem' }}>
              หากต้องการบันทึกเกม กดปุ่ม “บันทึกเกม” ที่หน้าปฏิทิน
            </div>
          </div>
        ) : (
          <>
            <div className="calendar-summary-stats" style={{ marginBottom: '1rem' }}>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{games.length}</div>
                <div className="calendar-stat-label">เกม</div>
              </div>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{shuttles}</div>
                <div className="calendar-stat-label">ลูกขนไก่</div>
              </div>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{players.size}</div>
                <div className="calendar-stat-label">ผู้เล่น</div>
              </div>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{cost.toFixed(0)}</div>
                <div className="calendar-stat-label">บาทรวม</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {games.map((game) => (
                <div key={game.game_id} className="sheet-game">
                  <div className="game-card-players">
                    {game.players.map((p, i) => (
                      <span key={i} className="pill">
                        {p.nickname} ({p.department})
                      </span>
                    ))}
                  </div>
                  <div className="game-card-meta">
                    <span>
                      {new Date(game.timestamp).toLocaleTimeString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      น. · {game.shuttles_used} ลูก · รวม {game.total_cost.toFixed(2)} บ.
                    </span>
                  </div>
                  <div className="game-card-meta">
                    <span className="balance-label">
                      ลูกละ {game.price_per_shuttle_at_time.toFixed(2)} บ.
                    </span>
                    <span className="game-card-cost">คนละ {game.cost_per_player.toFixed(2)} บ.</span>
                  </div>
                  <div className="game-card-actions">
                    <button type="button" className="btn btn-sm" onClick={() => onEdit(game)}>
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => onDelete(game)}
                      disabled={busyId === game.game_id}
                    >
                      {busyId === game.game_id ? 'กำลังลบ...' : 'ลบ'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="sheet-actions">
          <button type="button" className="sheet-btn-cancel" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </>
  );
}
