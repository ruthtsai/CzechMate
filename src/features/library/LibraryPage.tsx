import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../db';
import { RESOURCE_TYPES, RESOURCE_TYPE_LABEL, STAGES, STAGE_LABEL, type ResourceType, type Stage } from '../../domain/constants';
import { searchResources, tagCounts, toTerms } from '../../domain/search';
import { IconPlus, IconSearch } from '../../components/Icons';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/ui';
import { ResourceCard } from './parts';
import { useResourceEditors } from './ResourceEditors';

interface LibFilters { q: string; stage: 'all' | Stage; type: 'all' | ResourceType; tag: string | null }
// Kept for the session so switching tabs keeps the search.
let remembered: LibFilters = { q: '', stage: 'all', type: 'all', tag: null };

export function LibraryPage() {
  const { openResource, editResource } = useResourceEditors();
  const resources = useLiveQuery(() => db.resources.toArray(), []);
  const [f, setF] = useState<LibFilters>(remembered);
  const [input, setInput] = useState(f.q);
  const composing = useRef(false);
  const set = (patch: Partial<LibFilters>) => setF(prev => (remembered = { ...prev, ...patch }));

  // Search 150 ms after typing stops; never while an IME is composing (requirements spec 6.5).
  useEffect(() => {
    if (composing.current) return;
    const t = setTimeout(() => set({ q: input }), 150);
    return () => clearTimeout(t);
  }, [input]);

  const tags = useMemo(() => tagCounts(resources ?? []), [resources]);
  const terms = toTerms(f.q);
  const results = useMemo(() => {
    const filtered = (resources ?? []).filter(r =>
      (f.stage === 'all' || r.stage === f.stage) && (f.type === 'all' || r.type === f.type) && (!f.tag || r.tags.includes(f.tag))
    );
    return searchResources(filtered, f.q);
  }, [resources, f]);

  const filtering = f.q.trim() || f.stage !== 'all' || f.type !== 'all' || f.tag;
  const clearAll = () => { setInput(''); set({ q: '', stage: 'all', type: 'all', tag: null }); };

  return (
    <>
      <PageHeader title="資源庫" />
      <main className="page">
        <div className="search">
          <IconSearch />
          <input
            type="search" placeholder="搜尋標題、內容、標籤或網址" aria-label="搜尋資源" value={input} enterKeyHint="search"
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={e => { composing.current = false; setInput(e.currentTarget.value); }}
          />
          {input && <button type="button" className="clear" aria-label="清除搜尋" onClick={() => { setInput(''); set({ q: '' }); }}>✕</button>}
        </div>

        <div className="scroller" role="group" aria-label="階段篩選">
          <button type="button" className="fchip" aria-pressed={f.stage === 'all'} onClick={() => set({ stage: 'all' })}>全部階段</button>
          {STAGES.map(s => (
            <button key={s} type="button" className={`fchip${s === 'travel' ? ' travel' : ''}`} aria-pressed={f.stage === s} onClick={() => set({ stage: f.stage === s ? 'all' : s })}>{STAGE_LABEL[s]}</button>
          ))}
          <span className="divider" />
          {RESOURCE_TYPES.map(t => (
            <button key={t} type="button" className="fchip" aria-pressed={f.type === t} onClick={() => set({ type: f.type === t ? 'all' : t })}>{RESOURCE_TYPE_LABEL[t]}</button>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="scroller" role="group" aria-label="標籤篩選" style={{ marginTop: -12 }}>
            {tags.map(([t, n]) => (
              <button key={t} type="button" className="fchip" aria-pressed={f.tag === t} onClick={() => set({ tag: f.tag === t ? null : t })}>
                #{t} <span className="muted tiny num">{n}</span>
              </button>
            ))}
          </div>
        )}

        {resources === undefined ? (
          <p className="muted small">載入中…</p>
        ) : resources.length === 0 ? (
          <EmptyState action={<button type="button" className="btn btn-primary" onClick={() => editResource()}><IconPlus />新增第一筆</button>}>
            還沒有儲存資源，新增第一筆，或從設定匯入整理好的 CSV。
          </EmptyState>
        ) : (
          <section className="section">
            <div className="group-h">{filtering ? '符合的資源' : '我的資源'} <span className="n num">{results.length} 筆</span></div>
            {results.length === 0 ? (
              <EmptyState action={<button type="button" className="btn btn-secondary" onClick={clearAll}>清除條件</button>}>
                找不到符合的資源，試試其他關鍵字或清除篩選條件。
              </EmptyState>
            ) : (
              results.map(r => <ResourceCard key={r.id} r={r} terms={terms} onClick={() => openResource(r.id)} />)
            )}
          </section>
        )}

        <div className="fab-spacer" />
        <button type="button" className="fab" onClick={() => editResource()}><IconPlus />新增資源</button>
      </main>
    </>
  );
}
