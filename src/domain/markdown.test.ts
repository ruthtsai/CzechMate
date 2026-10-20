// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripInline, stripMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, lists, emphasis and line breaks', () => {
    const html = renderMarkdown('## 重點\n- 押金要先匯\n- **收據**要留\n第一行\n第二行');
    expect(html).toContain('<h2>重點</h2>');
    expect(html).toContain('<li>押金要先匯</li>');
    expect(html).toContain('<strong>收據</strong>');
    expect(html).toContain('第一行<br>');
  });

  it('keeps safe HTML from notes but removes anything that could run or restyle the app', () => {
    const html = renderMarkdown(
      [
        '前言',
        '',
        // <script> removal is checked in a real browser; happy-dom returns an empty result for it.
        '<div class="card" style="color:red" onclick="x()">文字<img src="x.png" onerror="alert(1)"></div>',
        '',
        '<a href="javascript:alert(1)">連結</a>'
      ].join('\n')
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('class="card"');
    expect(html).not.toContain('javascript:');
    expect(html).toMatch(/<img[^>]*src="x.png"/);
    expect(html).toContain('<div>文字');
  });

  it('renders a pasted HTML page from HackMD as its content only', () => {
    const page = [
      '布拉格的大眾交通很簡單。',
      '',
      '<!DOCTYPE html> /* 註解 /',
      '<html lang="en">',
      '<head>',
      '<title>Icon Display</title>',
      '<style>',
      '.logo { color: #d32f2f; }',
      '</style>',
      '</head>',
      '<body>',
      '<div class="logo-container">',
      '<div class="logo">pid</div>',
      '<div class="icon"><a href="https://pid.cz/en/metro"><img src="https://hackmd.io/_uploads/a.svg" alt="Metro"></a></div>',
      '</div>',
      '</body>',
      '</html>'
    ].join('\n');
    const html = renderMarkdown(page);
    expect(html).toContain('布拉格的大眾交通很簡單。');
    expect(html).not.toMatch(/DOCTYPE|Icon Display|\.logo|<style|<html|<head|註解/);
    const link = html.match(/<a [^>]*href="https:\/\/pid.cz\/en\/metro"[^>]*>/)?.[0] ?? '';
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<img[^>]*src="https:\/\/hackmd.io\/_uploads\/a.svg"/);
    expect(stripMarkdown(page)).not.toMatch(/<|Icon Display|logo \{/);
    expect(stripMarkdown(page)).toContain('pid');
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

describe('renderMarkdown with a base', () => {
  it('resolves site-relative links against the note site', () => {
    expect(renderMarkdown('[交通篇](/@demo/transport)', 'https://hackmd.io')).toContain('href="https://hackmd.io/@demo/transport"');
    expect(renderMarkdown('[交通篇](/@demo/transport)')).toContain('href="/@demo/transport"');
  });
});

describe('stripInline', () => {
  it('keeps numbering in headings', () => {
    expect(stripInline('2. **PID** [Lítačka](https://x) 購票')).toBe('2. PID Lítačka 購票');
  });
});

describe('HackMD image sizes', () => {
  it('renders images that carry a size suffix', () => {
    const html = renderMarkdown('![票](https://hackmd.io/_uploads/a.jpg =50%x)');
    expect(html).toMatch(/<img[^>]*src="https:\/\/hackmd.io\/_uploads\/a.jpg"/);
    expect(html).toContain('alt="票"');
  });
});
