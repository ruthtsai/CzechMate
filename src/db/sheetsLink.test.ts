import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup } from '../io/backup';
import { linkedSheet } from '../io/scriptRunner.testkit';
import { db, getSetting, setSetting } from './index';
import { saveExpense } from './ledger';
import { deleteKeyDate, getKeyDates, saveKeyDate } from './keyDates';
import { createSheetsLink } from './sheetsLink';
import { syncLedgerNow } from './sheetsSync';

// The phone talks to the real Apps Script, running against an in-memory spreadsheet.
let env: ReturnType<typeof linkedSheet>['env'];
let url: string;
let link: ReturnType<typeof createSheetsLink>;

const addExpense = (itemName: string) =>
  saveExpense({ date: '2027-01-25', mode: 'daily', categoryId: 'cat-daily-food', amount: 100, currency: 'TWD', paymentId: 'pay-cash', itemName, place: '', note: '' });
const wipePhone = async () => {
  await db.delete();
  await db.open();
};
/** A phone set up the way the settings screen leaves it: the script it copied carries this secret. */
const newPhone = async () => {
  await wipePhone();
  await setSetting('gsSecret', 's');
};
const sheetItems = () => ((env.post({ action: 'getLedger' }).tables?.expenses ?? []) as { itemName: string }[]).map(e => e.itemName).sort();

beforeEach(async () => {
  await newPhone();
  const sheet = linkedSheet();
  env = sheet.env;
  url = sheet.cfg.url;
  link = createSheetsLink({ remote: env.fetch });
});

describe('connecting a sheet', () => {
  it('on a new phone, offers the ledger already in the sheet instead of overwriting it', async () => {
    await addExpense('午餐');
    await link.connect(url);
    await newPhone();
    await addExpense('咖啡');

    const r = await link.connect(url);
    expect(r).toMatchObject({ name: 'CzechMate 測試', restoreOffer: { counts: { expenses: 1 } } });
    expect(sheetItems()).toEqual(['午餐']);
  });

  it('links the same phone again without asking, after unlinking', async () => {
    await addExpense('午餐');
    await link.connect(url);
    await link.unlink();
    // Unlinking dropped the key; the sheet's script still has the old one, as if redeployed with it.
    await setSetting('gsSecret', 's');
    await addExpense('晚餐');

    const linked: string[] = [];
    expect(await link.connect(url, { onLinked: name => linked.push(name) })).toEqual({ name: 'CzechMate 測試' });
    expect(linked).toEqual(['CzechMate 測試']);
    expect(sheetItems()).toEqual(['午餐', '晚餐']);
  });

  it('does not carry ledger ownership over to a different sheet', async () => {
    // Another phone has already saved its ledger in a second sheet.
    const other = linkedSheet();
    await addExpense('別支手機');
    await createSheetsLink({ remote: other.env.fetch }).connect(other.cfg.url);
    await newPhone();

    await addExpense('我的');
    await link.connect(url);
    const otherUrl = 'https://script.google.com/macros/s/OTHER/exec'; // the in-memory script answers at any address
    const r = await createSheetsLink({ remote: other.env.fetch }).connect(otherUrl);
    expect(r.restoreOffer).toMatchObject({ counts: { expenses: 1 } });
    expect(other.env.post({ action: 'getLedger' }).tables.expenses.map((e: { itemName: string }) => e.itemName)).toEqual(['別支手機']);
  });

  it('rejects an address that is not a deployed script, linking nothing', async () => {
    await expect(link.connect('https://docs.google.com/spreadsheets/d/x/edit')).rejects.toMatchObject({ code: 'config' });
    expect(await getSetting('gsUrl', null)).toBeNull();
  });
});

describe('answering the restore offer', () => {
  beforeEach(async () => {
    await addExpense('午餐');
    await link.connect(url);
    await newPhone();
    await addExpense('咖啡');
    await link.connect(url);
  });

  it('restoring puts the sheet ledger on the phone', async () => {
    expect(await link.previewRestore()).toMatchObject({ counts: { expenses: 1 } });
    expect(await link.restoreFromSheet()).toMatchObject({ expenses: 1 });
    expect((await db.expenses.toArray()).map(e => e.itemName)).toEqual(['午餐']);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();
  });

  it('overwriting puts the phone ledger in the sheet', async () => {
    await link.overwriteSheet();
    expect(sheetItems()).toEqual(['咖啡']);
    expect(await getSetting('gsRestoreOffer', null)).toBeNull();
  });
});

describe('knowing when the ledger needs sending', () => {
  beforeEach(async () => {
    await addExpense('午餐');
    await link.connect(url);
  });

  it('a budget change needs sending, and sending settles it', async () => {
    expect(await link.ledgerNeedsSending()).toBe(false);
    await setSetting('budgetMonthly', 15000);
    expect(await link.ledgerNeedsSending()).toBe(true);
    await link.syncLedger();
    expect(await link.ledgerNeedsSending()).toBe(false);
  });

  it('adding, editing and removing a key date each need sending', async () => {
    const sent = async () => {
      expect(await link.ledgerNeedsSending()).toBe(true);
      await link.syncLedger();
      expect(await link.ledgerNeedsSending()).toBe(false);
    };
    await saveKeyDate({ title: '出發', date: '2027-01-20' });
    await sent();
    const [d] = await getKeyDates();
    await saveKeyDate({ title: '出發（改期）', date: '2027-01-22' }, d.id);
    await sent();
    await deleteKeyDate(d.id);
    await sent();
  });

  it('still needs sending when the sheet did not keep the full ledger', async () => {
    await addExpense('晚餐');
    // An older script ignores the full ledger and keeps only the summary sheets.
    const older = createSheetsLink({
      remote: ((u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        delete body.raw;
        return env.fetch(u, { ...init, body: JSON.stringify(body) });
      }) as typeof fetch
    });
    await older.syncLedger();
    expect(await link.ledgerNeedsSending()).toBe(true);
  });

  it('a ledger just restored from the sheet needs no sending', async () => {
    await newPhone();
    await link.connect(url);
    await link.restoreFromSheet();
    expect(await link.ledgerNeedsSending()).toBe(false);
  });

  it('a phone updated from an earlier version sends once', async () => {
    await db.settings.delete('gsPushedFingerprint');
    expect(await link.ledgerNeedsSending()).toBe(true);
    await link.syncLedger();
    expect(await link.ledgerNeedsSending()).toBe(false);
  });
});

describe('testing the connection and changing the key', () => {
  it('reports the image folder the deployed script uses', async () => {
    await link.connect(url);
    expect(await link.testConnection()).toEqual({ imageFolder: 'CzechMate 圖片' });
  });

  it('a new key stops working until the script is redeployed with it', async () => {
    await link.connect(url);
    await link.rotateKey();
    expect(await getSetting('gsSecret', '')).not.toBe('s');
    await expect(link.testConnection()).rejects.toMatchObject({ code: 'secret' });
  });
});

describe('phone backups', () => {
  const settingKeys = (b: Awaited<ReturnType<typeof createBackup>>) => (b.data.settings as { key: string }[]).map(s => s.key).filter(k => k.startsWith('gs')).sort();

  beforeEach(async () => {
    await addExpense('午餐');
    await link.connect(url);
    await setSetting('gsAutoSync', false);
  });

  it('carry sync preferences but not the link, and the address and key only when asked', async () => {
    expect(settingKeys(await createBackup(db))).toEqual(['gsAutoSync']);
    expect(settingKeys(await createBackup(db, { includeSecrets: true }))).toEqual(['gsAutoSync', 'gsSecret', 'gsUrl']);
  });

  it('restoring an older backup does not overwrite a newer ledger in the sheet', async () => {
    const backup = await createBackup(db);
    // Backups from earlier versions carried ledger ownership.
    backup.data.settings.push({ key: 'gsLedgerOwner', value: true });
    await addExpense('晚餐');
    await syncLedgerNow({ url, secret: 's', fetch: env.fetch });

    await restoreBackup(db, backup);
    await syncLedgerNow({ url, secret: 's', fetch: env.fetch }).catch(() => {});
    expect(await getSetting('gsRestoreOffer', null)).toMatchObject({ counts: { expenses: 2 } });
    expect(sheetItems()).toEqual(['午餐', '晚餐']);
    expect(await getSetting('gsSheetName', null)).toBe('CzechMate 測試'); // still linked
  });

  it('restoring a backup with the address and key starts a fresh link with them', async () => {
    const backup = await createBackup(db, { includeSecrets: true });
    // Backups from earlier versions carried every link setting.
    const old = [{ key: 'gsLedgerOwner', value: true }, { key: 'gsSheetName', value: '舊的' }];
    backup.data.settings = [...(backup.data.settings as { key: string }[]).filter(s => !old.some(o => o.key === s.key)), ...old];
    await newPhone();

    await restoreBackup(db, backup);
    expect(await getSetting('gsUrl', null)).toBe(url);
    expect(await getSetting('gsSecret', null)).toBe('s');
    expect(await getSetting('gsSheetName', null)).toBeNull();
    expect(await getSetting('gsLedgerOwner', null)).toBeNull();
    expect(await getSetting('gsAutoSync', true)).toBe(false);
  });

  it('restoring a backup with only an address keeps the phone link as it is', async () => {
    const backup = await createBackup(db);
    backup.data.settings.push({ key: 'gsUrl', value: 'https://script.google.com/macros/s/OLD/exec' });

    await restoreBackup(db, backup);
    expect(await getSetting('gsUrl', null)).toBe(url);
    expect(await getSetting('gsSecret', null)).toBe('s');
    expect(await getSetting('gsSheetName', null)).toBe('CzechMate 測試');
  });
});

describe('unlinking', () => {
  it('keeps every resource and the sheet, forgets the link, and keeps sync preferences', async () => {
    env.post({ action: 'appendResource', resource: { ID: 'r1', 標題: '學生證', 類型: '網站', 階段: '抵達後' } });
    await link.connect(url);
    await setSetting('gsAutoSync', false);
    await setSetting('gsImageFolder', '交換計畫');
    await db.outbox.put({ id: 'q', kind: 'appendResource', resourceId: 'r1', createdAt: '2027-01-01T00:00:00Z', attempts: 0 });

    await link.unlink();
    expect(await db.resources.get('r1')).toMatchObject({ title: '學生證', source: 'app' });
    expect(await db.outbox.count()).toBe(0);
    expect(env.sheet('資源').cells).toHaveLength(2);
    for (const k of ['gsUrl', 'gsSecret', 'gsSheetUrl', 'gsSheetName', 'gsScriptImageFolder', 'gsScriptFeatures', 'gsLedgerOwner', 'gsLastSyncAt', 'gsSyncLog']) {
      expect(await getSetting(k, null), k).toBeNull();
    }
    expect(await getSetting('gsAutoSync', true)).toBe(false);
    expect(await getSetting('gsImageFolder', null)).toBe('交換計畫');
  });
});
