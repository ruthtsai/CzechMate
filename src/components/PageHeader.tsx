import { createContext, useContext } from 'react';
import { IconGear } from './Icons';
import { TopBar } from './ui';

export type SettingsScreen = 'main' | 'payments' | 'categories' | 'trips' | 'pins' | 'tags' | 'import' | 'restore';

/** Opens the settings sheet, optionally on a sub-screen. */
export const SettingsCtx = createContext<(screen?: SettingsScreen) => void>(() => {});
export const useOpenSettings = () => useContext(SettingsCtx);

/** Page title bar with the settings button (UI spec 4.1). */
export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  const openSettings = useContext(SettingsCtx);
  return (
    <TopBar
      title={title}
      sub={sub}
      actions={
        <button type="button" className="iconbtn" aria-label="設定" onClick={() => openSettings()}>
          <IconGear />
        </button>
      }
    />
  );
}
