import { describe, expect, it } from 'vitest';
import { ledgerFingerprint } from './ledgerFingerprint';
import type { LedgerTables } from './ledgerRestore';

const ledger = (): LedgerTables => ({
  expenses: [{ id: 'e1', itemName: '午餐', amount: 120 }, { id: 'e2', itemName: '車票', amount: 30 }] as unknown as LedgerTables['expenses'],
  exchanges: [],
  trips: [{ id: 't1', name: '維也納' }] as unknown as LedgerTables['trips'],
  paymentMethods: [{ id: 'pay-cash', name: '現金' }, { id: 'pay-card', name: '信用卡' }] as unknown as LedgerTables['paymentMethods'],
  categories: [],
  settings: [{ key: 'budgetMonthly', value: 15000 }, { key: 'keyDates', value: [] }]
});

describe('ledger fingerprint', () => {
  it('is the same however the records and their fields were read', () => {
    const a = ledger();
    const b = ledger();
    b.expenses.reverse();
    b.paymentMethods.reverse();
    b.settings.reverse();
    b.expenses[0] = { amount: 30, itemName: '車票', id: 'e2' } as unknown as LedgerTables['expenses'][number];
    expect(ledgerFingerprint(b)).toBe(ledgerFingerprint(a));
  });

  it('changes when any value changes', () => {
    const a = ledger();
    const b = ledger();
    (b.expenses[0] as unknown as { amount: number }).amount = 121;
    const c = ledger();
    c.settings[0].value = 16000;
    expect(new Set([ledgerFingerprint(a), ledgerFingerprint(b), ledgerFingerprint(c)]).size).toBe(3);
  });
});
