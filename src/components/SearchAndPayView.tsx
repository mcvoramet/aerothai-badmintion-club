import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOutstanding, getSettings } from '../api/appsScript';
import PaySheet from './PaySheet';
import type { OutstandingPlayer } from '../types';

export default function SearchAndPayView() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<OutstandingPlayer[]>([]);
  const [paymentDetails, setPaymentDetails] = useState('');
  const [selected, setSelected] = useState<OutstandingPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, settings] = await Promise.all([getOutstanding(), getSettings()]);
      setRows(list);
      setPaymentDetails(settings.payment_details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายชื่อค้างชำระไม่สำเร็จ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) => r.nickname.includes(q) || r.department.includes(q));
  }, [rows, query]);

  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <>
      <div className="card">
        <h2>ค้างชำระ</h2>

        <div className="sheet-field">
          <label htmlFor="search-player">ค้นหาชื่อเล่น หรือ กอง</label>
          <input
            id="search-player"
            type="text"
            placeholder="พิมพ์เพื่อค้นหา หรือเลือกจากรายชื่อด้านล่าง"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && (
          <div className="error-banner" style={{ marginTop: '0.75rem' }}>
            {error}
          </div>
        )}
        {loading && <p className="balance-label">กำลังโหลด...</p>}

        {!loading && !error && rows.length === 0 && (
          <div className="empty-state">🎉 ทุกคนชำระครบแล้ว</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div className="rank-summary">
              <span>ค้างชำระ {rows.length} คน</span>
              <span className="game-card-cost">รวม {total.toFixed(2)} บาท</span>
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">ไม่พบผู้เล่นที่ค้นหา</div>
            ) : (
              <ul className="rank-list">
                {filtered.map((row) => {
                  const rank = rows.indexOf(row) + 1;
                  return (
                    <li key={row.player_key} className="rank-card">
                      <div className="rank-head">
                        <span className={`rank-badge${rank <= 3 ? ' top' : ''}`}>{rank}</span>
                        <span className="rank-name">
                          {row.nickname}
                          <span className="balance-label"> {row.department}</span>
                        </span>
                        <span className="rank-amount">{row.balance.toFixed(2)} ฿</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-block rank-pay-btn"
                        onClick={() => setSelected(row)}
                      >
                        ยืนยันชำระเงิน
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {selected && (
        <PaySheet
          player={selected}
          paymentDetails={paymentDetails}
          onClose={() => setSelected(null)}
          onPaid={async () => {
            setSelected(null);
            await load();
          }}
        />
      )}
    </>
  );
}
