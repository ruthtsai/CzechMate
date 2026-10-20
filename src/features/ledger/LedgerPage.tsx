import { useEffect, useMemo, useState } from 'react';
import { CURRENCIES, MODES, MODE_SHORT, type Currency } from '../../domain/constants';
import { shortDate, today, weekday } from '../../domain/dates';
import { formatAmount, formatRate, formatTwd } from '../../domain/format';
import { summarize } from '../../domain/money';
import { defaultFilters, filterExpenses, rememberFilters, takeReveal, takeStartFilters, type Filters, type Period } from './ledgerFilters';
import { Field, Options } from '../../components/form';
import { IconAlert, IconExchange, IconPlus, IconWallet } from '../../components/Icons';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, Seg, Sheet, useToast } from '../../components/ui';
import { useEditors } from './Editors';
import { useLedger } from './LedgerData';
import { ExchangeRow, ExpenseRow } from './rows';

const SEGMENTS = [['expenses', '支出'], ['exchanges', '換匯']] as const;
const PERIODS: [Period, string][] = [['week', '本週'], ['month', '本月'], ['all', '全部'], ['custom', '自訂']];

export function LedgerPage() {
  const L = useLedger();
  const { openExpense, openExchange } = useEditors();
  const toast = useToast();
  const [f, setF] = useState<Filters>(takeStartFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  // Only the user's own choices are remembered, never the "only pending" shortcut.
  const set = (patch: Partial<Filters>) =>
    setF(prev => {
      const next = { ...prev, ...patch };
      rememberFilters(next);
      return next;
    });

  const counts = useMemo(() => {
    let pending = 0, noRate = 0;
    for (const c of L.money.expenses.values()) {
      if (c.source === 'pending') pending++;
      else if (c.source === 'no-rate') noRate++;
    }
    return { pending, noRate };
  }, [L.money]);

  const list = useMemo(() => filterExpenses(f, L.expenses, L.money.expenses, L.category), [L, f]);

  // A just-saved expense must be visible: if the current filters hide it, go back to the usual view.
  useEffect(() => {
    const check = () => {
      const target = takeReveal(id => L.expenses.some(e => e.id === id));
      if (!target) return;
      const visible = f.seg === 'expenses' && filterExpenses(f, L.expenses, L.money.expenses, L.category).some(e => e.id === target.id);
      if (visible) return;
      const thisMonth = target.date.slice(0, 7) === today().slice(0, 7);
      set({ ...defaultFilters(), period: thisMonth ? 'month' : 'all' });
      toast('已切回全部支出，才看得到剛記的那筆。');
    };
    check();
    window.addEventListener('czechmate-reveal', check);
    return () => window.removeEventListener('czechmate-reveal', check);
  });

  const days = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const e of list) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [list]);

  const sum = summarize(list, L.money.expenses);
  const travelTrips = L.trips;

  if (f.seg === 'exchanges') return <ExchangesView seg={f.seg} onSeg={seg => set({ seg })} onAdd={() => openExchange()} onEdit={openExchange} />;

  return (
    <>
      <PageHeader title="記帳" />
      <main className="page">
        <Seg label="切換支出或換匯" value={f.seg} options={SEGMENTS} onChange={seg => set({ seg })} />

        {f.missing ? (
          <button type="button" className="banner" onClick={() => set({ missing: null })}>
            <IconAlert />
            <span>{f.missing === 'pending' ? `只顯示刷卡待補的 ${counts.pending} 筆` : `只顯示現金無匯率的 ${counts.noRate} 筆`}</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>顯示全部 ›</span>
          </button>
        ) : (
          <>
            <div className="scroller" role="group" aria-label="期間">
              {PERIODS.map(([k, n]) => (
                <button key={k} type="button" className="fchip" aria-pressed={f.period === k && !(f.mode === 'travel' && f.tripId !== 'all')} onClick={() => set({ period: k, tripId: 'all' })}>{n}</button>
              ))}
              <span className="divider" />
              <button type="button" className="fchip" aria-pressed={f.mode === 'all'} onClick={() => set({ mode: 'all', tripId: 'all', categoryId: 'all' })}>全部模式</button>
              {MODES.map(m => (
                <button key={m} type="button" className={`fchip${m === 'travel' ? ' travel' : ''}`} aria-pressed={f.mode === m} onClick={() => set({ mode: m, tripId: 'all', categoryId: 'all' })}>{MODE_SHORT[m]}</button>
              ))}
            </div>

            {f.mode === 'travel' && travelTrips.length > 0 && (
              <div className="scroller" role="group" aria-label="旅程" style={{ marginTop: -12 }}>
                <button type="button" className="fchip travel" aria-pressed={f.tripId === 'all'} onClick={() => set({ tripId: 'all' })}>所有旅程</button>
                {travelTrips.map(t => (
                  <button key={t.id} type="button" className="fchip travel" aria-pressed={f.tripId === t.id} onClick={() => set({ tripId: t.id })}>{t.name}</button>
                ))}
              </div>
            )}

            {f.period === 'custom' && !(f.mode === 'travel' && f.tripId !== 'all') && (
              <div className="two" style={{ marginTop: -8 }}>
                <Field label="從" htmlFor="lf-from"><input id="lf-from" type="date" value={f.from} onChange={e => set({ from: e.target.value })} /></Field>
                <Field label="到" htmlFor="lf-to"><input id="lf-to" type="date" value={f.to} min={f.from} onChange={e => set({ to: e.target.value })} /></Field>
              </div>
            )}

            <div className="scroller" style={{ marginTop: -8 }}>
              <button type="button" className="fchip" onClick={() => setFilterOpen(true)}>更多篩選</button>
              {f.categoryId !== 'all' && (
                <button type="button" className="fchip" aria-pressed="true" onClick={() => set({ categoryId: 'all' })} aria-label="移除類別篩選">
                  {f.categoryId.startsWith('name:') ? f.categoryId.slice(5) : L.category(f.categoryId)?.name}<span className="x">✕</span>
                </button>
              )}
              {f.paymentId !== 'all' && (
                <button type="button" className="fchip" aria-pressed="true" onClick={() => set({ paymentId: 'all' })} aria-label="移除付款方式篩選">
                  {L.payment(f.paymentId)?.name}<span className="x">✕</span>
                </button>
              )}
            </div>

            {counts.pending > 0 && (
              <button type="button" className="banner" onClick={() => set({ missing: 'pending' })}>
                <IconAlert />
                <span>有 <b>{counts.pending} 筆</b>刷卡待補帳單金額</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>只看待補 ›</span>
              </button>
            )}
            {counts.noRate > 0 && (
              <button type="button" className="banner" onClick={() => set({ missing: 'no-rate' })}>
                <IconAlert />
                <span>有 <b>{counts.noRate} 筆</b>現金支出沒有換匯紀錄</span>
                <span className="muted small" style={{ marginLeft: 'auto' }}>查看 ›</span>
              </button>
            )}
          </>
        )}

        {list.length > 0 && (
          <div className="muted small num">
            共 {list.length} 筆 · 台幣 {formatTwd(sum.twd)}
            {sum.missingCount > 0 && `，另有 ${sum.missingCount} 筆未換算（${Object.entries(sum.missing).map(([c, a]) => `${formatAmount(a!, c as Currency)} ${c}`).join('、')}）`}
          </div>
        )}

        {days.length === 0 ? (
          <EmptyState icon={<IconWallet />} action={<button type="button" className="btn btn-primary" onClick={() => openExpense()}><IconPlus />新增第一筆支出</button>}>
            這段期間還沒有支出紀錄。
          </EmptyState>
        ) : (
          days.map(([date, items]) => {
            const t = summarize(items, L.money.expenses).twd;
            return (
              <section className="section" key={date}>
                <div className="day-h num"><span>{shortDate(date)} {weekday(date)}</span><span>{t ? formatTwd(t) : ''}</span></div>
                <div className="list">{items.map(e => <ExpenseRow key={e.id} e={e} onClick={() => openExpense(e.id)} />)}</div>
              </section>
            );
          })
        )}

        <div className="fab-spacer" />
        <button type="button" className="fab" onClick={() => openExpense()}><IconPlus />新增支出</button>
      </main>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} labelledBy="filter-title">
        <div className="sheet-h">
          <h2 id="filter-title">更多篩選</h2>
          <button type="button" onClick={() => setFilterOpen(false)}>完成</button>
        </div>
        <Field label="類別">
          <Options
            label="類別"
            value={f.categoryId}
            options={[
              { value: 'all', label: '全部' },
              ...L.categories.filter(c => f.mode === 'all' || c.mode === f.mode).map(c => ({ value: c.id, label: f.mode === 'all' ? `${MODE_SHORT[c.mode]}・${c.name}` : c.name }))
            ]}
            onChange={categoryId => set({ categoryId })}
          />
        </Field>
        <Field label="付款方式">
          <Options label="付款方式" value={f.paymentId} options={[{ value: 'all', label: '全部' }, ...L.payments.map(p => ({ value: p.id, label: p.name }))]} onChange={paymentId => set({ paymentId })} />
        </Field>
      </Sheet>
    </>
  );
}

function ExchangesView({ seg, onSeg, onAdd, onEdit }: { seg: Filters['seg']; onSeg: (s: Filters['seg']) => void; onAdd: () => void; onEdit: (id: string) => void }) {
  const L = useLedger();
  const stocks = CURRENCIES.filter(c => c !== 'TWD').map(c => [c, L.money.cash[c]] as const).filter(([, s]) => s && (Math.abs(s.stock) > 0.004 || s.avg !== null));
  const list = [...L.exchanges].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  return (
    <>
      <PageHeader title="記帳" />
      <main className="page">
        <Seg label="切換支出或換匯" value={seg} options={SEGMENTS} onChange={onSeg} />
        {list.length === 0 ? (
          <EmptyState icon={<IconExchange />} action={<button type="button" className="btn btn-primary" onClick={onAdd}><IconPlus />新增換匯</button>}>
            還沒有換匯紀錄，新增後即可換算現金支出的台幣金額。
          </EmptyState>
        ) : (
          <>
            <section className="section">
              <div className="sec-h"><h2>現金庫存</h2></div>
              <div className="stocks">
                {stocks.map(([c, s]) => (
                  <div key={c} className={`stock${s!.stock < 0 ? ' neg' : ''}`}>
                    <span className="cur">{c} 現金</span>
                    <span className="bal num">{formatAmount(s!.stock, c)}</span>
                    <span className="avg num">{s!.avg !== null ? `平均 1 ${c} = ${formatRate(s!.avg, c)} TWD` : '尚無成本'}</span>
                    {s!.stock < 0 && <span className="avg" style={{ color: 'var(--error)' }}>庫存不足，請補記換匯</span>}
                  </div>
                ))}
              </div>
              <p className="muted tiny" style={{ margin: 0 }}>用現金付外幣時，會用這裡的平均成本換算成台幣（移動平均）。</p>
            </section>
            <section className="section">
              <div className="sec-h"><h2>換匯紀錄</h2></div>
              <div className="list">{list.map(x => <ExchangeRow key={x.id} x={x} onClick={() => onEdit(x.id)} />)}</div>
            </section>
          </>
        )}
        <div className="fab-spacer" />
        <button type="button" className="fab" onClick={onAdd}><IconPlus />新增換匯</button>
      </main>
    </>
  );
}
