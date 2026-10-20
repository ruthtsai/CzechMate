import type { CzechMateDB } from '../db/schema';

// Full backup and restore (requirements spec 6.2). Handbook sections are left out: they can be re-synced.

export const BACKUP_SCHEMA_VERSION = 1;

const TABLES = ['resources', 'expenses', 'exchanges', 'trips', 'paymentMethods', 'categories', 'handbookSources', 'settings'] as const;
type TableName = (typeof TABLES)[number];

interface BackupImage { id: string; mime: string; width: number; height: number; createdAt: string; base64: string }
export interface BackupFile {
  app: 'CzechMate';
  schemaVersion: number;
  exportedAt: string;
  data: Record<TableName, unknown[]> & { images: BackupImage[] };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function localStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const tz = `${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${tz}`;
}

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `CzechMate_備份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export async function createBackup(db: CzechMateDB): Promise<BackupFile> {
  return db.transaction('r', [...TABLES.map(t => db.table(t)), db.images], async () => {
    const data = {} as BackupFile['data'];
    for (const t of TABLES) data[t] = await db.table(t).toArray();
    const images = await db.images.toArray();
    data.images = await Promise.all(
      images.map(async im => ({ id: im.id, mime: im.blob.type || 'image/jpeg', width: im.width, height: im.height, createdAt: im.createdAt, base64: await blobToBase64(im.blob) }))
    );
    return { app: 'CzechMate', schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: localStamp(), data };
  });
}

export class RestoreError extends Error {}

/** Parses and checks a backup file before anything is written. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RestoreError('這不是有效的備份檔（無法讀取 JSON）。');
  }
  const b = parsed as Partial<BackupFile>;
  if (b?.app !== 'CzechMate' || typeof b.schemaVersion !== 'number' || typeof b.data !== 'object' || !b.data) {
    throw new RestoreError('這不是 CzechMate 的備份檔。');
  }
  if (b.schemaVersion > BACKUP_SCHEMA_VERSION) throw new RestoreError('這個備份來自較新版本的 CzechMate，請先更新 App 再還原。');
  for (const t of [...TABLES, 'images'] as const) {
    if (b.data[t] !== undefined && !Array.isArray(b.data[t])) throw new RestoreError(`備份檔內容有誤（${t}）。`);
  }
  return b as BackupFile;
}

/** Replaces all data in one transaction; on failure nothing changes. */
export async function restoreBackup(db: CzechMateDB, backup: BackupFile): Promise<void> {
  const images = (backup.data.images ?? []).map(im => ({ id: im.id, width: im.width, height: im.height, createdAt: im.createdAt, blob: base64ToBlob(im.base64, im.mime) }));
  await db.transaction('rw', [...TABLES.map(t => db.table(t)), db.images, db.handbookSections], async () => {
    for (const t of TABLES) await db.table(t).clear();
    await db.images.clear();
    await db.handbookSections.clear();
    for (const t of TABLES) {
      const rows = backup.data[t] ?? [];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
    if (images.length) await db.images.bulkAdd(images);
  });
}
