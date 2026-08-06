import { useState } from 'react';
import TabBar, { type TabKey } from './components/TabBar';
import CalendarView from './components/CalendarView';
import SearchAndPayView from './components/SearchAndPayView';
import SettingsView from './components/SettingsView';

const TITLES: Record<TabKey, string> = {
  log: 'บันทึกเกม',
  pay: 'ค้นหา & ชำระเงิน',
  settings: 'ตั้งค่า',
};

// The LINE bubble links straight here: ?pay=<player_key> opens that person's pay
// sheet, ?tab=pay just lands on the list. Read once on mount and then scrub the
// query string, so a refresh doesn't reopen a sheet the user already dismissed.
function readDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const payKey = params.get('pay');
  const tab = params.get('tab');
  if (payKey || tab) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return {
    tab: (payKey || tab === 'pay' ? 'pay' : tab === 'settings' ? 'settings' : 'log') as TabKey,
    payKey,
  };
}

export default function App() {
  const [deepLink] = useState(readDeepLink);
  const [tab, setTab] = useState<TabKey>(deepLink.tab);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{TITLES[tab]}</h1>
        <p>AEROTHAI Badminton Club — App คำนวณค่าลูกขนไก่</p>
      </header>

      {tab === 'log' && (
        <div className="view">
          <CalendarView />
        </div>
      )}

      {tab === 'pay' && (
        <div className="view">
          <SearchAndPayView initialPlayerKey={deepLink.payKey} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="view">
          <SettingsView />
        </div>
      )}

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
