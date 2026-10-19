import type { Theme } from './domain/constants';

// Light/dark backgrounds used for the iOS status bar (meta theme-color).
const BAR = { light: '#F5F3EB', dark: '#17211B' };
const media = window.matchMedia('(prefers-color-scheme: dark)');
let current: Theme = 'system';

function syncStatusBar() {
  const dark = current === 'dark' || (current === 'system' && media.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? BAR.dark : BAR.light);
}

export function applyTheme(theme: Theme) {
  current = theme;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('cm-theme', theme); // read synchronously on next launch to avoid a flash
  } catch {
    /* storage can be unavailable; the database copy still applies after load */
  }
  syncStatusBar();
}

export function applyCachedTheme() {
  let t: string | null = null;
  try {
    t = localStorage.getItem('cm-theme');
  } catch {
    /* ignore */
  }
  applyTheme(t === 'light' || t === 'dark' ? t : 'system');
  media.addEventListener('change', syncStatusBar);
}
