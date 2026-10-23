import { daysBetween } from './dates';

// F-03: deadlines and important days counted down on the home screen.

export interface KeyDate { id: string; title: string; date: string; note?: string }
export interface KeyDateView extends KeyDate { daysLeft: number }

/** Upcoming dates, soonest first; ones that passed stay visible for `keepPastDays` days. */
export function upcomingKeyDates(dates: KeyDate[], day: string, keepPastDays = 1): KeyDateView[] {
  return dates
    .map(d => ({ ...d, daysLeft: daysBetween(day, d.date) }))
    .filter(d => d.daysLeft >= -keepPastDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title));
}

export const countdownLabel = (daysLeft: number) =>
  daysLeft === 0 ? '今天' : daysLeft === 1 ? '明天' : daysLeft > 0 ? `還有 ${daysLeft} 天` : `已過 ${-daysLeft} 天`;

/** Checks a date being added or edited; returns an error message or null. */
export function validateKeyDate(input: { title: string; date: string }): string | null {
  if (!input.title.trim()) return '請輸入名稱。';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return '請選擇日期。';
  return null;
}
