import scriptSource from './appsScript.gs?raw';
import type { SheetData } from './exportRows';

// Talks to the user's Apps Script web app (requirements spec 6.6 and 6.7).
// The URL and secret live only in the phone's settings; nothing here is sent anywhere else.

export const PROTOCOL = 1;

export type SheetsErrorCode = 'secret' | 'protocol' | 'busy' | 'exception' | 'network' | 'config' | 'wouldErase';

export class SheetsError extends Error {
  constructor(public code: SheetsErrorCode, message: string) {
    super(message);
  }
}

export interface SheetsConfig { url: string; secret: string }

const SECRET_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateSecret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(b => SECRET_CHARS[b % SECRET_CHARS.length]).join('');
}

export const DEFAULT_IMAGE_FOLDER = 'CzechMate 圖片';

/** Cleans a folder path typed by the user: "我的雲端硬碟/" prefix, extra slashes and spaces removed. */
export function normalizeFolderPath(path: string): string {
  return path
    .replace(/^\s*(我的雲端硬碟|My Drive)\s*\//i, '')
    .split('/')
    .map(p => p.trim())
    .filter(Boolean)
    .join('/') || DEFAULT_IMAGE_FOLDER;
}

/** The script to paste into the spreadsheet, with this phone's secret and image folder filled in. */
export const buildAppsScript = (secret: string, imageFolder = DEFAULT_IMAGE_FOLDER) =>
  scriptSource
    .replace('__CZECHMATE_SECRET__', () => secret.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
    // The path goes inside a single-quoted string in the script.
    .replace('__CZECHMATE_IMAGE_FOLDER__', () => normalizeFolderPath(imageFolder).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

export const isScriptUrl = (url: string) => /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]+\/exec$/.test(url.trim());

type Fetch = typeof fetch;

export async function callScript<T extends object>(cfg: SheetsConfig, action: string, payload: object = {}, fetchImpl: Fetch = fetch): Promise<T> {
  if (!isScriptUrl(cfg.url) || !cfg.secret) throw new SheetsError('config', '尚未設定 Google 試算表連結。');
  let res: Response;
  try {
    // text/plain keeps this a "simple" request, so the browser sends no CORS preflight that Apps Script cannot answer.
    res = await fetchImpl(cfg.url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ app: 'CzechMate', protocol: PROTOCOL, secret: cfg.secret, action, sentAt: new Date().toISOString(), ...payload }),
      redirect: 'follow'
    });
  } catch {
    throw new SheetsError('network', '無法連線到 Google，請確認網路。');
  }
  const text = await res.text();
  let data: { ok?: boolean; error?: SheetsErrorCode; message?: string };
  try {
    data = JSON.parse(text);
  } catch {
    // An HTML page usually means the deployment is not set to "Anyone" or the URL is wrong.
    throw new SheetsError('config', '腳本網址沒有回應正確的資料。請確認部署的存取權是「任何人」，並使用 /exec 結尾的網址。');
  }
  if (!data.ok) throw new SheetsError(data.error ?? 'exception', data.message ?? '同步失敗。');
  return data as T;
}

export interface PingResult { spreadsheetUrl: string; name: string; resourcesGid: number; imageFolder?: string; features?: string[] }
export const ping = (cfg: SheetsConfig, f?: Fetch) => callScript<PingResult>(cfg, 'ping', {}, f);

/** Full ledger records kept in the sheet's hidden _記帳原始資料 tab, so a phone can restore from it. */
export interface RawLedger {
  expenses: unknown[]; exchanges: unknown[]; trips: unknown[]; paymentMethods: unknown[]; categories: unknown[];
  settings: { key: string; value: unknown }[];
}
export type RawCounts = Record<keyof RawLedger, number>;

/** `allowEmpty` tells the script this phone emptied its ledger on purpose. */
export const pushLedger = (cfg: SheetsConfig, sheets: SheetData[], raw?: RawLedger, allowEmpty = false, f?: Fetch) =>
  callScript<{ syncedAt: string; sheets: number; rawSaved?: boolean }>(cfg, 'sync', { sheets, raw, allowEmpty }, f);

export const getLedger = (cfg: SheetsConfig, f?: Fetch) =>
  callScript<{ tables: RawLedger | null; syncedAt: string; counts: RawCounts }>(cfg, 'getLedger', {}, f);

export interface SheetRow { row: number; values: Record<string, string> }
export const getResources = (cfg: SheetsConfig, f?: Fetch) =>
  callScript<{ rows: SheetRow[]; spreadsheetUrl: string; resourcesGid: number }>(cfg, 'getResources', {}, f);

export const appendResource = (cfg: SheetsConfig, resource: Record<string, string>, f?: Fetch) =>
  callScript<{ id: string; row: number; existed?: boolean }>(cfg, 'appendResource', { resource }, f);

export const uploadImage = (cfg: SheetsConfig, name: string, mime: string, base64: string, f?: Fetch) =>
  callScript<{ name: string; id: string; modified: string }>(cfg, 'uploadImage', { name, mime, base64 }, f);

export interface RemoteImage { name: string; id?: string; modified?: string; mime?: string; base64?: string; missing?: boolean; unchanged?: boolean }
export const getImages = (cfg: SheetsConfig, names: string[], known: Record<string, { id: string; modified: string }>, f?: Fetch) =>
  callScript<{ images: RemoteImage[] }>(cfg, 'getImages', { names, known }, f);

/** Link that opens the 資源 sheet at a row. */
export const sheetRowLink = (spreadsheetUrl: string, gid: number, row: number) =>
  /^https:\/\/docs\.google\.com\/spreadsheets\//.test(spreadsheetUrl)
    ? `${spreadsheetUrl.replace(/\/edit.*$/, '')}/edit#gid=${Number(gid)}&range=A${Number(row)}`
    : '';
