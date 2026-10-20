import type { Category, Expense, PaymentMethod, Trip } from '../db/schema';
import type { Currency, Mode } from './constants';
import { CURRENCIES } from './constants';
import { daysBetween, monthKey } from './dates';
import { summarize, type ExpenseCalc } from './money';

// Statistics: requirements spec 5.4.

type Calc = Map<string, ExpenseCalc>;

export interface CategorySlice {
  name: string;
  color: number;
  twd: number;
  /** Category ids merged under this name (same name across modes). */
  ids: string[];
}

/** TWD per category, merging same-named categories across modes, largest first, zero totals dropped. */
export function byCategory(list: Expense[], calc: Calc, categories: Category[]): CategorySlice[] {
  const byId = new Map(categories.map(c => [c.id, c]));
  const slices = new Map<string, CategorySlice>();
  for (const e of list) {
    const twd = calc.get(e.id)?.twd;
    if (twd == null) continue;
    const c = byId.get(e.categoryId);
    const name = c?.name ?? '未分類';
    const s = slices.get(name) ?? { name, color: c?.color ?? 10, twd: 0, ids: [] };
    s.twd += twd;
    if (c && !s.ids.includes(c.id)) s.ids.push(c.id);
    slices.set(name, s);
  }
  return [...slices.values()].filter(s => s.twd > 0).sort((a, b) => b.twd - a.twd);
}

export const filterMonth = (list: Expense[], month: string, mode: 'all' | Mode = 'all') =>
  list.filter(e => monthKey(e.date) === month && (mode === 'all' || e.mode === mode));

/** Months that have expenses, oldest first; always includes `current`. */
export function monthsWithData(list: Expense[], current: string): string[] {
  return [...new Set([...list.map(e => monthKey(e.date)), current])].sort();
}

export interface TripSummary {
  trip: Trip;
  start: string;
  end: string;
  days: number;
  twd: number;
  perDay: number;
  missingCount: number;
  missing: Partial<Record<Currency, number>>;
  categories: CategorySlice[];
  expenses: Expense[];
}

export function tripSummaries(trips: Trip[], list: Expense[], calc: Calc, categories: Category[]): TripSummary[] {
  return trips.map(trip => {
    const expenses = list.filter(e => e.tripId === trip.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = expenses.at(-1)?.date;
    // No end date: use the last expense (never before the start).
    const end = trip.endDate ?? (last && last > trip.startDate ? last : trip.startDate);
    const days = daysBetween(trip.startDate, end) + 1;
    const s = summarize(expenses, calc);
    return {
      trip, start: trip.startDate, end, days, twd: s.twd, perDay: s.twd / days,
      missingCount: s.missingCount, missing: s.missing, categories: byCategory(expenses, calc, categories), expenses
    };
  });
}

export interface PaymentSummary {
  payment: PaymentMethod;
  count: number;
  /** Original-currency subtotals in CURRENCIES order. */
  byCurrency: [Currency, number][];
  /** Cash: converted TWD. Cards: filled-in bill amounts plus TWD purchases. */
  twd: number;
  pending: Expense[];
  expenses: Expense[];
}

export function paymentSummaries(payments: PaymentMethod[], list: Expense[], calc: Calc): PaymentSummary[] {
  return payments
    .map(payment => {
      const expenses = list.filter(e => e.paymentId === payment.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const totals = new Map<Currency, number>();
      for (const e of expenses) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
      const s = summarize(expenses, calc);
      return {
        payment,
        count: expenses.length,
        byCurrency: CURRENCIES.filter(c => totals.has(c)).map(c => [c, totals.get(c)!] as [Currency, number]),
        twd: s.twd,
        pending: expenses.filter(e => calc.get(e.id)?.source === 'pending'),
        expenses
      };
    })
    .filter(p => p.count > 0);
}
