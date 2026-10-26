import { db, getSetting, setSetting } from './index';
import { refreshNotes } from './handbook';
import {
  getSheetsConfig, migrateAppResources, overwriteSheetLedger, previewRestore, processOutbox, pullResources, readLedger, restoreLedgerFromSheet,
  syncLedgerNow, type PullSummary, type RestoreOffer, type SyncLogEntry
} from './sheetsSync';
import { ledgerFingerprint } from '../domain/ledgerFingerprint';
import { isLinkRecord, LINK_STATE_KEYS, SYNC_PREFERENCE_KEYS } from '../domain/sheetsLinkKeys';
import { DEFAULT_IMAGE_FOLDER, generateSecret, isScriptUrl, normalizeFolderPath, ping, SheetsError, type SheetsConfig } from '../io/sheetsClient';

// The link between this phone and one Google Sheet (see GLOSSARY.md): every action the user takes on it.
// Screens call these actions instead of building a config or writing link state themselves.

export interface ConnectResult {
  name: string;
  /** Set when the sheet holds a ledger this phone has not seen: the user picks restore or overwrite. */
  restoreOffer?: RestoreOffer;
}

/** What the screens show about the link: its link state and the sync preferences, read in one go. */
export interface SheetsLinkStatus {
  /** Linked once a sheet answered; the address and key alone (e.g. from a backup) are not enough. */
  linked: boolean;
  url: string;
  /** This phone's key, filled into the script the user copies. */
  key: string;
  sheetName: string;
  sheetUrl: string;
  resourcesGid: number;
  lastSyncAt?: string;
  lastPullAt?: string;
  lastError: string;
  pullErrors: PullSummary['errors'];
  /** Newest first. */
  log: SyncLogEntry[];
  restoreOffer?: RestoreOffer;
  /** What the deployed script supports and which folder it uses; unset when it never said. */
  scriptFeatures: string[];
  scriptImageFolder?: string;
  autoSync: boolean;
  imageFolder: string;
}

/** Why the background sync was woken: the app starting or coming back, the network returning, the ledger changing, a request, or its own timer. */
export type TickReason = 'start' | 'visible' | 'online' | 'ledgerChanged' | 'requested' | 'timer';

const LEDGER_DELAY = 30_000;
const PULL_EVERY = 2 * 60_000;
const RETRY_AFTER_FAILURE = 5 * 60_000;

/**
 * `remote` replaces the network (e.g. the script running in memory for tests); `now` and `isOnline` replace
 * the clock and the browser's network status.
 */
export function createSheetsLink({ remote, now = Date.now, isOnline = () => navigator.onLine }: {
  remote?: typeof fetch; now?: () => number; isOnline?: () => boolean;
} = {}) {
  // Background sync state, for as long as the app runs.
  let ledgerDueAt: number | undefined;
  let lastFailure = -Infinity;
  let lastPull = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  const secret = async () => {
    let s = await getSetting<string>('gsSecret', '');
    if (!s) await setSetting('gsSecret', (s = generateSecret()));
    return s;
  };
  const config = async () => {
    const cfg = await getSheetsConfig();
    if (!cfg) throw new SheetsError('config', '尚未設定 Google 試算表連結。');
    return { ...cfg, fetch: remote };
  };

  const ledgerNeedsSending = async () => (await getSetting<string>('gsPushedFingerprint', '')) !== ledgerFingerprint(await readLedger());

  async function step(reason: TickReason): Promise<{ wakeAt?: number }> {
    const t = now();
    const cfg = await getSheetsConfig();
    if (!cfg) {
      ledgerDueAt = undefined;
      return {};
    }
    const c = { ...cfg, fetch: remote };
    if (reason === 'ledgerChanged') {
      ledgerDueAt = t + LEDGER_DELAY;
      return { wakeAt: ledgerDueAt };
    }
    const ledgerDue = ledgerDueAt !== undefined && t >= ledgerDueAt;
    if (reason === 'timer' && !ledgerDue) return wake();
    if (ledgerDue) ledgerDueAt = undefined;
    if (!isOnline()) return wake(); // coming back online wakes the sync again
    // These pull right away; the timer's ledger run also skips the wait after a failure, but never pulls.
    const forced = reason === 'start' || reason === 'online' || reason === 'requested';
    if (!forced && !ledgerDue && t - lastFailure < RETRY_AFTER_FAILURE) return wake();
    try {
      if (await db.outbox.count()) await processOutbox(c);
      const auto = await getSetting<boolean>('gsAutoSync', true);
      // While the sheet holds a ledger this phone has not seen, wait for the user to restore or overwrite it.
      const waiting = await getSetting<unknown>('gsRestoreOffer', null);
      // A phone that has never saved its full ledger to the sheet does so once, as the first backup.
      const firstBackup = !(await getSetting<boolean>('gsLedgerOwner', false));
      if (auto && !waiting && (firstBackup || (await ledgerNeedsSending()))) {
        await syncLedgerNow(c);
        ledgerDueAt = undefined;
      }
      if (reason !== 'timer' && (forced || t - lastPull > PULL_EVERY)) {
        await pullResources(c);
        lastPull = now();
        await refreshNotes(await db.resources.toArray());
      }
    } catch {
      lastFailure = now(); // the error is saved in settings for the sync screen
    }
    return wake();
  }
  const wake = () => (ledgerDueAt === undefined ? {} : { wakeAt: ledgerDueAt });

  return {
    /**
     * Runs whatever background sync is due now: queued additions, the ledger (30 s after its last change), and the
     * resource pull (at most every 2 minutes unless forced). Returns when to call again with 'timer', if ever.
     * Calls run one at a time, in order.
     */
    tick(reason: TickReason): Promise<{ wakeAt?: number }> {
      const run = queue
        .then(() => step(reason))
        .catch(() => {
          lastFailure = now(); // e.g. the database could not be read; try again later
          return wake();
        });
      queue = run;
      return run;
    },

    /** The link as the screens show it. Reads only the database, so it works in live queries. */
    async status(): Promise<SheetsLinkStatus> {
      const keys = [...LINK_STATE_KEYS, ...SYNC_PREFERENCE_KEYS];
      const rows = await db.settings.bulkGet(keys);
      const v = Object.fromEntries(keys.map((k, i) => [k, rows[i]?.value])) as Partial<Record<(typeof keys)[number], unknown>>;
      const str = (x: unknown) => (typeof x === 'string' ? x : '');
      const list = <T>(x: unknown) => (Array.isArray(x) ? (x as T[]) : []);
      const linked = !!(v.gsUrl && v.gsSecret && v.gsSheetUrl);
      return {
        linked,
        url: str(v.gsUrl),
        key: str(v.gsSecret),
        sheetName: str(v.gsSheetName),
        sheetUrl: str(v.gsSheetUrl),
        resourcesGid: Number(v.gsResourcesGid) || 0,
        lastSyncAt: str(v.gsLastSyncAt) || undefined,
        lastPullAt: str(v.gsLastPullAt) || undefined,
        lastError: str(v.gsLastError),
        pullErrors: list(v.gsPullErrors),
        log: list(v.gsSyncLog),
        restoreOffer: (v.gsRestoreOffer as RestoreOffer | undefined) ?? undefined,
        scriptFeatures: list(v.gsScriptFeatures),
        scriptImageFolder: typeof v.gsScriptImageFolder === 'string' ? v.gsScriptImageFolder : undefined,
        autoSync: v.gsAutoSync !== false,
        imageFolder: normalizeFolderPath(str(v.gsImageFolder) || DEFAULT_IMAGE_FOLDER)
      };
    },

    /** Whether ledger changes are sent on their own (when online). */
    async setAutoSync(on: boolean) {
      await setSetting('gsAutoSync', on);
    },
    /** Sets the Drive folder for images, from My Drive; returns the cleaned path. The script must be copied again to use it. */
    async setImageFolder(path: string) {
      const folder = normalizeFolderPath(path);
      await setSetting('gsImageFolder', folder);
      return folder;
    },

    /** Makes sure there is a key to put in the script, before the user copies it. */
    async ensureKey() {
      await secret();
    },

    /**
     * Links the sheet whose script answers at `url`, then runs the first ledger sync and resource pull.
     * `onLinked` runs once the link is saved, before that first sync; the link is kept even when the sync fails.
     */
    async connect(url: string, { onLinked }: { onLinked?: (name: string) => void } = {}): Promise<ConnectResult> {
      const u = url.trim();
      if (!isScriptUrl(u)) throw new SheetsError('config', '網址格式不對，請貼上「網頁應用程式」部署後、以 /exec 結尾的網址。');
      const cfg: SheetsConfig = { url: u, secret: await secret(), fetch: remote };
      const r = await ping(cfg);
      // A different sheet starts from nothing: in particular, owning the old sheet's ledger says nothing about this one.
      const previous = await getSetting<string>('gsUrl', '');
      if (previous && previous !== u) await db.settings.bulkDelete(LINK_STATE_KEYS.filter(isLinkRecord));
      // The answer below is about this sync, not an earlier one.
      await db.settings.delete('gsRestoreOffer');
      await Promise.all([
        setSetting('gsUrl', u), setSetting('gsSheetUrl', r.spreadsheetUrl), setSetting('gsSheetName', r.name), setSetting('gsResourcesGid', r.resourcesGid),
        setSetting('gsScriptImageFolder', r.imageFolder ?? ''), setSetting('gsScriptFeatures', r.features ?? []), setSetting('gsLastError', '')
      ]);
      onLinked?.(r.name);
      try {
        await syncLedgerNow(cfg);
      } catch (e) {
        // A new or wiped phone must not overwrite a ledger already in the sheet.
        if (!(e instanceof SheetsError && e.code === 'wouldErase')) throw e;
      }
      await pullResources(cfg);
      const restoreOffer = await getSetting<RestoreOffer | null>('gsRestoreOffer', null);
      return restoreOffer ? { name: r.name, restoreOffer } : { name: r.name };
    },

    /** Whether the ledger changed since the sheet last kept it in full. Reads only the database, so it works in live queries. */
    /** Whether the ledger changed since the sheet last kept it in full. Reads only the database, so it works in live queries. */
    ledgerNeedsSending,
    /** The whole ledger, for a live query that reacts to any change in it (records, budget or key dates). */
    ledgerSnapshot: readLedger,

    /** Sends the ledger to the sheet now. */
    syncLedger: async () => syncLedgerNow(await config()),
    /** Reads the 資源 sheet now, asking Drive about every image, and refreshes the handbook notes. */
    async refreshResources() {
      const r = await pullResources(await config(), { checkAllImages: true });
      await refreshNotes(await db.resources.toArray(), true);
      return r;
    },
    /** Moves every resource that exists only in the app to the sheet; returns how many were sent. */
    moveAppResources: async () => migrateAppResources(await config()),

    /** What the sheet's ledger holds, for the confirmation before restoring. */
    previewRestore: async () => previewRestore(await config()),
    /** Replaces the phone's ledger with the sheet's copy. */
    restoreFromSheet: async () => restoreLedgerFromSheet(await config()),
    /** Replaces the sheet's ledger with the phone's. */
    overwriteSheet: async () => overwriteSheetLedger(await config()),

    /** Asks the deployed script which image folder it uses; a mismatch with the setting means it needs redeploying. */
    async testConnection(): Promise<{ imageFolder: string }> {
      const r = await ping(await config());
      const imageFolder = r.imageFolder ?? '';
      await Promise.all([setSetting('gsScriptImageFolder', imageFolder), setSetting('gsScriptFeatures', r.features ?? [])]);
      return { imageFolder };
    },

    /** Makes a new key. The deployed script keeps the old one until the user copies and redeploys the script. */
    async rotateKey() {
      await setSetting('gsSecret', generateSecret());
    },

    /** Ends the link on this phone only: the sheet keeps its contents, and every resource stays, editable in the app again. */
    async unlink() {
      await db.transaction('rw', db.resources, db.outbox, db.settings, async () => {
        await db.resources.filter(r => r.source === 'sheet' || r.source === 'pending').modify({ source: 'app' });
        await db.outbox.clear();
        await db.settings.bulkDelete([...LINK_STATE_KEYS]);
      });
    }
  };
}

export const sheetsLink = createSheetsLink();
