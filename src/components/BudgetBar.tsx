import type { BudgetStatus } from '../domain/budget';
import { formatTwd } from '../domain/format';

/** Spent-versus-budget bar with what is left (U-03). */
export function BudgetBar({ label, status }: { label: string; status: BudgetStatus }) {
  const pct = Math.min(100, Math.round(status.ratio * 100));
  return (
    <div className={`budget${status.over ? ' over' : status.ratio >= 0.8 ? ' near' : ''}`}>
      <div className="budget-h small">
        <span>{label}</span>
        <span className="num">{status.over ? `超支 ${formatTwd(-status.left)}` : `剩 ${formatTwd(status.left)}`}</span>
      </div>
      <div className="budget-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="muted tiny num">已用 {formatTwd(status.spent)} / {formatTwd(status.budget)}</div>
    </div>
  );
}
