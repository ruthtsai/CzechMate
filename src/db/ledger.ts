import { db, setSetting } from './index';
import type { Category, Exchange, Expense, PaymentMethod, Trip } from './schema';
import type { Mode, PaymentKind } from '../domain/constants';
import { CATEGORY_COLOR } from './seed';

// Writes for the ledger. Validation happens in the forms (domain/validate.ts); these functions
// enforce the integrity rules from requirements spec 4.1 and 4.5.

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export type ExpenseInput = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;
export type ExchangeInput = Omit<Exchange, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveExpense(input: ExpenseInput, id?: string): Promise<string> {
  const t = now();
  return db.transaction('rw', db.expenses, db.settings, async () => {
    if (id) {
      await db.expenses.update(id, { ...input, tripId: input.tripId, billTwd: input.billTwd, updatedAt: t });
    } else {
      id = uid();
      await db.expenses.add({ ...input, id, createdAt: t, updatedAt: t });
    }
    // Next form opens with these (requirements EXP-04).
    await Promise.all([
      setSetting('lastMode', input.mode),
      setSetting('lastCurrency', input.currency),
      setSetting('lastPaymentId', input.paymentId),
      input.tripId ? setSetting('lastTripId', input.tripId) : Promise.resolve()
    ]);
    return id;
  });
}

export const deleteExpense = (id: string) => db.expenses.delete(id);

export async function saveExchange(input: ExchangeInput, id?: string): Promise<string> {
  const t = now();
  if (id) {
    await db.exchanges.update(id, { ...input, cardId: input.cardId, estimated: input.estimated, updatedAt: t });
    return id;
  }
  const newId = uid();
  await db.exchanges.add({ ...input, id: newId, createdAt: t, updatedAt: t });
  return newId;
}

export const deleteExchange = (id: string) => db.exchanges.delete(id);

/* ---------- trips ---------- */

export async function saveTrip(input: { name: string; startDate: string; endDate?: string }, id?: string): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('請輸入旅程名稱。');
  const clash = await db.trips.filter(t => t.name === name && t.id !== id).count();
  if (clash) throw new Error('已經有同名的旅程。');
  const endDate = input.endDate && input.endDate >= input.startDate ? input.endDate : undefined;
  if (id) {
    await db.trips.update(id, { name, startDate: input.startDate, endDate });
    return id;
  }
  const trip: Trip = { id: uid(), name, startDate: input.startDate, endDate, createdAt: now() };
  await db.trips.add(trip);
  return trip.id;
}

export async function deleteTrip(id: string) {
  if (await db.expenses.where('tripId').equals(id).count()) throw new Error('這個旅程已有支出紀錄，不能刪除。');
  await db.trips.delete(id);
}

/* ---------- payment methods ---------- */

export async function addPaymentMethod(name: string, kind: Exclude<PaymentKind, 'cash'>) {
  name = name.trim();
  if (!name) throw new Error('請輸入名稱。');
  if (await db.paymentMethods.filter(p => p.name === name).count()) throw new Error('已經有同名的付款方式。');
  const order = (await db.paymentMethods.count()) + 1;
  await db.paymentMethods.add({ id: uid(), name, kind, order, active: true });
}

export async function updatePaymentMethod(p: PaymentMethod, changes: Partial<Pick<PaymentMethod, 'name' | 'active'>>) {
  if (changes.active === false && p.kind === 'cash') throw new Error('現金不能停用。');
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) throw new Error('請輸入名稱。');
    if (await db.paymentMethods.filter(x => x.name === changes.name && x.id !== p.id).count()) throw new Error('已經有同名的付款方式。');
  }
  await db.paymentMethods.update(p.id, changes);
}

export async function deletePaymentMethod(p: PaymentMethod) {
  if (p.kind === 'cash') throw new Error('現金不能刪除。');
  const used = (await db.expenses.where('paymentId').equals(p.id).count()) + (await db.exchanges.filter(x => x.cardId === p.id).count());
  if (used) throw new Error('已經使用過的付款方式只能停用。');
  await db.paymentMethods.delete(p.id);
}

/* ---------- categories ---------- */

export async function addCategory(mode: Mode, name: string) {
  name = name.trim();
  if (!name) throw new Error('請輸入類別名稱。');
  const inMode = await db.categories.where('mode').equals(mode).toArray();
  if (inMode.some(c => c.name === name)) throw new Error('這個模式已經有同名的類別。');
  // Same name keeps the same colour across modes; otherwise pick the least used colour.
  const all = await db.categories.toArray();
  const color = all.find(c => c.name === name)?.color ?? CATEGORY_COLOR[name] ?? leastUsedColor(inMode);
  await db.categories.add({ id: uid(), mode, name, color, order: inMode.length, active: true });
}

function leastUsedColor(list: Category[]) {
  const counts = Array.from({ length: 9 }, (_, i) => list.filter(c => c.color === i + 1).length);
  return counts.indexOf(Math.min(...counts)) + 1;
}

export async function updateCategory(c: Category, changes: Partial<Pick<Category, 'name' | 'active'>>) {
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) throw new Error('請輸入類別名稱。');
    if (await db.categories.filter(x => x.mode === c.mode && x.name === changes.name && x.id !== c.id).count()) throw new Error('這個模式已經有同名的類別。');
  }
  await db.categories.update(c.id, changes);
}

export async function deleteCategory(c: Category) {
  if (await db.expenses.where('categoryId').equals(c.id).count()) throw new Error('已經使用過的類別只能停用。');
  await db.categories.delete(c.id);
}

/** Swap `order` with the neighbour above (-1) or below (+1). */
export async function move<T extends { id: string; order: number }>(table: 'paymentMethods' | 'categories', list: T[], id: string, dir: -1 | 1) {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  await db.transaction('rw', db.table(table), async () => {
    await Promise.all(sorted.map((x, k) => {
      const order = k === i ? j : k === j ? i : k;
      return x.order === order ? undefined : db.table(table).update(x.id, { order });
    }));
  });
}
