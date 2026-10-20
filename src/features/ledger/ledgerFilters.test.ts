import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../../db/schema';
import type { ExpenseCalc } from '../../domain/money';
import { defaultFilters, filterExpenses, presetLedgerFilter, rememberFilters, revealExpense, takeReveal, takeStartFilters } from './ledgerFilters';

// Regression: an expense added from the home screen was hidden in the ledger because a home-banner
// shortcut ("only pending card bills") stayed active for every later visit.

const ex = (id: string, date: string, extra: Partial<Expense> = {}): Expense => ({
  id, date, mode: 'daily', categoryId: 'c1', amount: 1, currency: 'CZK', paymentId: 'pay-cash', itemName: id, place: '', note: '',
  createdAt: `${date}T00:00:00Z`, updatedAt: '', ...extra
});

describe('ledger shortcuts', () => {
  it('apply once and are not remembered for the next visit', () => {
    vi.stubGlobal('window', { dispatchEvent: () => true });
    rememberFilters({ ...defaultFilters(), mode: 'daily' });
    presetLedgerFilter({ seg: 'expenses', missing: 'pending' });
    expect(takeStartFilters()).toMatchObject({ missing: 'pending', mode: 'daily' });
    expect(takeStartFilters()).toMatchObject({ missing: null, mode: 'daily' });
  });

  it('never remember the "only pending" filter even when the user changes something else', () => {
    rememberFilters({ ...defaultFilters(), missing: 'no-rate', period: 'all' });
    expect(takeStartFilters()).toMatchObject({ missing: null, period: 'all' });
  });

  it('hand over a just-saved expense once it exists', () => {
    vi.stubGlobal('window', { dispatchEvent: () => true });
    revealExpense('e9', '2027-03-15');
    expect(takeReveal(() => false)).toBeNull();
    expect(takeReveal(id => id === 'e9')).toEqual({ id: 'e9', date: '2027-03-15' });
    expect(takeReveal(() => true)).toBeNull();
  });
});

describe('filterExpenses', () => {
  const calc = new Map<string, ExpenseCalc>([['card', { twd: null, source: 'pending' }], ['cash', { twd: 140, source: 'cash' }]]);
  const list = [ex('cash', '2027-03-15'), ex('card', '2027-03-10', { paymentId: 'pay-cube' }), ex('old', '2027-02-01'), ex('trip', '2027-03-05', { mode: 'travel', tripId: 't1' })];
  const cat = () => undefined;

  it('shows this month, newest first, by default', () => {
    expect(filterExpenses(defaultFilters(), list, calc, cat, '2027-03-20').map(e => e.id)).toEqual(['cash', 'card', 'trip']);
  });
  it('the pending shortcut hides everything else', () => {
    expect(filterExpenses({ ...defaultFilters(), missing: 'pending' }, list, calc, cat, '2027-03-20').map(e => e.id)).toEqual(['card']);
  });
  it('a trip filter ignores the period', () => {
    expect(filterExpenses({ ...defaultFilters(), mode: 'travel', tripId: 't1', period: 'week' }, list, calc, cat, '2027-03-31').map(e => e.id)).toEqual(['trip']);
  });
});
