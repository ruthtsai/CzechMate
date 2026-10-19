import type { Currency } from './constants';

// Amount display rules: requirements spec 5.5.

const fmt = (n: number, min: number, max: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

export function formatAmount(n: number, currency: Currency): string {
  switch (currency) {
    case 'TWD':
    case 'HUF':
      return fmt(Math.round(n), 0, 0);
    case 'CZK':
      return Number.isInteger(round2(n)) ? fmt(n, 0, 0) : fmt(n, 2, 2);
    default:
      return fmt(n, 2, 2);
  }
}

export const formatTwd = (n: number) => `NT$ ${fmt(Math.round(n), 0, 0)}`;

/** Average cost in TWD per unit: 4 decimals, 6 for HUF. */
export const formatRate = (rate: number, currency: Currency) => rate.toFixed(currency === 'HUF' ? 6 : 4);

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parses user input such as "1,234.5" or "12,5" (decimal comma). Returns NaN when invalid. */
export function parseAmount(input: string): number {
  let s = input.trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  return Number(s);
}
