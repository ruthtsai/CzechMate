import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { db } from '../../db';
import { deleteTag, importDrafts, renameTag, reorderPins, setPinned, updatePin } from '../../db/resources';
import { tagCounts } from '../../domain/search';
import { parseResourceCsv, type ImportPreview } from '../../io/csvImport';
import { compressImage, type Compressed } from '../../io/images';
import { getSheetsConfig, queueForSheet } from '../../db/sheetsSync';
import { requestSheetsSync } from '../sync/SyncManager';
import { Field } from '../../components/form';
import { Seg, useToast } from '../../components/ui';

// Settings sub-screens for the library: pinned-link order, tags, CSV import (requirements RES-04, RES-05, RES-07).

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="sheet-h">
      <button type="button" className="backbtn" onClick={onBack}>‹ 設定</button>
      <h2 id="settings-title" style={{ textAlign: 'center' }}>{title}</h2>
      <span style={{ width: 60 }} />
    </div>
  );
}

export function ManagePins({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const pins = useLiveQuery(async () => (await db.resources.filter(r => r.pinned).toArray()).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)), [], []);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const move = (i: number, dir: -1 | 1) => {
    const ids = pins.map(p => p.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorderPins(ids);
  };
  return (
    <>
      <Header title="常用連結" onBack={onBack} />
      {pins.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>還沒有釘選的連結。在資源詳情勾選「釘選到首頁」即可加入。</p>
      ) : (
        <div className="list">
          {pins.map((p, i) =>
            editing?.id === p.id ? (
              <div className="editrow" key={p.id}>
                <input
                  className="name" aria-label="顯示名稱" value={editing.label} autoFocus placeholder={p.title.slice(0, 6)}
                  style={{ minHeight: 40, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 16 }}
                  onChange={e => setEditing({ ...editing, label: e.target.value })}
                />
                <button type="button" className="mini" onClick={() => setEditing(null)}>取消</button>
                <button type="button" className="mini" onClick={async () => { await updatePin(p.id, { pinLabel: editing.label }); setEditing(null); }}>儲存</button>
              </div>
            ) : (
              p.source === 'sheet' ? (
                <div className="editrow" key={p.id}>
                  <span className="name"><span>{p.pinLabel || p.title.slice(0, 6)}</span><small>{p.title} · 在試算表調整</small></span>
                </div>
              ) : (
              <div className="editrow" key={p.id}>
                <span className="name"><span>{p.pinLabel || p.title.slice(0, 6)}</span><small>{p.title}</small></span>
                <button type="button" className="mini" aria-label={`上移 ${p.title}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="mini" aria-label={`下移 ${p.title}`} disabled={i === pins.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="mini" onClick={() => setEditing({ id: p.id, label: p.pinLabel ?? '' })}>名稱</button>
                <button type="button" className="mini" aria-label={`取消釘選 ${p.title}`} onClick={async () => { await setPinned(p, false); toast('已取消釘選。'); }}>✕</button>
              </div>
              )
            )
          )}
        </div>
      )}
      {pins.some(p => p.source === 'sheet') && (
        <p className="muted tiny" style={{ margin: 0 }}>來自試算表的連結：在「釘選」欄填數字（1、2、3…）決定順序，在「常用連結名稱」欄設定顯示名稱。</p>
      )}
      <p className="muted tiny" style={{ margin: 0 }}>首頁每列顯示 4 個，名稱太長會被截斷，可以設定較短的顯示名稱。</p>
    </>
  );
}

export function ManageTags({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const tags = useLiveQuery(async () => tagCounts(await db.resources.toArray()), [], []);
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function rename() {
    if (!editing) return;
    const merging = editing.to.trim() !== editing.from && tags.some(([t]) => t === editing.to.trim());
    try {
      const skipped = await renameTag(editing.from, editing.to);
      toast((merging ? `已合併到「${editing.to.trim()}」。` : '已改名。') + (skipped ? `來自試算表的 ${skipped} 筆請在試算表修改。` : ''));
      setEditing(null);
    } catch (e) {
      toast((e as Error).message, { ok: false });
    }
  }

  return (
    <>
      <Header title="標籤" onBack={onBack} />
      {tags.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>還沒有任何標籤。</p>
      ) : (
        <div className="list">
          {tags.map(([t, n]) =>
            editing?.from === t ? (
              <div className="editrow" key={t}>
                <input
                  className="name" aria-label="新名稱" value={editing.to} autoFocus
                  style={{ minHeight: 40, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 16 }}
                  onChange={e => setEditing({ ...editing, to: e.target.value })}
                />
                <button type="button" className="mini" onClick={() => setEditing(null)}>取消</button>
                <button type="button" className="mini" onClick={rename}>儲存</button>
              </div>
            ) : confirmDelete === t ? (
              <div className="editrow" key={t}>
                <span className="name"><span>從 {n} 筆資源移除「{t}」？</span></span>
                <button type="button" className="mini" onClick={() => setConfirmDelete(null)}>取消</button>
                <button type="button" className="mini" style={{ color: 'var(--error)' }} onClick={async () => { const skipped = await deleteTag(t); setConfirmDelete(null); toast(skipped ? `已刪除；來自試算表的 ${skipped} 筆請在試算表修改。` : '已刪除標籤。'); }}>刪除</button>
              </div>
            ) : (
              <div className="editrow" key={t}>
                <span className="name"><span>#{t}</span><small>{n} 筆資源</small></span>
                <button type="button" className="mini" onClick={() => setEditing({ from: t, to: t })}>改名</button>
                <button type="button" className="mini" aria-label={`刪除標籤 ${t}`} onClick={() => setConfirmDelete(t)}>✕</button>
              </div>
            )
          )}
        </div>
      )}
      <p className="muted tiny" style={{ margin: 0 }}>改成已經存在的標籤名稱，會把兩個標籤合併。刪除標籤不會刪除資源。</p>
    </>
  );
}

const DUP_OPTIONS = [['skip', '略過可能重複的'], ['keep', '仍然匯入']] as const;

export function ImportResources({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [dup, setDup] = useState<'skip' | 'keep'>('skip');
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const all = [...files];
    const csv = all.find(f => /\.csv$/i.test(f.name) || f.type === 'text/csv');
    const imgs = all.filter(f => f !== csv && f.type.startsWith('image/'));
    if (fileInput.current) fileInput.current.value = '';
    if (!csv) return toast('請一併選取 CSV 檔。', { ok: false });
    const existing = await db.resources.toArray();
    setImages(imgs);
    setPreview(parseResourceCsv(await csv.text(), existing, imgs.map(f => f.name)));
  }

  async function run() {
    if (!preview) return;
    const drafts = preview.drafts.filter(d => dup === 'keep' || !d.duplicateOf);
    if (!drafts.length) return toast('沒有可以匯入的資料。', { ok: false });
    const needed = new Set(drafts.flatMap(d => d.imageNames));
    const compressed = new Map<string, Compressed>();
    try {
      let i = 0;
      for (const f of images.filter(f => needed.has(f.name))) {
        setBusy(`處理圖片 ${++i} / ${needed.size}…`);
        compressed.set(f.name, await compressImage(f));
      }
      setBusy('寫入資料…');
      const ids = await importDrafts(drafts, compressed);
      // With a linked sheet, imported resources go to the sheet like anything added in the app.
      if (await getSheetsConfig()) {
        await queueForSheet(ids);
        requestSheetsSync();
        toast(`已匯入 ${ids.length} 筆資源，正在寫入試算表。`);
      } else toast(`已匯入 ${ids.length} 筆資源。`);
      setPreview(null);
      onBack();
    } catch {
      toast('匯入失敗，沒有任何資料被寫入。請檢查檔案後再試。', { ok: false });
    } finally {
      setBusy(null);
    }
  }

  const dups = preview?.drafts.filter(d => d.duplicateOf).length ?? 0;
  const willImport = preview ? preview.drafts.length - (dup === 'skip' ? dups : 0) : 0;
  const warned = preview?.drafts.filter(d => d.warnings.length) ?? [];

  return (
    <>
      <Header title="匯入資源 CSV" onBack={onBack} />
      {!preview ? (
        <>
          <div className="hint">
            選取整理好的 CSV 檔；若 CSV 有填「圖片檔名」，請在同一次選取中一併選好那些圖片（可多選）。
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => fileInput.current?.click()}>選擇檔案</button>
          <input ref={fileInput} type="file" accept=".csv,text/csv,image/*" multiple hidden onChange={e => pick(e.target.files)} />
          <p className="muted tiny" style={{ margin: 0 }}>欄位：標題、類型、階段、網址、內容、標籤、圖片檔名、釘選。範本可在設定的「資料」下載。</p>
        </>
      ) : (
        <>
          <div className="card small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>將匯入 <b className="num">{willImport}</b> 筆</span>
            <span className="muted">可能重複 {dups} 筆 · 錯誤 {preview.errors.length} 筆 · 圖片 {images.length} 張</span>
          </div>
          {dups > 0 && (
            <Field label="可能重複的資料（網址或標題相同）">
              <Seg label="重複處理" value={dup} options={DUP_OPTIONS} onChange={setDup} />
            </Field>
          )}
          {preview.errors.length > 0 && (
            <div className="hint warn">
              <b>這些列不會匯入：</b>
              {preview.errors.slice(0, 20).map((e, i) => <div key={i}>第 {e.line} 列：{e.message}</div>)}
              {preview.errors.length > 20 && <div>…另有 {preview.errors.length - 20} 筆</div>}
            </div>
          )}
          {warned.length > 0 && (
            <div className="hint">
              <b>提醒（仍會匯入）：</b>
              {warned.slice(0, 10).map(d => <div key={d.line}>第 {d.line} 列：{d.warnings.join(' ')}</div>)}
              {warned.length > 10 && <div>…另有 {warned.length - 10} 筆</div>}
            </div>
          )}
          {preview.unknownColumns.length > 0 && <div className="hint">略過不認得的欄位：{preview.unknownColumns.join('、')}</div>}
          {preview.drafts.length > 0 && (
            <div className="list">
              {preview.drafts.slice(0, 8).map(d => (
                <div className="row" key={d.line}>
                  <span className="main">
                    <span className="t">{d.title}</span>
                    <span className="m">第 {d.line} 列{d.duplicateOf ? ' · 可能重複' : ''}{d.tags.length ? ` · #${d.tags.join(' #')}` : ''}</span>
                  </span>
                </div>
              ))}
              {preview.drafts.length > 8 && <div className="row muted small">…共 {preview.drafts.length} 筆</div>}
            </div>
          )}
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPreview(null)} disabled={!!busy}>重新選擇</button>
            <button type="button" className="btn btn-primary" onClick={run} disabled={!!busy || willImport === 0}>{busy ?? `匯入 ${willImport} 筆`}</button>
          </div>
        </>
      )}
    </>
  );
}
