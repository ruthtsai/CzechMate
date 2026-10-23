import type { Trip } from '../db/schema';

// U-03: monthly living-cost budget and per-trip budgets, all in TWD.

export interface BudgetStatus { spent: number; budget: number; left: number; ratio: number; over: boolean }

export function budgetStatus(spent: number, budget: number): BudgetStatus {
  const left = budget - spent;
  return { spent, budget, left, ratio: budget > 0 ? spent / budget : 0, over: left < 0 };
}

/** Trips running on `day` (no end date counts as one day long). */
export const activeTrips = (trips: Trip[], day: string) =>
  trips.filter(t => t.startDate <= day && (t.endDate ?? t.startDate) >= day);
