import { useEffect, useState } from 'react';
import type { Player, PlayerInput } from '../types';
import type { SimilarPlayer } from '../lib/similarNames';

/** One typed name that reads like somebody already in the book. */
export interface NameConflict {
  /** Index of the player slot in the form the name was typed into. */
  slot: number;
  input: PlayerInput;
  candidates: SimilarPlayer[];
}

export type MergeDecision =
  /** Same person — keep the name already on file, drop the one just typed. */
  | { type: 'keep-existing'; target: Player }
  /** Same person — move their history onto the name just typed. */
  | { type: 'use-new-name'; target: Player }
  /** Two different people who happen to sound alike. Asked once, then remembered. */
  | { type: 'distinct' };

interface Props {
  conflict: NameConflict;
  /** Position in the queue, so a four-player game doesn't feel like a loop. */
  index: number;
  total: number;
  busy: boolean;
  error: string | null;
  onDecide: (decision: MergeDecision) => void;
  onCancel: () => void;
}

const fullName = (p: { nickname: string; department: string }) =>
  `${p.nickname} (${p.department})`;

export default function MergeNameDialog({
  conflict,
  index,
  total,
  busy,
  error,
  onDecide,
  onCancel,
}: Props) {
  // Whichever existing player looked most alike is pre-selected; a second
  // candidate is rare, and picking one shouldn't be work.
  const [targetKey, setTargetKey] = useState(conflict.candidates[0].player.player_key);
  const target =
    conflict.candidates.find((c) => c.player.player_key === targetKey)?.player ??
    conflict.candidates[0].player;

  useEffect(() => {
    setTargetKey(conflict.candidates[0].player.player_key);
  }, [conflict]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <>
      <div className="merge-backdrop" />
      <div className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title">
        <div className="merge-head">
          <div>
            <div className="sheet-title" id="merge-title">
              ชื่อนี้อาจเป็นคนเดียวกัน
            </div>
            <div className="sheet-subtitle">
              พบชื่อที่คล้ายกับ <strong>{conflict.input.nickname}</strong> อยู่แล้ว
              {total > 1 && ` · ${index + 1}/${total}`}
            </div>
          </div>
        </div>

        <div className="merge-compare">
          <div className="merge-side">
            <span className="merge-side-label">ชื่อที่พิมพ์</span>
            <strong>{conflict.input.nickname}</strong>
            <span className="pill">{conflict.input.department}</span>
          </div>
          <span className="merge-vs">≟</span>
          <div className="merge-side">
            <span className="merge-side-label">มีอยู่แล้ว</span>
            <strong>{target.nickname}</strong>
            <span className="pill">{target.department}</span>
            <span className="merge-side-meta">{target.games_count} เกม</span>
          </div>
        </div>

        {conflict.candidates.length > 1 && (
          <ul className="merge-candidates">
            {conflict.candidates.map(({ player }) => (
              <li key={player.player_key}>
                <label className={player.player_key === targetKey ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="merge-target"
                    checked={player.player_key === targetKey}
                    disabled={busy}
                    onChange={() => setTargetKey(player.player_key)}
                  />
                  <span>
                    {player.nickname} <span className="pill">{player.department}</span>
                  </span>
                  <span className="merge-side-meta">{player.games_count} เกม</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="error-banner">{error}</div>}

        <div className="merge-actions">
          <button
            type="button"
            className="merge-btn is-primary"
            disabled={busy}
            onClick={() => onDecide({ type: 'keep-existing', target })}
          >
            <span className="merge-btn-title">รวมกัน — ใช้ชื่อเดิม “{target.nickname}”</span>
            <span className="merge-btn-note">
              ประวัติและยอดค้างของทั้งสองชื่อจะรวมเป็นคนเดียว โดยใช้ชื่อที่มีอยู่แล้ว
            </span>
          </button>

          <button
            type="button"
            className="merge-btn"
            disabled={busy}
            onClick={() => onDecide({ type: 'use-new-name', target })}
          >
            <span className="merge-btn-title">
              รวมกัน — เปลี่ยนเป็นชื่อใหม่ “{conflict.input.nickname}”
            </span>
            <span className="merge-btn-note">
              รวมเป็นคนเดียวเหมือนกัน แต่เปลี่ยนชื่อ {fullName(target)} เป็นชื่อที่เพิ่งพิมพ์
              (ทุกเกมและการชำระเงินที่ผ่านมาจะเปลี่ยนตาม)
            </span>
          </button>

          <button
            type="button"
            className="merge-btn"
            disabled={busy}
            onClick={() => onDecide({ type: 'distinct' })}
          >
            <span className="merge-btn-title">คนละคน — บันทึกแยกกัน</span>
            <span className="merge-btn-note">
              เก็บทั้งสองชื่อไว้แยกกัน และจะไม่ถามคู่นี้อีก
            </span>
          </button>
        </div>

        <button type="button" className="sheet-btn-cancel" disabled={busy} onClick={onCancel}>
          {busy ? 'กำลังรวมข้อมูล...' : 'ย้อนกลับไปแก้ไข'}
        </button>
      </div>
    </>
  );
}
