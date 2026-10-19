import { describe, expect, it } from 'vitest';
import type { Exchange, Expense } from '../db/schema';
import type { Currency, PaymentKind } from './constants';
import { cashStateOn, computeMoney, summarize } from './money';

// Worked examples from requirements spec 5.3.

const KIND: Record<string, PaymentKind> = { 'pay-cash': 'cash', 'pay-cube': 'credit', 'pay-debit': 'debit' };
const kindOf = (id: string) => KIND[id];
let t = 0;
const stamp = () => new Date(Date.UTC(2027, 0, 1, 0, 0, t++)).toISOString();

function fx(id: string, date: string, outAmount: number, outCurrency: Currency, inAmount: number, inCurrency: Currency, extra: Partial<Exchange> = {}): Exchange {
  return { id, date, method: 'cash', outAmount, outCurrency, inAmount, inCurrency, place: '', note: '', createdAt: stamp(), updatedAt: '', ...extra };
}
function ex(id: string, date: string, amount: number, currency: Currency, paymentId = 'pay-cash', extra: Partial<Expense> = {}): Expense {
  return { id, date, mode: 'daily', categoryId: 'c', amount, currency, paymentId, itemName: '', place: '', note: '', createdAt: stamp(), updatedAt: '', ...extra };
}

describe('example A: exchanges and cash expenses', () => {
  const exchanges = [fx('x1', '2027-01-08', 9800, 'TWD', 7000, 'CZK'), fx('x2', '2027-03-01', 4260, 'TWD', 3000, 'CZK', { method: 'atm', cardId: 'pay-cube', estimated: true })];
  const expenses = [ex('e1', '2027-01-26', 300, 'CZK'), ex('e2', '2027-02-03', 642, 'CZK'), ex('e3', '2027-03-03', 518, 'CZK')];
  const r = computeMoney(expenses, exchanges, kindOf);

  it('converts with the average cost and rounds each expense', () => {
    expect(r.expenses.get('e1')).toMatchObject({ twd: 420, source: 'cash', rate: 1.4 });
    expect(r.expenses.get('e2')?.twd).toBe(899);
    expect(r.expenses.get('e3')?.twd).toBe(729);
  });

  it('re-averages after the ATM withdrawal', () => {
    expect(r.exchanges.get('x2')?.rate).toBeCloseTo(1.42, 6);
    expect(r.cash.CZK?.avg).toBeCloseTo(1.406624, 6);
    expect(r.cash.CZK?.stock).toBe(8540);
  });
});

describe('example B: correcting the ATM bill amount', () => {
  it('recomputes later cash expenses', () => {
    const exchanges = [fx('x1', '2027-01-08', 9800, 'TWD', 7000, 'CZK'), fx('x2', '2027-03-01', 4301, 'TWD', 3000, 'CZK', { method: 'atm', cardId: 'pay-cube' })];
    const expenses = [ex('e1', '2027-01-26', 300, 'CZK'), ex('e2', '2027-02-03', 642, 'CZK'), ex('e3', '2027-03-03', 518, 'CZK')];
    const r = computeMoney(expenses, exchanges, kindOf);
    expect(r.cash.CZK?.avg).toBeCloseTo(1.41115, 5);
    expect(r.expenses.get('e3')?.twd).toBe(731);
  });
});

describe('example C: foreign to foreign', () => {
  it('carries the EUR cost into HUF', () => {
    const exchanges = [fx('x1', '2027-01-08', 5000, 'TWD', 145, 'EUR'), fx('x2', '2027-02-19', 50, 'EUR', 19500, 'HUF')];
    const r = computeMoney([ex('e1', '2027-02-21', 11000, 'HUF')], exchanges, kindOf);
    expect(r.exchanges.get('x2')?.cost).toBeCloseTo(1724.14, 2);
    expect(r.cash.HUF?.avg).toBeCloseTo(0.088417, 6);
    expect(r.cash.EUR?.stock).toBe(95);
    expect(r.expenses.get('e1')?.twd).toBe(973);
  });

  it('marks the exchange when the source currency has no cost yet', () => {
    const r = computeMoney([], [fx('x1', '2027-02-19', 50, 'EUR', 19500, 'HUF')], kindOf);
    expect(r.exchanges.get('x1')).toMatchObject({ cost: null, missingRate: true });
    expect(r.cash.HUF).toEqual({ stock: 19500, avg: null });
  });
});

describe('example D: converting back to TWD', () => {
  it('reports the gain and reduces the stock', () => {
    const exchanges = [fx('x1', '2027-01-08', 9800, 'TWD', 7000, 'CZK'), fx('x2', '2027-06-30', 1000, 'CZK', 1350, 'TWD')];
    const r = computeMoney([], exchanges, kindOf);
    expect(r.exchanges.get('x2')?.gain).toBe(1350 - 1400);
    expect(r.cash.CZK?.stock).toBe(6000);
    expect(r.cash.CZK?.avg).toBe(1.4);
  });
});

describe('example E: no exchange yet', () => {
  it('marks cash as no-rate, then fills in once an earlier exchange is added', () => {
    const expenses = [ex('e1', '2027-04-02', 50, 'PLN')];
    expect(computeMoney(expenses, [], kindOf).expenses.get('e1')).toMatchObject({ twd: null, source: 'no-rate', lowStock: true });
    const later = computeMoney(expenses, [fx('x1', '2027-04-01', 800, 'TWD', 100, 'PLN')], kindOf);
    expect(later.expenses.get('e1')).toMatchObject({ twd: 400, source: 'cash' });
  });
});

describe('ordering and edge cases', () => {
  it('applies a same-day exchange before that day\'s expenses, even if entered later', () => {
    const expense = ex('e1', '2027-01-08', 100, 'CZK');
    const exchange = fx('x1', '2027-01-08', 1400, 'TWD', 1000, 'CZK');
    expect(computeMoney([expense], [exchange], kindOf).expenses.get('e1')?.twd).toBe(140);
  });

  it('keeps converting with the last average when stock goes negative, and flags it', () => {
    const r = computeMoney([ex('e1', '2027-01-09', 1200, 'CZK')], [fx('x1', '2027-01-08', 1400, 'TWD', 1000, 'CZK')], kindOf);
    expect(r.expenses.get('e1')).toMatchObject({ twd: 1680, lowStock: true });
    expect(r.cash.CZK?.stock).toBe(-200);
  });

  it('starts a fresh average after negative stock', () => {
    const r = computeMoney(
      [ex('e1', '2027-01-09', 1200, 'CZK')],
      [fx('x1', '2027-01-08', 1400, 'TWD', 1000, 'CZK'), fx('x2', '2027-01-10', 1500, 'TWD', 1000, 'CZK')],
      kindOf
    );
    expect(r.cash.CZK).toEqual({ stock: 800, avg: 1.5 });
  });

  it('handles card payments: bill amount, pending, and TWD', () => {
    const r = computeMoney(
      [
        ex('e1', '2027-01-09', 19.9, 'EUR', 'pay-cube', { billTwd: 718 }),
        ex('e2', '2027-01-09', 26, 'EUR', 'pay-cube'),
        ex('e3', '2027-01-09', 28500, 'TWD', 'pay-debit')
      ],
      [],
      kindOf
    );
    expect(r.expenses.get('e1')).toEqual({ twd: 718, source: 'bill' });
    expect(r.expenses.get('e2')).toEqual({ twd: null, source: 'pending' });
    expect(r.expenses.get('e3')).toEqual({ twd: 28500, source: 'twd' });
    expect(r.cash.EUR).toBeUndefined();
  });

  it('recomputes after an exchange is deleted', () => {
    const expenses = [ex('e1', '2027-02-01', 100, 'CZK')];
    const all = [fx('x1', '2027-01-08', 1400, 'TWD', 1000, 'CZK'), fx('x2', '2027-01-20', 1600, 'TWD', 1000, 'CZK')];
    expect(computeMoney(expenses, all, kindOf).expenses.get('e1')?.twd).toBe(150);
    expect(computeMoney(expenses, [all[0]], kindOf).expenses.get('e1')?.twd).toBe(140);
  });
});

describe('cashStateOn', () => {
  it('sees records up to and including the day, excluding the edited one', () => {
    const exchanges = [fx('x1', '2027-01-08', 1400, 'TWD', 1000, 'CZK'), fx('x2', '2027-02-01', 1600, 'TWD', 1000, 'CZK')];
    const expenses = [ex('e1', '2027-01-10', 100, 'CZK')];
    expect(cashStateOn('2027-01-15', expenses, exchanges, kindOf).CZK).toEqual({ stock: 900, avg: 1.4 });
    expect(cashStateOn('2027-01-15', expenses, exchanges, kindOf, 'e1').CZK).toEqual({ stock: 1000, avg: 1.4 });
  });
});

describe('summarize', () => {
  it('sums TWD and lists what is missing per currency', () => {
    const expenses = [ex('e1', '2027-01-09', 19.9, 'EUR', 'pay-cube', { billTwd: 718 }), ex('e2', '2027-01-09', 26, 'EUR', 'pay-cube'), ex('e3', '2027-01-09', 300, 'CZK', 'pay-cube')];
    const s = summarize(expenses, computeMoney(expenses, [], kindOf).expenses);
    expect(s).toEqual({ twd: 718, missing: { EUR: 26, CZK: 300 }, missingCount: 2 });
  });
});
