import type { Currency, PaymentKind } from './constants';
import type { Exchange, Expense } from '../db/schema';

// Cash stock and moving-average cost engine: requirements spec section 5.
// Pure function over all exchanges and expenses; recomputed from scratch on every change.

export type TwdSource = 'twd' | 'cash' | 'bill' | 'pending' | 'no-rate';

export const TWD_SOURCE_LABEL: Record<TwdSource, string> = {
  twd: '台幣',
  cash: '現金換算',
  bill: '帳單',
  pending: '待補',
  'no-rate': '無匯率'
};

export interface ExpenseCalc {
  twd: number | null;
  source: TwdSource;
  /** Average cost used for a cash foreign-currency expense. */
  rate?: number;
  /** Cash stock of this currency went negative with this expense. */
  lowStock?: boolean;
}

export interface ExchangeCalc {
  /** TWD cost of the currency received; null when the source currency had no cost yet. */
  cost: number | null;
  /** TWD per unit received (null when converting back to TWD or cost unknown). */
  rate: number | null;
  /** Converting back to TWD: received TWD minus the cost of the currency given up. */
  gain?: number;
  missingRate?: boolean;
}

export interface CashState {
  stock: number;
  avg: number | null;
}

export interface MoneyResult {
  expenses: Map<string, ExpenseCalc>;
  exchanges: Map<string, ExchangeCalc>;
  cash: Partial<Record<Currency, CashState>>;
}

type KindOf = (paymentId: string) => PaymentKind | undefined;

interface Event {
  date: string;
  order: 0 | 1; // exchanges before expenses on the same day
  createdAt: string;
  exchange?: Exchange;
  expense?: Expense;
}

function sortEvents(exchanges: Exchange[], expenses: Expense[]): Event[] {
  const events: Event[] = [
    ...exchanges.map(x => ({ date: x.date, order: 0 as const, createdAt: x.createdAt, exchange: x })),
    ...expenses.map(e => ({ date: e.date, order: 1 as const, createdAt: e.createdAt, expense: e }))
  ];
  return events.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.order !== b.order ? a.order - b.order : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );
}

export function computeMoney(expenses: Expense[], exchanges: Exchange[], kindOf: KindOf, until?: (e: Event) => boolean): MoneyResult {
  const cash: Partial<Record<Currency, CashState>> = {};
  const state = (c: Currency) => (cash[c] ??= { stock: 0, avg: null });
  const exCalc = new Map<string, ExchangeCalc>();
  const expCalc = new Map<string, ExpenseCalc>();

  for (const ev of sortEvents(exchanges, expenses)) {
    if (until && until(ev)) break;
    if (ev.exchange) {
      const x = ev.exchange;
      let cost: number | null;
      if (x.outCurrency === 'TWD') cost = x.outAmount;
      else {
        const out = state(x.outCurrency);
        cost = out.avg === null ? null : x.outAmount * out.avg;
        out.stock -= x.outAmount;
      }
      if (x.inCurrency === 'TWD') {
        exCalc.set(x.id, { cost, rate: null, gain: cost === null ? undefined : x.inAmount - Math.round(cost), missingRate: cost === null });
        continue;
      }
      const into = state(x.inCurrency);
      if (cost !== null) {
        // Stock whose cost is unknown (received before any rate existed) does not weigh in the average.
        const s = into.avg === null ? 0 : Math.max(into.stock, 0);
        into.avg = (s * (into.avg ?? 0) + cost) / (s + x.inAmount);
      }
      into.stock += x.inAmount;
      exCalc.set(x.id, { cost, rate: cost === null ? null : cost / x.inAmount, missingRate: cost === null });
    } else if (ev.expense) {
      const e = ev.expense;
      const kind = kindOf(e.paymentId);
      if (e.currency === 'TWD') expCalc.set(e.id, { twd: e.amount, source: 'twd' });
      else if (kind === 'cash') {
        const st = state(e.currency);
        st.stock -= e.amount;
        const lowStock = st.stock < -1e-9 || undefined;
        if (st.avg === null) expCalc.set(e.id, { twd: null, source: 'no-rate', lowStock });
        else expCalc.set(e.id, { twd: Math.round(e.amount * st.avg), source: 'cash', rate: st.avg, lowStock });
      } else if (e.billTwd && e.billTwd > 0) expCalc.set(e.id, { twd: e.billTwd, source: 'bill' });
      else expCalc.set(e.id, { twd: null, source: 'pending' });
    }
  }
  return { expenses: expCalc, exchanges: exCalc, cash };
}

/**
 * Cash state as seen by a new or edited record on `date`: every other record up to and including that day.
 * Used for form previews and to block foreign→foreign exchanges without a cost.
 */
export function cashStateOn(date: string, expenses: Expense[], exchanges: Exchange[], kindOf: KindOf, excludeId?: string) {
  return computeMoney(
    expenses.filter(e => e.id !== excludeId),
    exchanges.filter(x => x.id !== excludeId),
    kindOf,
    ev => ev.date > date
  ).cash;
}

/** Sum of TWD amounts plus what is still missing, per currency (requirements spec 5.4). */
export function summarize(list: Expense[], calc: Map<string, ExpenseCalc>) {
  let twd = 0;
  const missing: Partial<Record<Currency, number>> = {};
  let missingCount = 0;
  for (const e of list) {
    const c = calc.get(e.id);
    if (c?.twd != null) twd += c.twd;
    else {
      missingCount++;
      missing[e.currency] = (missing[e.currency] ?? 0) + e.amount;
    }
  }
  return { twd, missing, missingCount };
}
