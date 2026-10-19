import { useEffect, useMemo, useState } from 'react';
import { deleteExchange, saveExchange } from '../../db/ledger';
import { CURRENCIES, type Currency } from '../../domain/constants';
import { today } from '../../domain/dates';
import { formatRate, formatTwd, parseAmount } from '../../domain/format';
import { cashStateOn } from '../../domain/money';
import { validateExchange, type Errors } from '../../domain/validate';
import { DeleteButton, Field, Options } from '../../components/form';
import { Seg, Sheet, useToast } from '../../components/ui';
import { useLedger } from './LedgerData';

interface Draft {
  date: string;
  method: 'cash' | 'atm';
  cardId?: string;
  outAmount: string;
  outCurrency: Currency;
  inAmount: string;
  inCurrency: Currency;
  estimated: boolean;
  place: string;
  note: string;
}

const METHODS = [['cash', '現金換匯'], ['atm', '卡片提領']] as const;
const FOREIGN = CURRENCIES.filter(c => c !== 'TWD');

export function ExchangeForm({ open, editId, onClose }: { open: boolean; editId?: string; onClose: () => void }) {
  const L = useLedger();
  const toast = useToast();
  const [d, setD] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Errors<string>>({});

  useEffect(() => {
    if (!open) return setD(null);
    if (!L.ready) return;
    setErrors({});
    const x = editId ? L.exchanges.find(e => e.id === editId) : undefined;
    setD(
      x
        ? { ...x, outAmount: String(x.outAmount), inAmount: String(x.inAmount), estimated: !!x.estimated }
        : { date: today(), method: 'cash', outAmount: '', outCurrency: 'TWD', inAmount: '', inCurrency: 'CZK', estimated: true, place: '', note: '' }
    );
  }, [open, editId, L.ready]);

  const kindOf = (id: string) => L.payment(id)?.kind;
  const cashBefore = useMemo(
    () => (d ? cashStateOn(d.date, L.expenses, L.exchanges, id => L.payment(id)?.kind, editId) : {}),
    [d?.date, L, editId]
  );

  if (!d) return <Sheet open={open} onClose={onClose} labelledBy="fx-title"><h2 id="fx-title" className="muted small">載入中…</h2></Sheet>;
  const set = (patch: Partial<Draft>) => setD(prev => (prev ? { ...prev, ...patch } : prev));

  const cards = L.payments.filter(p => p.kind !== 'cash' && (p.active || p.id === d.cardId));
  const outOptions = (d.method === 'atm' ? ['TWD'] : CURRENCIES).map(c => ({ value: c as Currency, label: c }));
  const inOptions = (d.outCurrency === 'TWD' ? FOREIGN : CURRENCIES.filter(c => c !== d.outCurrency)).map(c => ({ value: c, label: c }));

  // Live rate preview
  const out = parseAmount(d.outAmount);
  const inn = parseAmount(d.inAmount);
  let preview: string | null = null;
  if (out > 0 && inn > 0 && d.outCurrency !== d.inCurrency) {
    const outAvg = d.outCurrency === 'TWD' ? 1 : cashBefore[d.outCurrency]?.avg;
    if (outAvg != null) {
      const cost = out * outAvg;
      preview = d.inCurrency === 'TWD'
        ? `成本 ${formatTwd(cost)} · 匯差 ${inn - Math.round(cost) >= 0 ? '+' : '−'}${Math.abs(inn - Math.round(cost)).toLocaleString('en-US')} TWD`
        : `1 ${d.inCurrency} = ${formatRate(cost / inn, d.inCurrency)} TWD${d.outCurrency !== 'TWD' ? `（以 ${d.outCurrency} 平均成本換算）` : ''}`;
    }
  }

  function changeMethod(method: Draft['method']) {
    set(method === 'atm'
      ? { method, outCurrency: 'TWD', cardId: d!.cardId ?? cards[0]?.id, inCurrency: d!.inCurrency === 'TWD' ? 'CZK' : d!.inCurrency, estimated: true }
      : { method, cardId: undefined });
  }

  function changeOut(outCurrency: Currency) {
    // Keep the received currency unless it now equals the one given up.
    const inCurrency = d!.inCurrency !== outCurrency ? d!.inCurrency : outCurrency === 'CZK' ? 'TWD' : 'CZK';
    set({ outCurrency, inCurrency });
  }

  async function save() {
    if (!d) return;
    const r = validateExchange(d, kindOf, cashBefore);
    setErrors(r.errors);
    if (!r.ok) return;
    try {
      await saveExchange(
        {
          date: d.date, method: d.method, cardId: d.method === 'atm' ? d.cardId : undefined,
          outAmount: r.values.outAmount, outCurrency: d.outCurrency, inAmount: r.values.inAmount, inCurrency: d.inCurrency,
          estimated: d.method === 'atm' ? d.estimated : undefined, place: d.place.trim(), note: d.note.trim()
        },
        editId
      );
      toast('已成功儲存，現金成本已重新計算。');
      onClose();
    } catch {
      toast('暫時無法儲存，請稍後再試；你輸入的內容已保留。', { ok: false });
    }
  }

  async function remove() {
    if (!editId) return;
    await deleteExchange(editId);
    toast('已刪除，現金成本已重新計算。');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="fx-title">
      <div className="sheet-h">
        <button type="button" onClick={onClose}>取消</button>
        <h2 id="fx-title" style={{ textAlign: 'center' }}>{editId ? '編輯換匯' : '新增換匯'}</h2>
        <button type="button" className="save" onClick={save}>儲存</button>
      </div>

      <Seg label="換匯方式" value={d.method} options={METHODS} onChange={changeMethod} />

      {d.method === 'atm' && (
        <Field label="提領卡片" error={errors.cardId}>
          <Options label="提領卡片" value={d.cardId} options={cards.map(p => ({ value: p.id, label: p.name }))} onChange={cardId => set({ cardId })} />
        </Field>
      )}

      <Field label={d.method === 'atm' ? '扣款台幣（含手續費）' : '換出'} htmlFor="fx-out" error={errors.outAmount ?? errors.outCurrency}>
        <input id="fx-out" inputMode="decimal" autoComplete="off" placeholder="例如 10000" value={d.outAmount} autoFocus={!editId} onChange={e => set({ outAmount: e.target.value })} />
        {d.method === 'cash' && <Options label="換出幣別" value={d.outCurrency} options={outOptions} onChange={changeOut} />}
      </Field>

      <Field label="換入" htmlFor="fx-in" error={errors.inAmount ?? errors.inCurrency}>
        <input id="fx-in" inputMode="decimal" autoComplete="off" placeholder="例如 7150" value={d.inAmount} onChange={e => set({ inAmount: e.target.value })} />
        <Options label="換入幣別" value={d.inCurrency} options={inOptions} onChange={inCurrency => set({ inCurrency })} />
      </Field>

      {preview && <div className="hint num">{preview}</div>}

      {d.method === 'atm' && (
        <label className="check">
          <input type="checkbox" checked={d.estimated} onChange={e => set({ estimated: e.target.checked })} />
          台幣金額是預估的（帳單出來後改成實際金額，再取消勾選）
        </label>
      )}

      <div className="two">
        <Field label="日期" htmlFor="fx-date" error={errors.date}>
          <input id="fx-date" type="date" value={d.date} onChange={e => set({ date: e.target.value })} />
        </Field>
        <Field label="地點" htmlFor="fx-place">
          <input id="fx-place" type="text" value={d.place} placeholder="例如 台灣銀行" onChange={e => set({ place: e.target.value })} />
        </Field>
      </div>

      <Field label="備註" htmlFor="fx-note">
        <textarea id="fx-note" value={d.note} onChange={e => set({ note: e.target.value })} />
      </Field>

      <button type="button" className="btn btn-primary btn-block" onClick={save}>儲存</button>
      {editId && <DeleteButton label="刪除這筆換匯" onDelete={remove} />}
    </Sheet>
  );
}
