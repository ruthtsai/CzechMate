import { CURRENCIES, MODES, type Currency, type Mode, type PaymentKind } from './constants';
import { isDateKey } from './dates';
import { parseAmount, round2 } from './format';
import type { CashState } from './money';

// Form validation shared by the expense and exchange forms (UI spec 6.5, requirements spec 4.6–4.7).

export const MSG = {
  required: '請完成此欄位。',
  amount: '請輸入有效金額，且金額必須大於 0。',
  date: '請選擇有效日期。',
  trip: '旅遊模式請選擇或新增旅程。',
  sameCurrency: '換出與換入的幣別不能相同。',
  card: '卡片提領請選擇提領的卡片。',
  atmTwd: '卡片提領的換出幣別必須是台幣（卡片帳單金額）。'
};

export type Errors<K extends string> = Partial<Record<K, string>>;

export interface ExpenseDraft {
  date: string;
  mode: Mode;
  categoryId: string;
  amount: string;
  currency: Currency;
  paymentId: string;
  tripId?: string;
  billTwd: string;
}

export interface ExpenseContext {
  categoryMode: (id: string) => Mode | undefined;
  paymentKind: (id: string) => PaymentKind | undefined;
  tripExists: (id: string) => boolean;
}

/** Card payment in a foreign currency: the only case where a bill amount applies. */
export const takesBill = (kind: PaymentKind | undefined, currency: Currency) => kind !== undefined && kind !== 'cash' && currency !== 'TWD';

export function validateExpense(d: ExpenseDraft, ctx: ExpenseContext) {
  const errors: Errors<'amount' | 'date' | 'categoryId' | 'paymentId' | 'tripId' | 'billTwd' | 'currency' | 'mode'> = {};
  const amount = parseAmount(d.amount);
  if (!(amount > 0)) errors.amount = MSG.amount;
  if (!isDateKey(d.date)) errors.date = MSG.date;
  if (!MODES.includes(d.mode)) errors.mode = MSG.required;
  if (!CURRENCIES.includes(d.currency)) errors.currency = MSG.required;
  if (ctx.categoryMode(d.categoryId) !== d.mode) errors.categoryId = MSG.required;
  const kind = ctx.paymentKind(d.paymentId);
  if (!kind) errors.paymentId = MSG.required;
  if (d.mode === 'travel' && !(d.tripId && ctx.tripExists(d.tripId))) errors.tripId = MSG.trip;
  let billTwd: number | undefined;
  if (takesBill(kind, d.currency) && d.billTwd.trim()) {
    const b = parseAmount(d.billTwd);
    if (!(b > 0)) errors.billTwd = MSG.amount;
    else billTwd = Math.round(b);
  }
  return {
    errors,
    ok: Object.keys(errors).length === 0,
    values: { amount: round2(amount), billTwd, tripId: d.mode === 'travel' ? d.tripId : undefined }
  };
}

export interface ExchangeDraft {
  date: string;
  method: 'cash' | 'atm';
  cardId?: string;
  outAmount: string;
  outCurrency: Currency;
  inAmount: string;
  inCurrency: Currency;
}

export function validateExchange(d: ExchangeDraft, paymentKind: (id: string) => PaymentKind | undefined, cashBefore: Partial<Record<Currency, CashState>>) {
  const errors: Errors<'date' | 'outAmount' | 'inAmount' | 'inCurrency' | 'outCurrency' | 'cardId'> = {};
  const outAmount = parseAmount(d.outAmount);
  const inAmount = parseAmount(d.inAmount);
  if (!isDateKey(d.date)) errors.date = MSG.date;
  if (!(outAmount > 0)) errors.outAmount = MSG.amount;
  if (!(inAmount > 0)) errors.inAmount = MSG.amount;
  if (d.outCurrency === d.inCurrency) errors.inCurrency = MSG.sameCurrency;
  if (d.method === 'atm') {
    const k = d.cardId ? paymentKind(d.cardId) : undefined;
    if (!k || k === 'cash') errors.cardId = MSG.card;
    if (d.outCurrency !== 'TWD') errors.outCurrency = MSG.atmTwd;
  }
  if (!errors.outCurrency && d.outCurrency !== 'TWD' && cashBefore[d.outCurrency]?.avg == null) {
    errors.outCurrency = `請先記錄 ${d.outCurrency} 的換匯。`;
  }
  return { errors, ok: Object.keys(errors).length === 0, values: { outAmount: round2(outAmount), inAmount: round2(inAmount) } };
}
