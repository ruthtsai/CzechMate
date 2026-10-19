import { useState, type ReactNode } from 'react';
import { IconAlert } from './Icons';

export function FieldError({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="err" role="alert">
      <IconAlert />
      {text}
    </span>
  );
}

export function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="lab">{label}</span>}
      {children}
      <FieldError text={error} />
    </div>
  );
}

/** A row of toggle buttons used instead of a select, so each choice is one tap (UI spec 3.4). */
export function Options<T extends string>({ value, options, onChange, label, extra }: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  extra?: ReactNode;
}) {
  return (
    <div className="opts" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" className="opt" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      {extra}
    </div>
  );
}

/** Two-step delete built into the form, since the page cannot rely on window.confirm. */
export function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-danger btn-block" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm" role="alertdialog" aria-label="刪除確認">
      <span>確定要刪除這筆資料嗎？此操作無法直接復原。</span>
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>取消</button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>刪除</button>
      </div>
    </div>
  );
}
