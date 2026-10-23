import { useEffect, useMemo, useState } from 'react';
import { getSetting } from '../../db';
import { deleteExpense, saveExpense, saveTrip } from '../../db/ledger';
import { CURRENCIES, MODES, MODE_SHORT, type Currency, type Mode } from '../../domain/constants';
import { today } from '../../domain/dates';
import { formatAmount, formatRate, formatTwd, parseAmount } from '../../domain/format';
import { cashStateOn } from '../../domain/money';
import { takesBill, validateExpense, type Errors } from '../../domain/validate';
import { DeleteButton, Field, FieldError, Options } from '../../components/form';
import { Seg, Sheet, useToast } from '../../components/ui';
import { useLedger } from './LedgerData';
import { revealExpense } from './ledgerFilters';
import { copyFields, recentTemplates } from './templates';

interface Draft {
  mode: Mode;
  categoryId: string;
  amount: string;
  currency: Currency;
  paymentId: string;
  tripId?: string;
  itemName: string;
  date: string;
  place: string;
  note: string;
  billTwd: string;
}

const MODE_OPTIONS = MODES.map(m => [m, MODE_SHORT[m]] as const);

export function ExpenseForm({ open, editId, copyFromId, onCopy, onClose }: {
  open: boolean; editId?: string; copyFromId?: string; onCopy: (id: string) => void; onClose: () => void;
}) {
  const L = useLedger();
  const toast = useToast();
  const [d, setD] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors<string>>({});
  const [newTrip, setNewTrip] = useState<{ name: string; start: string; end: string; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const firstCategory = (mode: Mode) => L.categories.find(c => c.mode === mode && c.active)?.id ?? '';

  // Initialise the draft each time the sheet opens (requirements EXP-04 defaults).
  useEffect(() => {
    if (!open) return setD(null);
    if (!L.ready) return;
    setErrors({});
    setNewTrip(null);
    const e = editId ? L.expenses.find(x => x.id === editId) : undefined;
    if (e) {
      setD({ ...e, amount: String(e.amount), billTwd: e.billTwd ? String(e.billTwd) : '' });
      return;
    }
    const from = copyFromId ? L.expenses.find(x => x.id === copyFromId) : undefined;
    if (from) {
      setD({ ...copyFields(from), date: today(), note: '', billTwd: '' });
      return;
    }
    let cancelled = false;
    Promise.all([
      getSetting<Mode>('lastMode', 'daily'),
      getSetting<Currency>('lastCurrency', 'CZK'),
      getSetting<string>('lastPaymentId', 'pay-cash'),
      getSetting<string | undefined>('lastTripId', undefined)
    ]).then(([mode, currency, paymentId, lastTrip]) => {
      if (cancelled) return;
      const pay = L.payment(paymentId)?.active ? paymentId : 'pay-cash';
      const trip = lastTrip && L.trip(lastTrip) ? lastTrip : L.trips[0]?.id;
      setD({ mode, categoryId: firstCategory(mode), amount: '', currency, paymentId: pay, tripId: trip, itemName: '', date: today(), place: '', note: '', billTwd: '' });
    });
    return () => { cancelled = true; };
    // Only re-run when the sheet opens or the record changes, not on every ledger update.
  }, [open, editId, copyFromId, L.ready]);

  const templates = useMemo(() => (open && !editId && !copyFromId ? recentTemplates(L.expenses) : []), [open, editId, copyFromId, L.ready]);

  const kind = d ? L.payment(d.paymentId)?.kind : undefined;

  const preview = useMemo(() => {
    if (!d || kind !== 'cash' || d.currency === 'TWD') return null;
    const st = cashStateOn(d.date, L.expenses, L.exchanges, id => L.payment(id)?.kind, editId)[d.currency];
    const amount = parseAmount(d.amount);
    const left = (st?.stock ?? 0) - (amount > 0 ? amount : 0);
    if (!st || st.avg === null) return { warn: `還沒有 ${d.currency} 的換匯紀錄，台幣金額會先標為「無匯率」，補記換匯後自動換算。` };
    const twd = amount > 0 ? `≈ ${formatTwd(amount * st.avg)}　` : '';
    return {
      text: `${twd}成本 1 ${d.currency} = ${formatRate(st.avg, d.currency)} TWD · 付款後剩 ${formatAmount(left, d.currency)} ${d.currency}`,
      warn: left < 0 ? `${d.currency} 現金庫存不足，請補記換匯。` : undefined
    };
  }, [d, kind, L, editId]);

  if (!d) return <Sheet open={open} onClose={onClose} labelledBy="exp-title"><h2 id="exp-title" className="muted small">載入中…</h2></Sheet>;

  const set = (patch: Partial<Draft>) => setD(prev => (prev ? { ...prev, ...patch } : prev));
  const travel = d.mode === 'travel';

  const changeMode = (mode: Mode) => {
    if (mode === d.mode) return;
    set({ mode, categoryId: firstCategory(mode), tripId: d.tripId ?? L.trips[0]?.id });
  };

  const payOptions = L.payments.filter(p => p.active || p.id === d.paymentId).map(p => ({ value: p.id, label: p.name }));
  const catOptions = L.categories.filter(c => c.mode === d.mode && (c.active || c.id === d.categoryId)).map(c => ({ value: c.id, label: c.name }));
  const tripOptions = L.trips.map(t => ({ value: t.id, label: t.name }));

  async function createTrip() {
    if (!newTrip || !d) return;
    if (!newTrip.start) return setNewTrip({ ...newTrip, error: '請選擇開始日期。' });
    try {
      const id = await saveTrip({ name: newTrip.name, startDate: newTrip.start, endDate: newTrip.end || undefined });
      set({ tripId: id });
      setNewTrip(null);
      toast(`已建立旅程「${newTrip.name.trim()}」。`);
    } catch (e) {
      setNewTrip({ ...newTrip, error: (e as Error).message });
    }
  }

  async function save() {
    if (!d || saving) return;
    const r = validateExpense(d, {
      categoryMode: id => L.category(id)?.mode,
      paymentKind: id => L.payment(id)?.kind,
      tripExists: id => !!L.trip(id)
    });
    setErrors(r.errors);
    if (!r.ok) return;
    setSaving(true);
    try {
      const savedId = await saveExpense(
        {
          date: d.date, mode: d.mode, categoryId: d.categoryId, amount: r.values.amount, currency: d.currency, paymentId: d.paymentId,
          tripId: r.values.tripId, itemName: d.itemName.trim(), place: d.place.trim(), note: d.note.trim(), billTwd: r.values.billTwd
        },
        editId
      );
      revealExpense(savedId, d.date);
      toast('已成功儲存。');
      onClose();
    } catch {
      toast('暫時無法儲存，請稍後再試；你輸入的內容已保留。', { ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editId) return;
    await deleteExpense(editId);
    toast('已刪除。');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="exp-title" className={travel ? 'form-travel' : undefined}>
      <div className="sheet-h">
        <button type="button" onClick={onClose}>取消</button>
        <h2 id="exp-title" style={{ textAlign: 'center' }}>{editId ? '編輯支出' : copyFromId ? '複製支出' : '新增支出'}</h2>
        <button type="button" className="save" onClick={save} disabled={saving}>儲存</button>
      </div>

      <Seg label="記帳模式" value={d.mode} options={MODE_OPTIONS} onChange={changeMode} />

      {templates.length > 0 && !d.amount && !d.itemName && (
        <div className="scroller" role="group" aria-label="最近記過">
          <span className="muted small" style={{ flexShrink: 0, alignSelf: 'center' }}>最近記過</span>
          {templates.map(t => (
            <button key={t.id} type="button" className="fchip" onClick={() => set({ ...copyFields(t), tripId: t.tripId ?? d.tripId })}>
              {t.itemName} · {formatAmount(t.amount, t.currency)} {t.currency}
            </button>
          ))}
        </div>
      )}

      {travel && (
        <Field label="哪一趟旅程" error={errors.tripId}>
          <Options
            label="旅程"
            value={d.tripId}
            options={tripOptions}
            onChange={tripId => set({ tripId })}
            extra={!newTrip && (
              <button type="button" className="opt add" onClick={() => setNewTrip({ name: '', start: d.date, end: '' })}>＋ 新旅程</button>
            )}
          />
        </Field>
      )}
      {travel && newTrip && (
        <div className="inset">
          <Field label="旅程名稱" htmlFor="nt-name">
            <input id="nt-name" type="text" value={newTrip.name} placeholder="例如：克拉科夫週末" autoFocus onChange={e => setNewTrip({ ...newTrip, name: e.target.value, error: undefined })} />
          </Field>
          <div className="two">
            <Field label="開始" htmlFor="nt-start">
              <input id="nt-start" type="date" value={newTrip.start} onChange={e => setNewTrip({ ...newTrip, start: e.target.value })} />
            </Field>
            <Field label="結束（選填）" htmlFor="nt-end">
              <input id="nt-end" type="date" value={newTrip.end} min={newTrip.start} onChange={e => setNewTrip({ ...newTrip, end: e.target.value })} />
            </Field>
          </div>
          <FieldError text={newTrip.error} />
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setNewTrip(null)}>取消</button>
            <button type="button" className="btn btn-primary" onClick={createTrip}>建立並選取</button>
          </div>
        </div>
      )}

      <Field label="金額" htmlFor="exp-amount" error={errors.amount}>
        <input
          id="exp-amount" className="amount-in" inputMode="decimal" autoComplete="off" placeholder="0"
          value={d.amount} autoFocus={!editId} onChange={e => set({ amount: e.target.value })}
        />
        <Options label="幣別" value={d.currency} options={CURRENCIES.map(c => ({ value: c, label: c }))} onChange={currency => set({ currency })} />
      </Field>

      <Field label="付款方式" error={errors.paymentId}>
        <Options label="付款方式" value={d.paymentId} options={payOptions} onChange={paymentId => set({ paymentId })} />
      </Field>

      {preview?.text && <div className="hint num">{preview.text}</div>}
      {preview?.warn && <div className="hint warn">{preview.warn}</div>}

      <Field label="類別" error={errors.categoryId}>
        <Options label="類別" value={d.categoryId} options={catOptions} onChange={categoryId => set({ categoryId })} />
      </Field>

      <Field label="項目名稱" htmlFor="exp-item">
        <input id="exp-item" type="text" value={d.itemName} placeholder="例如：午餐、火車票" onChange={e => set({ itemName: e.target.value })} />
      </Field>

      <div className="two">
        <Field label="日期" htmlFor="exp-date" error={errors.date}>
          <input id="exp-date" type="date" value={d.date} onChange={e => set({ date: e.target.value })} />
        </Field>
        <Field label="地點" htmlFor="exp-place">
          <input id="exp-place" type="text" value={d.place} placeholder="城市或店家" onChange={e => set({ place: e.target.value })} />
        </Field>
      </div>

      <Field label="備註" htmlFor="exp-note">
        <textarea id="exp-note" value={d.note} placeholder="補充資訊" onChange={e => set({ note: e.target.value })} />
      </Field>

      {takesBill(kind, d.currency) && (
        <Field label="帳單台幣金額" htmlFor="exp-bill" error={errors.billTwd}>
          <input id="exp-bill" inputMode="numeric" value={d.billTwd} placeholder="帳單出來後再補，含國外交易手續費" onChange={e => set({ billTwd: e.target.value })} />
        </Field>
      )}

      <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={saving}>儲存</button>
      {editId && <button type="button" className="btn btn-secondary btn-block" onClick={() => onCopy(editId)}>複製成新的一筆</button>}
      {editId && <DeleteButton label="刪除這筆支出" onDelete={remove} />}
    </Sheet>
  );
}
