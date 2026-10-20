import type { Exchange, Expense } from '../../db/schema';
import { MODE_SHORT } from '../../domain/constants';
import { slashDate } from '../../domain/dates';
import { formatAmount, formatRate, formatTwd } from '../../domain/format';
import { useLedger } from './LedgerData';

export const catColor = (n: number | undefined) => `var(--cat${n ?? 10})`;
/** Readable text colour on a category colour (tokens.css). */
export const catInk = (n: number | undefined) => `var(--cat${n ?? 10}-ink)`;

export function ExpenseRow({ e, onClick }: { e: Expense; onClick: () => void }) {
  const L = useLedger();
  const cat = L.category(e.categoryId);
  const calc = L.money.expenses.get(e.id);
  const trip = e.tripId ? L.trip(e.tripId) : undefined;
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="caticon" style={{ background: catColor(cat?.color), color: catInk(cat?.color) }} aria-hidden="true">{cat?.name.slice(0, 1) ?? '?'}</span>
      <span className="main">
        <span className="t">{e.itemName || cat?.name || '支出'}</span>
        <span className="m">
          <span className={`chip${e.mode === 'travel' ? ' travel' : e.mode === 'prep' ? ' green' : ''}`}>{MODE_SHORT[e.mode]}</span>
          <span>{cat?.name}</span>
          <span>· {L.payment(e.paymentId)?.name}</span>
          {trip && <span className="chip travel">{trip.name}</span>}
        </span>
      </span>
      <span className="amt num">
        <b>{formatAmount(e.amount, e.currency)} <small>{e.currency}</small></b>
        {e.currency !== 'TWD' &&
          (calc?.twd != null ? (
            <span>≈ {formatTwd(calc.twd)}</span>
          ) : (
            <span className="warn">{calc?.source === 'no-rate' ? '無匯率' : '待補'}</span>
          ))}
      </span>
    </button>
  );
}

export function ExchangeRow({ x, onClick }: { x: Exchange; onClick: () => void }) {
  const L = useLedger();
  const calc = L.money.exchanges.get(x.id);
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="caticon" style={{ background: 'var(--cat2)', color: 'var(--cat2-ink)' }} aria-hidden="true">⇄</span>
      <span className="main">
        <span className="t num">
          {formatAmount(x.outAmount, x.outCurrency)} {x.outCurrency} → {formatAmount(x.inAmount, x.inCurrency)} {x.inCurrency}
        </span>
        <span className="m">
          <span>{slashDate(x.date)}</span>
          {x.place && <span>{x.place}</span>}
          {x.method === 'atm' ? (
            <span className={`chip${x.estimated ? ' warn' : ''}`}>卡片提領 · {L.payment(x.cardId ?? '')?.name}{x.estimated ? ' · 預估' : ''}</span>
          ) : (
            <span className="chip">現金換匯</span>
          )}
        </span>
      </span>
      <span className="amt num">
        {calc?.gain !== undefined ? (
          <>
            <span>匯差</span>
            <b>{calc.gain >= 0 ? '+' : '−'}{Math.abs(calc.gain).toLocaleString('en-US')}</b>
            <span>TWD</span>
          </>
        ) : calc?.rate != null ? (
          <>
            <span>1 {x.inCurrency} =</span>
            <b>{formatRate(calc.rate, x.inCurrency)}</b>
            <span>TWD</span>
          </>
        ) : (
          <span className="warn">缺少 {x.outCurrency} 成本</span>
        )}
      </span>
    </button>
  );
}
