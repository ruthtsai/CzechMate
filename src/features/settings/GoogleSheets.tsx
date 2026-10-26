import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../../db';
import { ShortcutGuide } from './ShortcutGuide';
import { sheetsLink } from '../../db/sheetsLink';
import { useLedgerUnsent, useSheetsLinkStatus } from '../sync/useSheetsLinkStatus';
import { LedgerRestore } from './LedgerRestore';
import { buildAppsScript, DEFAULT_IMAGE_FOLDER, isScriptUrl, normalizeFolderPath, SheetsError } from '../../io/sheetsClient';
import { Field } from '../../components/form';
import { useToast } from '../../components/ui';

// Settings › Google 試算表 (requirements GS-01–06, RS-01–05).

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="sheet-h">
      <button type="button" className="backbtn" onClick={onBack}>‹ 設定</button>
      <h2 id="settings-title" style={{ textAlign: 'center' }}>Google 試算表</h2>
      <span style={{ width: 60 }} />
    </div>
  );
}

const stamp = (iso?: string) => {
  if (!iso) return '還沒有';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function GoogleSheetsSettings({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const s = useSheetsLinkStatus();
  const unsent = useLedgerUnsent();
  const appOnly = useLiveQuery(() => db.resources.filter(r => (r.source ?? 'app') === 'app').count(), [], 0);
  const queued = useLiveQuery(() => db.outbox.count(), [], 0);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [keyRotated, setKeyRotated] = useState(false);

  // Create the secret up front: iOS only allows clipboard writes directly inside the tap, with no await before it.
  // Unlinking drops the key, so a new one is made then too.
  const hasKey = !!s?.key;
  useEffect(() => {
    if (!hasKey) sheetsLink.ensureKey();
  }, [hasKey]);

  if (!s) return <Header onBack={onBack} />;

  const { linked, imageFolder } = s;
  const script = s.key ? buildAppsScript(s.key, imageFolder) : '';
  // The deployed script reports its folder on every test; a mismatch means it needs redeploying.
  const scriptOutdated = linked && s.scriptImageFolder !== undefined && s.scriptImageFolder !== imageFolder;
  const scriptTooOld = linked && s.scriptImageFolder === undefined;

  async function saveFolder() {
    await sheetsLink.setImageFolder(folder ?? imageFolder);
    setFolder(null);
    toast(linked ? '已更新資料夾。請重新複製腳本，貼到 Apps Script 後部署新版本。' : '已更新資料夾。');
  }

  async function testConnection() {
    setBusy('測試中…');
    try {
      const r = await sheetsLink.testConnection();
      setKeyRotated(false);
      toast(r.imageFolder === imageFolder ? `連線正常，圖片資料夾：${r.imageFolder}` : '連線正常，但腳本還是舊版，請重新複製腳本並部署新版本。', { ok: r.imageFolder === imageFolder });
    } catch (e) {
      toast(e instanceof SheetsError ? e.message : '連線失敗。', { ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function rotateKey(message: string) {
    await sheetsLink.rotateKey();
    setKeyRotated(true);
    toast(message);
  }

  async function copyScript() {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      toast('已複製腳本，請貼到 Apps Script。');
    } catch {
      setShowScript(true);
      toast('無法自動複製，請在下方全選後複製。', { ok: false });
    }
  }

  async function connect() {
    const u = (url ?? s!.url).trim();
    if (!isScriptUrl(u)) return toast('網址格式不對，請貼上「網頁應用程式」部署後、以 /exec 結尾的網址。', { ok: false });
    setBusy('連線中…');
    try {
      const r = await sheetsLink.connect(u, {
        onLinked: name => {
          setUrl(null);
          toast(`已連線到「${name}」。`);
          setBusy('第一次同步中…');
        }
      });
      // A new or wiped phone must not overwrite a ledger already in the sheet; the restore section takes over.
      if (r.restoreOffer) toast('試算表裡已有記帳資料，請在下方「記帳備份與還原」選擇要還原或覆蓋。', { ok: false });
    } catch (e) {
      toast(e instanceof SheetsError ? e.message : '連線失敗。', { ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function job(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast(await fn());
    } catch (e) {
      toast(e instanceof SheetsError ? e.message : '同步失敗。', { ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header onBack={onBack} />

      {linked ? (
        <div className="card small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>已連線到「{s.sheetName}」</span>
          <span className="muted">記帳上次同步：{stamp(s.lastSyncAt)}{unsent ? '（有尚未同步的變更）' : ''}</span>
          <span className="muted">資源上次更新：{stamp(s.lastPullAt)}{queued ? ` · ${queued} 筆新增等待送出` : ''}</span>
          {s.lastError && <span style={{ color: 'var(--warning)' }}>{s.lastError}</span>}
          <a href={s.sheetUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>開啟試算表</a>
        </div>
      ) : (
        <div className="hint">
          把記帳同步到你的試算表，並從試算表的「資源」工作表讀取資源。試算表只有你看得到，App 也不會改變共用設定。
        </div>
      )}

      {linked && (
        <>
          <div className="actions">
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => job('同步記帳中…', async () => { await sheetsLink.syncLedger(); return '記帳已同步到試算表。'; })}>同步記帳</button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => job('更新資源中…', async () => {
              const r = await sheetsLink.refreshResources();
              return `資源已更新：新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}${r.images ? `、圖片 ${r.images} 張` : ''}。`;
            })}>更新資源</button>
          </div>
          {busy && <p className="muted small" style={{ margin: 0 }}>{busy}</p>}
          <label className="check">
            <input type="checkbox" checked={s.autoSync} onChange={e => sheetsLink.setAutoSync(e.target.checked)} />
            記帳變更後自動同步（有網路時）
          </label>
          {!!s.pullErrors.length && (
            <div className="hint warn">
              <b>「資源」工作表有些列沒有讀進來：</b>
              {s.pullErrors.slice(0, 15).map(e => <div key={e.line}>第 {e.line} 列：{e.message}</div>)}
            </div>
          )}
          {!!s.log.length && (
            <details className="synclog">
              <summary>同步紀錄（最近 {s.log.length} 次）</summary>
              <ul>
                {s.log.map((e, i) => (
                  <li key={i} className={e.ok ? '' : 'bad'}>
                    <span className="when">{stamp(e.at)}</span>
                    <span>{e.ok ? '✓' : '✕'} {e.job}：{e.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {appOnly > 0 && (
            <div className="inset">
              <span className="small">App 裡有 {appOnly} 筆資源還不在試算表裡（之前用 App 或 CSV 新增的）。搬過去之後，就統一在試算表編輯。</span>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => job('搬移中…', async () => `已搬移 ${await sheetsLink.moveAppResources()} 筆到試算表。`)}>搬到試算表</button>
            </div>
          )}
        </>
      )}

      <div className="setgroup">
        <h3>圖片資料夾</h3>
        <Field label="從「我的雲端硬碟」開始的路徑，用 / 分隔" htmlFor="gs-folder">
          <input id="gs-folder" type="text" autoCapitalize="off" autoCorrect="off" value={folder ?? imageFolder} placeholder={DEFAULT_IMAGE_FOLDER} onChange={e => setFolder(e.target.value)} />
        </Field>
        {folder !== null && normalizeFolderPath(folder) !== imageFolder && (
          <button type="button" className="btn btn-secondary" onClick={saveFolder}>儲存資料夾</button>
        )}
        {(scriptOutdated || scriptTooOld) && (
          <div className="hint warn">
            雲端的腳本還沒更新到這個資料夾{s.scriptImageFolder ? `（目前是「${s.scriptImageFolder}」）` : ''}。請按下方「複製腳本」，到 Apps Script 全部取代後儲存，再「部署 › 管理部署作業 › 編輯（鉛筆）› 版本：新版本 › 部署」。網址不會變。完成後按「測試連線」。
          </div>
        )}
        <p className="muted tiny" style={{ margin: 0 }}>資料夾不存在時，腳本會自動建立。照片直接放在最後一層資料夾裡，試算表的「圖片檔名」填檔名即可。</p>
        {linked && <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={!!busy}>測試連線</button>}
      </div>

      <div className="setgroup">
        <h3>{linked ? '重新設定' : '設定步驟（約 5 分鐘）'}</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: '1.3em', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>打開你的 Google 試算表，選單「擴充功能 › Apps Script」。</li>
          <li>按下面的「複製腳本」，把編輯器裡原本的內容全部取代成這段腳本，按儲存。腳本裡已經有這支手機的同步金鑰。</li>
          <li>右上角「部署 › 新增部署作業」，類型選「網頁應用程式」；執行身分選「我」，存取權選「任何人」，按部署。第一次會要你授權自己的帳號（看到「Google 尚未驗證這個應用程式」時，按「進階 › 前往」）。</li>
          <li>複製「網頁應用程式」的網址（/exec 結尾），貼到下面，按「連線」。</li>
        </ol>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={copyScript}>複製腳本</button>
          <button type="button" className="btn btn-secondary" onClick={() => rotateKey('已重新產生同步金鑰。請複製新腳本並部署新版本，舊金鑰立即失效。')}>重新產生金鑰</button>
        </div>
        {keyRotated && (
          <div className="hint warn">
            已產生新金鑰。請按上方「複製腳本」，到 Apps Script 全部取代並儲存，再「部署 › 管理部署作業 › 編輯（鉛筆）› 版本：新版本 › 部署」，舊金鑰即會失效。
          </div>
        )}
        {showScript && script && (
          <textarea readOnly value={script} aria-label="腳本內容" style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }} onFocus={e => e.currentTarget.select()} />
        )}
        <Field label="網頁應用程式網址" htmlFor="gs-url">
          <input id="gs-url" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://script.google.com/macros/s/…/exec" value={url ?? s.url ?? ''} onChange={e => setUrl(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-primary" onClick={connect} disabled={!!busy}>{busy && !linked ? busy : '連線'}</button>
        <p className="muted tiny" style={{ margin: 0 }}>
          網址與金鑰只存在這支手機，不會上傳到其他地方；備份檔預設不包含它們。試算表會多出「資源」與五個記帳工作表；你自己的其他工作表不會被動到。
        </p>
      </div>

      {linked && <LedgerRestore offer={s.restoreOffer} supported={!!s.scriptFeatures.includes('ledgerRestore')} lastSyncAt={s.lastSyncAt} />}

      {linked && <ShortcutGuide url={s.url} secret={s.key} supported={!!s.scriptFeatures.includes('quickAddType')} />}

      {linked && (
        <div className="setgroup">
          <h3>安全</h3>
          <div className="list">
            <button type="button" className="row" onClick={() => rotateKey('已產生新金鑰。請重新複製腳本，貼上後「管理部署作業 › 編輯 › 新版本」。')}>
              <span className="main"><span className="t">更換金鑰</span><span className="m">懷疑網址外流時使用；舊金鑰立即失效</span></span>
            </button>
            {confirmUnlink ? (
              <div className="row">
                <span className="main"><span className="t">解除連結？試算表內容會保留。</span></span>
                <button type="button" className="mini" onClick={() => setConfirmUnlink(false)}>取消</button>
                <button type="button" className="mini" style={{ color: 'var(--error)' }} onClick={async () => { await sheetsLink.unlink(); setConfirmUnlink(false); toast('已解除連結。'); }}>解除</button>
              </div>
            ) : (
              <button type="button" className="row" onClick={() => setConfirmUnlink(true)}>
                <span className="main"><span className="t" style={{ color: 'var(--error)' }}>解除連結</span><span className="m">App 裡的資源會保留，之後可以直接在 App 編輯</span></span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
