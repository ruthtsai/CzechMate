import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { IconAlert, IconPin, IconPlus } from '../../components/Icons';
import { EmptyState, useToast } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';

// iOS keeps home-screen web apps and Safari tabs in separate storage (requirements spec 3).
const inSafariTab = navigator.standalone === false;

export function HomePage() {
  const toast = useToast();
  const pinned = useLiveQuery(() => db.resources.filter(r => r.pinned).count(), [], 0);
  const now = new Date();
  const month = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;

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

        <section className="section">
          <div className="sec-h"><h2>常用連結</h2></div>
          {pinned === 0 && (
            <EmptyState icon={<IconPin />}>還沒有釘選的連結。在資源上開啟「釘選到首頁」，學校系統等常用網站就會出現在這裡。</EmptyState>
          )}
        </section>

        <section className="section">
          <div className="sec-h"><h2>{month}花費</h2></div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>
              <small className="muted" style={{ fontSize: 15, fontWeight: 500, marginRight: 4 }}>NT$</small>0
            </span>
            <span className="muted small">這段期間還沒有支出紀錄。</span>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => toast('記帳功能還在開發中。', { ok: false })}>
            <IconPlus />快速記一筆
          </button>
        </section>

        <section className="section">
          <div className="sec-h"><h2>最近新增的資源</h2></div>
          <EmptyState>還沒有儲存資源，新增第一筆，或從設定匯入整理好的 CSV。</EmptyState>
        </section>
      </main>
    </>
  );
}
