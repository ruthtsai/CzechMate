import { describe, expect, it } from 'vitest';
import type { Resource } from '../db/schema';
import { planPull, toSheetValues } from './sheetResources';

const row = (n: number, values: Record<string, string>) => ({ row: n, values: { 類型: '', 階段: '', 網址: '', 內容: '', 標籤: '', 圖片檔名: '', 釘選: '', 常用連結名稱: '', ...values } });
const res = (id: string, extra: Partial<Resource> = {}): Resource => ({
  id, title: id, type: 'note', stage: 'any', content: '', tags: [], url: '', imageIds: [], pinned: false, createdAt: 'old', updatedAt: 'old', ...extra
});

describe('planPull', () => {
  it('adds new rows, updates changed ones, keeps unchanged ones and removes deleted ones', () => {
    const first = planPull([row(2, { ID: 'a', 標題: 'KOS', 網址: 'https://kos.cvut.cz', 釘選: '是' }), row(3, { ID: 'b', 標題: '筆記' })], [], 'T1');
    expect(first.put.map(r => [r.id, r.source, r.sheetRow, r.pinned, r.pinOrder])).toEqual([['a', 'sheet', 2, true, 1002], ['b', 'sheet', 3, false, undefined]]);

    const existing = first.put;
    const second = planPull([row(2, { ID: 'a', 標題: 'KOS', 網址: 'https://kos.cvut.cz', 釘選: '是' }), row(3, { ID: 'c', 標題: '新的' })], existing, 'T2');
    expect(second.unchanged).toBe(1);
    expect(second.put.map(r => r.id)).toEqual(['c']);
    expect(second.remove).toEqual(['b']);
  });

  it('keeps createdAt and image ids of existing records', () => {
    const p = planPull([row(2, { ID: 'a', 標題: '改過的標題' })], [res('a', { source: 'sheet', sheetRow: 2, imageIds: ['img1'] })], 'NOW');
    expect(p.put[0]).toMatchObject({ title: '改過的標題', createdAt: 'old', updatedAt: 'NOW', imageIds: ['img1'] });
  });

  it('uses numbered pins as the order and reads the pin label', () => {
    const p = planPull([row(9, { ID: 'a', 標題: 'Moodle', 網址: 'https://moodle.cvut.cz', 釘選: '2', 常用連結名稱: 'Moodle' })], []);
    expect(p.put[0]).toMatchObject({ pinned: true, pinOrder: 2, pinLabel: 'Moodle' });
  });

  it('reports invalid and duplicate rows and leaves app or pending records alone', () => {
    const p = planPull(
      [row(2, { ID: 'a', 標題: '' }), row(3, { ID: 'b', 標題: 'ok' }), row(4, { ID: 'b', 標題: 'dup' })],
      [res('local', { source: 'app' }), res('waiting', { source: 'pending' })]
    );
    expect(p.errors).toEqual([{ line: 2, message: '標題是空白的。' }, { line: 4, message: 'ID 與上面的列重複，請刪除這格讓腳本重新產生。' }]);
    expect(p.remove).toEqual([]);
  });
});

describe('toSheetValues', () => {
  it('writes labels the import understands', () => {
    const v = toSheetValues(res('x', { title: '居留', type: 'screenshot', stage: 'after', tags: ['居留', '移民局'], pinned: true, url: 'https://a.b' }), ['x-1.jpg']);
    expect(v).toMatchObject({ ID: 'x', 類型: '截圖', 階段: '抵達後', 標籤: '居留;移民局', 圖片檔名: 'x-1.jpg', 釘選: '是' });
  });
});
