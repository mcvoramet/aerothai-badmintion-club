import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addGame, editGame, mergePlayers } from '../api/appsScript';
import { findSimilarPlayers, markDistinct, playerKeyOf } from '../lib/similarNames';
import MergeNameDialog, { type MergeDecision, type NameConflict } from './MergeNameDialog';
import type { Game, Player, PlayerInput } from '../types';

const MAX_PLAYERS = 4;

interface Props {
  initialDate: string;
  editingGame: Game | null;
  players: Player[];
  /** Current rate, already loaded with the calendar — avoids a round trip
   *  just to render the cost preview. Editing uses the game's frozen price. */
  pricePerShuttle: number | null;
  /** `playersMerged` is true when names were merged before the sheet closed —
   *  the merge stands even if the game was never saved. */
  onClose: (playersMerged: boolean) => void;
  /**
   * `lineWarning` is set when an edit saved but the LINE group wasn't told.
   * `playersMerged` means two people were folded into one on the way to saving,
   * which rewrites keys across the whole sheet — the caller's cached month is
   * stale and has to be re-read.
   */
  onSaved: (saved: Game, lineWarning: string | null, playersMerged: boolean) => void;
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

export default function GameSheet({
  initialDate,
  editingGame,
  players,
  pricePerShuttle,
  onClose,
  onSaved,
}: Props) {
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
  // Set once a name turns out to look like someone already in the book. The
  // cleaned slots ride along, because answering the question rewrites them and
  // nothing is saved until the last one is answered.
  const [pending, setPending] = useState<{
    slots: PlayerInput[];
    queue: NameConflict[];
    /** Questions in the original batch, so the counter doesn't count down. */
    total: number;
  } | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // A ref, not state: the save fires in the same tick as the last merge.
  const mergedAny = useRef(false);
  const close = () => onClose(mergedAny.current);
  // Editing keeps the game's frozen price; new games preview at the current rate.
  const price = editingGame ? editingGame.price_per_shuttle_at_time : pricePerShuttle;

  // Read inside the key handler, which is registered once and must not see a
  // stale `pending` — or a `close` bound to a merge that hadn't happened yet.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      // While the merge question is up it owns Escape — closing the whole form
      // underneath it would throw away everything typed.
      if (e.key === 'Escape' && !pendingRef.current) closeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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

  // Anyone holding more than one slot, with how many shares they carry — the
  // cost preview says "คนละ X" and that stops being true for them.
  function extraShares() {
    const counts = new Map<string, { nickname: string; shares: number }>();
    for (const slot of slots) {
      const nickname = slot.nickname.trim();
      if (!nickname || !slot.department.trim()) continue;
      const key = playerKeyOf(slot);
      const entry = counts.get(key);
      if (entry) entry.shares++;
      else counts.set(key, { nickname, shares: 1 });
    }
    return [...counts.values()].filter((c) => c.shares > 1);
  }

  function validate(cleaned: PlayerInput[]): string | null {
    if (cleaned.length < 1) return 'ต้องมีผู้เล่นอย่างน้อย 1 คน';
    if (cleaned.some((s) => !s.nickname || !s.department)) {
      return 'กรุณากรอกชื่อเล่นและกองให้ครบทุกคน (หรือลบช่องที่ไม่ใช้ออก)';
    }
    const count = Number(shuttles);
    if (!isFinite(count) || count <= 0 || !Number.isInteger(count)) {
      return 'จำนวนลูกขนไก่ต้องเป็นจำนวนเต็มที่มากกว่า 0';
    }
    // A repeated name is allowed on purpose: someone covering a friend's share
    // takes a second slot, and the split charges them for both.
    return null;
  }

  async function save(finalSlots: PlayerInput[]) {
    setSaving(true);
    try {
      const payload = {
        players: finalSlots,
        shuttles_used: Number(shuttles),
        timestamp: timestampFor(date, editingGame?.timestamp),
      };
      if (editingGame) {
        const saved = await editGame(editingGame.game_id, payload);
        onSaved(saved, saved.line_warning, mergedAny.current);
      } else {
        onSaved(await addGame(payload), null, mergedAny.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกเกมไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const cleaned = slots.map((s) => ({
      nickname: s.nickname.trim(),
      department: s.department.trim(),
    }));
    const problem = validate(cleaned);
    if (problem) {
      setError(problem);
      return;
    }

    // Asked before saving, not after: once the game is written, the second name
    // has a history of its own and untangling it is a manual job.
    //
    // One question per name, not per slot — a person entered twice to cover a
    // friend's share shouldn't be asked about twice.
    const asked = new Set<string>();
    const queue = cleaned
      .map((input, slot) => ({ slot, input, candidates: findSimilarPlayers(input, players) }))
      .filter((c) => {
        const key = playerKeyOf(c.input);
        if (!c.candidates.length || asked.has(key)) return false;
        asked.add(key);
        return true;
      });
    if (queue.length) {
      setSlots(cleaned);
      setPending({ slots: cleaned, queue, total: queue.length });
      return;
    }

    await save(cleaned);
  }

  async function handleDecision(decision: MergeDecision) {
    if (!pending) return;
    const [conflict, ...rest] = pending.queue;
    const sourceKey = playerKeyOf(conflict.input);
    setMergeError(null);

    let nextSlots = pending.slots;
    let nextQueue = rest;

    if (decision.type === 'distinct') {
      conflict.candidates.forEach((c) => markDistinct(sourceKey, c.player.player_key));
    } else {
      setMerging(true);
      try {
        const keepNewName = decision.type === 'use-new-name';
        const result = await mergePlayers({
          targetKey: decision.target.player_key,
          // A name typed for the first time isn't in the sheet yet, so there is
          // nothing to move — the merge is only the rename.
          sourceKey: players.some((p) => p.player_key === sourceKey) ? sourceKey : undefined,
          nickname: keepNewName ? conflict.input.nickname : undefined,
          department: keepNewName ? conflict.input.department : undefined,
        });
        mergedAny.current = true;
        const survivor = result.player;
        // Every slot holding that name, not just the one that raised the
        // question: a person covering two shares is still one person.
        nextSlots = pending.slots.map((slot) =>
          playerKeyOf(slot) === sourceKey
            ? { nickname: survivor.nickname, department: survivor.department }
            : slot
        );
        // Questions still in the queue may name a key this merge just retired.
        nextQueue = rest
          .map((c) => {
            const seen = new Set<string>();
            const candidates = c.candidates
              .map((cand) =>
                cand.player.player_key === decision.target.player_key ||
                cand.player.player_key === sourceKey
                  ? { ...cand, player: survivor }
                  : cand
              )
              .filter((cand) => {
                if (cand.player.player_key === playerKeyOf(c.input)) return false;
                if (seen.has(cand.player.player_key)) return false;
                seen.add(cand.player.player_key);
                return true;
              });
            return { ...c, candidates };
          })
          .filter((c) => c.candidates.length > 0);
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : 'รวมชื่อผู้เล่นไม่สำเร็จ');
        return;
      } finally {
        setMerging(false);
      }
    }

    setSlots(nextSlots);
    if (nextQueue.length) {
      setPending({ slots: nextSlots, queue: nextQueue, total: pending.total });
      return;
    }
    setPending(null);
    const problem = validate(nextSlots);
    if (problem) {
      setError(problem);
      return;
    }
    await save(nextSlots);
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={close} />
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
          <button type="button" className="sheet-close" onClick={close} aria-label="ปิด">
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
                <span>หารเป็น {slots.length} ส่วน</span>
                <strong>คนละ {((price * Number(shuttles)) / slots.length).toFixed(2)} บ.</strong>
              </div>
              {extraShares().map((c) => (
                <div key={c.nickname} className="cost-preview-row">
                  <span>
                    {c.nickname} อยู่ {c.shares} ช่อง (ออกแทนเพื่อน)
                  </span>
                  <strong>
                    จ่าย {((price * Number(shuttles) * c.shares) / slots.length).toFixed(2)} บ.
                  </strong>
                </div>
              ))}
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          <div className="sheet-actions">
            <button type="button" className="sheet-btn-cancel" onClick={close}>
              ยกเลิก
            </button>
            <button type="submit" className="sheet-btn-save" disabled={saving}>
              {saving ? 'กำลังบันทึก...' : editingGame ? 'บันทึกการแก้ไข' : 'บันทึกเกม'}
            </button>
          </div>
        </form>
      </div>

      {pending && (
        <MergeNameDialog
          conflict={pending.queue[0]}
          index={pending.total - pending.queue.length}
          total={pending.total}
          busy={merging}
          error={mergeError}
          onDecide={handleDecision}
          onCancel={() => {
            setPending(null);
            setMergeError(null);
          }}
        />
      )}
    </>
  );
}
