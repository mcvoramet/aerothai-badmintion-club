import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOutstanding, getSettings } from '../api/appsScript';
import { readCache, writeCache } from '../lib/cache';
import PaySheet from './PaySheet';
import type { OutstandingPlayer } from '../types';

const CACHE_KEY = 'outstanding';

interface CachedPay {
  rows: OutstandingPlayer[];
  paymentDetails: string;
}

export default function SearchAndPayView({ initialPlayerKey }: { initialPlayerKey?: string | null }) {
  const cached = useMemo(() => readCache<CachedPay>(CACHE_KEY), []);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<OutstandingPlayer[]>(cached?.rows ?? []);
  const [paymentDetails, setPaymentDetails] = useState(cached?.paymentDetails ?? '');
  const [selected, setSelected] = useState<OutstandingPlayer | null>(null);
  // Cached data renders immediately; only a cold start shows a spinner.
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  // Set when a LINE deep link named someone who no longer owes anything.
  const [deepLinkMiss, setDeepLinkMiss] = useState<string | null>(null);
  const [deepLinkDone, setDeepLinkDone] = useState(!initialPlayerKey);
  // Distinct from `loading`, which starts false whenever a cache exists.
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, settings] = await Promise.all([getOutstanding(), getSettings()]);
      setRows(list);
      setPaymentDetails(settings.payment_details);
      writeCache<CachedPay>(CACHE_KEY, { rows: list, paymentDetails: settings.payment_details });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดรายชื่อค้างชำระไม่สำเร็จ');
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Open the pay sheet the LINE link asked for, once the live list has arrived.
  // Runs against fresh rows rather than the cache so a stale bubble can't open a
  // sheet for someone who has already paid.
  useEffect(() => {
    if (deepLinkDone || !loadedOnce || !initialPlayerKey) return;
    const match = rows.find((r) => r.player_key === initialPlayerKey);
    if (match) {
      setSelected(match);
    } else {
      setDeepLinkMiss(initialPlayerKey.split('|')[0] || initialPlayerKey);
    }
    setDeepLinkDone(true);
  }, [deepLinkDone, loadedOnce, initialPlayerKey, rows]);

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
        {deepLinkMiss && (
          <div className="success-banner" style={{ marginTop: '0.75rem' }}>
            {deepLinkMiss} ไม่มียอดค้างชำระแล้ว (รายการใน LINE อาจเป็นข้อมูลเก่า)
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
