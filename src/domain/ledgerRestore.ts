import type { Category, Exchange, Expense, PaymentMethod, Trip } from '../db/schema';

// Restoring the ledger from the sheet's hidden _記帳原始資料 tab (backlog R-02).

/** Settings that belong to the ledger and travel with it. Sync secrets never do. */
export const LEDGER_SETTING_KEYS = ['budgetMonthly', 'keyDates'] as const;

export interface LedgerTables {
  expenses: Expense[];
  exchanges: Exchange[];
  trips: Trip[];
  paymentMethods: PaymentMethod[];
  categories: Category[];
  settings: { key: string; value: unknown }[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const hasId = (x: unknown) => isObj(x) && typeof x.id === 'string' && x.id.length > 0;
const isDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

/** Checks what the sheet sent before anything on the phone is replaced. */
export function validateLedgerTables(raw: unknown): { ok: true; tables: LedgerTables } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: '試算表裡還沒有可以還原的記帳資料。' };
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]) : null);
  for (const k of ['expenses', 'exchanges', 'trips', 'paymentMethods', 'categories']) {
    const rows = list(k);
    if (!rows) return { ok: false, error: `試算表的記帳資料缺少「${k}」。` };
    const bad = rows.findIndex(r => !hasId(r));
    if (bad >= 0) return { ok: false, error: `試算表的記帳資料有誤（${k} 第 ${bad + 1} 筆沒有 ID）。` };
  }
  const expenses = list('expenses') as Record<string, unknown>[];
  const badExp = expenses.findIndex(e => !isDate(e.date) || !isNum(e.amount) || typeof e.currency !== 'string' || typeof e.paymentId !== 'string');
  if (badExp >= 0) return { ok: false, error: `試算表的記帳資料有誤（第 ${badExp + 1} 筆支出的日期、金額或付款方式不正確）。` };
  const exchanges = list('exchanges') as Record<string, unknown>[];
  const badFx = exchanges.findIndex(x => !isDate(x.date) || !isNum(x.outAmount) || !isNum(x.inAmount));
  if (badFx >= 0) return { ok: false, error: `試算表的記帳資料有誤（第 ${badFx + 1} 筆換匯的日期或金額不正確）。` };
  if (!(list('paymentMethods') ?? []).length || !(list('categories') ?? []).length) {
    return { ok: false, error: '試算表的記帳資料沒有付款方式或類別，無法還原。' };
  }
  const settings = (list('settings') ?? []).filter(
    (s): s is { key: string; value: unknown } => isObj(s) && (LEDGER_SETTING_KEYS as readonly string[]).includes(String(s.key))
  );
  return {
    ok: true,
    tables: {
      expenses: expenses as unknown as Expense[],
      exchanges: exchanges as unknown as Exchange[],
      trips: list('trips') as unknown as Trip[],
      paymentMethods: list('paymentMethods') as unknown as PaymentMethod[],
      categories: list('categories') as unknown as Category[],
      settings
    }
  };
}
