import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { db } from '../../db';
import { fetchNote } from '../../db/handbook';
import { renderMarkdown } from '../../domain/markdown';
import { slashDate } from '../../domain/dates';
import { canonicalNoteUrl } from '../../io/hackmd';
import { IconBook } from '../../components/Icons';
import { Sheet, useToast } from '../../components/ui';

// Reads the synced survival handbook inside the app, offline (requirements HB-01).

interface Target { pageUrl?: string; heading?: string }
const Ctx = createContext<(t?: Target) => void>(() => {});
export const useHandbookReader = () => useContext(Ctx);

interface Page { url: string; title: string; order: number }

function usePages(): Page[] {
  return useLiveQuery(async () => {
    const pages = new Map<string, Page>();
    await db.handbookSections.each(s => {
      const p = pages.get(s.pageUrl);
      if (!p || s.order < p.order) pages.set(s.pageUrl, { url: s.pageUrl, title: s.pageTitle, order: s.order });
    });
    return [...pages.values()].sort((a, b) => a.order - b.order);
  }, [], []);
}

function PageView({ page, heading, onBack, onOpen }: { page: Page; heading?: string; onBack: () => void; onOpen: (url: string) => boolean }) {
  const toast = useToast();
  const note = useLiveQuery(() => db.noteCache.get(page.url), [page.url]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const html = useMemo(() => (note ? renderMarkdown(note.markdown, 'https://hackmd.io') : ''), [note]);

  // Pages synced before full pages were kept are fetched on demand.
  useEffect(() => {
    if (note !== undefined || loading || !navigator.onLine) return;
    db.noteCache.get(page.url).then(c => {
      if (c) return;
      setLoading(true);
      fetchNote(page.url).catch(() => toast('無法下載這一篇，請確認網路後再試。', { ok: false })).finally(() => setLoading(false));
    });
  }, [note, page.url]);

  // Jump to the section a search result pointed at.
  useEffect(() => {
    if (!html || !heading || !box.current) return;
    const want = heading.trim();
    const all = [...box.current.querySelectorAll('h1, h2, h3, h4')];
    // Exact first; books synced by older versions dropped a leading "2." from headings.
    const h = all.find(el => el.textContent?.trim() === want) ?? all.find(el => el.textContent?.trim().endsWith(want));
    h?.scrollIntoView({ block: 'start' });
  }, [html, heading]);

  // Links to other pages of the handbook open here instead of leaving the app.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a && onOpen(a.href)) e.preventDefault();
  };

  return (
    <>
      <div className="sheet-h">
        <button type="button" className="backbtn" onClick={onBack}>‹ 目錄</button>
        <span style={{ flex: 1 }} />
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="linkbtn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>在 HackMD 開啟</a>
      </div>
      <h3 id="hb-title" style={{ margin: 0, fontSize: 20 }}>{page.title}</h3>
      {note ? (
        <>
          <div className="md" ref={box} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
          <span className="muted tiny">下載於 {slashDate(note.fetchedAt.slice(0, 10))}，離線也能看。</span>
        </>
      ) : (
        <p className="muted small">{loading ? '正在下載…' : '這一篇還沒有下載。請連上網路後，到資源庫按「重新同步」生存手冊。'}</p>
      )}
    </>
  );
}

function HandbookSheet({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const pages = usePages();
  const source = useLiveQuery(() => db.handbookSources.toCollection().first(), []);
  const [page, setPage] = useState<Page | null>(null);
  const [heading, setHeading] = useState<string | undefined>();

  useEffect(() => {
    if (!target) return;
    const p = target.pageUrl ? pages.find(x => x.url === target.pageUrl) : undefined;
    setPage(p ?? null);
    setHeading(target.heading);
  }, [target, pages]);

  const openByUrl = (href: string) => {
    const url = canonicalNoteUrl(href);
    const p = url ? pages.find(x => x.url === url) : undefined;
    if (!p) return false;
    setPage(p);
    setHeading(undefined);
    return true;
  };

  return (
    <Sheet open={!!target} onClose={onClose} labelledBy={page ? 'hb-title' : 'hb-toc-title'}>
      {page ? (
        <PageView key={page.url} page={page} heading={heading} onBack={() => setPage(null)} onOpen={openByUrl} />
      ) : (
        <>
          <div className="sheet-h">
            <h2 id="hb-toc-title">{source?.title ?? '生存手冊'}</h2>
            <button type="button" onClick={onClose}>關閉</button>
          </div>
          {pages.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>還沒有同步。請在資源庫按「立即同步」，同步後就能離線閱讀與搜尋。</p>
          ) : (
            <div className="list">
              {pages.map(p => (
                <button type="button" className="row" key={p.url} onClick={() => { setPage(p); setHeading(undefined); }}>
                  <IconBook width={18} height={18} />
                  <span className="main"><span className="t" style={{ whiteSpace: 'normal' }}>{p.title}</span></span>
                  <span className="end">›</span>
                </button>
              ))}
            </div>
          )}
          {source?.url && <p className="muted tiny" style={{ margin: 0 }}>內容來自 HackMD《{source.title}》，作者保有版權；App 只存一份在你的手機供離線閱讀。</p>}
        </>
      )}
    </Sheet>
  );
}

export function HandbookReaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = useCallback((t: Target = {}) => setTarget({ ...t }), []);
  const close = useCallback(() => setTarget(null), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <HandbookSheet target={target} onClose={close} />
    </Ctx.Provider>
  );
}
