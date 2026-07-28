import { useState } from 'react';
import TabBar, { type TabKey } from './components/TabBar';
import CalendarView from './components/CalendarView';
import StatsView from './components/StatsView';
import SearchAndPayView from './components/SearchAndPayView';
import SettingsView from './components/SettingsView';
import { usePlayers } from './hooks/usePlayers';

const TITLES: Record<TabKey, string> = {
  log: 'บันทึกเกม',
  stats: 'สถิติค่าลูกขนไก่',
  pay: 'ค้นหา & ชำระเงิน',
  settings: 'ตั้งค่า',
};

export default function App() {
  const [tab, setTab] = useState<TabKey>('log');
  const players = usePlayers();

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{TITLES[tab]}</h1>
        <p>ชมรมแบดมินตัน — คำนวณค่าลูกขนไก่</p>
      </header>

      {tab === 'log' && (
        <div className="view">
          <CalendarView
            players={players.players}
            onPlayersChanged={() => {
              void players.refresh();
            }}
          />
        </div>
      )}

      {tab === 'stats' && (
        <div className="view">
          <StatsView />
        </div>
      )}

      {tab === 'pay' && (
        <div className="view">
          <SearchAndPayView />
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
