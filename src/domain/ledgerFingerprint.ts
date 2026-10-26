import type { LedgerTables } from './ledgerRestore';

// The ledger fingerprint (see GLOSSARY.md): a short summary of the whole ledger that changes whenever any part of it does.
// Synchronous on purpose, so it can run inside Dexie live queries.

/**
 * The same value with object keys in a fixed order, so the order fields were stored in doesn't matter.
 * Ledger records hold only strings, numbers, booleans, arrays and plain objects; a Date or Blob would read as {}.
 */
const ordered = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(ordered)
    : x && typeof x === 'object'
      ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered((x as Record<string, unknown>)[k])]))
      : x;

const sortedBy = <T>(rows: T[], key: keyof T) => [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0));

/** cyrb53: a fast 53-bit string hash; plenty for telling one ledger from the next. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function ledgerFingerprint(t: LedgerTables): string {
  return hash(JSON.stringify(ordered({
    expenses: sortedBy(t.expenses, 'id'),
    exchanges: sortedBy(t.exchanges, 'id'),
    trips: sortedBy(t.trips, 'id'),
    paymentMethods: sortedBy(t.paymentMethods, 'id'),
    categories: sortedBy(t.categories, 'id'),
    settings: sortedBy(t.settings, 'key')
  })));
}
