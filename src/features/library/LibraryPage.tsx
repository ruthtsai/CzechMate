import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../../db';
import { RESOURCE_TYPES, RESOURCE_TYPE_LABEL, STAGES, STAGE_LABEL, type ResourceType, type Stage } from '../../domain/constants';
import { searchResources, searchSections, snippet, tagCounts, toTerms } from '../../domain/search';
import { stripMarkdown } from '../../domain/markdown';
import { slashDate } from '../../domain/dates';
import { canonicalNoteUrl, isHackmdNote } from '../../io/hackmd';
import { syncHandbooks } from '../../db/handbook';
import { getSetting } from '../../db';
import { IconBook, IconCheck, IconPlus } from '../../components/Icons';
import { SearchBox } from '../../components/SearchBox';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, useToast } from '../../components/ui';
import { Highlighted, ResourceCard } from './parts';
import { useResourceEditors } from './ResourceEditors';
import { useHandbookReader } from './HandbookReader';

interface LibFilters { q: string; stage: 'all' | Stage; type: 'all' | ResourceType; tag: string | null }
// Kept for the session so switching tabs keeps the search.
let remembered: LibFilters = { q: '', stage: 'all', type: 'all', tag: null };

export function LibraryPage() {
  const { openResource, editResource } = useResourceEditors();
  const toast = useToast();
  const resources = useLiveQuery(() => db.resources.toArray(), []);
  const sections = useLiveQuery(() => db.handbookSections.toArray(), [], []);
  const notes = useLiveQuery(async () => new Map((await db.noteCache.toArray()).map(n => [n.url, stripMarkdown(n.markdown)])), [], new Map<string, string>());
  const syncedAt = useLiveQuery(() => getSetting<string | undefined>('handbookSyncedAt', undefined), []);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [f, setF] = useState<LibFilters>(remembered);
  const set = (patch: Partial<LibFilters>) => setF(prev => (remembered = { ...prev, ...patch }));

  const tags = useMemo(() => tagCounts(resources ?? []), [resources]);
  const terms = toTerms(f.q);
  const results = useMemo(() => {
    const filtered = (resources ?? []).filter(r =>
      (f.stage === 'all' || r.stage === f.stage) && (f.type === 'all' || r.type === f.type) && (!f.tag || r.tags.includes(f.tag))
    );
    return searchResources(filtered, f.q, r => (isHackmdNote(r.url) ? notes.get(canonicalNoteUrl(r.url)!) ?? '' : ''));
  }, [resources, f, notes]);
  const pageCount = useMemo(() => new Set(sections.map(x => x.pageUrl)).size, [sections]);
  const openReader = useHandbookReader();
  const handbookHits = useMemo(() => searchSections(sections, f.q).slice(0, 30), [sections, f.q]);

  async function syncNow() {
    setSyncing('準備中…');
    try {
      const r = await syncHandbooks(setSyncing);
      toast(r.failed.length ? `已同步 ${r.pages - r.failed.length} 篇，有 ${r.failed.length} 篇失敗，請稍後再試。` : `已同步 ${r.pages} 篇。`, { ok: !r.failed.length });
    } catch {
      toast('無法連線到 HackMD，請確認網路後再試。', { ok: false });
    } finally {
      setSyncing(null);
    }
  }

  const filtering = f.q.trim() || f.stage !== 'all' || f.type !== 'all' || f.tag;
  const clearAll = () => set({ q: '', stage: 'all', type: 'all', tag: null });

  return (
    <>
      <PageHeader title="資源庫" />
      <main className="page">
        <SearchBox value={f.q} onSearch={q => set({ q })} placeholder="搜尋標題、內容、標籤或網址" label="搜尋資源" />

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

        <div className="sync">
          {syncing ? (
            <span>生存手冊同步中：{syncing}</span>
          ) : syncedAt ? (
            <>
              <IconCheck />
              <span>生存手冊已同步 · {slashDate(syncedAt.slice(0, 10))}</span>
              <button type="button" onClick={syncNow}>重新同步</button>
            </>
          ) : (
            <>
              <span>尚未同步生存手冊，同步後就能離線搜尋。</span>
              <button type="button" onClick={syncNow}>立即同步</button>
            </>
          )}
        </div>

        {!terms.length && sections.length > 0 && (
          <button type="button" className="res" onClick={() => openReader()}>
            <span className="ticon book"><IconBook /></span>
            <span className="body">
              <span className="t">捷克交換學生生存手冊</span>
              <span className="p">{pageCount} 篇，可離線閱讀。搜尋時也會一起找手冊的內容。</span>
            </span>
            <span className="end muted" style={{ alignSelf: 'center' }}>›</span>
          </button>
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

        {terms.length > 0 && (
          <section className="section">
            <div className="group-h"><IconBook width={16} height={16} /> 生存手冊 <span className="n num">{handbookHits.length} 段</span></div>
            {handbookHits.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>{sections.length ? '手冊裡沒有相符的段落。' : '同步生存手冊後，這裡會一起顯示手冊的搜尋結果。'}</p>
            ) : (
              handbookHits.map(h => (
                <button type="button" key={h.id} className="res" onClick={() => openReader({ pageUrl: h.pageUrl, heading: h.heading })}>
                  <span className="ticon book"><IconBook /></span>
                  <span className="body">
                    <span className="t" style={{ fontSize: 15 }}><span><Highlighted text={`${h.pageTitle} › ${h.heading}`} terms={terms} /></span></span>
                    <span className="p"><Highlighted text={snippet(h.text, terms)} terms={terms} /></span>
                  </span>
                </button>
              ))
            )}
          </section>
        )}

        <div className="fab-spacer" />
        <button type="button" className="fab" onClick={() => editResource()}><IconPlus />新增資源</button>
      </main>
    </>
  );
}
