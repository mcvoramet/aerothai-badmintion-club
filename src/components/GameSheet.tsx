import { useEffect, useState, type FormEvent } from 'react';
import { addGame, editGame, getSettings } from '../api/appsScript';
import type { Game, Player, PlayerInput } from '../types';

const MAX_PLAYERS = 4;

interface Props {
  initialDate: string;
  editingGame: Game | null;
  players: Player[];
  onClose: () => void;
  onSaved: () => void;
}

function emptySlots(): PlayerInput[] {
  return [
    { nickname: '', department: '' },
    { nickname: '', department: '' },
    { nickname: '', department: '' },
    { nickname: '', department: '' },
  ];
}

function dateKeyOf(iso: string) {
  const t = new Date(iso);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(
    t.getDate()
  ).padStart(2, '0')}`;
}

// Builds an ISO timestamp on the chosen day, keeping a sensible clock time so
// games logged for past days still sort naturally.
function timestampFor(dateKey: string, keepTimeFrom?: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const src = keepTimeFrom ? new Date(keepTimeFrom) : new Date();
  return new Date(y, m - 1, d, src.getHours(), src.getMinutes(), src.getSeconds()).toISOString();
}

export default function GameSheet({ initialDate, editingGame, players, onClose, onSaved }: Props) {
  const [slots, setSlots] = useState<PlayerInput[]>(() =>
    editingGame
      ? editingGame.players.map((p) => ({ nickname: p.nickname, department: p.department }))
      : emptySlots()
  );
  const [shuttles, setShuttles] = useState(
    editingGame ? String(editingGame.shuttles_used) : ''
  );
  const [date, setDate] = useState(
    editingGame ? dateKeyOf(editingGame.timestamp) : initialDate
  );
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing keeps the game's frozen price; new games preview at the current rate.
  const [price, setPrice] = useState<number | null>(
    editingGame ? editingGame.price_per_shuttle_at_time : null
  );

  useEffect(() => {
    if (editingGame) return;
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setPrice(s.price_per_shuttle);
      })
      .catch(() => {
        /* preview is optional — saving still works */
      });
    return () => {
      cancelled = true;
    };
  }, [editingGame]);

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

  function updateSlot(i: number, value: PlayerInput) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  function addSlot() {
    setSlots((prev) =>
      prev.length >= MAX_PLAYERS ? prev : [...prev, { nickname: '', department: '' }]
    );
  }

  function removeSlot(i: number) {
    setSlots((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
    setActiveSlot(null);
  }

  function suggestionsFor(i: number) {
    const q = slots[i].nickname.trim();
    const list = q ? players.filter((p) => p.nickname.includes(q)) : players;
    return list.slice(0, 5);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (slots.length < 1) {
      setError('ต้องมีผู้เล่นอย่างน้อย 1 คน');
      return;
    }
    if (slots.some((s) => !s.nickname.trim() || !s.department.trim())) {
      setError('กรุณากรอกชื่อเล่นและกองให้ครบทุกคน (หรือลบช่องที่ไม่ใช้ออก)');
      return;
    }
    const count = Number(shuttles);
    if (!isFinite(count) || count <= 0 || !Number.isInteger(count)) {
      setError('จำนวนลูกขนไก่ต้องเป็นจำนวนเต็มที่มากกว่า 0');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        players: slots,
        shuttles_used: count,
        timestamp: timestampFor(date, editingGame?.timestamp),
      };
      if (editingGame) await editGame(editingGame.game_id, payload);
      else await addGame(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกเกมไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div>
            <div className="sheet-title">{editingGame ? 'แก้ไขเกม' : 'บันทึกเกม'}</div>
            <div className="sheet-subtitle">
              {editingGame
                ? 'แก้ไขข้อมูลเกมที่บันทึกไว้'
                : 'เลือกวันที่และกรอกผู้เล่น 1–4 คน (ค่าลูกขนไก่หารตามจำนวนคน)'}
            </div>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="ปิด">
            ×
          </button>
        </div>

        <form className="sheet-form" onSubmit={handleSubmit}>
          <div className="sheet-field">
            <label htmlFor="sheet-date">วันที่</label>
            <input
              id="sheet-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {slots.map((slot, i) => (
            <div key={i} className="sheet-player">
              <div className="sheet-player-head">
                <span className="sheet-player-index">ผู้เล่นคนที่ {i + 1}</span>
                {slots.length > 1 && (
                  <button
                    type="button"
                    className="sheet-player-remove"
                    onClick={() => removeSlot(i)}
                    aria-label={`ลบผู้เล่นคนที่ ${i + 1}`}
                  >
                    ลบ
                  </button>
                )}
              </div>
              <div className="sheet-grid-2">
                <div className="sheet-field sheet-autocomplete">
                  <label>ชื่อเล่น *</label>
                  <input
                    type="text"
                    placeholder="เช่น เอ"
                    value={slot.nickname}
                    onChange={(e) => updateSlot(i, { ...slot, nickname: e.target.value })}
                    onFocus={() => setActiveSlot(i)}
                    onBlur={() => setTimeout(() => setActiveSlot(null), 150)}
                  />
                  {activeSlot === i && suggestionsFor(i).length > 0 && (
                    <ul className="autocomplete-list">
                      {suggestionsFor(i).map((p) => (
                        <li
                          key={p.player_key}
                          onMouseDown={() =>
                            updateSlot(i, { nickname: p.nickname, department: p.department })
                          }
                        >
                          {p.nickname} <span className="pill">{p.department}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="sheet-field">
                  <label>กอง *</label>
                  <input
                    type="text"
                    placeholder="เช่น กองบริหาร"
                    value={slot.department}
                    onChange={(e) => updateSlot(i, { ...slot, department: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}

          {slots.length < MAX_PLAYERS && (
            <button type="button" className="sheet-add-player" onClick={addSlot}>
              ＋ เพิ่มผู้เล่น ({slots.length}/{MAX_PLAYERS})
            </button>
          )}

          <div className="sheet-field">
            <label htmlFor="sheet-shuttles">จำนวนลูกขนไก่ที่ใช้ *</label>
            <input
              id="sheet-shuttles"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="เช่น 3"
              value={shuttles}
              onChange={(e) => setShuttles(e.target.value)}
            />
          </div>

          {price !== null && Number(shuttles) > 0 && (
            <div className="cost-preview">
              <div className="cost-preview-row">
                <span>
                  {shuttles} ลูก × {price.toFixed(2)} บ.
                </span>
                <strong>{(price * Number(shuttles)).toFixed(2)} บ.</strong>
              </div>
              <div className="cost-preview-row split">
                <span>หารกับผู้เล่น {slots.length} คน</span>
                <strong>คนละ {((price * Number(shuttles)) / slots.length).toFixed(2)} บ.</strong>
              </div>
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          <div className="sheet-actions">
            <button type="button" className="sheet-btn-cancel" onClick={onClose}>
              ยกเลิก
            </button>
            <button type="submit" className="sheet-btn-save" disabled={saving}>
              {saving ? 'กำลังบันทึก...' : editingGame ? 'บันทึกการแก้ไข' : 'บันทึกเกม'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
