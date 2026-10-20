import { describe, expect, it } from 'vitest';
import type { Category, Expense, PaymentMethod, Trip } from '../db/schema';
import type { Currency, Mode } from './constants';
import { computeMoney } from './money';
import { byCategory, filterMonth, monthsWithData, paymentSummaries, tripSummaries } from './stats';

const payments: PaymentMethod[] = [
  { id: 'pay-cash', name: '現金', kind: 'cash', order: 0, active: true },
  { id: 'pay-cube', name: 'Cube', kind: 'credit', order: 1, active: true },
  { id: 'pay-mega', name: 'Mega', kind: 'credit', order: 2, active: true }
];
const categories: Category[] = [
  { id: 'd-food', mode: 'daily', name: '餐飲', color: 3, order: 0, active: true },
  { id: 't-food', mode: 'travel', name: '餐飲', color: 3, order: 0, active: true },
  { id: 't-lodging', mode: 'travel', name: '住宿', color: 1, order: 1, active: true },
  { id: 'd-rent', mode: 'daily', name: '房租／住宿', color: 1, order: 1, active: true }
];
const kindOf = (id: string) => payments.find(p => p.id === id)?.kind;
let n = 0;
const ex = (date: string, mode: Mode, categoryId: string, amount: number, currency: Currency, paymentId: string, extra: Partial<Expense> = {}): Expense => ({
  id: `e${n}`, date, mode, categoryId, amount, currency, paymentId, itemName: '', place: '', note: '',
  createdAt: new Date(Date.UTC(2027, 0, 1, 0, 0, n++)).toISOString(), updatedAt: '', ...extra
});

const list = [
  ex('2027-03-01', 'daily', 'd-rent', 11310, 'TWD', 'pay-cube'),
  ex('2027-03-31', 'daily', 'd-food', 300, 'TWD', 'pay-cash'),
  ex('2027-03-06', 'travel', 't-food', 500, 'TWD', 'pay-cash', { tripId: 'vie' }),
  ex('2027-03-05', 'travel', 't-lodging', 64, 'EUR', 'pay-mega', { tripId: 'vie', billTwd: 2296 }),
  ex('2027-03-06', 'travel', 't-food', 26, 'EUR', 'pay-cube', { tripId: 'vie' }),
  ex('2027-04-01', 'daily', 'd-food', 95, 'TWD', 'pay-cash')
];
const calc = computeMoney(list, [], kindOf).expenses;

describe('month filtering', () => {
  it('includes the first and last day of the month only', () => {
    expect(filterMonth(list, '2027-03').map(e => e.date)).not.toContain('2027-04-01');
    expect(filterMonth(list, '2027-03')).toHaveLength(5);
    expect(filterMonth(list, '2027-03', 'travel')).toHaveLength(3);
  });
  it('lists months with data plus the current month', () => {
    expect(monthsWithData(list, '2027-06')).toEqual(['2027-03', '2027-04', '2027-06']);
  });
});

describe('byCategory', () => {
  it('merges same-named categories across modes and skips pending', () => {
    const s = byCategory(filterMonth(list, '2027-03'), calc, categories);
    expect(s.map(x => [x.name, x.twd])).toEqual([['房租／住宿', 11310], ['住宿', 2296], ['餐飲', 800]]);
    expect(s.find(x => x.name === '餐飲')?.ids.sort()).toEqual(['d-food', 't-food']);
  });
});

describe('tripSummaries', () => {
  const trip: Trip = { id: 'vie', name: '維也納', startDate: '2027-03-05', createdAt: '' };
  it('uses the last expense as the end date when none is set', () => {
    const [s] = tripSummaries([trip], list, calc, categories);
    expect(s).toMatchObject({ end: '2027-03-06', days: 2, twd: 2796, perDay: 1398, missingCount: 1, missing: { EUR: 26 } });
  });
  it('uses the given end date', () => {
    const [s] = tripSummaries([{ ...trip, endDate: '2027-03-07' }], list, calc, categories);
    expect(s.days).toBe(3);
  });
  it('handles a trip without expenses', () => {
    const [s] = tripSummaries([{ ...trip, id: 'empty' }], list, calc, categories);
    expect(s).toMatchObject({ days: 1, twd: 0, perDay: 0 });
  });
});

describe('paymentSummaries', () => {
  it('subtotals per currency, bill TWD and pending per card', () => {
    const s = paymentSummaries(payments, filterMonth(list, '2027-03'), calc);
    const cube = s.find(p => p.payment.id === 'pay-cube')!;
    expect(cube.byCurrency).toEqual([['TWD', 11310], ['EUR', 26]]);
    expect(cube.twd).toBe(11310);
    expect(cube.pending).toHaveLength(1);
    expect(s.find(p => p.payment.id === 'pay-cash')?.twd).toBe(800);
  });
});
