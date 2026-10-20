import type { Category, Exchange, Expense, PaymentMethod, Trip } from '../db/schema';
import { CURRENCIES, MODE_LABEL, PAYMENT_KIND_LABEL, type Currency } from '../domain/constants';
import { monthKey } from '../domain/dates';
import { TWD_SOURCE_LABEL, type MoneyResult } from '../domain/money';
import { byCategory, paymentSummaries, tripSummaries } from '../domain/stats';

// Builds the five Excel sheets as plain rows (requirements spec 6.3). Kept free of ExcelJS so it is easy to test.

export type ColType = 'text' | 'date' | 'twd' | 'amount' | 'rate' | 'int' | 'datetime';
export interface Column { header: string; type: ColType; width?: number }
export type Cell = string | number | null;
export interface SheetData { name: string; columns: Column[]; rows: Cell[][]; totalRow?: boolean }

export interface ExportInput {
  expenses: Expense[];
  exchanges: Exchange[];
  payments: PaymentMethod[];
  categories: Category[];
  trips: Trip[];
  money: MoneyResult;
  from?: string;
  to?: string;
}

const inRange = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);
const byDate = <T extends { date: string; createdAt: string }>(a: T, b: T) =>
  a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

export function buildSheets(input: ExportInput): SheetData[] {
  const { money, from, to } = input;
  const calc = money.expenses;
  const pay = new Map(input.payments.map(p => [p.id, p]));
  const cat = new Map(input.categories.map(c => [c.id, c]));
  const trip = new Map(input.trips.map(t => [t.id, t]));
  const expenses = input.expenses.filter(e => inRange(e.date, from, to)).sort(byDate);
  const exchanges = input.exchanges.filter(x => inRange(x.date, from, to)).sort(byDate);

  /* 1. 支出總表 */
  const detail: SheetData = {
    name: '支出總表',
    columns: [
      { header: 'ID', type: 'text', width: 12 }, { header: '日期', type: 'date', width: 12 }, { header: '年月', type: 'text', width: 9 },
      { header: '模式', type: 'text', width: 11 }, { header: '類別', type: 'text', width: 11 }, { header: '項目名稱', type: 'text', width: 22 },
      { header: '金額', type: 'amount', width: 11 }, { header: '幣別', type: 'text', width: 6 }, { header: '付款方式', type: 'text', width: 16 },
      { header: '付款類型', type: 'text', width: 9 }, { header: '旅程', type: 'text', width: 16 }, { header: '地點', type: 'text', width: 14 },
      { header: '備註', type: 'text', width: 20 }, { header: '帳單台幣金額', type: 'twd', width: 12 }, { header: '現金換算匯率', type: 'rate', width: 12 },
      { header: '台幣金額', type: 'twd', width: 11 }, { header: '台幣來源', type: 'text', width: 9 },
      { header: '建立時間', type: 'datetime', width: 18 }, { header: '更新時間', type: 'datetime', width: 18 }
    ],
    rows: expenses.map(e => {
      const c = calc.get(e.id);
      const p = pay.get(e.paymentId);
      return [
        e.id, e.date, monthKey(e.date), MODE_LABEL[e.mode], cat.get(e.categoryId)?.name ?? '', e.itemName, e.amount, e.currency,
        p?.name ?? '', p ? PAYMENT_KIND_LABEL[p.kind] : '', e.tripId ? trip.get(e.tripId)?.name ?? '' : '', e.place, e.note,
        e.billTwd ?? null, c?.rate ?? null, c?.twd ?? null, c ? TWD_SOURCE_LABEL[c.source] : '', e.createdAt, e.updatedAt
      ];
    })
  };

  /* 2. 換匯紀錄 */
  const fx: SheetData = {
    name: '換匯紀錄',
    columns: [
      { header: '日期', type: 'date', width: 12 }, { header: '方式', type: 'text', width: 10 }, { header: '提領卡片', type: 'text', width: 16 },
      { header: '換出金額', type: 'amount', width: 11 }, { header: '換出幣別', type: 'text', width: 8 }, { header: '換入金額', type: 'amount', width: 11 },
      { header: '換入幣別', type: 'text', width: 8 }, { header: '台幣成本', type: 'twd', width: 11 }, { header: '匯率（TWD／換入單位）', type: 'rate', width: 14 },
      { header: '是否預估', type: 'text', width: 8 }, { header: '匯差', type: 'twd', width: 9 }, { header: '地點', type: 'text', width: 16 }, { header: '備註', type: 'text', width: 20 }
    ],
    rows: exchanges.map(x => {
      const c = money.exchanges.get(x.id);
      return [
        x.date, x.method === 'atm' ? '卡片提領' : '現金換匯', x.cardId ? pay.get(x.cardId)?.name ?? '' : '', x.outAmount, x.outCurrency,
        x.inAmount, x.inCurrency, c?.cost != null ? Math.round(c.cost) : null, c?.rate ?? null, x.estimated ? '是' : '',
        c?.gain ?? null, x.place, x.note
      ];
    })
  };

  /* 3. 月份×類別 */
  const months = [...new Set(expenses.map(e => monthKey(e.date)))].sort();
  const catOrder = byCategory(expenses, calc, input.categories).map(s => s.name);
  const monthRows = months.map(m => {
    const list = expenses.filter(e => monthKey(e.date) === m);
    const slices = new Map(byCategory(list, calc, input.categories).map(s => [s.name, s.twd]));
    const values = catOrder.map(n => slices.get(n) ?? null);
    const total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
    const pending = list.filter(e => calc.get(e.id)?.twd == null).length;
    return [m, ...values, total, pending];
  });
  const monthTotals: Cell[] = ['合計', ...catOrder.map((_, i) => monthRows.reduce((s, r) => s + ((r[i + 1] as number | null) ?? 0), 0))];
  monthTotals.push(monthRows.reduce((s, r) => s + (r[catOrder.length + 1] as number), 0), monthRows.reduce((s, r) => s + (r[catOrder.length + 2] as number), 0));
  const byMonth: SheetData = {
    name: '月份×類別',
    columns: [{ header: '年月', type: 'text', width: 9 }, ...catOrder.map(n => ({ header: n, type: 'twd' as const, width: 11 })), { header: '合計', type: 'twd', width: 12 }, { header: '待補筆數', type: 'int', width: 9 }],
    rows: months.length ? [...monthRows, monthTotals] : [],
    totalRow: months.length > 0
  };

  /* 4. 旅程彙總 */
  const trips = tripSummaries(input.trips, expenses, calc, input.categories).filter(t => t.expenses.length > 0).sort((a, b) => (a.start < b.start ? -1 : 1));
  const tripCats = [...new Set(trips.flatMap(t => t.categories.map(c => c.name)))];
  const byTrip: SheetData = {
    name: '旅程彙總',
    columns: [
      { header: '旅程', type: 'text', width: 18 }, { header: '開始日', type: 'date', width: 12 }, { header: '結束日', type: 'date', width: 12 },
      { header: '天數', type: 'int', width: 6 }, { header: '台幣總額', type: 'twd', width: 11 }, { header: '每日平均', type: 'twd', width: 10 },
      { header: '待補筆數', type: 'int', width: 9 }, ...tripCats.map(n => ({ header: n, type: 'twd' as const, width: 11 }))
    ],
    rows: trips.map(t => {
      const m = new Map(t.categories.map(c => [c.name, c.twd]));
      return [t.trip.name, t.start, t.end, t.days, t.twd, Math.round(t.perDay), t.missingCount, ...tripCats.map(n => m.get(n) ?? null)];
    })
  };

  /* 5. 付款方式彙總 */
  const usedCurrencies = CURRENCIES.filter(c => expenses.some(e => e.currency === c)) as Currency[];
  const payRows: Cell[][] = [];
  for (const m of months) {
    const list = expenses.filter(e => monthKey(e.date) === m);
    for (const p of paymentSummaries(input.payments, list, calc)) {
      const by = new Map(p.byCurrency);
      payRows.push([m, p.payment.name, ...usedCurrencies.map(c => by.get(c) ?? null), p.twd, p.pending.length]);
    }
  }
  const byPayment: SheetData = {
    name: '付款方式彙總',
    columns: [
      { header: '年月', type: 'text', width: 9 }, { header: '付款方式', type: 'text', width: 16 },
      ...usedCurrencies.map(c => ({ header: c, type: (c === 'TWD' ? 'twd' : 'amount') as ColType, width: 11 })),
      { header: '台幣小計', type: 'twd', width: 11 }, { header: '待補筆數', type: 'int', width: 9 }
    ],
    rows: payRows
  };

  return [detail, fx, byMonth, byTrip, byPayment];
}
