import { useEffect, useState } from 'react';
import { getPlayerBalance, settlePlayer } from '../api/appsScript';
import type { OutstandingPlayer, PlayerBalance } from '../types';

interface Props {
  player: OutstandingPlayer;
  paymentDetails: string;
  onClose: () => void;
  onPaid: () => void;
}

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PaySheet({ player, paymentDetails, onClose, onPaid }: Props) {
  const [detail, setDetail] = useState<PlayerBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await getPlayerBalance(player.player_key);
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [player.player_key]);

  async function handleConfirm() {
    if (!detail) return;
    if (
      !window.confirm(
        `ยืนยันว่า ${detail.nickname} (${detail.department}) ชำระเงิน ${detail.balance.toFixed(
          2
        )} บาท แล้ว?`
      )
    )
      return;
    setSettling(true);
    setError(null);
    try {
      await settlePlayer(player.player_key);
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการชำระเงินไม่สำเร็จ');
      setSettling(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div>
            <div className="sheet-title">{player.nickname}</div>
            <div className="sheet-subtitle">{player.department}</div>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </div>

        {loading && <p className="balance-label">กำลังโหลด...</p>}
        {error && <div className="error-banner">{error}</div>}

        {detail && !loading && (
          <>
            <div className="balance-display">
              <div className="balance-amount">{detail.balance.toFixed(2)} บาท</div>
              <div className="balance-label">ยอดค้างชำระทั้งหมด</div>
            </div>

            <div className="calendar-summary-stats">
              <div className="calendar-stat">
                <div className="calendar-stat-value">{detail.unpaid_games}</div>
                <div className="calendar-stat-label">เกมที่ค้าง</div>
              </div>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{detail.unpaid_shuttles}</div>
                <div className="calendar-stat-label">ลูกขนไก่</div>
              </div>
              <div className="calendar-stat">
                <div className="calendar-stat-value">{detail.games_count}</div>
                <div className="calendar-stat-label">เกมทั้งหมด</div>
              </div>
            </div>

            <div className="pay-meta">
              {detail.unpaid_from && detail.unpaid_to && (
                <div>
                  <span className="balance-label">ช่วงวันที่ค้างชำระ</span>
                  <strong>
                    {thaiDate(detail.unpaid_from)} – {thaiDate(detail.unpaid_to)}
                  </strong>
                </div>
              )}
              <div>
                <span className="balance-label">ชำระล่าสุด</span>
                <strong>
                  {detail.last_settled_at ? thaiDate(detail.last_settled_at) : 'ยังไม่เคยชำระ'}
                </strong>
              </div>
            </div>

            {detail.games.length > 0 && (
              <div className="pay-games">
                <div className="sheet-existing-head">
                  <span>รายการเกมที่ค้างชำระ</span>
                </div>
                {detail.games.map((game) => (
                  <div key={game.game_id} className="pay-game-row">
                    <span>{thaiDate(game.timestamp)}</span>
                    <span className="balance-label">{game.shuttles_used} ลูก</span>
                    <span className="game-card-cost">{game.cost_per_player.toFixed(2)} ฿</span>
                  </div>
                ))}
              </div>
            )}

            {paymentDetails.trim() && (
              <div className="pay-account">
                <div className="sheet-existing-head">
                  <span>บัญชีรับชำระเงิน</span>
                </div>
                <pre className="pay-account-text">{paymentDetails}</pre>
              </div>
            )}

            <div className="sheet-actions">
              <button type="button" className="sheet-btn-cancel" onClick={onClose}>
                ปิด
              </button>
              <button
                type="button"
                className="sheet-btn-save"
                onClick={handleConfirm}
                disabled={settling || detail.balance <= 0}
              >
                {settling ? 'กำลังบันทึก...' : 'ยืนยันว่าชำระแล้ว'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
