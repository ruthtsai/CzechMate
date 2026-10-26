import { db, getSetting, setSetting } from './index';
import type { Resource, StoredImage } from './schema';
import { computeMoney } from '../domain/money';
import { planPull, toSheetValues } from '../domain/sheetResources';
import { base64ToBlob, blobToBase64 } from '../io/backup';
import { buildSheets } from '../io/exportRows';
import { compressImage } from '../io/images';
import {
  appendResource, getImages, getLedger, getResources, pushLedger, SheetsError, uploadImage, type RawCounts, type SheetsConfig
} from '../io/sheetsClient';
import { LEDGER_SETTING_KEYS, validateLedgerTables, type LedgerTables } from '../domain/ledgerRestore';
import { ledgerFingerprint } from '../domain/ledgerFingerprint';

// Google Sheets sync jobs (requirements spec 6.6, 6.7). Each job reads its own data from the database,
// so it can run from a timer or an event without the UI.

export async function getSheetsConfig(): Promise<SheetsConfig | null> {
  const [url, secret] = await Promise.all([getSetting<string>('gsUrl', ''), getSetting<string>('gsSecret', '')]);
  return url && secret ? { url, secret } : null;
}

const message = (e: unknown) => (e instanceof SheetsError || e instanceof Error ? e.message : '同步失敗。');

/* ---------- sync log (R-03) ---------- */

export type SyncJob = '記帳' | '資源' | '上傳';
export interface SyncLogEntry { at: string; job: SyncJob; ok: boolean; message: string }
export const SYNC_LOG_MAX = 20;

/** Newest first, capped at SYNC_LOG_MAX. */
export const withLogEntry = (log: SyncLogEntry[], entry: SyncLogEntry) => [entry, ...log].slice(0, SYNC_LOG_MAX);

export async function logSync(job: SyncJob, ok: boolean, msg: string) {
  const log = await getSetting<SyncLogEntry[]>('gsSyncLog', []);
  await setSetting('gsSyncLog', withLogEntry(Array.isArray(log) ? log : [], { at: new Date().toISOString(), job, ok, message: msg }));
}

/* ---------- ledger push ---------- */

/**
 * What the sheet holds when this phone has not synced its ledger there yet but the sheet already has one
 * (a new phone, or one whose data was wiped). Ledger pushes wait until the user restores or overwrites.
 */
export interface RestoreOffer { counts: RawCounts; syncedAt: string }

/** Remembers the ledger the sheet now holds in full; later changes make the ledger need sending again. */
const sentFingerprint = (t: LedgerTables) => ({ key: 'gsPushedFingerprint', value: ledgerFingerprint(t) });

/** True once this phone has saved its ledger to the sheet or restored from it; its pushes are trusted. */
const isLedgerOwner = () => getSetting<boolean>('gsLedgerOwner', false);

/** The whole ledger as the sheet keeps it: every record plus the ledger settings. Reads only the database, so it works in live queries. */
export async function readLedger(): Promise<LedgerTables> {
  const [expenses, exchanges, trips, paymentMethods, categories, settings] = await Promise.all([
    db.expenses.toArray(), db.exchanges.toArray(), db.trips.toArray(), db.paymentMethods.toArray(), db.categories.toArray(),
    db.settings.bulkGet([...LEDGER_SETTING_KEYS])
  ]);
  return { expenses, exchanges, trips, paymentMethods, categories, settings: settings.filter((x): x is { key: string; value: unknown } => !!x) };
}

/** The sheet's saved ledger summary, or null when the script is too old to keep one. */
async function remoteLedger(cfg: SheetsConfig) {
  try {
    return await getLedger(cfg);
  } catch (e) {
    if (e instanceof SheetsError && e.code === 'protocol') return null;
    throw e;
  }
}

export async function syncLedgerNow(cfg: SheetsConfig): Promise<void> {
  const raw = await readLedger();
  const { expenses, exchanges, trips } = raw;
  const payments = [...raw.paymentMethods].sort((a, b) => a.order - b.order);
  const categories = [...raw.categories].sort((a, b) => a.order - b.order);
  const kind = new Map(payments.map(p => [p.id, p.kind]));
  const money = computeMoney(expenses, exchanges, id => kind.get(id));
  try {
    const owner = await isLedgerOwner();
    if (!owner) {
      // Never overwrite a ledger in the sheet that this phone has not seen: offer to restore it instead.
      const remote = await remoteLedger(cfg);
      // Records the phone already has (e.g. the same phone linked again) are safe to write over.
      const localIds = new Set([...expenses, ...exchanges].map(x => x.id));
      const unseen = remote?.tables
        ? [...(remote.tables.expenses as { id?: string }[]), ...(remote.tables.exchanges as { id?: string }[])].some(x => !localIds.has(String(x?.id)))
        : false;
      if (remote && unseen) {
        await setSetting('gsRestoreOffer', { counts: remote.counts, syncedAt: remote.syncedAt } satisfies RestoreOffer);
        throw new SheetsError('wouldErase', `試算表裡已有 ${remote.counts.expenses} 筆支出、${remote.counts.exchanges} 筆換匯，請先選擇要還原，或用這支手機的資料覆蓋。`);
      }
    }
    const r = await pushLedger(cfg, buildSheets({ expenses, exchanges, payments, categories, trips, money }), raw, owner);
    const done: Promise<unknown>[] = [setSetting('gsLastSyncAt', r.syncedAt), setSetting('gsLastError', '')];
    // Only a ledger the sheet kept in full counts as sent.
    if (r.rawSaved) done.push(db.settings.bulkPut([{ key: 'gsLedgerOwner', value: true }, sentFingerprint(raw)]), db.settings.delete('gsRestoreOffer'));
    await Promise.all(done);
    await logSync('記帳', true, `${expenses.length} 筆支出、${exchanges.length} 筆換匯`);
  } catch (e) {
    await setSetting('gsLastError', `記帳同步失敗：${message(e)}`);
    await logSync('記帳', false, message(e));
    throw e;
  }
}

/** Looks at what the sheet holds, for the confirmation before restoring. */
export async function previewRestore(cfg: SheetsConfig): Promise<RestoreOffer> {
  const remote = await getLedger(cfg);
  return { counts: remote.counts, syncedAt: remote.syncedAt };
}

/** Replaces the phone's ledger (and budget and key dates) with the copy saved in the sheet. */
export async function restoreLedgerFromSheet(cfg: SheetsConfig): Promise<RawCounts> {
  const remote = await getLedger(cfg);
  const checked = validateLedgerTables(remote.tables);
  if (!checked.ok) throw new Error(checked.error);
  const t = checked.tables;
  await db.transaction('rw', [db.expenses, db.exchanges, db.trips, db.paymentMethods, db.categories, db.settings], async () => {
    await Promise.all([db.expenses.clear(), db.exchanges.clear(), db.trips.clear(), db.paymentMethods.clear(), db.categories.clear()]);
    await db.paymentMethods.bulkAdd(t.paymentMethods);
    await db.categories.bulkAdd(t.categories);
    await db.trips.bulkAdd(t.trips);
    await db.expenses.bulkAdd(t.expenses);
    await db.exchanges.bulkAdd(t.exchanges);
    await db.settings.bulkDelete([...LEDGER_SETTING_KEYS]);
    await db.settings.bulkPut(t.settings);
    // The phone now holds what the sheet holds.
    await db.settings.bulkPut([{ key: 'gsLedgerOwner', value: true }, sentFingerprint(t)]);
    await db.settings.delete('gsRestoreOffer');
  });
  await logSync('記帳', true, `從試算表還原 ${t.expenses.length} 筆支出、${t.exchanges.length} 筆換匯`);
  return remote.counts;
}

/** The user chose to keep this phone's ledger: it replaces the copy in the sheet. */
export async function overwriteSheetLedger(cfg: SheetsConfig): Promise<void> {
  await Promise.all([setSetting('gsLedgerOwner', true), db.settings.delete('gsRestoreOffer')]);
  await syncLedgerNow(cfg);
}

/* ---------- resources pull ---------- */

export interface PullSummary { added: number; updated: number; removed: number; errors: { line: number; message: string }[]; images: number }

export async function pullResources(cfg: SheetsConfig, opts: { checkAllImages?: boolean } = {}): Promise<PullSummary> {
  try {
    const res = await getResources(cfg);
    await Promise.all([setSetting('gsSheetUrl', res.spreadsheetUrl), setSetting('gsResourcesGid', res.resourcesGid)]);
    const existing = await db.resources.toArray();
    const plan = planPull(res.rows, existing);
    const before = new Set(existing.map(r => r.id));
    await db.transaction('rw', db.resources, db.outbox, async () => {
      if (plan.put.length) await db.resources.bulkPut(plan.put);
      if (plan.remove.length) await db.resources.bulkDelete(plan.remove);
      // Additions that reached the sheet need no further sending.
      const arrived = plan.put.filter(r => before.has(r.id)).map(r => r.id);
      if (arrived.length) await db.outbox.where('id').anyOf(arrived).delete();
    });
    const images = await syncImages(cfg, !!opts.checkAllImages);
    await Promise.all([setSetting('gsLastPullAt', new Date().toISOString()), setSetting('gsPullErrors', plan.errors), setSetting('gsLastError', '')]);
    const summary = {
      added: plan.put.filter(r => !before.has(r.id)).length,
      updated: plan.put.filter(r => before.has(r.id)).length,
      removed: plan.remove.length,
      errors: plan.errors,
      images
    };
    // Unchanged pulls happen every few minutes; only log ones that did something.
    if (plan.put.length || plan.remove.length || images || plan.errors.length) {
      await logSync('資源', !plan.errors.length, `新增 ${summary.added}、更新 ${summary.updated}、移除 ${summary.removed}${images ? `、圖片 ${images}` : ''}${plan.errors.length ? `，${plan.errors.length} 列有誤` : ''}`);
    }
    return summary;
  } catch (e) {
    await setSetting('gsLastError', `資源更新失敗：${message(e)}`);
    await logSync('資源', false, message(e));
    throw e;
  }
}

/**
 * Downloads Drive images named by sheet rows. Normally only names with no local copy are fetched;
 * `checkAll` also asks Drive whether existing ones changed.
 */
async function syncImages(cfg: SheetsConfig, checkAll: boolean): Promise<number> {
  const sheetRes = await db.resources.filter(r => r.source === 'sheet').toArray();
  const stored = await db.images.filter(i => !!i.name).toArray();
  const byName = new Map(stored.map(i => [i.name!.toLowerCase(), i]));
  const wanted = [...new Set(sheetRes.flatMap(r => r.imageNames ?? []))];
  const toFetch = wanted.filter(n => checkAll || !byName.has(n.toLowerCase()));
  let fetched = 0;
  for (let i = 0; i < toFetch.length; i += 5) {
    const names = toFetch.slice(i, i + 5);
    const known = Object.fromEntries(
      names.flatMap(n => {
        const s = byName.get(n.toLowerCase());
        return s?.driveId && s.driveModified ? [[n, { id: s.driveId, modified: s.driveModified }]] : [];
      })
    );
    const { images } = await getImages(cfg, names, known);
    for (const im of images) {
      if (!im.base64 || !im.id) continue;
      const c = await compressImage(base64ToBlob(im.base64, im.mime ?? 'image/jpeg'));
      const prev = byName.get(im.name.toLowerCase());
      const row: StoredImage = { id: prev?.id ?? crypto.randomUUID(), blob: c.blob, width: c.width, height: c.height, createdAt: new Date().toISOString(), driveId: im.id, driveModified: im.modified, name: im.name };
      await db.images.put(row);
      byName.set(im.name.toLowerCase(), row);
      fetched++;
    }
  }
  // Point each sheet resource at its images and drop Drive images nobody uses any more.
  await db.transaction('rw', db.resources, db.images, async () => {
    const used = new Set<string>();
    for (const r of sheetRes) {
      const ids = (r.imageNames ?? []).flatMap(n => (byName.get(n.toLowerCase()) ? [byName.get(n.toLowerCase())!.id] : []));
      ids.forEach(id => used.add(id));
      if (JSON.stringify(ids) !== JSON.stringify(r.imageIds)) await db.resources.update(r.id, { imageIds: ids });
    }
    const others = await db.resources.filter(r => r.source !== 'sheet').toArray();
    others.forEach(r => r.imageIds.forEach(id => used.add(id)));
    const orphans = (await db.images.filter(i => !!i.driveId && !used.has(i.id)).primaryKeys()) as string[];
    if (orphans.length) await db.images.bulkDelete(orphans);
  });
  return fetched;
}

/* ---------- app additions → sheet ---------- */

export async function queueForSheet(resourceIds: string[]) {
  const now = new Date().toISOString();
  await db.transaction('rw', db.resources, db.outbox, async () => {
    for (const id of resourceIds) {
      await db.resources.update(id, { source: 'pending' });
      if (!(await db.outbox.get(id))) await db.outbox.put({ id, kind: 'appendResource', resourceId: id, createdAt: now, attempts: 0 });
    }
  });
}

/** Sends queued additions (with their images) to the sheet. Returns how many were sent. */
export async function processOutbox(cfg: SheetsConfig): Promise<number> {
  const items = await db.outbox.orderBy('createdAt').toArray();
  let sent = 0;
  for (const item of items) {
    const r = await db.resources.get(item.resourceId);
    if (!r) {
      await db.outbox.delete(item.id);
      continue;
    }
    try {
      const names = await uploadResourceImages(cfg, r);
      const out = await appendResource(cfg, toSheetValues(r, names));
      await db.transaction('rw', db.resources, db.outbox, async () => {
        await db.resources.update(r.id, { source: 'sheet', sheetRow: out.row, imageNames: names });
        await db.outbox.delete(item.id);
      });
      sent++;
    } catch (e) {
      await db.outbox.update(item.id, { attempts: item.attempts + 1, lastError: message(e) });
      await logSync('上傳', false, `「${r.title}」：${message(e)}`);
      if (e instanceof SheetsError && (e.code === 'network' || e.code === 'config' || e.code === 'secret')) break;
    }
  }
  if (sent) await logSync('上傳', true, `${sent} 筆資源送到試算表`);
  return sent;
}

async function uploadResourceImages(cfg: SheetsConfig, r: Resource): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < r.imageIds.length; i++) {
    const im = await db.images.get(r.imageIds[i]);
    if (!im) continue;
    if (im.name && im.driveId) {
      names.push(im.name);
      continue;
    }
    const name = im.name ?? `CzechMate-${r.id.slice(0, 8)}-${i + 1}.jpg`;
    const up = await uploadImage(cfg, name, im.blob.type || 'image/jpeg', await blobToBase64(im.blob));
    await db.images.update(im.id, { name: up.name, driveId: up.id, driveModified: up.modified });
    names.push(up.name);
  }
  return names;
}

/** RS-05: move every app-only resource to the sheet. */
export async function migrateAppResources(cfg: SheetsConfig): Promise<number> {
  const ids = (await db.resources.filter(r => (r.source ?? 'app') === 'app').primaryKeys()) as string[];
  await queueForSheet(ids);
  return processOutbox(cfg);
}
