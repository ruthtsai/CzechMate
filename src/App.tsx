import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getSetting } from './db';
import type { Theme } from './domain/constants';
import { applyTheme } from './theme';
import { IconChart, IconHome, IconLibrary, IconWallet } from './components/Icons';
import { SettingsCtx, type SettingsScreen } from './components/PageHeader';
import { ToastProvider, useToast } from './components/ui';
import { HomePage } from './features/home/HomePage';
import { EditorsProvider } from './features/ledger/Editors';
import { LedgerDataProvider } from './features/ledger/LedgerData';
import { ResourceEditorsProvider } from './features/library/ResourceEditors';
import { SyncManager } from './features/sync/SyncManager';
import { HandbookReaderProvider } from './features/library/HandbookReader';

// The home page ships in the main bundle; other tabs and settings load on first visit (precached for offline use).
const LibraryPage = lazy(() => import('./features/library/LibraryPage').then(m => ({ default: m.LibraryPage })));
const LedgerPage = lazy(() => import('./features/ledger/LedgerPage').then(m => ({ default: m.LedgerPage })));
const StatsPage = lazy(() => import('./features/stats/StatsPage').then(m => ({ default: m.StatsPage })));
const SettingsSheet = lazy(() => import('./features/settings/SettingsSheet').then(m => ({ default: m.SettingsSheet })));

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
  const [settings, setSettings] = useState<SettingsScreen | null>(null);
  // Mounted on first open and kept, so its state survives closing as before.
  const [settingsUsed, setSettingsUsed] = useState(false);
  const openSettings = useCallback((screen: SettingsScreen = 'main') => {
    setSettingsUsed(true);
    setSettings(screen);
  }, []);
  const closeSettings = useCallback(() => setSettings(null), []);

  useEffect(() => {
    // The database is the source of truth for the theme; localStorage only avoids a flash on launch.
    getSetting<Theme>('theme', 'system').then(applyTheme);
  }, []);

  return (
    <ToastProvider>
      <LedgerDataProvider>
        <EditorsProvider>
          <ResourceEditorsProvider>
          <HandbookReaderProvider>
              <SettingsCtx.Provider value={openSettings}>
                <HashRouter>
                  <div className="app">
                    <Suspense fallback={<div className="page" />}>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/library" element={<LibraryPage />} />
                      <Route path="/ledger" element={<LedgerPage />} />
                      <Route path="/stats" element={<StatsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                    </Suspense>
                    <TabBar />
                  </div>
                </HashRouter>
                {settingsUsed && (
                  <Suspense fallback={null}>
                    <SettingsSheet open={settings !== null} initialScreen={settings ?? 'main'} onClose={closeSettings} />
                  </Suspense>
                )}
                <UpdatePrompt />
                <SyncManager />
              </SettingsCtx.Provider>
          </HandbookReaderProvider>
          </ResourceEditorsProvider>
        </EditorsProvider>
      </LedgerDataProvider>
    </ToastProvider>
  );
}
