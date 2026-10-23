import type { Category, Expense } from '../../db/schema';
import type { Mode } from '../../domain/constants';
import { monthRange, today, weekRange } from '../../domain/dates';
import type { MoneyResult } from '../../domain/money';
import { normalize, toTerms } from '../../domain/search';

// Ledger filter state shared with other pages (home banners, statistics, the expense form).

export type Period = 'week' | 'month' | 'all' | 'custom';
export interface Filters {
  seg: 'expenses' | 'exchanges';
  period: Period;
  from: string;
  to: string;
  mode: 'all' | Mode;
  tripId: string; // 'all' or id
  /** 'all', a category id, or 'name:<名稱>' for same-named categories across modes (from statistics). */
  categoryId: string;
  paymentId: string;
  missing: null | 'pending' | 'no-rate';
  /** Search text (U-02); while set, the period and trip filters are ignored so older entries are found too. */
  q: string;
}

// Filters the user picks are kept for the session so switching tabs does not reset them.
// Shortcuts from other pages (home banners, statistics) apply once and are not remembered,
// so the next visit through the tab bar shows the usual view again.
let remembered: Filters | null = null;
let preset: Partial<Filters> | null = null;
// The last expense saved anywhere; the ledger makes sure it is visible.
let reveal: { id: string; date: string } | null = null;

/** Starting filters for a ledger visit: the remembered ones plus a one-time shortcut, if any. */
export function takeStartFilters(): Filters {
  const start = { ...(remembered ?? defaultFilters()), ...(preset ?? {}) };
  preset = null;
  return start;
}

export function rememberFilters(f: Filters) {
  remembered = { ...f, missing: null };
}

/** The expense waiting to be revealed, if it exists in `ids`; clears it. */
export function takeReveal(exists: (id: string) => boolean) {
  if (!reveal || !exists(reveal.id)) return null;
  const r = reveal;
  reveal = null;
  return r;
}

export const defaultFilters = (): Filters => {
  const [from, to] = monthRange(today());
  return { seg: 'expenses', period: 'month', from, to, mode: 'all', tripId: 'all', categoryId: 'all', paymentId: 'all', missing: null, q: '' };
};

/** Lets other pages open the ledger with a filter, e.g. the home banner showing pending card payments. */
export function presetLedgerFilter(patch: Partial<Filters>) {
  preset = patch;
}

/** Called after an expense is saved, so it is not hidden by whatever filter the ledger had. */
export function revealExpense(id: string, date: string) {
  reveal = { id, date };
  window.dispatchEvent(new Event('czechmate-reveal'));
}

/**
 * True when every search term appears in the expense's text (item, place, note, plus `extra` such as
 * category, payment and trip names). A number term also matches amounts that start with it.
 */
export function matchesQuery(e: Expense, terms: string[], extra = ''): boolean {
  if (!terms.length) return true;
  const text = normalize(`${e.itemName} ${e.place} ${e.note} ${extra}`);
  const amounts = [e.amount, e.billTwd].filter((n): n is number => typeof n === 'number').map(String);
  return terms.every(t => text.includes(t) || (/^\d+(\.\d*)?$/.test(t) && amounts.some(a => a.startsWith(t))));
}

/** Pure filter used by the ledger list (exported for tests). */
export function filterExpenses(
  f: Filters, expenses: Expense[], calc: MoneyResult['expenses'], category: (id: string) => Category | undefined, now = today(),
  extraText: (e: Expense) => string = () => ''
): Expense[] {
  let out = expenses;
  const terms = toTerms(f.q ?? '');
  if (f.missing) out = out.filter(e => calc.get(e.id)?.source === f.missing);
  else {
    const byTrip = f.mode === 'travel' && f.tripId !== 'all';
    if (terms.length) out = out.filter(e => matchesQuery(e, terms, `${category(e.categoryId)?.name ?? ''} ${extraText(e)}`));
    else if (byTrip) out = out.filter(e => e.tripId === f.tripId);
    else if (f.period !== 'all') {
      const [from, to] = f.period === 'week' ? weekRange(now) : f.period === 'month' ? monthRange(now) : [f.from, f.to];
      out = out.filter(e => e.date >= from && e.date <= to);
    }
    if (f.mode !== 'all') out = out.filter(e => e.mode === f.mode);
    if (f.categoryId.startsWith('name:')) {
      const name = f.categoryId.slice(5);
      out = out.filter(e => category(e.categoryId)?.name === name);
    } else if (f.categoryId !== 'all') out = out.filter(e => e.categoryId === f.categoryId);
    if (f.paymentId !== 'all') out = out.filter(e => e.paymentId === f.paymentId);
  }
  return [...out].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

