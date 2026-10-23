import { useEffect, useRef, useState } from 'react';
import { IconSearch } from './Icons';

/**
 * Search field that reports its text 150 ms after typing stops and never while an IME is composing
 * (requirements spec 6.5). With 注音 the final text arrives before compositionend, so the check happens
 * when the timer fires and compositionend searches right away.
 */
export function SearchBox({ value, onSearch, placeholder, label }: { value: string; onSearch: (q: string) => void; placeholder: string; label: string }) {
  const [input, setInput] = useState(value);
  const composing = useRef(false);
  const sent = useRef(value);
  const latest = useRef((q: string) => { sent.current = q; onSearch(q); });
  latest.current = (q: string) => { sent.current = q; onSearch(q); };

  // Follow changes made elsewhere, e.g. a "clear filters" button, but not our own reports.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setInput(value);
    }
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!composing.current && input !== sent.current) latest.current(input);
    }, 150);
    return () => clearTimeout(t);
  }, [input]);

  return (
    <div className="search">
      <IconSearch />
      <input
        type="search" placeholder={placeholder} aria-label={label} value={input} enterKeyHint="search"
        onChange={e => setInput(e.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={e => {
          composing.current = false;
          setInput(e.currentTarget.value);
          latest.current(e.currentTarget.value); // the value may not have changed
        }}
      />
      {input && <button type="button" className="clear" aria-label="清除搜尋" onClick={() => { setInput(''); latest.current(''); }}>✕</button>}
    </div>
  );
}
