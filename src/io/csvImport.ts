import Papa from 'papaparse';
import { RESOURCE_TYPE_LABEL, STAGE_LABEL, type ResourceType, type Stage } from '../domain/constants';
import type { Resource } from '../db/schema';

// Resource CSV import: requirements spec 6.1.

export const CSV_COLUMNS = ['標題', '類型', '階段', '網址', '內容', '標籤', '圖片檔名', '釘選'] as const;

const TYPE_BY_LABEL = Object.fromEntries(Object.entries(RESOURCE_TYPE_LABEL).map(([k, v]) => [v.toLowerCase(), k])) as Record<string, ResourceType>;
const STAGE_BY_LABEL = Object.fromEntries(Object.entries(STAGE_LABEL).map(([k, v]) => [v, k])) as Record<string, Stage>;

export interface ImportDraft {
  /** 1-based row number in the file, counting the header as row 1. */
  line: number;
  title: string;
  type: ResourceType;
  stage: Stage;
  url: string;
  content: string;
  tags: string[];
  imageNames: string[];
  pinned: boolean;
  duplicateOf?: string;
  warnings: string[];
}

export interface ImportPreview {
  drafts: ImportDraft[];
  errors: { line: number; message: string }[];
  unknownColumns: string[];
  missingImages: string[];
}

export const normalizeUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
export const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());
export const splitTags = (s: string) => [...new Set(s.split(/[;；]/).map(t => t.trim()).filter(Boolean))];

export function parseResourceCsv(text: string, existing: Pick<Resource, 'id' | 'title' | 'url'>[], imageFileNames: string[] = []): ImportPreview {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() });
  const fields = result.meta.fields ?? [];
  const errors: ImportPreview['errors'] = [];
  if (!fields.includes('標題')) {
    return { drafts: [], errors: [{ line: 1, message: '找不到「標題」欄位。請確認第一列是欄位名稱，並存成 CSV UTF-8。' }], unknownColumns: [], missingImages: [] };
  }
  const unknownColumns = fields.filter(f => f && !(CSV_COLUMNS as readonly string[]).includes(f));

  const byUrl = new Map(existing.filter(r => r.url).map(r => [normalizeUrl(r.url), r.id]));
  const byTitle = new Map(existing.map(r => [r.title.trim(), r.id]));
  const files = new Map(imageFileNames.map(n => [n.toLowerCase(), n]));
  const missingImages = new Set<string>();
  const drafts: ImportDraft[] = [];

  result.data.forEach((row, i) => {
    const line = i + 2;
    const get = (k: string) => (row[k] ?? '').trim();
    const title = get('標題');
    if (!title) return errors.push({ line, message: '標題是空白的。' });
    const warnings: string[] = [];

    const typeRaw = get('類型');
    const type = typeRaw ? TYPE_BY_LABEL[typeRaw.toLowerCase()] : 'note';
    if (!type) return errors.push({ line, message: `類型「${typeRaw}」不在清單中（筆記、Dcard、網站、截圖、文件）。` });

    const stageRaw = get('階段');
    const stage = stageRaw ? STAGE_BY_LABEL[stageRaw] : 'any';
    if (!stage) return errors.push({ line, message: `階段「${stageRaw}」不在清單中（出發前、抵達後、旅遊、不分）。` });

    const url = get('網址');
    if (url && !isHttpUrl(url)) return errors.push({ line, message: '網址需要以 http:// 或 https:// 開頭。' });

    const pinRaw = get('釘選');
    let pinned = pinRaw === '是';
    if (pinRaw && !pinned) warnings.push(`釘選欄「${pinRaw}」只接受「是」，已當作不釘選。`);
    if (pinned && !url) {
      pinned = false;
      warnings.push('沒有網址，無法釘選到首頁。');
    }

    const imageNames: string[] = [];
    for (const name of splitTags(get('圖片檔名'))) {
      const found = files.get(name.toLowerCase());
      if (found) imageNames.push(found);
      else {
        missingImages.add(name);
        warnings.push(`找不到圖片 ${name}。`);
      }
    }
    if (imageNames.length > 5) {
      warnings.push('每筆最多 5 張圖片，只匯入前 5 張。');
      imageNames.length = 5;
    }

    const duplicateOf = (url && byUrl.get(normalizeUrl(url))) || (!url ? byTitle.get(title) : undefined);
    const draft: ImportDraft = { line, title, type, stage, url, content: row['內容'] ?? '', tags: splitTags(get('標籤')), imageNames, pinned, duplicateOf, warnings };
    drafts.push(draft);
    // Later rows in the same file also count as duplicates of earlier ones.
    if (url) byUrl.set(normalizeUrl(url), `row-${line}`);
    else byTitle.set(title, `row-${line}`);
  });

  for (const e of result.errors) {
    if (e.code !== 'UndetectableDelimiter') errors.push({ line: (e.row ?? 0) + 2, message: `CSV 格式有誤：${e.message}` });
  }
  return { drafts, errors, unknownColumns, missingImages: [...missingImages] };
}
