import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db } from '../../db';
import { deleteResource, saveResource } from '../../db/resources';
import { getSheetsConfig, queueForSheet } from '../../db/sheetsSync';
import { requestSheetsSync } from '../sync/SyncManager';
import { RESOURCE_TYPES, RESOURCE_TYPE_LABEL, STAGES, STAGE_LABEL, type ResourceType, type Stage } from '../../domain/constants';
import { tagCounts } from '../../domain/search';
import { isHttpUrl } from '../../io/csvImport';
import { compressImage, MAX_IMAGES, type Compressed } from '../../io/images';
import { DeleteButton, Field, Options } from '../../components/form';
import { IconImage } from '../../components/Icons';
import { Sheet, useToast } from '../../components/ui';
import { StoredImage } from './parts';

interface Draft {
  title: string;
  type: ResourceType;
  stage: Stage;
  url: string;
  content: string;
  tags: string[];
  pinned: boolean;
  pinLabel: string;
  keepImageIds: string[];
  newImages: (Compressed & { key: string; preview: string })[];
}

const empty = (): Draft => ({ title: '', type: 'note', stage: 'any', url: '', content: '', tags: [], pinned: false, pinLabel: '', keepImageIds: [], newImages: [] });

function TagInput({ tags, onChange, suggestions }: { tags: string[]; onChange: (t: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText('');
  };
  const hints = text.trim() ? suggestions.filter(s => s.includes(text.trim()) && !tags.includes(s)).slice(0, 6) : [];
  return (
    <>
      <div className="tagbox">
        {tags.map(t => (
          <span className="chip" key={t}>
            #{t}
            <button type="button" aria-label={`移除標籤 ${t}`} onClick={() => onChange(tags.filter(x => x !== t))}>✕</button>
          </span>
        ))}
        <input
          id="res-tags" type="text" value={text} placeholder={tags.length ? '' : '輸入後按空白或 Enter'} enterKeyHint="done"
          onChange={e => {
            const v = e.target.value;
            if (/[\s,，;；]$/.test(v) && !(e.nativeEvent as InputEvent).isComposing) add(v.slice(0, -1));
            else setText(v);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add(text); }
            else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {hints.length > 0 && (
        <div className="opts">
          {hints.map(h => <button type="button" key={h} className="opt" onClick={() => add(h)}>#{h}</button>)}
        </div>
      )}
    </>
  );
}

export function ResourceForm({ open, editId, onClose, onSaved }: { open: boolean; editId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(empty);
  const [errors, setErrors] = useState<{ title?: string; url?: string; pinned?: string }>({});
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const allTags = useLiveQuery(async () => tagCounts(await db.resources.toArray()).map(([t]) => t), [], []);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (!editId) return setD(empty());
    db.resources.get(editId).then(r => {
      if (r) setD({ title: r.title, type: r.type, stage: r.stage, url: r.url, content: r.content, tags: r.tags, pinned: r.pinned, pinLabel: r.pinLabel ?? '', keepImageIds: r.imageIds, newImages: [] });
    });
  }, [open, editId]);

  // Preview URLs for picked images; released when the sheet closes.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    if (open) return;
    previews.current.forEach(u => URL.revokeObjectURL(u));
    previews.current.clear();
  }, [open]);

  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));
  const imageCount = d.keepImageIds.length + d.newImages.length;

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_IMAGES - imageCount;
    const picked = [...files].slice(0, room);
    if (files.length > room) toast(`每筆最多 ${MAX_IMAGES} 張圖片，只加入前 ${room} 張。`, { ok: false });
    setBusy(true);
    try {
      const done = await Promise.all(picked.map(async f => {
        const c = await compressImage(f);
        const preview = URL.createObjectURL(c.blob);
        previews.current.add(preview);
        return { ...c, key: crypto.randomUUID(), preview };
      }));
      setD(prev => ({ ...prev, newImages: [...prev.newImages, ...done] }));
    } catch {
      toast('有圖片無法讀取，請換一張試試。', { ok: false });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function save() {
    const e: typeof errors = {};
    if (!d.title.trim()) e.title = '請完成此欄位。';
    if (d.url.trim() && !isHttpUrl(d.url)) e.url = '網址需要以 http:// 或 https:// 開頭。';
    if (d.pinned && !d.url.trim()) e.pinned = '釘選需要網址。';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      // With a linked sheet, new resources go to the sheet (requirements RS-03); edits to pending ones are sent with them.
      const linked = !!(await getSheetsConfig());
      const id = await saveResource(
        { title: d.title.trim(), type: d.type, stage: d.stage, url: d.url.trim(), content: d.content, tags: d.tags, pinned: d.pinned, pinLabel: d.pinLabel },
        { id: editId, keepImageIds: d.keepImageIds, newImages: d.newImages, source: linked && !editId ? 'pending' : undefined }
      );
      if (linked && !editId) {
        await queueForSheet([id]);
        requestSheetsSync();
        toast(navigator.onLine ? '已儲存，正在寫入試算表。' : '已儲存，連上網路後會寫入試算表。');
      } else toast('已成功儲存。');
      onSaved?.(id);
      onClose();
    } catch {
      toast('暫時無法儲存，請稍後再試；你輸入的內容已保留。', { ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editId) return;
    await deleteResource(editId);
    toast('已刪除。');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="res-form-title">
      <div className="sheet-h">
        <button type="button" onClick={onClose}>取消</button>
        <h2 id="res-form-title" style={{ textAlign: 'center' }}>{editId ? '編輯資源' : '新增資源'}</h2>
        <button type="button" className="save" onClick={save} disabled={busy}>儲存</button>
      </div>

      <Field label="標題（必填）" htmlFor="res-title" error={errors.title}>
        <input id="res-title" type="text" value={d.title} placeholder="例如：移民局預約方式" autoFocus={!editId} onChange={e => set({ title: e.target.value })} />
      </Field>
      <Field label="類型">
        <Options label="類型" value={d.type} options={RESOURCE_TYPES.map(t => ({ value: t, label: RESOURCE_TYPE_LABEL[t] }))} onChange={type => set({ type })} />
      </Field>
      <Field label="階段">
        <Options label="階段" value={d.stage} options={STAGES.map(s => ({ value: s, label: STAGE_LABEL[s] }))} onChange={stage => set({ stage })} />
      </Field>
      <Field label="網址" htmlFor="res-url" error={errors.url}>
        <input id="res-url" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={d.url} placeholder="https://" onChange={e => set({ url: e.target.value })} />
      </Field>
      <Field label="內容" htmlFor="res-content">
        <textarea id="res-content" value={d.content} placeholder="摘要、心得，或貼上文章全文" style={{ minHeight: 140 }} onChange={e => set({ content: e.target.value })} />
      </Field>
      <Field label="標籤" htmlFor="res-tags">
        <TagInput tags={d.tags} onChange={tags => set({ tags })} suggestions={allTags} />
      </Field>

      <Field label={`圖片（${imageCount} / ${MAX_IMAGES}）`}>
        {imageCount > 0 && (
          <div className="thumbs">
            {d.keepImageIds.map(id => (
              <div className="item" key={id}>
                <StoredImage id={id} />
                <button type="button" className="rm" aria-label="移除圖片" onClick={() => set({ keepImageIds: d.keepImageIds.filter(x => x !== id) })}>✕</button>
              </div>
            ))}
            {d.newImages.map(im => (
              <div className="item" key={im.key}>
                <img src={im.preview} alt="" />
                <button type="button" className="rm" aria-label="移除圖片" onClick={() => set({ newImages: d.newImages.filter(x => x.key !== im.key) })}>✕</button>
              </div>
            ))}
          </div>
        )}
        {imageCount < MAX_IMAGES && (
          <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
            <IconImage />{busy ? '處理中…' : '從相簿加入'}
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} />
      </Field>

      <Field label="釘選到首頁" error={errors.pinned}>
        <label className="check">
          <input type="checkbox" checked={d.pinned} onChange={e => set({ pinned: e.target.checked })} />
          顯示在首頁的常用連結（需要網址）
        </label>
        {d.pinned && (
          <input id="res-pinlabel" type="text" aria-label="常用連結顯示名稱" value={d.pinLabel} placeholder={`顯示名稱（預設：${d.title.slice(0, 6) || '標題前 6 字'}）`} onChange={e => set({ pinLabel: e.target.value })} />
        )}
      </Field>

      <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={busy}>儲存</button>
      {editId && <DeleteButton label="刪除這筆資源" onDelete={remove} />}
    </Sheet>
  );
}
