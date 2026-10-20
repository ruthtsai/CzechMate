import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAppsScript, callScript, generateSecret, isScriptUrl, normalizeFolderPath, sheetRowLink, SheetsError } from './sheetsClient';

/* ---------- a small in-memory stand-in for the Apps Script services ---------- */

class FakeRange {
  constructor(private sh: FakeSheet, private r: number, private c: number, private nr = 1, private nc = 1) {}
  getValues() {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.cells[this.r - 1 + i]?.[this.c - 1 + j] ?? ''));
  }
  setValues(v: unknown[][]) {
    v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x: unknown) { this.sh.set(this.r, this.c, x); return this; }
  setNumberFormat(f: string) { this.sh.formats.push([this.c, f]); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  createFilter() { this.sh.filter = true; return this; }
}

class FakeSheet {
  cells: unknown[][] = [];
  formats: [number, string][] = [];
  filter = false;
  frozen = 0;
  constructor(public name: string, public id: number) {}
  set(r: number, c: number, x: unknown) {
    while (this.cells.length < r) this.cells.push([]);
    this.cells[r - 1][c - 1] = x;
  }
  getSheetId() { return this.id; }
  getRange(r: number, c: number, nr?: number, nc?: number) { return new FakeRange(this, r, c, nr, nc); }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return Math.max(0, ...this.cells.map(r => r.length)); }
  getFilter() { return this.filter ? { remove: () => (this.filter = false) } : null; }
  clear() { this.cells = []; this.formats = []; }
  setFrozenRows(n: number) { this.frozen = n; }
  insertColumnBefore() { this.cells.forEach(r => r.unshift('')); }
  appendRow(row: unknown[]) { this.cells.push([...row]); }
}

function makeEnv(secret: string, imageFolder?: string) {
  const sheets: FakeSheet[] = [new FakeSheet('我的分析', 0)];
  const files: { name: string; id: string; bytes: string; mime: string; folder: string }[] = [];
  const ss = {
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
    getName: () => 'CzechMate 測試',
    getSheetByName: (n: string) => sheets.find(s => s.name === n) ?? null,
    insertSheet: (n: string) => { const s = new FakeSheet(n, sheets.length + 100); sheets.push(s); return s; }
  };
  const iter = <T,>(list: T[]) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const fileObj = (f: (typeof files)[number]) => ({
    getId: () => f.id, getName: () => f.name, getLastUpdated: () => new Date('2027-01-01T00:00:00Z'),
    getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes })
  });
  // Folders form a tree under My Drive; `files` holds the files of whichever folder the script writes to.
  interface FakeFolder { name: string; children: FakeFolder[]; getFoldersByName: (n: string) => unknown; createFolder: (n: string) => FakeFolder; getFilesByName: (n: string) => unknown; getFiles: () => unknown; createFile: (b: { name: string; bytes: string; mime: string }) => unknown }
  const made: string[] = [];
  const makeFolder = (name: string, path: string): FakeFolder => {
    const f: FakeFolder = {
      name,
      children: [],
      getFoldersByName: (n: string) => iter(f.children.filter(c => c.name === n)),
      createFolder: (n: string) => { const c = makeFolder(n, path ? `${path}/${n}` : n); made.push(path ? `${path}/${n}` : n); f.children.push(c); return c; },
      getFilesByName: (n: string) => iter(files.filter(x => x.folder === path && x.name === n).map(fileObj)),
      getFiles: () => iter(files.filter(x => x.folder === path).map(fileObj)),
      createFile: (b: { name: string; bytes: string; mime: string }) => { const x = { ...b, id: `file-${files.length}`, folder: path }; files.push(x); return fileObj(x); }
    };
    return f;
  };
  const root = makeFolder('我的雲端硬碟', '');
  let uuid = 0;
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      base64Decode: (s: string) => `decoded:${s}`,
      base64Encode: (b: string) => `b64:${b}`,
      newBlob: (bytes: string, mime: string, name: string) => ({ bytes, mime, name }),
      formatDate: (d: Date) => d.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Europe/Prague' },
    DriveApp: { getRootFolder: () => root }
  };
  const src = buildAppsScript(secret, imageFolder);
  const api = new Function(...Object.keys(globals), `${src}\nreturn { doPost, doGet };`)(...Object.values(globals)) as {
    doPost: (e: unknown) => { text: string };
    doGet: () => { text: string };
  };
  const post = (body: object) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ app: 'CzechMate', protocol: 1, secret, ...body }) } }).text);
  return { sheets, files, made, root, post, api, sheet: (n: string) => sheets.find(s => s.name === n)! };
}

describe('Apps Script', () => {
  it('ships with a placeholder that the app fills with the secret', () => {
    expect(readFileSync('src/io/appsScript.gs', 'utf-8')).toContain("const SECRET = '__CZECHMATE_SECRET__';");
    expect(buildAppsScript('abc')).toContain("const SECRET = 'abc';");
  });

  it('rejects a wrong secret or protocol without touching the sheet', () => {
    const env = makeEnv('right');
    expect(env.post({ secret: 'wrong', action: 'sync', sheets: [] })).toMatchObject({ ok: false, error: 'secret' });
    expect(env.post({ protocol: 99, action: 'ping' })).toMatchObject({ ok: false, error: 'protocol' });
    expect(env.sheets.map(s => s.name)).toEqual(['我的分析']);
  });

  it('answers ping with the spreadsheet link and creates the 資源 sheet', () => {
    const env = makeEnv('s');
    expect(env.post({ action: 'ping' })).toMatchObject({ ok: true, name: 'CzechMate 測試', spreadsheetUrl: expect.stringContaining('/TEST/') });
    expect(env.sheet('資源').cells[0]).toEqual(['ID', '標題', '類型', '階段', '網址', '內容', '標籤', '圖片檔名', '釘選', '常用連結名稱']);
  });

  it('overwrites only the five ledger sheets, converting dates and setting formats', () => {
    const env = makeEnv('s');
    const sheet = (name: string) => ({ name, columns: [{ header: '日期', type: 'date' }, { header: '金額', type: 'amount' }], rows: [['2027-03-05', 19.9]] });
    env.post({ action: 'sync', sheets: [sheet('支出總表'), sheet('我的分析')] });
    const r = env.post({ action: 'sync', sheets: [sheet('支出總表')] });
    expect(r).toMatchObject({ ok: true, sheets: 1 });
    const s = env.sheet('支出總表');
    expect(s.cells).toHaveLength(2);
    expect(s.cells[1][0]).toBeInstanceOf(Date);
    expect(s.formats).toContainEqual([2, '#,##0.00']);
    expect(s.frozen).toBe(1);
    expect(env.sheet('我的分析').cells).toEqual([]);
  });

  it('fills missing IDs, skips empty rows and returns values by header', () => {
    const env = makeEnv('s');
    env.post({ action: 'ping' });
    const sh = env.sheet('資源');
    sh.appendRow(['', 'KOS', '網站', '抵達後', 'https://kos.cvut.cz', '', '學校', '', '1', 'KOS']);
    sh.appendRow(['', '', '', '', '', '', '', '', '', '']);
    sh.appendRow(['keep-me', '筆記', '', '', '', '內容', '', 'a.png', '', '']);
    const r = env.post({ action: 'getResources' });
    expect(r.rows.map((x: { row: number }) => x.row)).toEqual([2, 4]);
    expect(r.rows[0].values).toMatchObject({ ID: 'uuid-1', 標題: 'KOS', 釘選: '1' });
    expect(sh.cells[1][0]).toBe('uuid-1');
    expect(r.rows[1].values.ID).toBe('keep-me');
  });

  it('appends a resource once even when the request is retried', () => {
    const env = makeEnv('s');
    const res = { ID: 'new-1', 標題: '快速新增', 類型: '筆記' };
    expect(env.post({ action: 'appendResource', resource: res })).toMatchObject({ ok: true, id: 'new-1', row: 2 });
    expect(env.post({ action: 'appendResource', resource: res })).toMatchObject({ ok: true, id: 'new-1', row: 2, existed: true });
    expect(env.sheet('資源').cells).toHaveLength(2);
    expect(env.sheet('資源').cells[1].slice(0, 3)).toEqual(['new-1', '快速新增', '筆記']);
  });

  it('uploads images once and returns only new or changed ones', () => {
    const env = makeEnv('s');
    const up = env.post({ action: 'uploadImage', name: 'a.jpg', mime: 'image/jpeg', base64: 'AAA' });
    expect(up).toMatchObject({ ok: true, name: 'a.jpg', id: 'file-0' });
    env.post({ action: 'uploadImage', name: 'a.jpg', mime: 'image/jpeg', base64: 'AAA' });
    expect(env.files).toHaveLength(1);
    const first = env.post({ action: 'getImages', names: ['A.JPG', 'missing.png'], known: {} });
    expect(first.images[0]).toMatchObject({ name: 'A.JPG', id: 'file-0', base64: 'b64:decoded:AAA' });
    expect(first.images[1]).toEqual({ name: 'missing.png', missing: true });
    const again = env.post({ action: 'getImages', names: ['a.jpg'], known: { 'a.jpg': { id: 'file-0', modified: up.modified } } });
    expect(again.images[0]).toMatchObject({ unchanged: true });
    expect(again.images[0].base64).toBeUndefined();
  });
});

describe('image folder path', () => {
  it('walks the configured path from My Drive, creating missing folders once', () => {
    const env = makeEnv('s', '我的雲端硬碟/2026_CTU交換學生計畫/CzechMate/CzechMate 圖片');
    expect(env.post({ action: 'ping' }).imageFolder).toBe('2026_CTU交換學生計畫/CzechMate/CzechMate 圖片');
    env.post({ action: 'uploadImage', name: 'a.jpg', mime: 'image/jpeg', base64: 'AAA' });
    env.post({ action: 'uploadImage', name: 'b.jpg', mime: 'image/jpeg', base64: 'BBB' });
    expect(env.made).toEqual(['2026_CTU交換學生計畫', '2026_CTU交換學生計畫/CzechMate', '2026_CTU交換學生計畫/CzechMate/CzechMate 圖片']);
    expect(env.files.map(f => f.folder)).toEqual(['2026_CTU交換學生計畫/CzechMate/CzechMate 圖片', '2026_CTU交換學生計畫/CzechMate/CzechMate 圖片']);
    expect(env.post({ action: 'getImages', names: ['b.jpg'], known: {} }).images[0].base64).toBe('b64:decoded:BBB');
  });

  it('defaults to a top-level CzechMate 圖片 folder and escapes quotes', () => {
    expect(makeEnv('s').post({ action: 'ping' }).imageFolder).toBe('CzechMate 圖片');
    expect(buildAppsScript('s', "Tom's/圖片")).toContain("const IMAGE_FOLDER_PATH = 'Tom\\'s/圖片';");
    expect(normalizeFolderPath(' My Drive / a //b ')).toBe('a/b');
    expect(normalizeFolderPath('')).toBe('CzechMate 圖片');
  });
});

describe('sheets client', () => {
  const cfg = { url: 'https://script.google.com/macros/s/AKfy-cb_123/exec', secret: 'sek' };

  it('recognises deployment URLs', () => {
    expect(isScriptUrl(cfg.url)).toBe(true);
    expect(isScriptUrl('https://script.google.com/a/example.com/macros/s/abc/exec')).toBe(true);
    expect(isScriptUrl('https://script.google.com/macros/s/abc/dev')).toBe(false);
    expect(generateSecret()).toMatch(/^[A-Za-z2-9]{32}$/);
  });

  it('posts JSON as text/plain with the secret in the body, never in the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, name: 'x' })));
    await callScript(cfg, 'ping', {}, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(cfg.url);
    expect(url).not.toContain('sek');
    expect((init.headers as Record<string, string>)['Content-Type']).toContain('text/plain');
    expect(JSON.parse(init.body as string)).toMatchObject({ app: 'CzechMate', protocol: 1, secret: 'sek', action: 'ping' });
  });

  it('maps failures to readable errors', async () => {
    const reply = (body: string) => (async () => new Response(body)) as unknown as typeof fetch;
    await expect(callScript(cfg, 'ping', {}, reply('{"ok":false,"error":"secret","message":"同步金鑰不正確。"}'))).rejects.toMatchObject({ code: 'secret' });
    await expect(callScript(cfg, 'ping', {}, reply('<html>Sign in</html>'))).rejects.toMatchObject({ code: 'config' });
    await expect(callScript(cfg, 'ping', {}, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).rejects.toBeInstanceOf(SheetsError);
    await expect(callScript({ url: '', secret: '' }, 'ping')).rejects.toMatchObject({ code: 'config' });
  });

  it('links to a row of the 資源 sheet', () => {
    expect(sheetRowLink('https://docs.google.com/spreadsheets/d/X/edit', 7, 12)).toBe('https://docs.google.com/spreadsheets/d/X/edit#gid=7&range=A12');
  });
});
