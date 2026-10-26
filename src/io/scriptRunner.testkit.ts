import { buildAppsScript, type SheetsConfig } from './sheetsClient';

// Runs the real appsScript.gs against a small in-memory stand-in for the Apps Script services,
// so tests can talk to it either directly (`post`) or through the app's sheets client (`fetch`).

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
  hidden = false;
  setFrozenRows(n: number) { this.frozen = n; }
  hideSheet() { this.hidden = true; }
  insertColumnBefore() { this.cells.forEach(r => r.unshift('')); }
  appendRow(row: unknown[]) { this.cells.push([...row]); }
}

export function makeEnv(secret: string, imageFolder?: string) {
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
  const cache = new Map<string, string>();
  const pages: Record<string, string> = {};
  const fetched: string[] = [];
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { createTextOutput: (t: string) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      // Bytes are kept as binary strings.
      base64Decode: (s: string) => atob(s),
      base64Encode: (b: string) => btoa(b),
      newBlob: (bytes: string, mime: string, name: string) => ({ bytes, mime, name }),
      formatDate: (d: Date) => d.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Europe/Prague' },
    DriveApp: { getRootFolder: () => root },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => void cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ setProperty: () => {} }) },
    UrlFetchApp: {
      fetch: (u: string) => {
        fetched.push(u);
        const page = pages[u];
        return { getResponseCode: () => (page === undefined ? 404 : 200), getContentText: () => page ?? '' };
      }
    }
  };
  const src = buildAppsScript(secret, imageFolder);
  const api = new Function(...Object.keys(globals), `${src}\nreturn { doPost, doGet };`)(...Object.values(globals)) as {
    doPost: (e: unknown) => { text: string };
    doGet: () => { text: string };
  };
  const post = (body: object) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ app: 'CzechMate', protocol: 1, secret, ...body }) } }).text);
  // The web app as the phone reaches it: the request body goes to doPost as is. There is one deployment, so the URL is ignored.
  const fetch = (async (_url: string, init?: RequestInit) =>
    new Response(api.doPost({ postData: { contents: String(init?.body ?? '') } }).text)) as unknown as typeof globalThis.fetch;
  return { sheets, files, made, root, post, fetch, api, pages, fetched, sheet: (n: string) => sheets.find(s => s.name === n)! };
}

/** A fresh script plus the config a phone linked to it would use. */
export function linkedSheet() {
  const env = makeEnv('s');
  const cfg: SheetsConfig = { url: 'https://script.google.com/macros/s/TEST/exec', secret: 's', fetch: env.fetch };
  return { env, cfg };
}
