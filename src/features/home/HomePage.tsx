import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, getSetting, setSetting } from '../../db';
import { ExportSheet } from '../data/ExportSheet';
import { monthKey, monthLabel, slashDate, today, weekday } from '../../domain/dates';
import { countdownLabel, upcomingKeyDates } from '../../domain/keyDates';
import { getKeyDates } from '../../db/keyDates';
import { formatAmount } from '../../domain/format';
import { summarize } from '../../domain/money';
import { activeTrips, budgetStatus } from '../../domain/budget';
import { BudgetBar } from '../../components/BudgetBar';
import type { Currency } from '../../domain/constants';
import { IconAlert, IconPin, IconPlus } from '../../components/Icons';
import { EmptyState } from '../../components/ui';
import { PageHeader, useOpenSettings } from '../../components/PageHeader';
import { ResourceCard } from '../library/parts';
import { useResourceEditors } from '../library/ResourceEditors';
import { useEditors } from '../ledger/Editors';
import { useLedger } from '../ledger/LedgerData';
import { presetLedgerFilter } from '../ledger/ledgerFilters';

/** Short mark for a pinned link: up to 3 Latin letters, or the first character. */
function pinMonogram(label: string) {
  const latin = label.match(/[A-Za-z]+/)?.[0];
  return latin && /^[A-Za-z]/.test(label.trim()) ? latin.slice(0, 3) : label.trim().slice(0, 1);
}

// iOS keeps home-screen web apps and Safari tabs in separate storage (requirements spec 3).
const inSafariTab = navigator.standalone === false;

export function HomePage() {
  const L = useLedger();
  const { openExpense } = useEditors();
  const navigate = useNavigate();
  const [exportOpen, setExportOpen] = useState(false);
  const { openResource, editResource } = useResourceEditors();
  const openSettings = useOpenSettings();
  const pinned = useLiveQuery(async () => (await db.resources.filter(r => r.pinned).toArray()).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0)), [], []);
  const reminders = useLiveQuery(async () => {
    const [lastExport, lastBackup, dismissed] = await Promise.all([
      getSetting<string | undefined>('lastExportAt', undefined),
      getSetting<string | undefined>('lastBackupAt', undefined),
      getSetting<string | undefined>('exportReminderDismissedMonth', undefined)
    ]);
    const hasData = (await db.expenses.count()) + (await db.resources.count()) > 0;
    const month = monthKey(today());
    const olderExpenses = await db.expenses.where('date').below(`${month}-01`).count();
    return {
      // A new month began and last month's expenses have not been exported yet (requirements SYS-03).
      exportDue: olderExpenses > 0 && (!lastExport || monthKey(lastExport.slice(0, 10)) < month) && dismissed !== month,
      backupDue: hasData && (!lastBackup || Date.now() - new Date(lastBackup).getTime() > 14 * 86_400_000),
      month
    };
  }, [], { exportDue: false, backupDue: false, month: '' });
  const recent = useLiveQuery(() => db.resources.orderBy('updatedAt').reverse().limit(5).toArray(), [], []);

  const month = monthKey(today());
  const thisMonth = L.expenses.filter(e => monthKey(e.date) === month);
  const sum = summarize(thisMonth, L.money.expenses);
  const keyDates = useLiveQuery(async () => upcomingKeyDates(await getKeyDates(), today()).slice(0, 4), [], []);
  const monthlyBudget = useLiveQuery(() => getSetting<number>('budgetMonthly', 0), [], 0);
  const living = monthlyBudget > 0 ? budgetStatus(summarize(thisMonth.filter(e => e.mode === 'daily'), L.money.expenses).twd, monthlyBudget) : null;
  const tripBudgets = activeTrips(L.trips, today())
    .filter(t => t.budgetTwd)
    .map(t => ({ trip: t, status: budgetStatus(summarize(L.expenses.filter(e => e.tripId === t.id), L.money.expenses).twd, t.budgetTwd!) }));
  let pending = 0;
  for (const c of L.money.expenses.values()) if (c.source === 'pending') pending++;
  const negative = Object.entries(L.money.cash).filter(([, s]) => s && s.stock < -0.004).map(([c]) => c);

  const showPending = () => {
    presetLedgerFilter({ seg: 'expenses', missing: 'pending' });
    navigate('/ledger');
  };
  const showExchanges = () => {
    presetLedgerFilter({ seg: 'exchanges', missing: null });
    navigate('/ledger');
  };

  return (
    <>
      <PageHeader title="CzechMate" sub="捷適旅" />
      <main className="page">
        {inSafariTab && (
          <div className="banner" role="note">
            <IconAlert />
            <span>
              請按 Safari 的「分享」→<b>「加入主畫面」</b>，之後從桌面圖示開啟。在 Safari 分頁裡輸入的資料不會出現在主畫面的 App。
            </span>
          </div>
        )}
        {pending > 0 && (
          <button type="button" className="banner" onClick={showPending}>
            <IconAlert />
            <span>有 <b>{pending} 筆</b>刷卡待補帳單金額</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>去補 ›</span>
          </button>
        )}
        {reminders.exportDue && (
          <div className="banner" role="note">
            <IconAlert />
            <span>新的月份到了，<b>該匯出上個月的記帳</b>。</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button type="button" className="linkbtn" onClick={() => setSetting('exportReminderDismissedMonth', reminders.month)}>稍後</button>
              <button type="button" className="linkbtn" onClick={() => setExportOpen(true)}>匯出 ›</button>
            </span>
          </div>
        )}
        {reminders.backupDue && (
          <button type="button" className="banner" onClick={() => openSettings()}>
            <IconAlert />
            <span>已超過 14 天沒有備份，<b>資料只存在這支手機上</b>。</span>
            <span className="muted small" style={{ marginLeft: 'auto' }}>去備份 ›</span>
          </button>
        )}
        {negative.length > 0 && (
          <button type="button" className="banner" onClick={showExchanges}>
            <IconAlert />
            <span><b>{negative.join('、')}</b> 現金庫存不足，請補記換匯。</span>
          </button>
        )}

        <section className="section">
          <div className="sec-h">
            <h2>常用連結</h2>
            {pinned.length > 1 && <button type="button" className="linkbtn" onClick={() => openSettings('pins')}>排序</button>}
          </div>
          {pinned.length === 0 ? (
            <EmptyState icon={<IconPin />}>還沒有釘選的連結。在資源上開啟「釘選到首頁」，學校系統等常用網站就會出現在這裡。</EmptyState>
          ) : (
            <div className="pins">
              {pinned.map(r => (
                <a key={r.id} className="pin" href={r.url} target="_blank" rel="noopener noreferrer">
                  <span className="ico" aria-hidden="true">{pinMonogram(r.pinLabel || r.title)}</span>
                  <span className="lbl">{r.pinLabel || r.title.slice(0, 6)}</span>
                </a>
              ))}
            </div>
          )}
        </section>

        {keyDates.length > 0 && (
          <section className="section">
            <div className="sec-h">
              <h2>重要日期</h2>
              <button type="button" className="linkbtn" onClick={() => openSettings('dates')}>管理 ›</button>
            </div>
            <div className="list keydates">
              {keyDates.map(d => (
                <div key={d.id} className={`keydate${d.daysLeft <= 7 ? ' soon' : ''}`}>
                  <span className="main">
                    <span className="t">{d.title}</span>
                    <span className="m num">{slashDate(d.date)} {weekday(d.date)}{d.note ? ` · ${d.note}` : ''}</span>
                  </span>
                  <span className="left num">{countdownLabel(d.daysLeft)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <div className="sec-h"><h2>{monthLabel(month)}花費</h2></div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>
              <small className="muted" style={{ fontSize: 15, fontWeight: 500, marginRight: 4 }}>NT$</small>
              {Math.round(sum.twd).toLocaleString('en-US')}
            </span>
            {thisMonth.length === 0 ? (
              <span className="muted small">這段期間還沒有支出紀錄。</span>
            ) : (
              <span className="muted small num">
                {thisMonth.length} 筆支出
                {sum.missingCount > 0 &&
                  `，另有 ${sum.missingCount} 筆未換算（${Object.entries(sum.missing).map(([c, a]) => `${formatAmount(a!, c as Currency)} ${c}`).join('、')}）`}
              </span>
            )}
            {living && <BudgetBar label="本月生活費預算" status={living} />}
            {tripBudgets.map(b => <BudgetBar key={b.trip.id} label={`${b.trip.name}預算`} status={b.status} />)}
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => openExpense()}>
            <IconPlus />快速記一筆
          </button>
        </section>

        <section className="section">
          <div className="sec-h">
            <h2>最近更新的資源</h2>
            {recent.length > 0 && <button type="button" className="linkbtn" onClick={() => navigate('/library')}>全部 ›</button>}
          </div>
          {recent.length === 0 ? (
            <EmptyState action={<button type="button" className="btn btn-secondary" onClick={() => editResource()}><IconPlus />新增資源</button>}>
              還沒有儲存資源，新增第一筆，或從設定匯入整理好的 CSV。
            </EmptyState>
          ) : (
            recent.map(r => <ResourceCard key={r.id} r={r} onClick={() => openResource(r.id)} />)
          )}
        </section>
      </main>
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}
