import { useCallback, useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getSetting } from './db';
import type { Theme } from './domain/constants';
import { applyTheme } from './theme';
import { IconChart, IconHome, IconLibrary, IconWallet } from './components/Icons';
import { SettingsCtx } from './components/PageHeader';
import { ToastProvider, useToast } from './components/ui';
import { HomePage } from './features/home/HomePage';
import { LibraryPage } from './features/library/LibraryPage';
import { LedgerPage } from './features/ledger/LedgerPage';
import { StatsPage } from './features/stats/StatsPage';
import { SettingsSheet } from './features/settings/SettingsSheet';
import { EditorsProvider } from './features/ledger/Editors';
import { LedgerDataProvider } from './features/ledger/LedgerData';

const TABS = [
  { to: '/', label: '首頁', Icon: IconHome },
  { to: '/library', label: '資源庫', Icon: IconLibrary },
  { to: '/ledger', label: '記帳', Icon: IconWallet },
  { to: '/stats', label: '統計', Icon: IconChart }
];

function TabBar() {
  return (
    <nav className="tabbar" aria-label="主要導覽">
      {TABS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Shows "new version" without reloading on its own, so typing is never interrupted (requirements SYS-05). */
function UpdatePrompt() {
  const toast = useToast();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  useEffect(() => {
    if (needRefresh) toast('有新版本可以使用。', { sticky: true, action: { label: '重新載入', run: () => updateServiceWorker(true) } });
  }, [needRefresh, toast, updateServiceWorker]);
  return null;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    // The database is the source of truth for the theme; localStorage only avoids a flash on launch.
    getSetting<Theme>('theme', 'system').then(applyTheme);
  }, []);

  return (
    <ToastProvider>
      <LedgerDataProvider>
        <EditorsProvider>
          <SettingsCtx.Provider value={openSettings}>
            <HashRouter>
              <div className="app">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/ledger" element={<LedgerPage />} />
                  <Route path="/stats" element={<StatsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                <TabBar />
              </div>
            </HashRouter>
            <SettingsSheet open={settingsOpen} onClose={closeSettings} />
            <UpdatePrompt />
          </SettingsCtx.Provider>
        </EditorsProvider>
      </LedgerDataProvider>
    </ToastProvider>
  );
}
