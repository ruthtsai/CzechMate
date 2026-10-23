import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe('repo and deployment security (S-03, S-06)', () => {
  it('enforces a Content-Security-Policy in index.html (S-03)', () => {
    const html = readFileSync('index.html', 'utf-8');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain('https://script.google.com');
    expect(html).toContain('https://script.googleusercontent.com');
    expect(html).toContain('https://hackmd.io');
  });

  it('ignores personal exports, backups and local spec files in .gitignore (S-06)', () => {
    const ignore = readFileSync('.gitignore', 'utf-8');
    expect(ignore).toContain('*.xlsx');
    expect(ignore).toContain('CzechMate_備份_*.json');
    expect(ignore).toContain('*_Spec.md');
    expect(ignore).toContain('CzechMate_Next_Phase.md');
    expect(ignore).toContain('資料整理/');
  });

  it('never tracks spec files, backups, Excel exports or real Apps Script URLs (S-06)', () => {
    let tracked: string[] = [];
    try {
      tracked = execSync('git ls-files', { encoding: 'utf-8' }).trim().split(/\r?\n/).filter(Boolean);
    } catch {
      tracked = [];
    }
    for (const file of tracked) {
      expect(file).not.toMatch(/_Spec\.md$|^CzechMate_Next_Phase\.md$|\.xlsx$|^CzechMate_備份_.*\.json$|^資料整理\//);
    }

    const prodFiles = [...walkFiles('src'), ...walkFiles('public')].filter(f => !f.endsWith('.test.ts') && /\.(ts|tsx|gs|html|json|csv)$/.test(f));
    for (const file of prodFiles) {
      const content = readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/https:\/\/script\.google\.com\/macros\/s\/AKfy[\w-]+\/exec/);
    }
  });
});
