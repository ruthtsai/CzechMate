import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { db } from '../../db';
import type { Category, Exchange, Expense, PaymentMethod, Trip } from '../../db/schema';
import { computeMoney, type MoneyResult } from '../../domain/money';

// Live ledger data plus the computed money state, shared by every page and form.

export interface LedgerData {
  ready: boolean;
  expenses: Expense[];
  exchanges: Exchange[];
  payments: PaymentMethod[];
  categories: Category[];
  trips: Trip[];
  money: MoneyResult;
  payment: (id: string) => PaymentMethod | undefined;
  category: (id: string) => Category | undefined;
  trip: (id: string) => Trip | undefined;
}

const Ctx = createContext<LedgerData | null>(null);

export function LedgerDataProvider({ children }: { children: ReactNode }) {
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);
  const exchanges = useLiveQuery(() => db.exchanges.toArray(), []);
  const payments = useLiveQuery(() => db.paymentMethods.orderBy('order').toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray(), []);
  const trips = useLiveQuery(() => db.trips.orderBy('startDate').reverse().toArray(), []);

  const value = useMemo<LedgerData>(() => {
    const pm = new Map((payments ?? []).map(p => [p.id, p]));
    const cm = new Map((categories ?? []).map(c => [c.id, c]));
    const tm = new Map((trips ?? []).map(t => [t.id, t]));
    const ex = expenses ?? [];
    const fx = exchanges ?? [];
    return {
      ready: !!(expenses && exchanges && payments && categories && trips),
      expenses: ex,
      exchanges: fx,
      payments: payments ?? [],
      categories: categories ?? [],
      trips: trips ?? [],
      money: computeMoney(ex, fx, id => pm.get(id)?.kind),
      payment: id => pm.get(id),
      category: id => cm.get(id),
      trip: id => tm.get(id)
    };
  }, [expenses, exchanges, payments, categories, trips]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger must be used inside LedgerDataProvider');
  return v;
}
