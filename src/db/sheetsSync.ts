import { db, getSetting, setSetting } from './index';
import type { Resource, StoredImage } from './schema';
import { computeMoney } from '../domain/money';
import { planPull, toSheetValues } from '../domain/sheetResources';
import { base64ToBlob, blobToBase64 } from '../io/backup';
import { buildSheets } from '../io/exportRows';
import { compressImage } from '../io/images';
import {
  appendResource, getImages, getResources, pushLedger, SheetsError, uploadImage, type SheetsConfig
} from '../io/sheetsClient';

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

export async function syncLedgerNow(cfg: SheetsConfig): Promise<void> {
  const [expenses, exchanges, payments, categories, trips] = await Promise.all([
    db.expenses.toArray(), db.exchanges.toArray(), db.paymentMethods.orderBy('order').toArray(), db.categories.orderBy('order').toArray(), db.trips.toArray()
  ]);
  const kind = new Map(payments.map(p => [p.id, p.kind]));
  const money = computeMoney(expenses, exchanges, id => kind.get(id));
  try {
    const r = await pushLedger(cfg, buildSheets({ expenses, exchanges, payments, categories, trips, money }));
    await Promise.all([setSetting('gsDirty', false), setSetting('gsLastSyncAt', r.syncedAt), setSetting('gsLastError', '')]);
    await logSync('記帳', true, `${expenses.length} 筆支出、${exchanges.length} 筆換匯`);
  } catch (e) {
    await setSetting('gsLastError', `記帳同步失敗：${message(e)}`);
    await logSync('記帳', false, message(e));
    throw e;
  }
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

/** Keeps every resource, now editable in the app again. */
export async function unlinkSheets() {
  await db.transaction('rw', db.resources, db.outbox, async () => {
    await db.resources.filter(r => r.source === 'sheet' || r.source === 'pending').modify({ source: 'app' });
    await db.outbox.clear();
  });
  await Promise.all(['gsUrl', 'gsSecret', 'gsSheetUrl', 'gsSheetName', 'gsResourcesGid', 'gsLastSyncAt', 'gsLastPullAt', 'gsLastError', 'gsPullErrors', 'gsDirty', 'gsSyncLog', 'gsScriptFeatures'].map(k => db.settings.delete(k)));
}
