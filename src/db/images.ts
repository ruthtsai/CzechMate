import { db } from './index';
import type { StoredImage } from './schema';
import type { Compressed } from '../io/images';

// When stored images are created and deleted. Resources point at images by id, and one image can be
// shared: sheet rows naming the same file all point at its one stored copy. So an image is deleted only
// once no resource points at it. Restoring a backup replaces the whole table and does not come here.

/** Resources that point at each image id. */
async function usedIds(): Promise<Set<string>> {
  const used = new Set<string>();
  await db.resources.each(r => r.imageIds.forEach(id => used.add(id)));
  return used;
}

/**
 * Stores new images and returns their ids. Call it inside the transaction that saves the resources
 * pointing at them, so a sweep running in between never sees them unused.
 */
export async function addImages(images: Compressed[], createdAt = new Date().toISOString()): Promise<string[]> {
  const rows: StoredImage[] = images.map(im => ({ id: crypto.randomUUID(), blob: im.blob, width: im.width, height: im.height, createdAt }));
  if (rows.length) await db.images.bulkAdd(rows);
  return rows.map(r => r.id);
}

/**
 * Deletes those of `ids` that no resource points at any more. Call it inside a transaction on resources
 * and images, after the resource change is written. Returns how many were deleted.
 */
export async function releaseImages(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const used = await usedIds();
  const gone = [...new Set(ids)].filter(id => !used.has(id));
  if (gone.length) await db.images.bulkDelete(gone);
  return gone.length;
}

/** Deletes every stored image that no resource points at, whatever its origin. Returns how many. */
export async function collectOrphanImages(): Promise<number> {
  return db.transaction('rw', db.resources, db.images, async () => {
    const used = await usedIds();
    const orphans = (await db.images.toCollection().primaryKeys()).filter(id => !used.has(id));
    if (orphans.length) await db.images.bulkDelete(orphans);
    return orphans.length;
  });
}
