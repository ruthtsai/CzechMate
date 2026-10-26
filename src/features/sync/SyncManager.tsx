import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { sheetsLink, type TickReason } from '../../db/sheetsLink';

// Runs Google Sheets sync in the background (requirements GS-04, RS-01, RS-03). What runs when is decided by
// sheetsLink.tick; this only passes it the browser's events and keeps the timer it asks for.

const EVENT = 'czechmate-sync';

/** Ask the sync manager to send queued resources now (e.g. right after a quick add). */
export const requestSheetsSync = () => window.dispatchEvent(new Event(EVENT));

export function SyncManager() {
  // Changes to any part of the ledger, budget and key dates included.
  const ledger = useLiveQuery(sheetsLink.ledgerSnapshot, []);
  const timer = useRef<number>();
  const seenLedger = useRef(false);
  const alive = useRef(true);

  async function tick(reason: TickReason) {
    const { wakeAt } = await sheetsLink.tick(reason);
    if (!alive.current) return;
    window.clearTimeout(timer.current);
    if (wakeAt !== undefined) timer.current = window.setTimeout(() => tick('timer'), Math.max(0, wakeAt - Date.now()));
  }

  useEffect(() => {
    if (!ledger) return;
    if (!seenLedger.current) {
      seenLedger.current = true;
      return;
    }
    tick('ledgerChanged');
  }, [ledger]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && tick('visible');
    const onOnline = () => tick('online');
    const onRequest = () => tick('requested');
    alive.current = true;
    tick('start');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener(EVENT, onRequest);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(EVENT, onRequest);
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}
