import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getSetting, setSetting } from '../../db';
import { MODE_SHORT, MODES, PAYMENT_KIND_LABEL, type Theme } from '../../domain/constants';
import { shareOrDownload } from '../../io/share';
import { applyTheme } from '../../theme';
import { IconShare } from '../../components/Icons';
import { Seg, Sheet, useToast } from '../../components/ui';

const THEME_OPTIONS = [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']] as const;
const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/resources_template.csv`;

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const theme = useLiveQuery(() => getSetting<Theme>('theme', 'system'), [], 'system');
  const payments = useLiveQuery(() => db.paymentMethods.orderBy('order').toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const [storage, setStorage] = useState<{ usage?: number; persisted?: boolean }>({});

  useEffect(() => {
    if (!open || !navigator.storage) return;
    Promise.all([navigator.storage.estimate?.(), navigator.storage.persisted?.()]).then(([est, persisted]) =>
      setStorage({ usage: est?.usage, persisted })
    );
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

  const soon = () => toast('這個功能還在開發中。', { ok: false });

  return (
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
        <h3>付款方式</h3>
        <div className="list">
          {payments.map(p => (
            <div className="row" key={p.id}>
              <span className="main">
                <span className="t">{p.name}</span>
              </span>
              <span className="chip">{PAYMENT_KIND_LABEL[p.kind]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="setgroup">
        <h3>類別</h3>
        <div className="list">
          {MODES.map(m => {
            const names = categories.filter(c => c.mode === m).sort((a, b) => a.order - b.order);
            return (
              <div className="row" key={m}>
                <span className="main">
                  <span className="t">{MODE_SHORT[m]}</span>
                  <span className="m">{names.map(c => c.name).join('、')}</span>
                </span>
                <span className="end num">{names.length}</span>
              </div>
            );
          })}
        </div>
        <p className="muted tiny" style={{ margin: 0 }}>新增、改名與排序會在記帳功能上線時開放。</p>
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
          {['匯入資源 CSV', '匯出 Excel', '完整備份', '還原備份'].map(t => (
            <button type="button" className="row" key={t} onClick={soon}>
              <span className="main"><span className="t">{t}</span></span>
              <span className="chip">開發中</span>
            </button>
          ))}
        </div>
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
  );
}
