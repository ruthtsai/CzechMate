import { db, setSetting } from './index';
import type { Resource } from './schema';
import { DEFAULT_HANDBOOK_SOURCES } from './seed';
import { canonicalNoteUrl, fetchMarkdown, isHackmdNote, syncBook } from '../io/hackmd';

// Handbook sync and personal note downloads (requirements HB-01, MD-02).

export interface HandbookSyncSummary { pages: number; sections: number; failed: string[] }

export async function syncHandbooks(onProgress?: (label: string) => void): Promise<HandbookSyncSummary> {
  // A restored backup can lack the default source; bring it back so there is always something to sync.
  if (!(await db.handbookSources.count())) await db.handbookSources.bulkAdd(DEFAULT_HANDBOOK_SOURCES);
  const sources = await db.handbookSources.toArray();
  const total: HandbookSyncSummary = { pages: 0, sections: 0, failed: [] };
  for (const src of sources) {
    const r = await syncBook(src, { delayMs: 300, onProgress: (done, n) => onProgress?.(`${src.title}：第 ${Math.min(done + 1, n)} / ${n} 篇`) });
    const now = new Date().toISOString();
    if (r.pages.length && r.failed.length === r.pages.length) {
      // Everything failed: keep the old sections so search keeps working.
      await db.handbookSources.update(src.id, { failedPages: r.failed.map(f => f.url) });
    } else {
      await db.transaction('rw', db.handbookSections, db.handbookSources, async () => {
        await db.handbookSections.where('sourceId').equals(src.id).delete();
        await db.handbookSections.bulkAdd(r.sections);
        await db.handbookSources.update(src.id, { lastSyncedAt: now, pageCount: r.pages.length, failedPages: r.failed.map(f => f.url) });
      });
    }
    total.pages += r.pages.length;
    total.sections += r.sections.length;
    total.failed.push(...r.failed.map(f => f.title));
  }
  await setSetting('handbookSyncedAt', new Date().toISOString());
  return total;
}

/** Downloads the HackMD note behind a resource URL into the cache. */
export async function fetchNote(url: string): Promise<string> {
  const key = canonicalNoteUrl(url);
  if (!key) throw new Error('這不是 HackMD 筆記的網址。');
  const markdown = await fetchMarkdown(key);
  await db.noteCache.put({ url: key, markdown, fetchedAt: new Date().toISOString() });
  return markdown;
}

/** Fetches notes that are not cached yet (or all, when `force`). Failures are skipped silently. */
export async function refreshNotes(resources: Resource[], force = false): Promise<number> {
  let n = 0;
  for (const r of resources) {
    if (!isHackmdNote(r.url)) continue;
    const key = canonicalNoteUrl(r.url)!;
    if (!force && (await db.noteCache.get(key))) continue;
    try {
      await fetchNote(key);
      n++;
    } catch {
      /* offline or note removed: try again next time */
    }
  }
  return n;
}
