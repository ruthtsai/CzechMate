import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linkedSheet } from '../io/scriptRunner.testkit';
import type { SheetsConfig } from '../io/sheetsClient';
import { db } from './index';
import { saveResource, type ResourceInput } from './resources';
import { processOutbox, pullResources, queueForSheet, SYNC_LOG_MAX, withLogEntry, type SyncLogEntry } from './sheetsSync';

// Tests run without a canvas, so stored images are kept as they arrive.
vi.mock('../io/images', () => ({ compressImage: async (blob: Blob) => ({ blob, width: 1, height: 1 }) }));

// The phone talks to the real Apps Script, running against an in-memory spreadsheet.
let env: ReturnType<typeof linkedSheet>['env'];
let cfg: SheetsConfig;

beforeEach(async () => {
  await db.delete();
  await db.open();
  ({ env, cfg } = linkedSheet());
});

const base: ResourceInput = { title: '', type: 'web', stage: 'after', content: '', tags: [], url: '', pinned: false };
const jpeg = (text: string, type = 'image/jpeg') => ({ blob: new Blob([text], { type }), width: 10, height: 10 });
const blobText = async (id: string) => (await db.images.get(id))!.blob.text();
/** Adds a resource on the phone and queues it for the sheet, as the form does when a sheet is linked. */
const addForSheet = async (title: string, opts: Parameters<typeof saveResource>[1] = {}) => {
  const id = await saveResource({ ...base, title }, { ...opts, source: 'pending' });
  await queueForSheet([id]);
  return id;
};
/** Resource rows of the 資源 sheet, below the header. */
const sheetRows = () => env.sheet('資源').cells.slice(1);
const column = (header: string) => env.sheet('資源').cells[0].indexOf(header);
const titles = () => sheetRows().map(r => r[column('標題')]);
/** Edits a cell of a resource row (0 = the first row below the header), as the user would in the sheet. */
const editCell = (row: number, header: string, value: string) => { sheetRows()[row][column(header)] = value; };

describe('sending phone additions to the sheet', () => {
  it('appends the resource and its image, then treats it as a sheet resource', async () => {
    const id = await addForSheet('布拉格交通卡', { newImages: [jpeg('photo')] });
    expect(await processOutbox(cfg)).toBe(1);

    expect(titles()).toEqual(['布拉格交通卡']);
    expect(env.files).toHaveLength(1);
    expect(await db.resources.get(id)).toMatchObject({ source: 'sheet', sheetRow: 2, imageNames: [env.files[0].name] });
    expect(await db.outbox.count()).toBe(0);
  });

  it('stops at a network failure and keeps the rest queued', async () => {
    await addForSheet('A');
    await addForSheet('B');
    cfg.fetch = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    expect(await processOutbox(cfg)).toBe(0);

    const attempts = (await db.outbox.orderBy('createdAt').toArray()).map(i => i.attempts);
    expect(attempts.sort()).toEqual([0, 1]);
    expect(env.sheet('資源')).toBeUndefined(); // nothing reached the script
  });

  it('stops when the script rejects the secret', async () => {
    await addForSheet('A');
    await addForSheet('B');
    cfg.secret = 'old-key';
    expect(await processOutbox(cfg)).toBe(0);

    const attempts = (await db.outbox.orderBy('createdAt').toArray()).map(i => i.attempts);
    expect(attempts.sort()).toEqual([0, 1]);
  });

  it('skips an item the script refuses and sends the next one', async () => {
    const bad = await addForSheet('壞圖片', { newImages: [jpeg('<html>', 'text/html')] });
    await addForSheet('好資源');
    expect(await processOutbox(cfg)).toBe(1);

    expect(titles()).toEqual(['好資源']);
    expect(await db.outbox.get(bad)).toMatchObject({ attempts: 1, lastError: expect.any(String) });
    expect(await db.resources.get(bad)).toMatchObject({ source: 'pending' });
  });
});

describe('pulling resources from the sheet', () => {
  it('adds, updates and removes resources to match the sheet', async () => {
    env.post({ action: 'appendResource', resource: { ID: 'r1', 標題: '學生證', 類型: '網站', 階段: '抵達後' } });
    env.post({ action: 'appendResource', resource: { ID: 'r2', 標題: '宿舍', 類型: '網站', 階段: '抵達後' } });
    expect(await pullResources(cfg)).toMatchObject({ added: 2, updated: 0, removed: 0 });
    expect((await db.resources.toArray()).map(r => r.title).sort()).toEqual(['學生證', '宿舍'].sort());

    editCell(0, '標題', 'ISIC 學生證');
    env.sheet('資源').cells.splice(2, 1); // the 宿舍 row is deleted in the sheet
    expect(await pullResources(cfg)).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect(await db.resources.toArray()).toEqual([expect.objectContaining({ id: 'r1', title: 'ISIC 學生證', source: 'sheet' })]);
  });

  it('clears the queue for phone additions that have reached the sheet', async () => {
    const id = await addForSheet('簽證');
    // Sent by an earlier attempt whose answer never reached the phone.
    const r = (await db.resources.get(id))!;
    env.post({ action: 'appendResource', resource: { ID: id, 標題: r.title, 類型: '網站', 階段: '抵達後' } });

    await pullResources(cfg);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.resources.get(id)).toMatchObject({ source: 'sheet' });
  });

  it('downloads each named image once, matching names in any case, and drops ones no longer used', async () => {
    env.post({ action: 'uploadImage', name: 'Map.jpg', mime: 'image/jpeg', base64: btoa('map') });
    env.post({ action: 'appendResource', resource: { ID: 'r1', 標題: '地鐵圖', 類型: '網站', 階段: '抵達後', 圖片檔名: 'map.JPG' } });

    expect(await pullResources(cfg)).toMatchObject({ images: 1 });
    const [img] = (await db.resources.get('r1'))!.imageIds;
    expect(await blobText(img)).toBe('map');
    expect(await pullResources(cfg)).toMatchObject({ images: 0 });
    // The same file named in other letter case is the image the phone already has: Drive is not asked again.
    editCell(0, '圖片檔名', 'MAP.jpg');
    const actions: string[] = [];
    const send = cfg.fetch!;
    cfg.fetch = ((url: string, init?: RequestInit) => {
      actions.push(JSON.parse(String(init?.body)).action);
      return send(url, init);
    }) as typeof fetch;
    expect(await pullResources(cfg)).toMatchObject({ images: 0 });
    expect(actions).toEqual(['getResources']);
    expect(await db.resources.get('r1')).toMatchObject({ imageIds: [img] });

    editCell(0, '圖片檔名', '');
    await pullResources(cfg);
    expect(await db.resources.get('r1')).toMatchObject({ imageIds: [] });
    expect(await db.images.count()).toBe(0);
  });
});

describe('sync log', () => {
  it('keeps the newest entries first and drops the oldest past the cap', () => {
    let log: SyncLogEntry[] = [];
    for (let i = 0; i < SYNC_LOG_MAX + 5; i++) log = withLogEntry(log, { at: `t${i}`, job: '記帳', ok: true, message: String(i) });
    expect(log).toHaveLength(SYNC_LOG_MAX);
    expect(log[0].message).toBe(String(SYNC_LOG_MAX + 4));
    expect(log.at(-1)!.message).toBe('5');
  });
});
