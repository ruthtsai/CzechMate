import { useState } from 'react';
import { IconExchange, IconWallet } from '../../components/Icons';
import { EmptyState, Seg } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';

const SEGMENTS = [['expenses', '支出'], ['exchanges', '換匯']] as const;

export function LedgerPage() {
  const [seg, setSeg] = useState<(typeof SEGMENTS)[number][0]>('expenses');
  return (
    <>
      <PageHeader title="記帳" />
      <main className="page">
        <Seg label="切換支出或換匯" value={seg} options={SEGMENTS} onChange={setSeg} />
        {seg === 'expenses' ? (
          <EmptyState icon={<IconWallet />}>這段期間還沒有支出紀錄。</EmptyState>
        ) : (
          <EmptyState icon={<IconExchange />}>還沒有換匯紀錄，新增後即可換算現金支出的台幣金額。</EmptyState>
        )}
      </main>
    </>
  );
}
