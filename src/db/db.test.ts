import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDB, getSetting, setSetting, type CzechMateDB } from './index';
import { DEFAULT_CATEGORIES } from './seed';

let n = 0;
const open: CzechMateDB[] = [];
function freshDB() {
  const d = createDB(`test-${n++}`);
  open.push(d);
  return d;
}
afterEach(async () => {
  for (const d of open.splice(0)) await d.delete();
});

describe('database seed', () => {
  it('creates the five default payment methods with exactly one cash method', async () => {
    const d = freshDB();
    const pays = await d.paymentMethods.orderBy('order').toArray();
    expect(pays.map(p => p.name)).toEqual(['現金', '國泰世華 Cube', '中國信託簽帳卡', '中國信託 uniopen', '兆豐 Mega']);
    expect(pays.filter(p => p.kind === 'cash')).toHaveLength(1);
  });

  it('creates the default categories for each mode', async () => {
    const d = freshDB();
    expect(await d.categories.where('mode').equals('prep').count()).toBe(8);
    expect(await d.categories.where('mode').equals('daily').count()).toBe(9);
    expect(await d.categories.where('mode').equals('travel').count()).toBe(6);
  });

  it('gives categories with the same name the same colour across modes', () => {
    const byName = new Map<string, Set<number>>();
    for (const c of DEFAULT_CATEGORIES) byName.set(c.name, (byName.get(c.name) ?? new Set()).add(c.color));
    for (const colours of byName.values()) expect(colours.size).toBe(1);
  });

  it('keeps category names unique within a mode', () => {
    const keys = DEFAULT_CATEGORIES.map(c => `${c.mode}/${c.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('adds the survival guide as a handbook source', async () => {
    const d = freshDB();
    const src = await d.handbookSources.get('hb-tchajwan');
    expect(src?.kind).toBe('book');
  });

  it('does not seed twice when the database is reopened', async () => {
    const name = `test-reopen-${n++}`;
    const first = createDB(name);
    await first.open();
    first.close();
    const second = createDB(name);
    open.push(second);
    expect(await second.paymentMethods.count()).toBe(5);
  });
});

describe('settings', () => {
  it('returns the fallback for a missing key and stores values', async () => {
    const d = freshDB();
    expect(await getSetting('lastMode', 'daily', d)).toBe('daily');
    await setSetting('lastMode', 'travel', d);
    expect(await getSetting('lastMode', 'daily', d)).toBe('travel');
  });

  it('defaults the theme to follow the system', async () => {
    const d = freshDB();
    expect(await getSetting('theme', 'light', d)).toBe('system');
  });
});
