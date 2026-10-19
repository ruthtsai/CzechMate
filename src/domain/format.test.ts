import { describe, expect, it } from 'vitest';
import { formatAmount, formatRate, formatTwd, parseAmount } from './format';
import { addDays, monthRange, weekRange } from './dates';
import { validateExchange, validateExpense } from './validate';

describe('formatAmount', () => {
  it('follows the per-currency decimal rules', () => {
    expect(formatAmount(28500, 'TWD')).toBe('28,500');
    expect(formatAmount(11000, 'HUF')).toBe('11,000');
    expect(formatAmount(130, 'CZK')).toBe('130');
    expect(formatAmount(129.9, 'CZK')).toBe('129.90');
    expect(formatAmount(19.9, 'EUR')).toBe('19.90');
    expect(formatAmount(12, 'GBP')).toBe('12.00');
  });
  it('formats TWD totals and rates', () => {
    expect(formatTwd(898.8)).toBe('NT$ 899');
    expect(formatRate(1.4066239, 'CZK')).toBe('1.4066');
    expect(formatRate(0.0884173, 'HUF')).toBe('0.088417');
  });
});

describe('parseAmount', () => {
  it('accepts dots, decimal commas and thousands separators', () => {
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('1,234.5')).toBe(1234.5);
    expect(parseAmount(' 300 ')).toBe(300);
  });
  it('rejects junk', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
    expect(parseAmount('1.2.3')).toBeNaN();
  });
});

describe('dates', () => {
  it('computes week and month ranges', () => {
    expect(weekRange('2027-03-17')).toEqual(['2027-03-15', '2027-03-21']);
    expect(monthRange('2027-02-10')).toEqual(['2027-02-01', '2027-02-28']);
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('validateExpense', () => {
  const ctx = {
    categoryMode: (id: string) => (id === 'cat-travel-food' ? 'travel' : id === 'cat-daily-food' ? 'daily' : undefined),
    paymentKind: (id: string) => (id === 'pay-cash' ? 'cash' : id === 'pay-cube' ? 'credit' : undefined),
    tripExists: (id: string) => id === 'trip-1'
  } as const;
  const base = { date: '2027-03-05', mode: 'daily', categoryId: 'cat-daily-food', amount: '18.5', currency: 'EUR', paymentId: 'pay-cash', billTwd: '' } as const;

  it('accepts a valid cash expense and rounds to 2 decimals', () => {
    const r = validateExpense({ ...base, amount: '18.555' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.values.amount).toBe(18.56);
  });
  it('requires a positive amount and a trip in travel mode', () => {
    const r = validateExpense({ ...base, amount: '0', mode: 'travel', categoryId: 'cat-travel-food' }, ctx);
    expect(r.errors.amount).toBeDefined();
    expect(r.errors.tripId).toBeDefined();
  });
  it('rejects a category from another mode', () => {
    expect(validateExpense({ ...base, mode: 'travel', tripId: 'trip-1' }, ctx).errors.categoryId).toBeDefined();
  });
  it('keeps the bill amount only for card payments in foreign currency', () => {
    expect(validateExpense({ ...base, paymentId: 'pay-cube', billTwd: '718' }, ctx).values.billTwd).toBe(718);
    expect(validateExpense({ ...base, billTwd: '718' }, ctx).values.billTwd).toBeUndefined();
    expect(validateExpense({ ...base, paymentId: 'pay-cube', currency: 'TWD', billTwd: '718' }, ctx).values.billTwd).toBeUndefined();
  });
});

describe('validateExchange', () => {
  const kind = (id: string) => (id === 'pay-cube' ? 'credit' : id === 'pay-cash' ? 'cash' : undefined);
  const base = { date: '2027-01-08', method: 'cash', outAmount: '9800', outCurrency: 'TWD', inAmount: '7000', inCurrency: 'CZK' } as const;

  it('accepts a TWD exchange', () => expect(validateExchange(base, kind, {}).ok).toBe(true));
  it('rejects the same currency on both sides', () => expect(validateExchange({ ...base, inCurrency: 'TWD' }, kind, {}).errors.inCurrency).toBeDefined());
  it('requires a card and TWD for ATM withdrawals', () => {
    const r = validateExchange({ ...base, method: 'atm', outCurrency: 'EUR' }, kind, { EUR: { stock: 10, avg: 34 } });
    expect(r.errors.cardId).toBeDefined();
    expect(r.errors.outCurrency).toBeDefined();
  });
  it('blocks foreign to foreign without a cost for the source currency', () => {
    const r = validateExchange({ ...base, outAmount: '50', outCurrency: 'EUR', inAmount: '19500', inCurrency: 'HUF' }, kind, {});
    expect(r.errors.outCurrency).toBe('請先記錄 EUR 的換匯。');
    expect(validateExchange({ ...base, outAmount: '50', outCurrency: 'EUR', inAmount: '19500', inCurrency: 'HUF' }, kind, { EUR: { stock: 145, avg: 34.48 } }).ok).toBe(true);
  });
});
