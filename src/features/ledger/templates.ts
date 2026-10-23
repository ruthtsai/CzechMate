import type { Expense } from '../../db/schema';

// U-01: quick entry from earlier expenses.

/** The latest expense for each distinct item name (newest first), skipping ones without a name. */
export function recentTemplates(expenses: Expense[], limit = 6): Expense[] {
  const seen = new Set<string>();
  const out: Expense[] = [];
  const sorted = [...expenses].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const e of sorted) {
    const key = e.itemName.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Fields copied into a new expense: everything but the date, note and card bill. */
export const copyFields = (e: Expense) => ({
  mode: e.mode, categoryId: e.categoryId, amount: String(e.amount), currency: e.currency, paymentId: e.paymentId,
  tripId: e.tripId, itemName: e.itemName, place: e.place
});
