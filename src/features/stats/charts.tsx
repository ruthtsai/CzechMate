import type { CategorySlice } from '../../domain/stats';
import { formatTwd } from '../../domain/format';
import { catColor } from '../ledger/rows';

/** Category ring: segment lengths are proportional to TWD; the legend carries names and amounts. */
export function Donut({ slices }: { slices: CategorySlice[] }) {
  const total = slices.reduce((s, x) => s + x.twd, 0);
  const r = 52;
  const C = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 1.5 : 0;
  let offset = 0;
  return (
    <svg className="donut" viewBox="0 0 140 140" role="img" aria-label={`類別分布，總額 ${formatTwd(total)}`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-subtle)" strokeWidth="18" />
      {total > 0 &&
        slices.map(s => {
          const len = (s.twd / total) * C;
          const el = (
            <circle
              key={s.name} cx="70" cy="70" r={r} fill="none" stroke={catColor(s.color)} strokeWidth="18"
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="70" y="64" textAnchor="middle" className="lbl">NT$</text>
      <text x="70" y="84" textAnchor="middle" className="val num">{Math.round(total).toLocaleString('en-US')}</text>
    </svg>
  );
}

export function CategoryList({ slices, onPick }: { slices: CategorySlice[]; onPick?: (s: CategorySlice) => void }) {
  const total = slices.reduce((s, x) => s + x.twd, 0) || 1;
  return (
    <div className="catlist">
      {slices.map(s => {
        const inner = (
          <>
            <i className="dot" style={{ background: catColor(s.color) }} />
            <span className="n">{s.name}</span>
            <span className="v">{formatTwd(s.twd)}</span>
            <span className="pct">{Math.round((s.twd / total) * 100)}%</span>
          </>
        );
        return onPick ? (
          <button type="button" key={s.name} onClick={() => onPick(s)} aria-label={`查看 ${s.name} 的支出`}>{inner}</button>
        ) : (
          <div key={s.name}>{inner}</div>
        );
      })}
    </div>
  );
}
