import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportDraft } from '../io/csvImport';

// The data layer uses the shared `db`, so give each test its own database name.
let n = 0;
let mod: typeof import('./resources');
let dbm: typeof import('./index');

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('./schema', async () => {
    const real = await vi.importActual<typeof import('./schema')>('./schema');
    return { ...real, DB_NAME: `res-${n++}` };
  });
  dbm = await import('./index');
  mod = await import('./resources');
});
afterEach(async () => {
  await dbm.db.delete();
  vi.doUnmock('./schema');
});

const base = { type: 'web' as const, stage: 'after' as const, content: '', tags: [] as string[], url: '', pinned: false };
const img = () => ({ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 10, height: 10 });

describe('saveResource', () => {
  it('pins only when there is a URL and appends to the pin order', async () => {
    const a = await mod.saveResource({ ...base, title: 'KOS', url: 'https://kos.cvut.cz', pinned: true });
    const b = await mod.saveResource({ ...base, title: 'Moodle', url: 'https://moodle.cvut.cz', pinned: true });
    const c = await mod.saveResource({ ...base, title: '筆記', pinned: true });
    const [ra, rb, rc] = await Promise.all([a, b, c].map(id => dbm.db.resources.get(id)));
    expect([ra?.pinOrder, rb?.pinOrder]).toEqual([1, 2]);
    expect(rc?.pinned).toBe(false);
  });

  it('keeps, removes and appends images, deleting removed blobs', async () => {
    const id = await mod.saveResource({ ...base, title: '截圖' }, { newImages: [img(), img()] });
    const first = (await dbm.db.resources.get(id))!;
    expect(first.imageIds).toHaveLength(2);
    await mod.saveResource({ ...base, title: '截圖' }, { id, keepImageIds: [first.imageIds[1]], newImages: [img()] });
    const second = (await dbm.db.resources.get(id))!;
    expect(second.imageIds[0]).toBe(first.imageIds[1]);
    expect(second.imageIds).toHaveLength(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await dbm.db.images.count()).toBe(2);
    await mod.deleteResource(id);
    expect(await dbm.db.images.count()).toBe(0);
  });
});

describe('tags', () => {
  it('renames, merges and deletes tags across resources', async () => {
    await mod.saveResource({ ...base, title: 'a', tags: ['電信', 'Vodafone'] });
    await mod.saveResource({ ...base, title: 'b', tags: ['電話卡'] });
    await mod.renameTag('電話卡', '電信');
    const all = await dbm.db.resources.toArray();
    expect(all.map(r => [...r.tags].sort().join(',')).sort()).toEqual(['Vodafone,電信', '電信']);
    await mod.deleteTag('電信');
    expect((await dbm.db.resources.toArray()).flatMap(r => r.tags)).toEqual(['Vodafone']);
  });

  it('leaves resources from the Google Sheet alone and reports them', async () => {
    const id = await mod.saveResource({ ...base, title: '試算表的', tags: ['交通'] }, { source: 'sheet' });
    await mod.saveResource({ ...base, title: 'App 的', tags: ['交通'] });
    expect(await mod.renameTag('交通', '運輸')).toBe(1);
    expect((await dbm.db.resources.get(id))?.tags).toEqual(['交通']);
    expect(await mod.deleteTag('交通')).toBe(1);
  });
});

describe('importDrafts', () => {
  it('writes resources with their images and pin order', async () => {
    const draft = (title: string, extra: Partial<ImportDraft> = {}): ImportDraft => ({
      line: 2, title, type: 'note', stage: 'any', url: '', content: '', tags: [], imageNames: [], pinned: false, warnings: [], ...extra
    });
    const ids = await mod.importDrafts(
      [draft('KOS', { url: 'https://kos.cvut.cz', pinned: true }), draft('截圖', { imageNames: ['a.png', 'missing.png'] })],
      new Map([['a.png', img()]])
    );
    expect(ids).toHaveLength(2);
    const shot = (await dbm.db.resources.filter(r => r.title === '截圖').first())!;
    expect(shot.imageIds).toHaveLength(1);
    expect((await dbm.db.resources.filter(r => r.title === 'KOS').first())?.pinOrder).toBe(1);
  });
});
