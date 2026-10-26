import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { sheetsLink } from '../../db/sheetsLink';
import type { RestoreOffer } from '../../db/sheetsSync';
import { SheetsError } from '../../io/sheetsClient';
import { useToast } from '../../components/ui';

// Restore the ledger from the copy every sync saves in the sheet (backlog R-02).

const when = (iso: string) => {
  if (!iso) return '時間不明';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function LedgerRestore({ offer, supported, lastSyncAt }: { offer?: RestoreOffer; supported: boolean; lastSyncAt?: string }) {
  const toast = useToast();
  const local = useLiveQuery(async () => ({ expenses: await db.expenses.count(), exchanges: await db.exchanges.count() }), [], { expenses: 0, exchanges: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  // What the user is about to confirm: a restore (with what the sheet holds) or an overwrite.
  const [confirm, setConfirm] = useState<{ kind: 'restore'; preview: RestoreOffer } | { kind: 'overwrite' } | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof SheetsError || e instanceof Error ? e.message : '操作失敗。', { ok: false });
    } finally {
      setBusy(null);
    }
  }

  const askRestore = () =>
    run('讀取試算表中…', async () => {
      const preview = await sheetsLink.previewRestore();
      if (preview.counts.expenses + preview.counts.exchanges + preview.counts.trips === 0) {
        toast('試算表裡還沒有記帳備份。記一筆帳、同步之後就會有。', { ok: false });
        return;
      }
      setConfirm({ kind: 'restore', preview });
    });

  const doRestore = () =>
    run('還原中…', async () => {
      const c = await sheetsLink.restoreFromSheet();
      setConfirm(null);
      toast(`已還原 ${c.expenses} 筆支出、${c.exchanges} 筆換匯、${c.trips} 個旅程。`);
    });

  const doOverwrite = () =>
    run('上傳中…', async () => {
      await sheetsLink.overwriteSheet();
      setConfirm(null);
      toast('已用這支手機的記帳更新試算表。');
    });

  return (
    <div className="setgroup">
      <h3>記帳備份與還原</h3>
      {!supported ? (
        <div className="hint warn">
          目前部署的腳本還不能備份記帳。請按上方「複製腳本」，到 Apps Script 全部取代並儲存，再「部署 › 管理部署作業 › 編輯 › 版本：新版本 › 部署」，然後按「測試連線」。
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          每次記帳同步時，完整的記帳資料（含旅程、付款方式、類別、預算、重要日期）也會存進試算表的隱藏工作表「_記帳原始資料」。手機資料不見或換手機時，可以從這裡還原。
          {lastSyncAt && <span className="muted">上次備份：{when(lastSyncAt)}。</span>}
        </p>
      )}

      {offer && !confirm && (
        <div className="hint warn">
          <b>試算表裡已有記帳資料：</b>{offer.counts.expenses} 筆支出、{offer.counts.exchanges} 筆換匯（{when(offer.syncedAt)} 同步）。
          這支手機目前有 {local.expenses} 筆支出、{local.exchanges} 筆換匯。為了不蓋掉試算表裡的資料，記帳暫停同步，請選一個：
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={askRestore}>從試算表還原</button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm({ kind: 'overwrite' })}>用這支手機覆蓋</button>
          </div>
        </div>
      )}

      {confirm?.kind === 'restore' && (
        <div className="inset">
          <span className="small">
            要用試算表的 <b>{confirm.preview.counts.expenses} 筆支出、{confirm.preview.counts.exchanges} 筆換匯、{confirm.preview.counts.trips} 個旅程</b>（{when(confirm.preview.syncedAt)} 同步）
            取代這支手機上的 {local.expenses} 筆支出、{local.exchanges} 筆換匯嗎？付款方式、類別、預算和重要日期也會換成試算表的版本。資源庫不受影響。
          </span>
          <div className="actions">
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={doRestore}>{busy ?? '確定還原'}</button>
          </div>
        </div>
      )}

      {confirm?.kind === 'overwrite' && (
        <div className="inset">
          <span className="small" style={{ color: 'var(--error)' }}>
            試算表裡的 {offer?.counts.expenses ?? 0} 筆支出、{offer?.counts.exchanges ?? 0} 筆換匯會被這支手機的 {local.expenses} 筆支出、{local.exchanges} 筆換匯取代，無法復原。確定嗎？
          </span>
          <div className="actions">
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button>
            <button type="button" className="btn btn-primary" style={{ background: 'var(--error)' }} disabled={!!busy} onClick={doOverwrite}>{busy ?? '確定覆蓋'}</button>
          </div>
        </div>
      )}

      {supported && !offer && !confirm && (
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={askRestore}>{busy ?? '從試算表還原記帳'}</button>
      )}
    </div>
  );
}
