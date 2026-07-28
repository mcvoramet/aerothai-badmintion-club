import { useEffect, useState, type FormEvent } from 'react';
import { getSettings, updateSettings, verifyPassword } from '../api/appsScript';

const UNLOCK_KEY = 'aerothai-settings-unlocked';

export default function SettingsView() {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(UNLOCK_KEY) === '1'
  );

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  }
  return <SettingsForm onLock={() => setUnlocked(false)} />;
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await verifyPassword(password);
      sessionStorage.setItem(UNLOCK_KEY, '1');
      onUnlock();
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

function SettingsForm({ onLock }: { onLock: () => void }) {
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

      <button type="button" className="btn btn-block" onClick={lock}>
        🔒 ล็อกหน้าตั้งค่า
      </button>
    </>
  );
}
