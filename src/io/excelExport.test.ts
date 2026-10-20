import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { Category, Exchange, Expense, PaymentMethod, Trip } from '../db/schema';
import type { Currency, Mode } from '../domain/constants';
import { computeMoney } from '../domain/money';
import { buildSheets, type ExportInput } from './exportRows';
import { buildWorkbook, exportFileName } from './excelExport';

const payments: PaymentMethod[] = [
  { id: 'pay-cash', name: '現金', kind: 'cash', order: 0, active: true },
  { id: 'pay-cube', name: '國泰世華 Cube', kind: 'credit', order: 1, active: true }
];
const categories: Category[] = [
  { id: 'd-food', mode: 'daily', name: '餐飲', color: 3, order: 0, active: true },
  { id: 't-food', mode: 'travel', name: '餐飲', color: 3, order: 0, active: true },
  { id: 't-tickets', mode: 'travel', name: '門票／景點', color: 8, order: 1, active: true }
];
const trips: Trip[] = [{ id: 'vie', name: '維也納三日遊', startDate: '2027-03-05', endDate: '2027-03-07', createdAt: '' }];
let n = 0;
const at = () => new Date(Date.UTC(2027, 0, 1, 0, 0, n++)).toISOString();
const ex = (date: string, mode: Mode, categoryId: string, amount: number, currency: Currency, paymentId: string, extra: Partial<Expense> = {}): Expense => ({
  id: `e${n}`, date, mode, categoryId, amount, currency, paymentId, itemName: `item${n}`, place: '', note: '', createdAt: at(), updatedAt: at(), ...extra
});
const exchanges: Exchange[] = [
  { id: 'x1', date: '2027-01-08', method: 'cash', outAmount: 9800, outCurrency: 'TWD', inAmount: 7000, inCurrency: 'CZK', place: '台灣銀行', note: '', createdAt: at(), updatedAt: '' },
  { id: 'x2', date: '2027-01-08', method: 'cash', outAmount: 5000, outCurrency: 'TWD', inAmount: 145, inCurrency: 'EUR', place: '', note: '', createdAt: at(), updatedAt: '' }
];
const expenses = [
  ex('2027-02-03', 'daily', 'd-food', 642, 'CZK', 'pay-cash'),
  ex('2027-03-06', 'travel', 't-food', 18.5, 'EUR', 'pay-cash', { tripId: 'vie' }),
  ex('2027-03-06', 'travel', 't-tickets', 26, 'EUR', 'pay-cube', { tripId: 'vie' }),
  ex('2027-03-10', 'daily', 'd-food', 300, 'TWD', 'pay-cube')
];
const input: ExportInput = {
  expenses, exchanges, payments, categories, trips,
  money: computeMoney(expenses, exchanges, id => payments.find(p => p.id === id)?.kind)
};

describe('buildSheets', () => {
  const sheets = buildSheets(input);
  const get = (name: string) => sheets.find(s => s.name === name)!;

  it('creates the five sheets', () => {
    expect(sheets.map(s => s.name)).toEqual(['支出總表', '換匯紀錄', '月份×類別', '旅程彙總', '付款方式彙總']);
  });

  it('writes one detail row per expense with TWD and its source', () => {
    const s = get('支出總表');
    const col = (h: string) => s.columns.findIndex(c => c.header === h);
    expect(s.rows).toHaveLength(4);
    expect(s.rows[0][col('台幣金額')]).toBe(899);
    expect(s.rows[0][col('台幣來源')]).toBe('現金換算');
    expect(s.rows[2][col('台幣金額')]).toBeNull();
    expect(s.rows[2][col('台幣來源')]).toBe('待補');
    expect(s.rows[1][col('旅程')]).toBe('維也納三日遊');
  });

  it('pivots months by category with totals and pending counts', () => {
    const s = get('月份×類別');
    expect(s.columns.map(c => c.header)).toEqual(['年月', '餐飲', '合計', '待補筆數']);
    expect(s.rows).toEqual([
      ['2027-02', 899, 899, 0],
      ['2027-03', 938, 938, 1],
      ['合計', 1837, 1837, 1]
    ]);
  });

  it('summarises trips and payment methods', () => {
    expect(get('旅程彙總').rows[0].slice(0, 7)).toEqual(['維也納三日遊', '2027-03-05', '2027-03-07', 3, 638, 213, 1]);
    const pay = get('付款方式彙總');
    expect(pay.columns.map(c => c.header)).toEqual(['年月', '付款方式', 'TWD', 'CZK', 'EUR', '台幣小計', '待補筆數']);
    expect(pay.rows).toContainEqual(['2027-03', '國泰世華 Cube', 300, null, 26, 300, 1]);
  });

  it('filters by date range', () => {
    const s = buildSheets({ ...input, from: '2027-03-01', to: '2027-03-31' });
    expect(s[0].rows).toHaveLength(3);
    expect(s[1].rows).toHaveLength(0);
  });
});

describe('buildWorkbook', () => {
  it('produces an xlsx with frozen headers, filters and real dates', async () => {
    const buf = await buildWorkbook(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('支出總表')!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    const date = ws.getRow(2).getCell(2).value as Date;
    expect(date.toISOString().slice(0, 10)).toBe('2027-02-03');
    expect(ws.getRow(2).getCell(2).numFmt).toBe('yyyy/mm/dd');
    expect(wb.worksheets).toHaveLength(5);
  });

  it('names the file with the export date', () => {
    expect(exportFileName(new Date(2027, 2, 15))).toBe('CzechMate_記帳_20270315.xlsx');
  });
});
