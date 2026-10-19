import { IconBook, IconSearch } from '../../components/Icons';
import { EmptyState } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';

export function LibraryPage() {
  return (
    <>
      <PageHeader title="資源庫" />
      <main className="page">
        <div className="search">
          <IconSearch />
          <input type="search" placeholder="搜尋資源與生存手冊" aria-label="搜尋" disabled />
        </div>
        <EmptyState>還沒有儲存資源，新增第一筆，或從設定匯入整理好的 CSV。</EmptyState>
        <EmptyState icon={<IconBook />}>尚未同步生存手冊，同步後就能離線搜尋。</EmptyState>
      </main>
    </>
  );
}
