import { useEffect, useState } from 'react';
import { confirmPayment, getPlayerBalance } from '../api/appsScript';
import type { Game, OutstandingPlayer, PaymentMethod, PlayerBalance } from '../types';

interface Props {
  player: OutstandingPlayer;
  paymentDetails: string;
  onClose: () => void;
  onPaid: () => void;
}

interface Slip {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

const SLIP_MAX_EDGE = 1280;

function thaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Phone cameras produce 4–12MP files. Downscaling before upload keeps the
// base64 payload small enough that the Apps Script round trip stays quick, and
// a 1280px slip is still comfortably readable in LINE.
async function prepareSlip(file: File): Promise<Slip> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, SLIP_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('อ่านไฟล์รูปไม่สำเร็จ');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
}

// Slots this person held in the game. Two when they covered someone else's
// share, and then they owe two of its shares — the row has to say so, or it
// won't add up to the total above it.
function sharesIn(game: Game, playerKey: string) {
  return game.players.filter((p) => p.player_key === playerKey).length;
}

export default function PaySheet({ player, paymentDetails, onClose, onPaid }: Props) {
  const [detail, setDetail] = useState<PlayerBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [preparingSlip, setPreparingSlip] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('transfer');

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

  async function handleSlipChange(file: File | undefined) {
    if (!file) return;
    setPreparingSlip(true);
    setError(null);
    try {
      setSlip(await prepareSlip(file));
    } catch {
      setError('อ่านไฟล์รูปไม่สำเร็จ กรุณาเลือกรูปภาพอื่น');
    } finally {
      setPreparingSlip(false);
    }
  }

  const isCash = method === 'cash';

  async function handleConfirm() {
    if (!detail || (!isCash && !slip)) return;
    if (
      !window.confirm(
        `ยืนยันว่า ${detail.nickname} (${detail.department}) ชำระเงิน ${detail.balance.toFixed(
          2
        )} บาท แล้ว?\n\n${
          isCash ? 'จะแจ้งเข้ากลุ่ม LINE ว่าชำระด้วยเงินสด' : 'สลิปจะถูกส่งเข้ากลุ่ม LINE'
        }`
      )
    )
      return;
    setSettling(true);
    setError(null);
    try {
      const result = await confirmPayment({
        playerKey: player.player_key,
        method,
        slipBase64: isCash ? undefined : slip?.base64,
        slipMimeType: isCash ? undefined : slip?.mimeType,
      });
      // The payment is recorded either way; only the group message can fail.
      if (result.warning) window.alert(result.warning);
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
                {detail.games.map((game) => {
                  const shares = sharesIn(game, detail.player_key);
                  return (
                    <div key={game.game_id} className="pay-game-row">
                      <span>{thaiDate(game.timestamp)}</span>
                      <span className="balance-label">
                        {game.shuttles_used} ลูก{shares > 1 ? ` · ${shares} ส่วน` : ''}
                      </span>
                      <span className="game-card-cost">
                        {(game.cost_per_player * shares).toFixed(2)} ฿
                      </span>
                    </div>
                  );
                })}
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

            <div className="pay-slip">
              <div className="sheet-existing-head">
                <span>วิธีชำระเงิน</span>
              </div>

              <div className="pay-method" role="radiogroup" aria-label="วิธีชำระเงิน">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isCash}
                  className={`pay-method-btn${!isCash ? ' is-active' : ''}`}
                  onClick={() => setMethod('transfer')}
                  disabled={settling}
                >
                  🏦 โอนเงิน
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isCash}
                  className={`pay-method-btn${isCash ? ' is-active' : ''}`}
                  onClick={() => setMethod('cash')}
                  disabled={settling}
                >
                  💵 จ่ายเงินสด
                </button>
              </div>

              {isCash ? (
                <p className="balance-label" style={{ marginTop: '0.7rem' }}>
                  จ่ายเงินสดไม่ต้องแนบสลิป — บอทจะโพสต์เข้ากลุ่ม LINE ว่า “ชำระด้วยเงินสด 💵”
                </p>
              ) : (
                <>
                  <div className="sheet-existing-head" style={{ marginTop: '0.9rem' }}>
                    <span>แนบสลิปหลักฐานการโอนเงิน</span>
                  </div>
                  {slip ? (
                    <div className="pay-slip-preview">
                      <img src={slip.dataUrl} alt="สลิปที่แนบ" />
                      <button
                        type="button"
                        className="btn pay-slip-remove"
                        onClick={() => setSlip(null)}
                        disabled={settling}
                      >
                        เลือกรูปใหม่
                      </button>
                    </div>
                  ) : (
                    <label className="pay-slip-drop">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleSlipChange(e.target.files?.[0])}
                        disabled={settling || preparingSlip}
                      />
                      <span className="pay-note-icon" aria-hidden="true">
                        🧾
                      </span>
                      <span>
                        {preparingSlip ? 'กำลังเตรียมรูป...' : 'แตะเพื่อถ่ายรูปหรือเลือกสลิป'}
                      </span>
                    </label>
                  )}
                  <p className="balance-label" style={{ marginTop: '0.6rem' }}>
                    เมื่อกดยืนยัน บอทจะโพสต์ “ยืนยันชำระแล้ว” พร้อมสลิปนี้เข้ากลุ่ม LINE
                    ระบบไม่ได้เก็บไฟล์สลิปไว้
                  </p>
                </>
              )}
            </div>

            <div className="sheet-actions">
              <button type="button" className="sheet-btn-cancel" onClick={onClose}>
                ปิด
              </button>
              <button
                type="button"
                className="sheet-btn-save"
                onClick={handleConfirm}
                disabled={settling || preparingSlip || (!isCash && !slip) || detail.balance <= 0}
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
