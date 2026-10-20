import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, lists, emphasis and line breaks', () => {
    const html = renderMarkdown('## 重點\n- 押金要先匯\n- **收據**要留\n第一行\n第二行');
    expect(html).toContain('<h2>重點</h2>');
    expect(html).toContain('<li>押金要先匯</li>');
    expect(html).toContain('<strong>收據</strong>');
    expect(html).toContain('第一行<br>');
  });

  it('never renders raw HTML from the source', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
  });

  it('opens external links in a new tab and keeps anchors', () => {
    expect(renderMarkdown('[CTU](https://cvut.cz)')).toContain('target="_blank" rel="noopener noreferrer"');
    expect(renderMarkdown('[下方](#備註)')).not.toContain('target=');
    expect(renderMarkdown('看 https://kos.cvut.cz')).toContain('href="https://kos.cvut.cz"');
  });

  it('turns HackMD callouts into boxes and drops colour markers', () => {
    const html = renderMarkdown(':::warning\n**本書仍在編輯中**\n:::\n> 註腳 [color=#F4B400]');
    expect(html).toContain('<div class="callout callout-warning"><p><strong>本書仍在編輯中</strong></p>\n</div>');
    expect(html).not.toContain('color=');
  });

  it('treats a bare ::: block as info', () => {
    expect(renderMarkdown(':::\n提示\n:::')).toContain('callout-info');
  });
});

describe('stripMarkdown', () => {
  it('keeps the words and drops the markup', () => {
    const s = stripMarkdown('## 重點\n- **押金**要先[匯款](https://x.y)\n> 引言\n:::info\n提示\n:::\n`code` [color=#fff]');
    expect(s).toBe('重點\n押金要先匯款\n引言\n\n提示\n\ncode');
  });
  it('flattens tables', () => {
    expect(stripMarkdown('| 票種 | 價格 |\n|---|---|\n| 月票 | 130 |')).toBe('票種 價格\n\n月票 130');
  });
});
