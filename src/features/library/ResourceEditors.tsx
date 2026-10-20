import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, getSetting } from '../../db';
import { sheetRowLink } from '../../io/sheetsClient';
import { setPinned } from '../../db/resources';
import { RESOURCE_TYPE_LABEL } from '../../domain/constants';
import { slashDate } from '../../domain/dates';
import { Sheet, useToast } from '../../components/ui';
import { fetchNote } from '../../db/handbook';
import { canonicalNoteUrl, isHackmdNote } from '../../io/hackmd';
import { ImageViewer, Markdown, StoredImage, TYPE_ICON, stageChip } from './parts';
import { ResourceForm } from './ResourceForm';

// Opens the resource detail and form sheets from anywhere (library, home).

interface ResourceEditors {
  openResource: (id: string) => void;
  editResource: (id?: string) => void;
}

const Ctx = createContext<ResourceEditors>({ openResource: () => {}, editResource: () => {} });

function ResourceDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (id: string) => void }) {
  const toast = useToast();
  const r = useLiveQuery(() => (id ? db.resources.get(id) : undefined), [id]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const closeViewer = useCallback(() => setViewing(null), []);
  const noteKey = r && isHackmdNote(r.url) ? canonicalNoteUrl(r.url) : null;
  const sheetLink = useLiveQuery(async () => {
    if (r?.source !== 'sheet' || !r.sheetRow) return undefined;
    const [url, gid] = await Promise.all([getSetting<string>('gsSheetUrl', ''), getSetting<number>('gsResourcesGid', 0)]);
    return url ? sheetRowLink(url, gid, r.sheetRow) : undefined;
  }, [r?.source, r?.sheetRow]);
  const note = useLiveQuery(() => (noteKey ? db.noteCache.get(noteKey) : undefined), [noteKey]);

  // First time a HackMD note is opened, download it (requirements MD-02).
  useEffect(() => {
    if (noteKey && note === undefined && navigator.onLine) {
      db.noteCache.get(noteKey).then(c => { if (!c) loadNote(false); });
    }
  }, [noteKey]);

  async function loadNote(announce = true) {
    if (!noteKey) return;
    setNoteBusy(true);
    try {
      await fetchNote(noteKey);
      if (announce) toast('已更新筆記內容。');
    } catch {
      if (announce) toast('無法下載筆記，請確認網路，或筆記是否設為公開。', { ok: false });
    } finally {
      setNoteBusy(false);
    }
  }

  if (!id) return null;
  const Icon = r ? TYPE_ICON[r.type] : null;

  async function togglePin() {
    if (!r) return;
    try {
      await setPinned(r, !r.pinned);
      toast(r.pinned ? '已取消釘選。' : '已釘選到首頁。');
    } catch (e) {
      toast((e as Error).message, { ok: false });
    }
  }

  return (
    <>
      <Sheet open onClose={onClose} labelledBy="res-detail-title">
        <div className="sheet-h">
          <button type="button" onClick={onClose}>關閉</button>
          <span style={{ flex: 1 }} />
          {r && r.source === 'sheet' ? (
            sheetLink && <a className="save" href={sheetLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 600, padding: '12px 4px', textDecoration: 'none' }}>在試算表編輯</a>
          ) : (
            r && <button type="button" className="save" onClick={() => onEdit(r.id)}>編輯</button>
          )}
        </div>
        {r && Icon && (
          <div className="detail">
            <span className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon width={16} />{RESOURCE_TYPE_LABEL[r.type]} · 更新於 {slashDate(r.updatedAt.slice(0, 10))}
            </span>
            <h3 id="res-detail-title">{r.title}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {stageChip(r)}
              {r.tags.map(t => <span className="chip" key={t}>#{t}</span>)}
            </div>
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                開啟連結
              </a>
            )}
            {r.url && <span className="muted small" style={{ overflowWrap: 'anywhere' }}>{r.url}</span>}
            {r.content && <Markdown source={r.content} />}
            {noteKey && (
              <section className="section">
                <div className="sec-h">
                  <h2 style={{ fontSize: 16 }}>HackMD 筆記</h2>
                  <button type="button" className="linkbtn" onClick={() => loadNote()} disabled={noteBusy}>{noteBusy ? '下載中…' : note ? '重新下載' : '下載'}</button>
                </div>
                {note ? (
                  <>
                    <div className="card"><Markdown source={note.markdown} /></div>
                    <span className="muted tiny">下載於 {slashDate(note.fetchedAt.slice(0, 10))}，離線也能看。</span>
                  </>
                ) : (
                  <span className="muted small">{noteBusy ? '正在下載筆記…' : '還沒有下載這篇筆記。'}</span>
                )}
              </section>
            )}
            {r.imageIds.length > 0 && (
              <div className="thumbs">
                {r.imageIds.map(im => (
                  <div className="item" key={im}>
                    <StoredImage id={im} />
                    <button type="button" className="open" aria-label="放大圖片" onClick={() => setViewing(im)} />
                  </div>
                ))}
              </div>
            )}
            {r.source === 'sheet' && (
              <p className="muted tiny" style={{ margin: 0 }}>
                這筆資源來自試算表「資源」工作表第 {r.sheetRow} 列。要修改、刪除或調整釘選，請在試算表編輯，App 下次開啟時會自動更新。
              </p>
            )}
            {r.source === 'pending' && <p className="muted tiny" style={{ margin: 0 }}>等待寫入試算表（連上網路後自動送出）。</p>}
            <label className="check card">
              <input type="checkbox" checked={r.pinned} onChange={togglePin} disabled={!r.url || r.source === 'sheet'} />
              {r.source === 'sheet' ? (r.pinned ? '已釘選到首頁（在試算表的「釘選」欄調整）' : '要釘選，請在試算表的「釘選」欄填「是」') : r.url ? '釘選到首頁的常用連結' : '加上網址後才能釘選到首頁'}
            </label>
          </div>
        )}
      </Sheet>
      <ImageViewer id={viewing} onClose={closeViewer} />
    </>
  );
}

export function ResourceEditorsProvider({ children }: { children: ReactNode }) {
  const [detail, setDetail] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeForm = useCallback(() => setForm(null), []);
  const value = useMemo<ResourceEditors>(() => ({
    openResource: id => setDetail(id),
    editResource: id => { setDetail(null); setForm({ id }); }
  }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ResourceDetail id={detail} onClose={closeDetail} onEdit={id => { setDetail(null); setForm({ id }); }} />
      <ResourceForm open={!!form} editId={form?.id} onClose={closeForm} onSaved={id => form?.id && setDetail(id)} />
    </Ctx.Provider>
  );
}

export const useResourceEditors = () => useContext(Ctx);
