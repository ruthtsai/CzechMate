import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The data layer uses the shared `db`, so give each test its own database name.
let n = 0;
let images: typeof import('./images');
let resources: typeof import('./resources');
let dbm: typeof import('./index');

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('./schema', async () => {
    const real = await vi.importActual<typeof import('./schema')>('./schema');
    return { ...real, DB_NAME: `img-${n++}` };
  });
  dbm = await import('./index');
  images = await import('./images');
  resources = await import('./resources');
});
afterEach(async () => {
  await dbm.db.delete();
  vi.doUnmock('./schema');
});

const base = { type: 'screenshot' as const, stage: 'after' as const, content: '', tags: [] as string[], url: '', pinned: false };
const img = () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 10, height: 10 });
const ids = async () => (await dbm.db.images.toCollection().primaryKeys()).sort();

/** Two resources sharing one image, as sheet rows naming the same file end up after the sheet is unlinked. */
async function shared() {
  const a = await resources.saveResource({ ...base, title: 'A' }, { newImages: [img()] });
  const imageId = (await dbm.db.resources.get(a))!.imageIds[0];
  const b = await resources.saveResource({ ...base, title: 'B' }, { keepImageIds: [imageId] });
  return { a, b, imageId };
}

describe('stored images', () => {
  it('keeps an image another resource still uses when one resource is deleted', async () => {
    const { a, b, imageId } = await shared();
    await resources.deleteResource(a);
    expect(await ids()).toEqual([imageId]);
    await resources.deleteResource(b);
    expect(await ids()).toEqual([]);
  });

  it('keeps a shared image when one resource drops it, and deletes it once nobody uses it', async () => {
    const { a, b, imageId } = await shared();
    await resources.saveResource({ ...base, title: 'A' }, { id: a, keepImageIds: [] });
    expect(await ids()).toEqual([imageId]);
    await resources.saveResource({ ...base, title: 'B' }, { id: b, keepImageIds: [] });
    expect(await ids()).toEqual([]);
  });

  it('sweeps every unused image, whatever its origin, and keeps used ones', async () => {
    const keep = await resources.saveResource({ ...base, title: 'kept' }, { newImages: [img()] });
    const keptId = (await dbm.db.resources.get(keep))!.imageIds[0];
    const t = new Date().toISOString();
    await dbm.db.images.bulkAdd([
      { id: 'app-orphan', ...img(), createdAt: t },
      { id: 'drive-orphan', ...img(), createdAt: t, driveId: 'd1', driveModified: t, name: 'a.jpg' }
    ]);
    expect(await images.collectOrphanImages()).toBe(2);
    expect(await ids()).toEqual([keptId]);
  });

  it('gives every imported resource its own images', async () => {
    const draft = (title: string) => ({ line: 2, title, type: 'note' as const, stage: 'before' as const, url: '', content: '', tags: [], imageNames: ['a.png'], pinned: false, warnings: [] });
    const [x, y] = await resources.importDrafts([draft('X'), draft('Y')], new Map([['a.png', img()]]));
    const [rx, ry] = await Promise.all([dbm.db.resources.get(x), dbm.db.resources.get(y)]);
    expect(rx!.imageIds).toHaveLength(1);
    expect(rx!.imageIds[0]).not.toBe(ry!.imageIds[0]);
    expect(await images.collectOrphanImages()).toBe(0);
  });
});
