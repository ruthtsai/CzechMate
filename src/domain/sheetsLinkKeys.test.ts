import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_STATE_KEYS, SYNC_PREFERENCE_KEYS } from './sheetsLinkKeys';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe('Google Sheets link settings', () => {
  it('sorts every gs* setting the app uses into exactly one list', () => {
    const used = new Set(files('src').flatMap(f => [...readFileSync(f, 'utf-8').matchAll(/'(gs[A-Z]\w*)'/g)].map(m => m[1])));
    const listed = [...LINK_STATE_KEYS, ...SYNC_PREFERENCE_KEYS] as string[];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...used].filter(k => !listed.includes(k))).toEqual([]);
  });
});
