import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDB, type CzechMateDB } from '../db';
import { base64ToBlob, blobToBase64, createBackup, parseBackup, restoreBackup, RestoreError } from './backup';

let n = 0;
const open: CzechMateDB[] = [];
const fresh = () => {
  const d = createDB(`backup-${n++}`);
  open.push(d);
  return d;
};
afterEach(async () => {
  for (const d of open.splice(0)) await d.delete();
});

async function fill(d: CzechMateDB) {
  await d.trips.add({ id: 't1', name: '維也納', startDate: '2027-03-05', createdAt: '2027-03-01T00:00:00Z' });
  await d.expenses.add({
    id: 'e1', date: '2027-03-05', mode: 'travel', categoryId: 'cat-travel-food', amount: 18.5, currency: 'EUR', paymentId: 'pay-cash',
    tripId: 't1', itemName: '炸肉排', place: 'Wien', note: '', createdAt: '2027-03-05T12:00:00Z', updatedAt: '2027-03-05T12:00:00Z'
  });
  await d.exchanges.add({
    id: 'x1', date: '2027-01-08', method: 'cash', outAmount: 5000, outCurrency: 'TWD', inAmount: 145, inCurrency: 'EUR',
    place: '台灣銀行', note: '', createdAt: '2027-01-08T00:00:00Z', updatedAt: '2027-01-08T00:00:00Z'
  });
  await d.paymentMethods.add({ id: 'pay-revolut', name: 'Revolut', kind: 'debit', order: 5, active: true });
  await d.handbookSections.add({ id: 's1', sourceId: 'hb-tchajwan', pageTitle: 'p', pageUrl: 'u', heading: 'h', anchor: 'a', text: 't', order: 0 });
}

describe('base64 helpers', () => {
  it('round-trips binary data', async () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    const b64 = await blobToBase64(new Blob([bytes]));
    const back = new Uint8Array(await base64ToBlob(b64, 'image/jpeg').arrayBuffer());
    expect(back).toEqual(bytes);
  });
});

describe('backup and restore', () => {
  it('restores every record into an empty database and drops handbook sections', async () => {
    const src = fresh();
    await fill(src);
    const json = JSON.stringify(await createBackup(src));

    const dst = fresh();
    await dst.expenses.add({ ...(await src.expenses.get('e1'))!, id: 'stale' });
    await dst.handbookSections.add({ id: 'old', sourceId: 'x', pageTitle: '', pageUrl: '', heading: '', anchor: '', text: '', order: 0 });
    await restoreBackup(dst, parseBackup(json));

    expect(await dst.expenses.toArray()).toEqual(await src.expenses.toArray());
    expect(await dst.exchanges.toArray()).toEqual(await src.exchanges.toArray());
    expect(await dst.trips.toArray()).toEqual(await src.trips.toArray());
    expect(await dst.paymentMethods.count()).toBe(6);
    expect(await dst.categories.count()).toBe(23);
    expect(await dst.handbookSections.count()).toBe(0);
    expect(await dst.expenses.get('stale')).toBeUndefined();
  });

  it('backs up and restores images (regression: encoding inside the transaction failed)', async () => {
    const src = fresh();
    await src.images.add({ id: 'img1', blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }), width: 4, height: 1, createdAt: 'x' });
    const backup = await createBackup(src);
    expect(backup.data.images).toHaveLength(1);
    const dst = fresh();
    await restoreBackup(dst, parseBackup(JSON.stringify(backup)));
    const im = await dst.images.get('img1');
    expect(new Uint8Array(await im!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]));
  });

  it('records the format and version', async () => {
    const b = await createBackup(fresh());
    expect(b).toMatchObject({ app: 'CzechMate', schemaVersion: 1 });
    expect(b.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('excludes Google Sheets credentials by default (S-01) and preserves local ones on restore unless opted in', async () => {
    const src = fresh();
    await src.settings.bulkPut([
      { key: 'theme', value: 'dark' },
      { key: 'gsUrl', value: 'https://script.google.com/macros/s/AKfy_test/exec' },
      { key: 'gsSecret', value: 'super-secret-key-32-characters-xx' }
    ]);
    const safeBackup = await createBackup(src);
    expect(safeBackup.data.settings).toEqual([{ key: 'theme', value: 'dark' }]);

    const fullBackup = await createBackup(src, { includeSecrets: true });
    expect(fullBackup.data.settings).toHaveLength(3);

    // Restoring a secret-free backup on a linked phone keeps the phone's existing secret.
    const dst = fresh();
    await dst.settings.bulkPut([
      { key: 'gsUrl', value: 'https://script.google.com/macros/s/AKfy_local/exec' },
      { key: 'gsSecret', value: 'local-secret' }
    ]);
    await restoreBackup(dst, parseBackup(JSON.stringify(safeBackup)));
    expect((await dst.settings.get('gsSecret'))?.value).toBe('local-secret');
    expect((await dst.settings.get('theme'))?.value).toBe('dark');
  });
});

describe('parseBackup', () => {
  it('rejects files that are not CzechMate backups', () => {
    expect(() => parseBackup('not json')).toThrow(RestoreError);
    expect(() => parseBackup('{"app":"Other","schemaVersion":1,"data":{}}')).toThrow('不是 CzechMate 的備份檔');
  });
  it('rejects backups from a newer version', () => {
    expect(() => parseBackup('{"app":"CzechMate","schemaVersion":99,"data":{}}')).toThrow('較新版本');
  });
  it('rejects unsafe URLs in resources or settings', () => {
    expect(() =>
      parseBackup(JSON.stringify({ app: 'CzechMate', schemaVersion: 1, data: { resources: [{ id: '1', url: 'javascript:alert(1)' }] } }))
    ).toThrow('資源網址');
    expect(() =>
      parseBackup(JSON.stringify({ app: 'CzechMate', schemaVersion: 1, data: { settings: [{ key: 'gsUrl', value: 'https://evil.example/exec' }] } }))
    ).toThrow('試算表腳本網址');
  });
});
