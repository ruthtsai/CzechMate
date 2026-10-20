import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { db } from '../../db';
import { setPinned } from '../../db/resources';
import { RESOURCE_TYPE_LABEL } from '../../domain/constants';
import { slashDate } from '../../domain/dates';
import { Sheet, useToast } from '../../components/ui';
import { ImageViewer, Linkified, StoredImage, TYPE_ICON, stageChip } from './parts';
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
  const closeViewer = useCallback(() => setViewing(null), []);
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
          {r && <button type="button" className="save" onClick={() => onEdit(r.id)}>編輯</button>}
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
            {r.content && <div className="content"><Linkified text={r.content} /></div>}
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
            <label className="check card">
              <input type="checkbox" checked={r.pinned} onChange={togglePin} disabled={!r.url} />
              {r.url ? '釘選到首頁的常用連結' : '加上網址後才能釘選到首頁'}
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
