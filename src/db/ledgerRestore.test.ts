import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawLedger } from '../io/sheetsClient';
import { validateLedgerTables } from '../domain/ledgerRestore';

// A fake sheet that keeps whatever the app pushes, like the script's hidden _記帳原始資料 tab.
const sheet: { raw: RawLedger | null; pushes: { allowEmpty: boolean }[] } = { raw: null, pushes: [] };
const counts = (r: RawLedger | null) => ({
  expenses: r?.expenses.length ?? 0, exchanges: r?.exchanges.length ?? 0, trips: r?.trips.length ?? 0,
  paymentMethods: r?.paymentMethods.length ?? 0, categories: r?.categories.length ?? 0, settings: r?.settings.length ?? 0
});

vi.mock('../io/sheetsClient', async importOriginal => {
  const real = await importOriginal<typeof import('../io/sheetsClient')>();
  return {
    ...real,
    pushLedger: vi.fn(async (_cfg: unknown, _sheets: unknown, raw: RawLedger, allowEmpty: boolean) => {
      sheet.pushes.push({ allowEmpty });
      sheet.raw = JSON.parse(JSON.stringify(raw));
      return { syncedAt: '2027-02-01T10:00:00Z', sheets: 5, rawSaved: true };
    }),
    getLedger: vi.fn(async () => ({ tables: sheet.raw, syncedAt: '2027-02-01T10:00:00Z', counts: counts(sheet.raw) }))
  };
});

const { db, getSetting, setSetting } = await import('./index');
const { restoreLedgerFromSheet, syncLedgerNow, overwriteSheetLedger } = await import('./sheetsSync');
const { saveExpense, saveTrip } = await import('./ledger');
const { SheetsError } = await import('../io/sheetsClient');

const cfg = { url: 'https://script.google.com/macros/s/TEST/exec', secret: 's' };
const addExpense = (itemName: string, amount = 100) =>
  saveExpense({ date: '2027-01-25', mode: 'daily', categoryId: 'cat-daily-food', amount, currency: 'TWD', paymentId: 'pay-cash', itemName, place: '', note: '' });

beforeEach(async () => {
  await db.delete();
  await db.open();
  sheet.raw = null;
  sheet.pushes = [];
});

describe('ledger backup and restore through the sheet', () => {
  it('saves the full ledger with the budget and key dates on every sync', async () => {
    await addExpense('午餐');
    await setSetting('budgetMonthly', 15000);
    await setSetting('gsSecret', 'never-sent');
    await syncLedgerNow(cfg);
    expect(sheet.raw?.expenses).toHaveLength(1);
    expect(sheet.raw?.paymentMethods.length).toBeGreaterThan(0);
    expect(sheet.raw?.settings).toEqual([{ key: 'budgetMonthly', value: 15000 }]);
    expect(await getSetting('gsLedgerOwner', false)).toBe(true);
  });

  it('on a new phone, offers the sheet copy instead of overwriting it', async () => {
    await addExpense('午餐');
    await addExpense('車票');
    await syncLedgerNow(cfg);
    // Same sheet, wiped phone.
    await db.delete();
    await db.open();
    await expect(syncLedgerNow(cfg)).rejects.toBeInstanceOf(SheetsError);
    expect(sheet.pushes).toHaveLength(1);
    expect(await getSetting<{ counts: { expenses: number } } | null>('gsRestoreOffer', null)).toMatchObject({ counts: { expenses: 2 } });

    // The phone records something before restoring: still not allowed to overwrite.
    await addExpense('咖啡');
    await expect(syncLedgerNow(cfg)).rejects.toThrow('試算表裡已有 2 筆支出');
    expect(sheet.raw?.expenses).toHaveLength(2);
  });

  it('restores everything from the sheet, then syncs normally', async () => {
    await saveTrip({ name: '維也納', startDate: '2027-03-10', budgetTwd: 8000 });
    await addExpense('午餐', 120);
    await setSetting('keyDates', [{ id: 'k', title: '出發', date: '2027-01-20' }]);
    await syncLedgerNow(cfg);
    await db.delete();
    await db.open();
    await syncLedgerNow(cfg).catch(() => {});

    const c = await restoreLedgerFromSheet(cfg);
    expect(c).toMatchObject({ expenses: 1, trips: 1 });
    expect((await db.expenses.toArray())[0]).toMatchObject({ itemName: '午餐', amount: 120 });
    expect((await db.trips.toArray())[0]).toMatchObject({ name: '維也納', budgetTwd: 8000 });
    expect(await getSetting('keyDates', [])).toEqual([{ id: 'k', title: '出發', date: '2027-01-20' }]);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();

    await addExpense('晚餐');
    await syncLedgerNow(cfg);
    expect(sheet.raw?.expenses).toHaveLength(2);
    expect(sheet.pushes.at(-1)).toEqual({ allowEmpty: true });
  });

  it('lets the phone overwrite the sheet when the user chooses to', async () => {
    await addExpense('舊資料');
    await syncLedgerNow(cfg);
    await db.delete();
    await db.open();
    await addExpense('新手機');
    await syncLedgerNow(cfg).catch(() => {});
    await overwriteSheetLedger(cfg);
    expect(sheet.raw?.expenses.map(e => (e as { itemName: string }).itemName)).toEqual(['新手機']);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();
  });

  it('syncs without asking when the sheet only holds records the phone already has', async () => {
    await addExpense('午餐');
    await syncLedgerNow(cfg);
    await setSetting('gsLedgerOwner', false); // e.g. unlinked and linked again
    await addExpense('晚餐');
    await syncLedgerNow(cfg);
    expect(sheet.raw?.expenses).toHaveLength(2);
  });
});

describe('validateLedgerTables', () => {
  const ok = { expenses: [], exchanges: [], trips: [], paymentMethods: [{ id: 'p' }], categories: [{ id: 'c' }], settings: [] };

  it('accepts a well-formed copy and keeps only ledger settings', () => {
    const r = validateLedgerTables({ ...ok, settings: [{ key: 'budgetMonthly', value: 1 }, { key: 'gsSecret', value: 'x' }] });
    expect(r.ok && r.tables.settings).toEqual([{ key: 'budgetMonthly', value: 1 }]);
  });

  it('rejects missing tables, records without IDs and broken expenses', () => {
    expect(validateLedgerTables(null)).toMatchObject({ ok: false });
    expect(validateLedgerTables({ ...ok, trips: undefined })).toMatchObject({ ok: false });
    expect(validateLedgerTables({ ...ok, trips: [{ name: 'x' }] })).toMatchObject({ ok: false });
    expect(validateLedgerTables({ ...ok, expenses: [{ id: 'e', date: '2027/01/01', amount: 1, currency: 'CZK', paymentId: 'p' }] })).toMatchObject({ ok: false });
    expect(validateLedgerTables({ ...ok, paymentMethods: [] })).toMatchObject({ ok: false });
  });
});
