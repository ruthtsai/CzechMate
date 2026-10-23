import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, getSetting, setSetting } from '../../db';
import { MODE_SHORT, MODES, type Theme } from '../../domain/constants';
import { backupFileName, createBackup, parseBackup, restoreBackup, RestoreError, type BackupFile } from '../../io/backup';
import { fileSize, shareOrDownload } from '../../io/share';
import { applyTheme } from '../../theme';
import { IconShare } from '../../components/Icons';
import { Seg, Sheet, useToast } from '../../components/ui';
import type { SettingsScreen } from '../../components/PageHeader';
import { useLedger } from '../ledger/LedgerData';
import { ExportSheet } from '../data/ExportSheet';
import { ManageCategories, ManagePayments, ManageTrips } from './Manage';
import { ImportResources, ManagePins, ManageTags } from './ManageLibrary';
import { GoogleSheetsSettings } from './GoogleSheets';
import { syncHandbooks } from '../../db/handbook';

const THEME_OPTIONS = [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']] as const;
const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/resources_template.csv`;

const stamp = (iso?: string) => {
  if (!iso) return '還沒有';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsSheet({ open, initialScreen = 'main', onClose }: { open: boolean; initialScreen?: SettingsScreen; onClose: () => void }) {
  const toast = useToast();
  const theme = useLiveQuery(() => getSetting<Theme>('theme', 'system'), [], 'system');
  const { payments, categories, trips } = useLedger();
  const [screen, setScreen] = useState<SettingsScreen>(initialScreen);
  const [storage, setStorage] = useState<{ usage?: number; persisted?: boolean }>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [readyBackup, setReadyBackup] = useState<File | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetName = useLiveQuery(() => getSetting<string>('gsSheetName', ''), [], '');
  const hasSheetsSecret = useLiveQuery(async () => !!(await getSetting<string>('gsUrl', '')), [], false);
  const hbSyncedAt = useLiveQuery(() => getSetting<string | undefined>('handbookSyncedAt', undefined), []);
  const [hbBusy, setHbBusy] = useState<string | null>(null);

  async function syncHandbookNow() {
    setHbBusy('準備中…');
    try {
      const r = await syncHandbooks(setHbBusy);
      toast(r.failed.length ? `已同步，有 ${r.failed.length} 篇失敗，請稍後再試。` : `已同步 ${r.pages} 篇。`, { ok: !r.failed.length });
    } catch {
      toast('無法連線到 HackMD，請確認網路後再試。', { ok: false });
    } finally {
      setHbBusy(null);
    }
  }
  const lastExport = useLiveQuery(() => getSetting<string | undefined>('lastExportAt', undefined), []);
  const lastBackup = useLiveQuery(() => getSetting<string | undefined>('lastBackupAt', undefined), []);

  useEffect(() => {
    setScreen(open ? initialScreen : 'main');
  }, [open, initialScreen]);

  useEffect(() => {
    if (!open || !navigator.storage) return;
    Promise.all([
      navigator.storage.estimate?.(),
      navigator.storage.persisted ? navigator.storage.persisted().then(p => (p ? true : navigator.storage.persist?.() ?? false)) : undefined
    ]).then(([est, persisted]) => setStorage({ usage: est?.usage, persisted }));
  }, [open]);

  async function changeTheme(t: Theme) {
    applyTheme(t);
    await setSetting('theme', t);
  }

  async function downloadTemplate() {
    try {
      const res = await fetch(TEMPLATE_URL);
      if (!res.ok) throw new Error(String(res.status));
      const file = new File([await res.blob()], 'CzechMate_資源匯入範本.csv', { type: 'text/csv' });
      const r = await shareOrDownload(file);
      if (r !== 'cancelled') toast('已產生 CSV 範本。');
    } catch {
      toast('暫時無法取得範本，請確認網路後再試。', { ok: false });
    }
  }


  async function handOver(file: File) {
    const r = await shareOrDownload(file);
    if (r === 'needs-tap') {
      setReadyBackup(file);
      return;
    }
    setReadyBackup(null);
    if (r === 'cancelled') return toast('已取消，備份檔沒有儲存。', { ok: false });
    await setSetting('lastBackupAt', new Date().toISOString());
    toast('已產生備份檔，請存到「檔案」App 或 iCloud 雲碟。');
  }

  async function backup() {
    setBusy(true);
    try {
      const json = JSON.stringify(await createBackup(db, { includeSecrets }));
      await handOver(new File([json], backupFileName(), { type: 'application/json' }));
    } catch (e) {
      toast(`暫時無法備份：${(e as Error)?.message ?? '未知錯誤'}`, { ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function pickRestore(file: File | undefined) {
    if (!file) return;
    try {
      setPendingRestore(parseBackup(await file.text()));
      setScreen('restore');
    } catch (e) {
      toast(e instanceof RestoreError ? e.message : '無法讀取這個檔案。', { ok: false });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    setBusy(true);
    try {
      await restoreBackup(db, pendingRestore);
      applyTheme(await getSetting<Theme>('theme', 'system'));
      setPendingRestore(null);
      setScreen('main');
      toast('已還原備份。');
    } catch {
      toast('還原失敗，原本的資料沒有變動。', { ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (screen !== 'main') {
    const back = () => setScreen('main');
    return (
      <Sheet open={open} onClose={onClose} labelledBy="settings-title">
        {screen === 'payments' && <ManagePayments onBack={back} />}
        {screen === 'categories' && <ManageCategories onBack={back} />}
        {screen === 'trips' && <ManageTrips onBack={back} />}
        {screen === 'pins' && <ManagePins onBack={back} />}
        {screen === 'tags' && <ManageTags onBack={back} />}
        {screen === 'import' && <ImportResources onBack={back} />}
        {screen === 'sheets' && <GoogleSheetsSettings onBack={back} />}
        {screen === 'restore' && pendingRestore && (
          <>
            <div className="sheet-h">
              <button type="button" className="backbtn" onClick={() => { setPendingRestore(null); back(); }}>‹ 設定</button>
              <h2 id="settings-title" style={{ textAlign: 'center' }}>還原備份</h2>
              <span style={{ width: 60 }} />
            </div>
            <div className="card small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>備份時間：{stamp(pendingRestore.exportedAt)}</span>
              <span className="muted">
                支出 {pendingRestore.data.expenses?.length ?? 0} 筆 · 換匯 {pendingRestore.data.exchanges?.length ?? 0} 筆 · 旅程 {pendingRestore.data.trips?.length ?? 0} 個 ·
                資源 {pendingRestore.data.resources?.length ?? 0} 筆 · 圖片 {pendingRestore.data.images?.length ?? 0} 張
              </span>
            </div>
            <div className="confirm">
              <span>還原會取代目前所有資料，確定要繼續嗎？</span>
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setPendingRestore(null); back(); }}>取消</button>
                <button type="button" className="btn btn-danger" onClick={confirmRestore} disabled={busy}>{busy ? '還原中…' : '還原'}</button>
              </div>
            </div>
            <p className="muted tiny" style={{ margin: 0 }}>生存手冊的內容不在備份裡，還原後到設定重新同步即可。</p>
          </>
        )}
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} labelledBy="settings-title">
        <div className="sheet-h">
          <h2 id="settings-title">設定</h2>
          <button type="button" onClick={onClose}>完成</button>
        </div>

        <div className="setgroup">
          <h3>外觀</h3>
          <Seg label="主題" value={theme} options={THEME_OPTIONS} onChange={changeTheme} />
        </div>

        <div className="setgroup">
          <h3>記帳</h3>
          <div className="list">
            <button type="button" className="row" onClick={() => setScreen('payments')}>
              <span className="main">
                <span className="t">付款方式</span>
                <span className="m">{payments.filter(p => p.active).map(p => p.name).join('、')}</span>
              </span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={() => setScreen('categories')}>
              <span className="main">
                <span className="t">類別</span>
                <span className="m">{MODES.map(m => `${MODE_SHORT[m]} ${categories.filter(c => c.mode === m && c.active).length}`).join(' · ')}</span>
              </span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={() => setScreen('trips')}>
              <span className="main">
                <span className="t">旅程</span>
                <span className="m">{trips.length ? `${trips.length} 個旅程` : '還沒有旅程'}</span>
              </span>
              <span className="end">›</span>
            </button>
          </div>
        </div>

        <div className="setgroup">
          <h3>同步</h3>
          <div className="list">
            <button type="button" className="row" onClick={() => setScreen('sheets')}>
              <span className="main">
                <span className="t">Google 試算表</span>
                <span className="m">{sheetName ? `已連線到「${sheetName}」` : '記帳同步到試算表、從試算表讀取資源'}</span>
              </span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={syncHandbookNow} disabled={!!hbBusy}>
              <span className="main">
                <span className="t">同步生存手冊</span>
                <span className="m">{hbBusy ?? (hbSyncedAt ? `上次同步：${stamp(hbSyncedAt)}` : '還沒有同步；同步後可離線搜尋')}</span>
              </span>
              <span className="end">›</span>
            </button>
          </div>
        </div>

        <div className="setgroup">
          <h3>資源庫</h3>
          <div className="list">
            <button type="button" className="row" onClick={() => setScreen('pins')}>
              <span className="main"><span className="t">常用連結排序</span><span className="m">調整首頁連結順序與顯示名稱</span></span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={() => setScreen('tags')}>
              <span className="main"><span className="t">標籤管理</span><span className="m">改名、合併、刪除</span></span>
              <span className="end">›</span>
            </button>
          </div>
        </div>

        <div className="setgroup">
          <h3>資料</h3>
          <div className="list">
            <button type="button" className="row" onClick={downloadTemplate}>
              <span className="main">
                <span className="t">下載資源匯入範本（CSV）</span>
                <span className="m">先用 Excel 或 Google 試算表整理，存成 CSV UTF-8</span>
              </span>
              <IconShare width={20} height={20} className="end" />
            </button>
            <button type="button" className="row" onClick={() => setExportOpen(true)}>
              <span className="main">
                <span className="t">匯出 Excel</span>
                <span className="m">上次匯出：{stamp(lastExport)}</span>
              </span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={backup} disabled={busy}>
              <span className="main">
                <span className="t">完整備份</span>
                <span className="m">{busy ? '正在產生備份…' : `上次備份：${stamp(lastBackup)}`}</span>
              </span>
              <IconShare width={20} height={20} className="end" />
            </button>
            {readyBackup && (
              <button type="button" className="row" onClick={() => handOver(readyBackup)} style={{ background: 'var(--warning-surface)' }}>
                <span className="main">
                  <span className="t">備份檔已準備好（{fileSize(readyBackup)}），按這裡儲存</span>
                  <span className="m">iPhone 需要再按一次才能打開分享選單</span>
                </span>
                <IconShare width={20} height={20} className="end" />
              </button>
            )}
            <button type="button" className="row" onClick={() => fileInput.current?.click()}>
              <span className="main">
                <span className="t">還原備份</span>
                <span className="m">選擇之前備份的 JSON 檔</span>
              </span>
              <span className="end">›</span>
            </button>
            <button type="button" className="row" onClick={() => setScreen('import')}>
              <span className="main">
                <span className="t">匯入資源 CSV</span>
                <span className="m">可同時選取 CSV 與圖片</span>
              </span>
              <span className="end">›</span>
            </button>
          </div>
          {hasSheetsSecret && (
            <label className="check" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={includeSecrets} onChange={e => setIncludeSecrets(e.target.checked)} />
              備份檔包含 Google 試算表同步金鑰（換手機還原時勾選；預設排除以防外洩）
            </label>
          )}
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={e => pickRestore(e.target.files?.[0])} />
        </div>

        <div className="setgroup">
          <h3>關於</h3>
          <div className="card small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>CzechMate 捷適旅 {__APP_VERSION__}</span>
            {storage.usage !== undefined && <span className="muted">本機已使用 {formatBytes(storage.usage)}</span>}
            {storage.persisted !== undefined && (
              <span className="muted">{storage.persisted ? '已取得持久儲存權限' : '尚未取得持久儲存權限（加入主畫面後較不會被系統清除）'}</span>
            )}
            <span className="muted">資料只存在這支手機。移除主畫面上的 App 前，請先備份。</span>
          </div>
        </div>
      </Sheet>
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
