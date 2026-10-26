import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateLedgerTables } from '../domain/ledgerRestore';
import { linkedSheet } from '../io/scriptRunner.testkit';
import { SheetsError, type SheetsConfig } from '../io/sheetsClient';
import { db, getSetting, setSetting } from './index';
import { saveExpense, saveTrip } from './ledger';
import { overwriteSheetLedger, restoreLedgerFromSheet, syncLedgerNow } from './sheetsSync';

// The phone talks to the real Apps Script, running against an in-memory spreadsheet.
let env: ReturnType<typeof linkedSheet>['env'];
let cfg: SheetsConfig;
const sheetLedger = () => env.post({ action: 'getLedger' }) as { tables: { expenses: { itemName: string }[]; paymentMethods: unknown[]; settings: unknown[] } | null };
const sheetItems = () => (sheetLedger().tables?.expenses.map(e => e.itemName) ?? []).sort();

const addExpense = (itemName: string, amount = 100) =>
  saveExpense({ date: '2027-01-25', mode: 'daily', categoryId: 'cat-daily-food', amount, currency: 'TWD', paymentId: 'pay-cash', itemName, place: '', note: '' });

const wipePhone = async () => {
  await db.delete();
  await db.open();
};

beforeEach(async () => {
  await wipePhone();
  ({ env, cfg } = linkedSheet());
});

describe('ledger backup and restore through the sheet', () => {
  it('saves the full ledger with the budget and key dates on every sync', async () => {
    await addExpense('午餐');
    await setSetting('budgetMonthly', 15000);
    await setSetting('gsSecret', 'never-sent');
    await syncLedgerNow(cfg);
    const saved = sheetLedger().tables!;
    expect(saved.expenses).toHaveLength(1);
    expect(saved.paymentMethods.length).toBeGreaterThan(0);
    expect(saved.settings).toEqual([{ key: 'budgetMonthly', value: 15000 }]);
    expect(env.sheet('支出總表').getLastRow()).toBeGreaterThan(1);
    expect(await getSetting('gsLedgerOwner', false)).toBe(true);
  });

  it('on a new phone, offers the sheet copy instead of overwriting it', async () => {
    await addExpense('午餐');
    await addExpense('車票');
    await syncLedgerNow(cfg);
    await wipePhone();
    await expect(syncLedgerNow(cfg)).rejects.toBeInstanceOf(SheetsError);
    expect(sheetItems()).toEqual(['午餐', '車票']);
    expect(await getSetting<{ counts: { expenses: number } } | null>('gsRestoreOffer', null)).toMatchObject({ counts: { expenses: 2 } });

    // The phone records something before restoring: still not allowed to overwrite.
    await addExpense('咖啡');
    await expect(syncLedgerNow(cfg)).rejects.toThrow('試算表裡已有 2 筆支出');
    expect(sheetItems()).toEqual(['午餐', '車票']);
  });

  it('restores everything from the sheet, then syncs normally', async () => {
    await saveTrip({ name: '維也納', startDate: '2027-03-10', budgetTwd: 8000 });
    await addExpense('午餐', 120);
    await setSetting('keyDates', [{ id: 'k', title: '出發', date: '2027-01-20' }]);
    await syncLedgerNow(cfg);
    await wipePhone();
    await syncLedgerNow(cfg).catch(() => {});

    const c = await restoreLedgerFromSheet(cfg);
    expect(c).toMatchObject({ expenses: 1, trips: 1 });
    expect((await db.expenses.toArray())[0]).toMatchObject({ itemName: '午餐', amount: 120 });
    expect((await db.trips.toArray())[0]).toMatchObject({ name: '維也納', budgetTwd: 8000 });
    expect(await getSetting('keyDates', [])).toEqual([{ id: 'k', title: '出發', date: '2027-01-20' }]);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();

    await addExpense('晚餐');
    await syncLedgerNow(cfg);
    expect(sheetItems()).toEqual(['午餐', '晚餐']);

    // Restoring made this phone the owner, so it may also empty the ledger.
    await db.expenses.clear();
    await syncLedgerNow(cfg);
    expect(sheetItems()).toEqual([]);
  });

  it('lets a phone that owns the ledger empty it on purpose', async () => {
    await addExpense('午餐');
    await syncLedgerNow(cfg);
    await db.expenses.clear();
    await syncLedgerNow(cfg);
    expect(sheetItems()).toEqual([]);
  });

  it('lets the phone overwrite the sheet when the user chooses to', async () => {
    await addExpense('舊資料');
    await syncLedgerNow(cfg);
    await wipePhone();
    await addExpense('新手機');
    await syncLedgerNow(cfg).catch(() => {});
    await overwriteSheetLedger(cfg);
    expect(sheetItems()).toEqual(['新手機']);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();
  });

  it('syncs without asking when the sheet only holds records the phone already has', async () => {
    await addExpense('午餐');
    await syncLedgerNow(cfg);
    await setSetting('gsLedgerOwner', false); // e.g. unlinked and linked again
    await addExpense('晚餐');
    await syncLedgerNow(cfg);
    expect(sheetItems()).toEqual(['午餐', '晚餐']);
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
