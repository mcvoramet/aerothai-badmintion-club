import { useEffect, useState, type FormEvent } from 'react';
import {
  getLineStatus,
  getSettings,
  pushOutstandingToLine,
  updateSettings,
  verifyPassword,
} from '../api/appsScript';
import type { LineStatus } from '../types';

// Holds the verified password for the session, not just an "unlocked" flag:
// pushing to the LINE group is checked server-side, so the value has to survive
// past the gate. It's the same string the client typed and already POSTed to
// verifyPassword.
const UNLOCK_KEY = 'aerothai-settings-unlocked';

export default function SettingsView() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(UNLOCK_KEY));

  if (password === null) {
    return <PasswordGate onUnlock={setPassword} />;
  }
  return <SettingsForm password={password} onLock={() => setPassword(null)} />;
}

function PasswordGate({ onUnlock }: { onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await verifyPassword(password);
      sessionStorage.setItem(UNLOCK_KEY, password);
      onUnlock(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'รหัสผ่านไม่ถูกต้อง');
    } finally {
      setChecking(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>🔒 หน้าตั้งค่า</h2>
      <p className="balance-label" style={{ marginBottom: '1rem' }}>
        กรุณากรอกรหัสผ่านเพื่อเข้าหน้าตั้งค่า
      </p>

      <div className="sheet-field">
        <label htmlFor="settings-password">รหัสผ่าน</label>
        <input
          id="settings-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && (
        <div className="error-banner" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={checking || !password}
        style={{ marginTop: '1rem' }}
      >
        {checking ? 'กำลังตรวจสอบ...' : 'เข้าสู่หน้าตั้งค่า'}
      </button>
    </form>
  );
}

function SettingsForm({ password, onLock }: { password: string; onLock: () => void }) {
  const [price, setPrice] = useState('');
  const [payment, setPayment] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'price' | 'payment' | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const settings = await getSettings();
      setPrice(String(settings.price_per_shuttle));
      setPayment(settings.payment_details);
      setUpdatedAt(settings.updated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดการตั้งค่าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function savePrice() {
    const value = Number(price);
    if (!isFinite(value) || value < 0) {
      setError('กรุณากรอกราคาลูกขนไก่เป็นตัวเลขที่ไม่ติดลบ');
      return;
    }
    setSavingPrice(true);
    setError(null);
    setSaved(null);
    try {
      const settings = await updateSettings({ price_per_shuttle: value });
      setPrice(String(settings.price_per_shuttle));
      setUpdatedAt(settings.updated_at);
      setSaved('price');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingPrice(false);
    }
  }

  async function savePayment() {
    setSavingPayment(true);
    setError(null);
    setSaved(null);
    try {
      const settings = await updateSettings({ payment_details: payment });
      setPayment(settings.payment_details);
      setSaved('payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingPayment(false);
    }
  }

  function lock() {
    sessionStorage.removeItem(UNLOCK_KEY);
    onLock();
  }

  if (loading) {
    return (
      <div className="card">
        <p className="balance-label">กำลังโหลด...</p>
      </div>
    );
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h2>ราคาลูกขนไก่ต่อลูก</h2>
        <div className="sheet-field">
          <label htmlFor="price-per-shuttle">ราคาต่อลูก (บาท)</label>
          <input
            id="price-per-shuttle"
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setSaved(null);
            }}
          />
        </div>

        {saved === 'price' && (
          <div className="success-banner" style={{ marginTop: '0.75rem' }}>
            บันทึกราคาเรียบร้อย
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={savePrice}
          disabled={savingPrice}
          style={{ marginTop: '0.75rem' }}
        >
          {savingPrice ? 'กำลังบันทึก...' : 'บันทึกราคา'}
        </button>

        {updatedAt && (
          <p className="balance-label" style={{ marginTop: '0.75rem' }}>
            แก้ไขล่าสุด: {new Date(updatedAt).toLocaleString('th-TH')}
          </p>
        )}
        <p className="balance-label">
          หมายเหตุ: การเปลี่ยนราคาจะมีผลกับเกมที่บันทึกใหม่เท่านั้น เกมที่บันทึกไปแล้วจะไม่ถูกคิดราคาย้อนหลัง
        </p>
      </div>

      <div className="card">
        <h2>รายละเอียดบัญชีรับชำระเงิน</h2>
        <p className="balance-label" style={{ marginBottom: '0.6rem' }}>
          ข้อความนี้จะแสดงให้ผู้เล่นเห็นตอนกดชำระเงิน
        </p>
        <div className="sheet-field">
          <label htmlFor="payment-details">ข้อมูลบัญชี (พิมพ์ได้อิสระ)</label>
          <textarea
            id="payment-details"
            rows={6}
            className="textarea-input"
            placeholder={'ธนาคาร: \nเลขที่บัญชี: \nชื่อบัญชี: \nพร้อมเพย์: '}
            value={payment}
            onChange={(e) => {
              setPayment(e.target.value);
              setSaved(null);
            }}
          />
        </div>

        {saved === 'payment' && (
          <div className="success-banner" style={{ marginTop: '0.75rem' }}>
            บันทึกข้อมูลบัญชีเรียบร้อย
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={savePayment}
          disabled={savingPayment}
          style={{ marginTop: '0.75rem' }}
        >
          {savingPayment ? 'กำลังบันทึก...' : 'บันทึกข้อมูลบัญชี'}
        </button>
      </div>

      <LineNotifyCard password={password} />

      <button type="button" className="btn btn-block" onClick={lock}>
        🔒 ล็อกหน้าตั้งค่า
      </button>
    </>
  );
}

function LineNotifyCard({ password }: { password: string }) {
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      setStatus(await getLineStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อ่านสถานะ LINE ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    // Posts publicly into the club's group chat — worth a second tap.
    if (!window.confirm('ส่งรายชื่อคนค้างชำระเข้ากลุ่ม LINE เลยไหม?')) return;
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const result = await pushOutstandingToLine(password);
      setSent(result.sent);
      setStatus(await getLineStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งเข้ากลุ่ม LINE ไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  const ready = status?.configured && status?.linked;

  return (
    <div className="card">
      <h2>📣 แจ้งเตือนกลุ่ม LINE</h2>
      <p className="balance-label" style={{ marginBottom: '0.6rem' }}>
        ส่งรายชื่อคนค้างชำระ 10 อันดับแรกเข้ากลุ่ม LINE โดยแต่ละคนมีปุ่ม "ชำระเงิน" ที่กดแล้วเปิดแอป
        พร้อมหน้าจ่ายเงินของคนนั้นให้เลย
      </p>

      {status?.trigger_words?.length ? (
        <p className="balance-label" style={{ marginBottom: '0.6rem' }}>
          หรือพิมพ์{' '}
          {status.trigger_words.map((word, i) => (
            <span key={word}>
              {i > 0 && ' หรือ '}
              <code className="line-trigger">{word}</code>
            </span>
          ))}{' '}
          ในกลุ่ม LINE บอทก็จะส่งรายการให้ทันที
        </p>
      ) : null}

      {loading ? (
        <p className="balance-label">กำลังตรวจสอบสถานะ...</p>
      ) : (
        <p className={`line-status ${ready ? 'is-ready' : 'is-pending'}`}>
          {!status?.configured
            ? '⚠️ ยังไม่ได้ตั้งค่า — ใส่ LINE_CHANNEL_ACCESS_TOKEN และ LINE_WEBHOOK_TOKEN ใน Script Properties'
            : !status?.linked
              ? '⚠️ ยังไม่ได้เชื่อมกลุ่ม — เพิ่มบอทเข้ากลุ่มแล้วพิมพ์อะไรก็ได้ 1 ครั้ง'
              : '✅ พร้อมส่ง'}
        </p>
      )}

      {error && (
        <div className="error-banner" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      {sent !== null && (
        <div className="success-banner" style={{ marginTop: '0.75rem' }}>
          {sent > 0 ? `ส่งรายชื่อค้างชำระ ${sent} คนเข้ากลุ่มแล้ว` : 'ส่งแล้ว — ตอนนี้ไม่มีใครค้างชำระ'}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={send}
        disabled={sending || loading || !ready}
        style={{ marginTop: '0.75rem' }}
      >
        {sending ? 'กำลังส่ง...' : 'ส่งรายชื่อค้างชำระเข้ากลุ่ม LINE'}
      </button>

      {status?.last_pushed_at && (
        <p className="balance-label" style={{ marginTop: '0.75rem' }}>
          ส่งล่าสุด: {new Date(status.last_pushed_at).toLocaleString('th-TH')}
        </p>
      )}
    </div>
  );
}
