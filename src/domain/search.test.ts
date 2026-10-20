import { describe, expect, it } from 'vitest';
import type { Resource } from '../db/schema';
import { highlight, normalize, searchResources, searchSections, snippet, tagCounts, toTerms } from './search';

const r = (id: string, title: string, extra: Partial<Resource> = {}): Resource => ({
  id, title, type: 'note', stage: 'any', content: '', tags: [], url: '', imageIds: [], pinned: false, createdAt: '', updatedAt: '2027-01-01', ...extra
});

describe('normalize', () => {
  it('folds case and full-width characters', () => {
    expect(normalize('  ＩＳＩＣ　Card ')).toBe('isic card');
    expect(toTerms('Vodafone  電信')).toEqual(['vodafone', '電信']);
  });
});

describe('searchResources', () => {
  const list = [
    r('a', '捷克電信方案比較', { tags: ['Vodafone'], updatedAt: '2027-01-02' }),
    r('b', '居留登記', { content: '要帶護照與電信帳單', updatedAt: '2027-01-05' }),
    r('c', 'Vodafone 門市', { updatedAt: '2027-01-01' }),
    r('d', 'KOS', { url: 'https://kos.cvut.cz' })
  ];
  it('ranks title hits before tag and content hits', () => {
    expect(searchResources(list, '電信').map(x => x.id)).toEqual(['a', 'b']);
    expect(searchResources(list, 'vodafone').map(x => x.id)).toEqual(['c', 'a']);
  });
  it('requires every term (AND) and searches URLs', () => {
    expect(searchResources(list, '電信 護照').map(x => x.id)).toEqual(['b']);
    expect(searchResources(list, 'cvut').map(x => x.id)).toEqual(['d']);
  });
  it('returns everything, newest first, for an empty query', () => {
    expect(searchResources(list, ' ').map(x => x.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('snippet and highlight', () => {
  it('cuts around the first hit', () => {
    const text = '前面'.repeat(40) + '關鍵字' + '後面'.repeat(40);
    const s = snippet(text, ['關鍵字']);
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('關鍵字');
  });
  it('marks every occurrence, case-insensitively', () => {
    expect(highlight('ISIC 卡與 isic 優惠', ['isic'])).toEqual([
      { text: 'ISIC', hit: true }, { text: ' 卡與 ', hit: false }, { text: 'isic', hit: true }, { text: ' 優惠', hit: false }
    ]);
  });
});

describe('tagCounts', () => {
  it('orders tags by use', () => {
    expect(tagCounts([r('a', 'x', { tags: ['交通', '學校'] }), r('b', 'y', { tags: ['交通'] })])).toEqual([['交通', 2], ['學校', 1]]);
  });
});

describe('searchSections', () => {
  const sec = (id: string, heading: string, text: string, order: number) => ({ id, sourceId: 'hb', pageTitle: '交通篇', pageUrl: 'u', heading, anchor: '', text, order });
  const list = [sec('a', '計程車', '可以用 Bolt 叫車，學生月票不適用', 2), sec('b', '學生月票', '綁定 ISIC 卡號購買', 5), sec('c', '其他', '無關內容', 1)];
  it('requires every term and ranks heading hits first', () => {
    expect(searchSections(list, '月票').map(s => s.id)).toEqual(['b', 'a']);
    expect(searchSections(list, '月票 isic').map(s => s.id)).toEqual(['b']);
    expect(searchSections(list, '交通篇').map(s => s.id)).toEqual(['c', 'a', 'b']);
    expect(searchSections(list, '')).toEqual([]);
  });
});

describe('searchResources with downloaded notes', () => {
  it('matches text that only exists in the note', () => {
    const note = r('n', '我的 HackMD 筆記', { url: 'https://hackmd.io/@me/note' });
    expect(searchResources([note], '居留卡', () => '居留卡要在 3 天內登記').map(x => x.id)).toEqual(['n']);
  });
});
