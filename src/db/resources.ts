import { db } from './index';
import type { Resource } from './schema';
import type { Compressed } from '../io/images';
import type { ImportDraft } from '../io/csvImport';

// Writes for the resource library (requirements spec 4.2–4.3).

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export type ResourceInput = Pick<Resource, 'title' | 'type' | 'stage' | 'content' | 'tags' | 'url' | 'pinned' | 'pinLabel'>;

async function nextPinOrder() {
  const pinned = await db.resources.filter(r => r.pinned).toArray();
  return pinned.reduce((m, r) => Math.max(m, r.pinOrder ?? 0), 0) + 1;
}

/** Saves a resource. `keepImageIds` are existing images to keep (in order); `newImages` are appended. */
export async function saveResource(
  input: ResourceInput,
  opts: { id?: string; keepImageIds?: string[]; newImages?: Compressed[]; source?: Resource['source'] } = {}
): Promise<string> {
  const t = now();
  return db.transaction('rw', db.resources, db.images, async () => {
    const old = opts.id ? await db.resources.get(opts.id) : undefined;
    const added = (opts.newImages ?? []).map(im => ({ id: uid(), blob: im.blob, width: im.width, height: im.height, createdAt: t }));
    if (added.length) await db.images.bulkAdd(added);
    const keep = opts.keepImageIds ?? old?.imageIds ?? [];
    const removed = (old?.imageIds ?? []).filter(i => !keep.includes(i));
    if (removed.length) await db.images.bulkDelete(removed);
    const imageIds = [...keep, ...added.map(a => a.id)];
    const pinned = input.pinned && !!input.url;
    const pinOrder = pinned ? (old?.pinned ? old.pinOrder : await nextPinOrder()) : undefined;
    const record: Resource = {
      ...input,
      pinned,
      pinOrder,
      pinLabel: input.pinLabel?.trim() || undefined,
      imageIds,
      source: opts.source ?? old?.source ?? 'app',
      sheetRow: old?.sheetRow,
      imageNames: old?.imageNames,
      id: opts.id ?? uid(),
      createdAt: old?.createdAt ?? t,
      updatedAt: t
    };
    await db.resources.put(record);
    return record.id;
  });
}

export async function deleteResource(id: string) {
  await db.transaction('rw', db.resources, db.images, async () => {
    const r = await db.resources.get(id);
    if (r?.imageIds.length) await db.images.bulkDelete(r.imageIds);
    await db.resources.delete(id);
  });
}

export async function setPinned(r: Resource, pinned: boolean) {
  if (pinned && !r.url) throw new Error('釘選需要網址。');
  await db.resources.update(r.id, { pinned, pinOrder: pinned ? await nextPinOrder() : undefined });
}

export async function updatePin(id: string, changes: { pinLabel?: string }) {
  await db.resources.update(id, { pinLabel: changes.pinLabel?.trim() || undefined });
}

/** Rewrites pinOrder to match the given id order. */
export async function reorderPins(ids: string[]) {
  await db.transaction('rw', db.resources, async () => {
    await Promise.all(ids.map((id, i) => db.resources.update(id, { pinOrder: i + 1 })));
  });
}

/* ---------- tags ---------- */

/**
 * Renames a tag; renaming onto an existing tag merges the two. Resources that come from the Google Sheet
 * are left alone (the next update would undo the change); returns how many of those were skipped.
 */
export async function renameTag(from: string, to: string): Promise<number> {
  to = to.trim();
  if (!to) throw new Error('請輸入標籤名稱。');
  return db.transaction('rw', db.resources, async () => {
    const list = await db.resources.where('tags').equals(from).toArray();
    const editable = list.filter(r => r.source !== 'sheet');
    await Promise.all(editable.map(r => db.resources.update(r.id, { tags: [...new Set(r.tags.map(t => (t === from ? to : t)))] })));
    return list.length - editable.length;
  });
}

export async function deleteTag(tag: string): Promise<number> {
  return db.transaction('rw', db.resources, async () => {
    const list = await db.resources.where('tags').equals(tag).toArray();
    const editable = list.filter(r => r.source !== 'sheet');
    await Promise.all(editable.map(r => db.resources.update(r.id, { tags: r.tags.filter(t => t !== tag) })));
    return list.length - editable.length;
  });
}

/* ---------- CSV import ---------- */

/** Writes the chosen drafts in one transaction; nothing is written if any step fails (requirements spec 6.1). */
export async function importDrafts(drafts: ImportDraft[], images: Map<string, Compressed>): Promise<string[]> {
  const t = now();
  return db.transaction('rw', db.resources, db.images, async () => {
    let order = await nextPinOrder();
    const imageRows: { id: string; blob: Blob; width: number; height: number; createdAt: string }[] = [];
    const resources: Resource[] = drafts.map(d => {
      const ids = d.imageNames.flatMap(name => {
        const im = images.get(name);
        if (!im) return [];
        const id = uid();
        imageRows.push({ id, blob: im.blob, width: im.width, height: im.height, createdAt: t });
        return [id];
      });
      return {
        id: uid(), title: d.title, type: d.type, stage: d.stage, content: d.content, tags: d.tags, url: d.url,
        imageIds: ids, pinned: d.pinned, pinOrder: d.pinned ? order++ : undefined, createdAt: t, updatedAt: t
      };
    });
    if (imageRows.length) await db.images.bulkAdd(imageRows);
    await db.resources.bulkAdd(resources);
    return resources.map(r => r.id);
  });
}
