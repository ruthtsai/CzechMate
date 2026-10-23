import { describe, expect, it } from 'vitest';
import { activeTrips, budgetStatus } from './budget';

describe('budget', () => {
  it('reports what is left and when it is over', () => {
    expect(budgetStatus(12000, 15000)).toEqual({ spent: 12000, budget: 15000, left: 3000, ratio: 0.8, over: false });
    expect(budgetStatus(16000, 15000)).toMatchObject({ left: -1000, over: true });
    expect(budgetStatus(10, 0).ratio).toBe(0);
  });

  it('finds trips running on a day', () => {
    const t = (id: string, startDate: string, endDate?: string) => ({ id, name: id, startDate, endDate, createdAt: '' });
    const trips = [t('vienna', '2027-03-10', '2027-03-12'), t('day', '2027-03-11'), t('later', '2027-04-01', '2027-04-03')];
    expect(activeTrips(trips, '2027-03-11').map(x => x.id)).toEqual(['vienna', 'day']);
    expect(activeTrips(trips, '2027-03-12').map(x => x.id)).toEqual(['vienna']);
  });
});
