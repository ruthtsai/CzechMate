import { describe, expect, it } from 'vitest';
import { countdownLabel, upcomingKeyDates, validateKeyDate } from './keyDates';

describe('key dates', () => {
  const list = [
    { id: 'a', title: '出發', date: '2027-01-20' },
    { id: 'b', title: '宿舍押金', date: '2026-11-30' },
    { id: 'c', title: '簽證面試', date: '2026-11-01' },
    { id: 'd', title: '選課截止', date: '2026-10-30' }
  ];

  it('lists upcoming dates soonest first and keeps yesterday', () => {
    expect(upcomingKeyDates(list, '2026-11-01').map(d => [d.id, d.daysLeft])).toEqual([['c', 0], ['b', 29], ['a', 80]]);
    expect(upcomingKeyDates(list, '2026-10-31').map(d => d.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('labels the countdown', () => {
    expect([0, 1, 5, -1].map(countdownLabel)).toEqual(['今天', '明天', '還有 5 天', '已過 1 天']);
  });

  it('needs a name and a date', () => {
    expect(validateKeyDate({ title: ' ', date: '2027-01-20' })).toBe('請輸入名稱。');
    expect(validateKeyDate({ title: '出發', date: '' })).toBe('請選擇日期。');
    expect(validateKeyDate({ title: '出發', date: '2027-01-20' })).toBeNull();
  });
});
