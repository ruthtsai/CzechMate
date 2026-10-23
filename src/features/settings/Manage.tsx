import { useState, type ReactNode } from 'react';
import {
  addCategory, addPaymentMethod, deleteCategory, deletePaymentMethod, deleteTrip, move, saveTrip, updateCategory, updatePaymentMethod
} from '../../db/ledger';
import type { Category, PaymentMethod, Trip } from '../../db/schema';
import { MODES, MODE_SHORT, PAYMENT_KIND_LABEL, type Mode } from '../../domain/constants';
import { daysBetween, slashDate, today } from '../../domain/dates';
import { countdownLabel } from '../../domain/keyDates';
import { deleteKeyDate, getKeyDates, saveKeyDate } from '../../db/keyDates';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatTwd, parseAmount } from '../../domain/format';
import { Field, FieldError } from '../../components/form';
import { Seg, useToast } from '../../components/ui';
import { useLedger } from '../ledger/LedgerData';
import { catColor } from '../ledger/rows';

// Settings sub-screens for SET-01: add, rename, reorder, disable or delete.

function useRun() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
      return true;
    } catch (e) {
      toast((e as Error).message, { ok: false });
      return false;
    }
  };
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="sheet-h">
      <button type="button" className="backbtn" onClick={onBack}>‹ 設定</button>
      <h2 id="settings-title" style={{ textAlign: 'center' }}>{title}</h2>
      <span style={{ width: 60 }} />
    </div>
  );
}

/** Row with inline rename, move up/down, enable/disable and delete. */
function EditRow({ name, sub, active, lead, first, last, canDisable, onRename, onMove, onToggle, onDelete }: {
  name: string; sub?: ReactNode; active: boolean; lead?: ReactNode; first: boolean; last: boolean; canDisable: boolean;
  onRename: (name: string) => Promise<boolean>; onMove: (dir: -1 | 1) => void; onToggle: () => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null) {
    return (
      <div className="editrow">
        <input
          className="name" aria-label="名稱" value={editing} autoFocus
          style={{ minHeight: 40, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 16 }}
          onChange={e => setEditing(e.target.value)}
        />
        <button type="button" className="mini" onClick={() => setEditing(null)}>取消</button>
        <button type="button" className="mini" onClick={async () => (await onRename(editing)) && setEditing(null)}>儲存</button>
      </div>
    );
  }
  return (
    <div className={`editrow${active ? '' : ' off'}`}>
      {lead}
      <span className="name"><span>{name}</span>{sub && <small>{sub}</small>}</span>
      <button type="button" className="mini" aria-label={`上移 ${name}`} disabled={first} onClick={() => onMove(-1)}>↑</button>
      <button type="button" className="mini" aria-label={`下移 ${name}`} disabled={last} onClick={() => onMove(1)}>↓</button>
      <button type="button" className="mini" onClick={() => setEditing(name)}>改名</button>
      {canDisable && <button type="button" className="mini" onClick={onToggle}>{active ? '停用' : '啟用'}</button>}
      <button type="button" className="mini" aria-label={`刪除 ${name}`} onClick={onDelete}>✕</button>
    </div>
  );
}

export function ManagePayments({ onBack }: { onBack: () => void }) {
  const L = useLedger();
  const run = useRun();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'credit' | 'debit'>('credit');
  const list = L.payments;
  return (
    <>
      <Header title="付款方式" onBack={onBack} />
      <div className="list">
        {list.map((p: PaymentMethod, i) => (
          <EditRow
            key={p.id} name={p.name} sub={PAYMENT_KIND_LABEL[p.kind]} active={p.active}
            first={i === 0} last={i === list.length - 1} canDisable={p.kind !== 'cash'}
            onRename={n => run(() => updatePaymentMethod(p, { name: n }), '已成功儲存。')}
            onMove={dir => run(() => move('paymentMethods', list, p.id, dir))}
            onToggle={() => run(() => updatePaymentMethod(p, { active: !p.active }), p.active ? '已停用，舊紀錄會保留。' : '已啟用。')}
            onDelete={() => run(() => deletePaymentMethod(p), '已刪除。')}
          />
        ))}
      </div>
      <p className="muted tiny" style={{ margin: 0 }}>用過的付款方式不能刪除，只能停用；停用後不會出現在新增表單。</p>
      <div className="inset">
        <Field label="新增付款方式" htmlFor="pm-name">
          <input id="pm-name" type="text" value={name} placeholder="例如：Revolut、台新 Richart" onChange={e => setName(e.target.value)} />
        </Field>
        <Seg label="類型" value={kind} options={[['credit', '信用卡'], ['debit', '簽帳卡']] as const} onChange={setKind} />
        <button type="button" className="btn btn-primary" onClick={async () => (await run(() => addPaymentMethod(name, kind), '已新增。')) && setName('')}>新增</button>
      </div>
    </>
  );
}

export function ManageCategories({ onBack }: { onBack: () => void }) {
  const L = useLedger();
  const run = useRun();
  const [mode, setMode] = useState<Mode>('daily');
  const [name, setName] = useState('');
  const list = L.categories.filter(c => c.mode === mode);
  return (
    <>
      <Header title="類別" onBack={onBack} />
      <Seg label="模式" value={mode} options={MODES.map(m => [m, MODE_SHORT[m]] as const)} onChange={setMode} />
      <div className="list">
        {list.map((c: Category, i) => (
          <EditRow
            key={c.id} name={c.name} active={c.active} first={i === 0} last={i === list.length - 1} canDisable
            lead={<i className="dot" style={{ background: catColor(c.color), marginRight: 4 }} />}
            onRename={n => run(() => updateCategory(c, { name: n }), '已成功儲存。')}
            onMove={dir => run(() => move('categories', list, c.id, dir))}
            onToggle={() => run(() => updateCategory(c, { active: !c.active }), c.active ? '已停用，舊紀錄會保留。' : '已啟用。')}
            onDelete={() => run(() => deleteCategory(c), '已刪除。')}
          />
        ))}
      </div>
      <p className="muted tiny" style={{ margin: 0 }}>用過的類別不能刪除，只能停用。同名類別在不同模式會使用相同顏色。</p>
      <div className="inset">
        <Field label={`新增「${MODE_SHORT[mode]}」類別`} htmlFor="cat-name">
          <input id="cat-name" type="text" value={name} placeholder="例如：健身房" onChange={e => setName(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-primary" onClick={async () => (await run(() => addCategory(mode, name), '已新增。')) && setName('')}>新增</button>
      </div>
    </>
  );
}

export function ManageTrips({ onBack }: { onBack: () => void }) {
  const L = useLedger();
  const run = useRun();
  const [edit, setEdit] = useState<{ id?: string; name: string; start: string; end: string; budget: string; error?: string } | null>(null);
  const count = (t: Trip) => L.expenses.filter(e => e.tripId === t.id).length;

  async function submit() {
    if (!edit) return;
    if (!edit.start) return setEdit({ ...edit, error: '請選擇開始日期。' });
    try {
      const budget = edit.budget.trim() ? parseAmount(edit.budget) : 0;
      if (!(budget >= 0)) return setEdit({ ...edit, error: '預算請輸入數字。' });
      await saveTrip({ name: edit.name, startDate: edit.start, endDate: edit.end || undefined, budgetTwd: budget }, edit.id);
      setEdit(null);
    } catch (e) {
      setEdit({ ...edit, error: (e as Error).message });
    }
  }

  return (
    <>
      <Header title="旅程" onBack={onBack} />
      {L.trips.length > 0 ? (
        <div className="list">
          {L.trips.map(t => (
            <div className="editrow" key={t.id}>
              <span className="name">
                <span>{t.name}</span>
                <small className="num">{slashDate(t.startDate)}{t.endDate ? ` – ${slashDate(t.endDate)}` : ''} · {count(t)} 筆{t.budgetTwd ? ` · 預算 ${formatTwd(t.budgetTwd)}` : ''}</small>
              </span>
              <button type="button" className="mini" onClick={() => setEdit({ id: t.id, name: t.name, start: t.startDate, end: t.endDate ?? '', budget: t.budgetTwd ? String(t.budgetTwd) : '' })}>編輯</button>
              <button type="button" className="mini" aria-label={`刪除 ${t.name}`} onClick={() => run(() => deleteTrip(t.id), '已刪除。')}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>還沒有旅程。也可以在新增支出時，切到旅遊模式直接新增。</p>
      )}
      {edit ? (
        <div className="inset">
          <Field label="旅程名稱" htmlFor="trip-name">
            <input id="trip-name" type="text" value={edit.name} autoFocus placeholder="例如：維也納三日遊" onChange={e => setEdit({ ...edit, name: e.target.value, error: undefined })} />
          </Field>
          <div className="two">
            <Field label="開始" htmlFor="trip-start"><input id="trip-start" type="date" value={edit.start} onChange={e => setEdit({ ...edit, start: e.target.value })} /></Field>
            <Field label="結束（選填）" htmlFor="trip-end"><input id="trip-end" type="date" value={edit.end} min={edit.start} onChange={e => setEdit({ ...edit, end: e.target.value })} /></Field>
          </div>
          <Field label="預算（台幣，選填）" htmlFor="trip-budget">
            <input id="trip-budget" inputMode="numeric" value={edit.budget} placeholder="例如：8000" onChange={e => setEdit({ ...edit, budget: e.target.value, error: undefined })} />
          </Field>
          <FieldError text={edit.error} />
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>取消</button>
            <button type="button" className="btn btn-primary" onClick={submit}>{edit.id ? '儲存' : '新增'}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setEdit({ name: '', start: today(), end: '', budget: '' })}>＋ 新增旅程</button>
      )}
      <p className="muted tiny" style={{ margin: 0 }}>已有支出的旅程不能刪除。</p>
    </>
  );
}

export function ManageKeyDates({ onBack }: { onBack: () => void }) {
  const run = useRun();
  const dates = useLiveQuery(getKeyDates, [], []);
  const [edit, setEdit] = useState<{ id?: string; title: string; date: string; note: string; error?: string } | null>(null);
  const sorted = [...dates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  async function submit() {
    if (!edit) return;
    try {
      await saveKeyDate({ title: edit.title, date: edit.date, note: edit.note }, edit.id);
      setEdit(null);
    } catch (e) {
      setEdit({ ...edit, error: (e as Error).message });
    }
  }

  return (
    <>
      <Header title="重要日期" onBack={onBack} />
      {sorted.length > 0 ? (
        <div className="list">
          {sorted.map(d => (
            <div className="editrow" key={d.id}>
              <span className="name">
                <span>{d.title}</span>
                <small className="num">{slashDate(d.date)} · {countdownLabel(daysBetween(today(), d.date))}{d.note ? ` · ${d.note}` : ''}</small>
              </span>
              <button type="button" className="mini" onClick={() => setEdit({ id: d.id, title: d.title, date: d.date, note: d.note ?? '' })}>編輯</button>
              <button type="button" className="mini" aria-label={`刪除 ${d.title}`} onClick={() => run(() => deleteKeyDate(d.id), '已刪除。')}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>例如：簽證面試、宿舍押金截止、選課、出發日。首頁會倒數即將到來的日期。</p>
      )}
      {edit ? (
        <div className="inset">
          <Field label="名稱" htmlFor="kd-title">
            <input id="kd-title" type="text" value={edit.title} autoFocus placeholder="例如：宿舍押金截止" onChange={e => setEdit({ ...edit, title: e.target.value, error: undefined })} />
          </Field>
          <Field label="日期" htmlFor="kd-date">
            <input id="kd-date" type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value, error: undefined })} />
          </Field>
          <Field label="備註（選填）" htmlFor="kd-note">
            <input id="kd-note" type="text" value={edit.note} placeholder="例如：要帶護照影本" onChange={e => setEdit({ ...edit, note: e.target.value })} />
          </Field>
          <FieldError text={edit.error} />
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEdit(null)}>取消</button>
            <button type="button" className="btn btn-primary" onClick={submit}>{edit.id ? '儲存' : '新增'}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setEdit({ title: '', date: today(), note: '' })}>＋ 新增日期</button>
      )}
      <p className="muted tiny" style={{ margin: 0 }}>過期的日期隔天會從首頁消失，這裡仍會保留。</p>
    </>
  );
}
