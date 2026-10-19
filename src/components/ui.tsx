import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconAlert, IconCheck } from './Icons';

/* ---------- TopBar ---------- */
export function TopBar({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="topbar">
      <h1>
        {sub && <span className="sub">{sub}</span>}
        {title}
      </h1>
      {actions}
    </header>
  );
}

/* ---------- Segmented control ---------- */
export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <p>{children}</p>
      {action}
    </div>
  );
}

/* ---------- Bottom sheet ---------- */
export function Sheet({ open, onClose, labelledBy, className, children }: { open: boolean; onClose: () => void; labelledBy: string; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`panel${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={panel}>
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

/* ---------- Toast ---------- */
interface ToastMsg { id: number; text: string; ok: boolean; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: string, opts?: { ok?: boolean; action?: ToastMsg['action']; sticky?: boolean }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<number>();
  const show = useCallback((text: string, opts: { ok?: boolean; action?: ToastMsg['action']; sticky?: boolean } = {}) => {
    window.clearTimeout(timer.current);
    setMsg({ id: Date.now(), text, ok: opts.ok ?? true, action: opts.action });
    if (!opts.sticky) timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" key={msg.id}>
          {msg.ok ? <IconCheck /> : <IconAlert />}
          <span>{msg.text}</span>
          {msg.action && (
            <button type="button" onClick={() => { msg.action!.run(); setMsg(null); }}>
              {msg.action.label}
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
