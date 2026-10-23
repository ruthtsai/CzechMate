import { describe, expect, it } from 'vitest';
import type { Expense } from '../../db/schema';
import { copyFields, recentTemplates } from './templates';

const ex = (id: string, itemName: string, createdAt: string, extra: Partial<Expense> = {}): Expense => ({
  id, date: createdAt.slice(0, 10), mode: 'daily', categoryId: 'c1', amount: 10, currency: 'CZK', paymentId: 'pay-cash', itemName, place: '', note: 'n',
  createdAt, updatedAt: '', ...extra
});

describe('recentTemplates', () => {
  it('keeps the newest expense per item name and skips unnamed ones', () => {
    const list = [
      ex('1', '午餐', '2027-03-01T10:00:00Z', { amount: 120 }),
      ex('2', '', '2027-03-04T10:00:00Z'),
      ex('3', '午餐 ', '2027-03-03T10:00:00Z', { amount: 150 }),
      ex('4', '月票', '2027-03-02T10:00:00Z')
    ];
    expect(recentTemplates(list).map(e => e.id)).toEqual(['3', '4']);
    expect(recentTemplates(list, 1)).toHaveLength(1);
  });

  it('copies everything except the date, note and bill', () => {
    const c = copyFields(ex('1', '月票', '2027-03-01T10:00:00Z', { billTwd: 182, tripId: 't1' }));
    expect(c).toEqual({ mode: 'daily', categoryId: 'c1', amount: '10', currency: 'CZK', paymentId: 'pay-cash', tripId: 't1', itemName: '月票', place: '' });
  });
});
