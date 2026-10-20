import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setBill } from '../../db/ledger';
import { MODES, MODE_SHORT, type Currency, type Mode } from '../../domain/constants';
import { monthKey, monthLabel, monthRange, shortDate, slashDate, today } from '../../domain/dates';
import { formatAmount, formatTwd, parseAmount } from '../../domain/format';
import { summarize } from '../../domain/money';
import { byCategory, filterMonth, monthsWithData, paymentSummaries, tripSummaries, type CategorySlice } from '../../domain/stats';
import { IconAlert, IconChart, IconShare } from '../../components/Icons';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, Seg, useToast } from '../../components/ui';
import { useEditors } from '../ledger/Editors';
import { useLedger } from '../ledger/LedgerData';
import { presetLedgerFilter } from '../ledger/LedgerPage';
import { ExpenseRow } from '../ledger/rows';
import { ExportSheet } from '../data/ExportSheet';
import { CategoryList, Donut } from './charts';

type View = 'month' | 'trip' | 'payment';
const VIEWS = [['month', '月份'], ['trip', '旅程'], ['payment', '付款方式']] as const;

// Kept for the session, like the ledger filters.
let remembered: { view: View; mode: 'all' | Mode; month: string } | null = null;

function MissingNote({ count, missing }: { count: number; missing: Partial<Record<Currency, number>> }) {
  if (!count) return null;
  return (
    <span className="chip warn" style={{ whiteSpace: 'normal' }}>
      <IconAlert width={12} height={12} />
      另有 {count} 筆未換算（{Object.entries(missing).map(([c, a]) => `${formatAmount(a!, c as Currency)} ${c}`).join('、')}）
    </span>
  );
}

function MonthNav({ months, month, onChange }: { months: string[]; month: string; onChange: (m: string) => void }) {
  const i = months.indexOf(month);
  return (
    <div className="monthnav">
      <button type="button" aria-label="上個月" disabled={i <= 0} onClick={() => onChange(months[i - 1])}>‹</button>
      <b>{monthLabel(month)}</b>
      <button type="button" aria-label="下個月" disabled={i >= months.length - 1} onClick={() => onChange(months[i + 1])}>›</button>
    </div>
  );
}

export function StatsPage() {
  const L = useLedger();
  const navigate = useNavigate();
  const [s, setS] = useState(() => remembered ?? { view: 'month' as View, mode: 'all' as const, month: monthKey(today()) });
  const [exportOpen, setExportOpen] = useState(false);
  const set = (patch: Partial<typeof s>) => setS(prev => (remembered = { ...prev, ...patch }));
  const months = useMemo(() => monthsWithData(L.expenses, monthKey(today())), [L.expenses]);

  const openCategory = (slice: CategorySlice) => {
    const [from, to] = monthRange(`${s.month}-01`);
    const id = slice.ids.length === 1 ? slice.ids[0] : `name:${slice.name}`;
    presetLedgerFilter({ seg: 'expenses', period: 'custom', from, to, mode: s.mode, tripId: 'all', categoryId: id, paymentId: 'all', missing: null });
    navigate('/ledger');
  };

  return (
    <>
      <PageHeader title="統計" />
      <main className="page">
        <Seg label="統計檢視" value={s.view} options={VIEWS} onChange={view => set({ view })} />
        {s.view !== 'trip' && (
          <div className="scroller" role="group" aria-label="模式">
            <button type="button" className="fchip" aria-pressed={s.mode === 'all'} onClick={() => set({ mode: 'all' })}>全部模式</button>
            {MODES.map(m => (
              <button key={m} type="button" className={`fchip${m === 'travel' ? ' travel' : ''}`} aria-pressed={s.mode === m} onClick={() => set({ mode: m })}>{MODE_SHORT[m]}</button>
            ))}
          </div>
        )}

        {L.expenses.length === 0 ? (
          <EmptyState icon={<IconChart />}>開始記帳後，這裡會顯示各類別、旅程與付款方式的花費。</EmptyState>
        ) : s.view === 'month' ? (
          <MonthView month={s.month} mode={s.mode} months={months} onMonth={month => set({ month })} onPick={openCategory} />
        ) : s.view === 'trip' ? (
          <TripView />
        ) : (
          <PaymentView month={s.month} mode={s.mode} months={months} onMonth={month => set({ month })} />
        )}

        <button type="button" className="btn btn-secondary btn-block" onClick={() => setExportOpen(true)}>
          <IconShare />匯出 Excel
        </button>
      </main>
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

function MonthView({ month, mode, months, onMonth, onPick }: { month: string; mode: 'all' | Mode; months: string[]; onMonth: (m: string) => void; onPick: (s: CategorySlice) => void }) {
  const L = useLedger();
  const list = filterMonth(L.expenses, month, mode);
  const sum = summarize(list, L.money.expenses);
  const slices = byCategory(list, L.money.expenses, L.categories);
  return (
    <>
      <MonthNav months={months} month={month} onChange={onMonth} />
      <div className="card total">
        <span className="muted small">台幣總額（現金依換匯成本、刷卡依帳單金額）</span>
        <span className="big num"><small>NT$</small>{Math.round(sum.twd).toLocaleString('en-US')}</span>
        <span className="muted small">{list.length} 筆支出</span>
        <MissingNote count={sum.missingCount} missing={sum.missing} />
      </div>
      {slices.length > 0 ? (
        <div className="card donut-wrap">
          <Donut slices={slices} />
          <CategoryList slices={slices} onPick={onPick} />
        </div>
      ) : (
        <EmptyState>這段期間還沒有已換算台幣的支出。</EmptyState>
      )}
    </>
  );
}

function TripView() {
  const L = useLedger();
  const { openExpense } = useEditors();
  const [open, setOpen] = useState<string | null>(null);
  const trips = useMemo(() => tripSummaries(L.trips, L.expenses, L.money.expenses, L.categories), [L]);
  if (!trips.length) return <EmptyState>還沒有旅程。新增支出時切到旅遊模式，就能建立旅程。</EmptyState>;
  return (
    <>
      {trips.map(t => (
        <section className="section" key={t.trip.id}>
          <button type="button" className="trip" aria-expanded={open === t.trip.id} onClick={() => setOpen(open === t.trip.id ? null : t.trip.id)}>
            <span className="h">
              <span className="name">{t.trip.name}</span>
              <span className="sum num">{formatTwd(t.twd)}</span>
            </span>
            <span className="meta num">
              <span>{slashDate(t.start)} – {shortDate(t.end)}</span>
              <span>{t.days} 天</span>
              <span>每日 {formatTwd(t.perDay)}</span>
              <span>{t.expenses.length} 筆</span>
            </span>
            {t.categories.length > 0 && (
              <span className="legend">
                {t.categories.slice(0, 3).map(c => (
                  <span key={c.name}><i className="dot" style={{ background: `var(--cat${c.color})` }} />{c.name} <span className="num">{formatTwd(c.twd)}</span></span>
                ))}
              </span>
            )}
            <MissingNote count={t.missingCount} missing={t.missing} />
          </button>
          {open === t.trip.id && (
            <>
              {t.categories.length > 0 && (
                <div className="card donut-wrap">
                  <Donut slices={t.categories} />
                  <CategoryList slices={t.categories} />
                </div>
              )}
              {t.expenses.length > 0 && <div className="list">{t.expenses.map(e => <ExpenseRow key={e.id} e={e} onClick={() => openExpense(e.id)} />)}</div>}
            </>
          )}
        </section>
      ))}
    </>
  );
}

function PaymentView({ month, mode, months, onMonth }: { month: string; mode: 'all' | Mode; months: string[]; onMonth: (m: string) => void }) {
  const L = useLedger();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [bills, setBills] = useState<Record<string, string>>({});
  const cards = paymentSummaries(L.payments, filterMonth(L.expenses, month, mode), L.money.expenses);

  async function fill(id: string) {
    const v = parseAmount(bills[id] ?? '');
    if (!(v > 0)) return toast('請輸入有效金額，且金額必須大於 0。', { ok: false });
    await setBill(id, v);
    setBills(b => ({ ...b, [id]: '' }));
    toast('已補上帳單金額。');
  }

  return (
    <>
      <MonthNav months={months} month={month} onChange={onMonth} />
      {cards.length === 0 && <EmptyState>這個月還沒有支出紀錄。</EmptyState>}
      {cards.map(p => {
        const isCash = p.payment.kind === 'cash';
        const expanded = open === p.payment.id;
        return (
          <div className="list" key={p.payment.id}>
            <button type="button" className="paycard" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.payment.id)}>
              <span className="h"><b>{p.payment.name}</b><span className="muted tiny">{p.count} 筆 {expanded ? '▴' : '▾'}</span></span>
              <span className="kv num"><span>原幣小計</span><span>{p.byCurrency.map(([c, a]) => `${formatAmount(a, c)} ${c}`).join(' ／ ')}</span></span>
              <span className="kv num"><span>{isCash ? '換算台幣' : '已補帳單台幣'}</span><span>{formatTwd(p.twd)}</span></span>
              {!isCash && p.pending.length > 0 && <span className="kv"><span>待補</span><span className="chip warn">{p.pending.length} 筆</span></span>}
            </button>
            {expanded &&
              p.expenses.map(e => {
                const c = L.money.expenses.get(e.id);
                const label = (
                  <span className="main">
                    {e.itemName || L.category(e.categoryId)?.name}
                    <br />
                    <span className="muted tiny num">{shortDate(e.date)} · {formatAmount(e.amount, e.currency)} {e.currency}</span>
                  </span>
                );
                return c?.source === 'pending' ? (
                  <div className="fillrow" key={e.id}>
                    {label}
                    <input inputMode="numeric" placeholder="NT$" aria-label={`${e.itemName} 的帳單台幣金額`} value={bills[e.id] ?? ''} onChange={ev => setBills(b => ({ ...b, [e.id]: ev.target.value }))} />
                    <button type="button" className="go" onClick={() => fill(e.id)}>補上</button>
                  </div>
                ) : (
                  <div className="fillrow" key={e.id}>
                    {label}
                    <span className="num">{c?.twd != null ? formatTwd(c.twd) : '無匯率'}</span>
                  </div>
                );
              })}
          </div>
        );
      })}
    </>
  );
}
