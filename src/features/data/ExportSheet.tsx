import { useState } from 'react';
import { setSetting } from '../../db';
import { monthRange, today } from '../../domain/dates';
import { exportFileName, buildWorkbook } from '../../io/excelExport';
import { fileSize, shareOrDownload } from '../../io/share';
import { Field } from '../../components/form';
import { IconShare } from '../../components/Icons';
import { Seg, Sheet, useToast } from '../../components/ui';
import { useLedger } from '../ledger/LedgerData';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const RANGES = [['all', '全部'], ['custom', '自訂期間']] as const;

/** Excel export (requirements OUT-01), opened from the stats page and settings. */
export function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useLedger();
  const toast = useToast();
  const [range, setRange] = useState<'all' | 'custom'>('all');
  const [[from, to], setDates] = useState<[string, string]>(() => monthRange(today()));
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<File | null>(null);

  async function handOver(file: File) {
    const result = await shareOrDownload(file);
    if (result === 'needs-tap') return setReady(file);
    setReady(null);
    if (result === 'cancelled') return;
    await setSetting('lastExportAt', new Date().toISOString());
    toast('已匯出 Excel。');
    onClose();
  }

  async function run() {
    if (range === 'custom' && (!from || !to || from > to)) return toast('請選擇有效的期間。', { ok: false });
    setBusy(true);
    try {
      const buf = await buildWorkbook({
        expenses: L.expenses, exchanges: L.exchanges, payments: L.payments, categories: L.categories, trips: L.trips, money: L.money,
        ...(range === 'custom' ? { from, to } : {})
      });
      await handOver(new File([buf], exportFileName(), { type: XLSX }));
    } catch {
      toast('暫時無法匯出，請稍後再試。', { ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="export-title">
      <div className="sheet-h">
        <button type="button" onClick={onClose}>取消</button>
        <h2 id="export-title" style={{ textAlign: 'center' }}>匯出 Excel</h2>
        <span style={{ width: 40 }} />
      </div>
      <Seg label="匯出範圍" value={range} options={RANGES} onChange={setRange} />
      {range === 'custom' && (
        <div className="two">
          <Field label="從" htmlFor="ex-from"><input id="ex-from" type="date" value={from} onChange={e => setDates([e.target.value, to])} /></Field>
          <Field label="到" htmlFor="ex-to"><input id="ex-to" type="date" value={to} min={from} onChange={e => setDates([from, e.target.value])} /></Field>
        </div>
      )}
      <div className="hint">
        檔案包含五個工作表：支出總表、換匯紀錄、月份×類別、旅程彙總、付款方式彙總。支出總表可以直接拿來做樞紐分析。
      </div>
      {ready ? (
        <button type="button" className="btn btn-primary btn-block" onClick={() => handOver(ready)}>
          <IconShare />檔案已準備好（{fileSize(ready)}），按這裡分享
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block" onClick={run} disabled={busy}>
          <IconShare />{busy ? '產生中…' : '產生並分享檔案'}
        </button>
      )}
      <p className="muted tiny" style={{ margin: 0 }}>在分享選單選「儲存到檔案」，就能存到 iPhone 的「檔案」App 或 iCloud 雲碟。</p>
    </Sheet>
  );
}
