import { useState } from 'react';
import { IconChart } from '../../components/Icons';
import { EmptyState, Seg } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';

const VIEWS = [['month', '月份'], ['trip', '旅程'], ['payment', '付款方式']] as const;

export function StatsPage() {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('month');
  return (
    <>
      <PageHeader title="統計" />
      <main className="page">
        <Seg label="統計檢視" value={view} options={VIEWS} onChange={setView} />
        <EmptyState icon={<IconChart />}>開始記帳後，這裡會顯示各類別、旅程與付款方式的花費。</EmptyState>
      </main>
    </>
  );
}
