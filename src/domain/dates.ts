// Dates are local calendar days stored as 'YYYY-MM-DD' (requirements spec 4.1).

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toDateKey(new Date());
export const monthKey = (date: string) => date.slice(0, 7);
export const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const weekday = (date: string) => `週${WEEK[parse(date).getDay()]}`;
export const slashDate = (date: string) => date.replace(/-/g, '/');
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;

/** Monday-based week containing `date`. */
export function weekRange(date: string): [string, string] {
  const dow = (parse(date).getDay() + 6) % 7;
  const start = addDays(date, -dow);
  return [start, addDays(start, 6)];
}

export function monthRange(date: string): [string, string] {
  const d = parse(date);
  return [toDateKey(new Date(d.getFullYear(), d.getMonth(), 1)), toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}
