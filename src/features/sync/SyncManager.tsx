import { useEffect, useRef } from 'react';
import { db, getSetting, setSetting } from '../../db';
import { refreshNotes } from '../../db/handbook';
import { getSheetsConfig, processOutbox, pullResources, syncLedgerNow } from '../../db/sheetsSync';
import { useLedger } from '../ledger/LedgerData';

// Runs Google Sheets sync in the background (requirements GS-04, RS-01, RS-03).

const LEDGER_DELAY = 30_000;
const PULL_EVERY = 2 * 60_000;
const RETRY_AFTER_FAILURE = 5 * 60_000;
const EVENT = 'czechmate-sync';

/** Ask the sync manager to send queued resources now (e.g. right after a quick add). */
export const requestSheetsSync = () => window.dispatchEvent(new Event(EVENT));

export function SyncManager() {
  const L = useLedger();
  const timer = useRef<number>();
  const busy = useRef(false);
  const lastFailure = useRef(0);
  const lastPull = useRef(0);
  const seenLedger = useRef(false);

  async function run(job: 'ledger' | 'all', force = false) {
    if (busy.current || !navigator.onLine) return;
    if (!force && Date.now() - lastFailure.current < RETRY_AFTER_FAILURE) return;
    const cfg = await getSheetsConfig();
    if (!cfg) return;
    busy.current = true;
    try {
      if (await db.outbox.count()) await processOutbox(cfg);
      const auto = await getSetting<boolean>('gsAutoSync', true);
      if (auto && (await getSetting<boolean>('gsDirty', false))) await syncLedgerNow(cfg);
      if (job === 'all' && (force || Date.now() - lastPull.current > PULL_EVERY)) {
        await pullResources(cfg);
        lastPull.current = Date.now();
        await refreshNotes(await db.resources.toArray());
      }
    } catch {
      lastFailure.current = Date.now(); // the error is saved in settings for the sync screen
    } finally {
      busy.current = false;
    }
  }

  // Any ledger change marks the sheet as stale and syncs 30 s after the last change.
  useEffect(() => {
    if (!L.ready) return;
    if (!seenLedger.current) {
      seenLedger.current = true;
      return;
    }
    let cancelled = false;
    getSheetsConfig().then(cfg => {
      if (!cfg || cancelled) return;
      setSetting('gsDirty', true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => run('ledger', true), LEDGER_DELAY);
    });
    return () => { cancelled = true; };
  }, [L.ready, L.expenses, L.exchanges, L.trips, L.payments, L.categories]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && run('all');
    const onOnline = () => run('all', true);
    const onRequest = () => run('all', true);
    run('all', true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener(EVENT, onRequest);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener(EVENT, onRequest);
      window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}
