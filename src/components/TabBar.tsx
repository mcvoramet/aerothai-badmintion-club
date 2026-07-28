export type TabKey = 'log' | 'pay' | 'settings';

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { key: 'log', label: 'บันทึกเกม', icon: '🏸' },
  { key: 'pay', label: 'ค้นหา & จ่าย', icon: '💸' },
  { key: 'settings', label: 'ตั้งค่า', icon: '⚙️' },
];

interface TabBarProps {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export default function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`tab-bar-item${active === tab.key ? ' active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <span className="tab-bar-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
