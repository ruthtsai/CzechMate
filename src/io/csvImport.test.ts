import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseResourceCsv } from './csvImport';

const HEADER = '標題,類型,階段,網址,內容,標籤,圖片檔名,釘選';

describe('parseResourceCsv', () => {
  it('reads the shipped template, including the BOM and a multi-line cell', () => {
    const text = readFileSync('public/templates/resources_template.csv', 'utf-8');
    const p = parseResourceCsv(text, [], ['img_1234.png']);
    expect(p.errors).toEqual([]);
    expect(p.drafts).toHaveLength(4);
    expect(p.drafts[0]).toMatchObject({ title: 'KOS 選課系統', type: 'web', stage: 'after', pinned: true, tags: ['學校', '選課'] });
    expect(p.drafts[1].content).toContain('\n');
    expect(p.drafts[2].imageNames).toEqual(['img_1234.png']);
    expect(p.missingImages).toEqual([]);
  });

  it('defaults type and stage and splits tags on full-width semicolons', () => {
    const p = parseResourceCsv(`${HEADER}\n筆記一,,,,內容,簽證；文件；簽證,,`, []);
    expect(p.drafts[0]).toMatchObject({ type: 'note', stage: 'any', tags: ['簽證', '文件'], pinned: false });
  });

  it('reports row errors with line numbers', () => {
    const p = parseResourceCsv(`${HEADER}\n,網站,,,,,,\n壞類型,影片,,,,,,\n壞網址,,,kos.cvut.cz,,,,\n好的,,,,,,,`, []);
    expect(p.errors).toEqual([
      { line: 2, message: '標題是空白的。' },
      { line: 3, message: '類型「影片」不在清單中（筆記、Dcard、網站、截圖、文件）。' },
      { line: 4, message: '網址需要以 http:// 或 https:// 開頭。' }
    ]);
    expect(p.drafts.map(d => d.title)).toEqual(['好的']);
  });

  it('rejects a file without a title column', () => {
    expect(parseResourceCsv('name,url\nx,y', []).errors[0].message).toContain('找不到「標題」欄位');
  });

  it('flags duplicates by URL (ignoring case and trailing slash) or by title when there is no URL', () => {
    const existing = [{ id: 'r1', title: '居留文件', url: '' }, { id: 'r2', title: 'KOS', url: 'https://KOS.cvut.cz/' }];
    const p = parseResourceCsv(`${HEADER}\nKOS 新,網站,,https://kos.cvut.cz,,,,\n居留文件,,,,,,,\n新的,,,,,,,\n新的,,,,,,,`, existing);
    expect(p.drafts.map(d => d.duplicateOf)).toEqual(['r2', 'r1', undefined, 'row-4']);
  });

  it('matches image names case-insensitively and warns about missing ones', () => {
    const p = parseResourceCsv(`${HEADER}\n截圖,截圖,,,,,IMG_1.PNG;img_2.png,`, [], ['img_1.png']);
    expect(p.drafts[0].imageNames).toEqual(['img_1.png']);
    expect(p.missingImages).toEqual(['img_2.png']);
    expect(p.drafts[0].warnings).toContain('找不到圖片 img_2.png。');
  });

  it('does not pin a row without a URL and lists unknown columns', () => {
    const p = parseResourceCsv(`${HEADER},備用\n沒網址,,,,,,,是,x`, []);
    expect(p.drafts[0].pinned).toBe(false);
    expect(p.unknownColumns).toEqual(['備用']);
  });
});
