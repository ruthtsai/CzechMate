import { describe, expect, it, vi } from 'vitest';
import { canonicalNoteUrl, headingAnchor, isHackmdNote, parseBookToc, splitSections, syncBook } from './hackmd';

// Synthetic fixtures shaped like the real handbook (no third-party content in the repo).
const TOC = `示範手冊
===
- [示範手冊](/@demo/homepage)
- [準備篇](/@demo/prep)
- [交通篇](https://hackmd.io/@demo/transport)
- [交通篇（重複）](/@demo/transport#票種)
- [外部連結](https://example.com/x)

各校手冊
---
- [某大學](/@demo/uni)
`;

const PAGE = `:::warning
點我回首頁：[示範手冊](https://hackmd.io/@demo/book/)
:::

# 交通篇
這是一段介紹布拉格大眾運輸的開場文字。

## 學生月票
學生月票可以綁定 ISIC 卡號，在網站上購買。[color=#F4B400]

## 短
太短

\`\`\`
# 不是標題
\`\`\`
`;

describe('canonicalNoteUrl', () => {
  it('normalises note, book-page and edit URLs', () => {
    expect(canonicalNoteUrl('/@demo/prep')).toBe('https://hackmd.io/@demo/prep');
    expect(canonicalNoteUrl('https://hackmd.io/@demo/transport#票種')).toBe('https://hackmd.io/@demo/transport');
    expect(canonicalNoteUrl('https://hackmd.io/@demo/book/%2F%40demo%2Fhomepage')).toBe('https://hackmd.io/@demo/homepage');
    expect(canonicalNoteUrl('https://hackmd.io/AbCdEf/edit?view')).toBe('https://hackmd.io/AbCdEf');
    expect(canonicalNoteUrl('https://example.com/@demo/x')).toBeNull();
    expect(isHackmdNote('https://hackmd.io/')).toBe(false);
  });
});

describe('parseBookToc', () => {
  it('lists unique HackMD pages in order and skips the book itself and other sites', () => {
    expect(parseBookToc(TOC, 'https://hackmd.io/@demo/homepage')).toEqual([
      { title: '準備篇', url: 'https://hackmd.io/@demo/prep' },
      { title: '交通篇', url: 'https://hackmd.io/@demo/transport' },
      { title: '某大學', url: 'https://hackmd.io/@demo/uni' }
    ]);
  });
});

describe('splitSections', () => {
  const page = { title: '交通篇', url: 'https://hackmd.io/@demo/transport' };
  const s = splitSections(PAGE, page, 'src', 2);
  it('splits on headings, skips tiny sections and ignores # inside code', () => {
    expect(s.map(x => x.heading)).toEqual(['交通篇', '學生月票']);
    expect(s.some(x => x.heading === '不是標題')).toBe(false);
  });
  it('strips markup, sets anchors and a global order', () => {
    expect(s[1].text).toBe('學生月票可以綁定 ISIC 卡號，在網站上購買。');
    expect(s[1].anchor).toBe(headingAnchor('學生月票'));
    expect(s[1].order).toBeGreaterThan(2000);
    expect(s[0].text).not.toContain(':::');
  });
});

describe('syncBook', () => {
  it('downloads every page, keeps going on failures and reports them', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/@demo/homepage/download')) return new Response(TOC);
      if (url.endsWith('/@demo/uni/download')) return new Response('nope', { status: 404 });
      return new Response(PAGE);
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const r = await syncBook({ id: 'src', url: 'https://hackmd.io/@demo/homepage', title: '示範', kind: 'book' }, { fetchImpl, onProgress: d => progress.push(d) });
    expect(r.pages).toHaveLength(3);
    expect(r.failed.map(f => f.title)).toEqual(['某大學']);
    expect(r.sections.length).toBe(4);
    expect(progress.at(-1)).toBe(3);
  });
});
