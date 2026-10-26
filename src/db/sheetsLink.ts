import { db, getSetting, setSetting } from './index';
import { refreshNotes } from './handbook';
import {
  getSheetsConfig, migrateAppResources, overwriteSheetLedger, previewRestore, pullResources, restoreLedgerFromSheet, syncLedgerNow, type RestoreOffer
} from './sheetsSync';
import { isLinkRecord, LINK_STATE_KEYS } from '../domain/sheetsLinkKeys';
import { generateSecret, isScriptUrl, ping, SheetsError, type SheetsConfig } from '../io/sheetsClient';

// The link between this phone and one Google Sheet (see GLOSSARY.md): every action the user takes on it.
// Screens call these actions instead of building a config or writing link state themselves.

export interface ConnectResult {
  name: string;
  /** Set when the sheet holds a ledger this phone has not seen: the user picks restore or overwrite. */
  restoreOffer?: RestoreOffer;
}

/** `remote` replaces the network, e.g. with the script running in memory for tests. */
export function createSheetsLink({ remote }: { remote?: typeof fetch } = {}) {
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

  return {
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
        setSetting('gsScriptImageFolder', r.imageFolder ?? ''), setSetting('gsScriptFeatures', r.features ?? []), setSetting('gsLastError', ''), setSetting('gsDirty', true)
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
