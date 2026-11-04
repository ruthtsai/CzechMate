import Papa from 'papaparse';
import type { Resource } from '../db/schema';
import { CSV_COLUMNS, rowToDraft, normalizeUrl, type ImportDraft, type ImportPreview } from './csvImport';

// Reading a resource CSV file (requirements spec 6.1). Kept apart from the row rules in csvImport.ts
// so papaparse loads with the import screen, not at launch.

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
    const r = rowToDraft(row, line, name => files.get(name.toLowerCase()) ?? null);
    r.missingImages.forEach(n => missingImages.add(n));
    if (!r.draft) return errors.push({ line, message: r.error! });
    const { url, title } = r.draft;
    const duplicateOf = (url && byUrl.get(normalizeUrl(url))) || (!url ? byTitle.get(title) : undefined);
    drafts.push({ ...r.draft, duplicateOf });
    // Later rows in the same file also count as duplicates of earlier ones.
    if (url) byUrl.set(normalizeUrl(url), `row-${line}`);
    else byTitle.set(title, `row-${line}`);
  });

  for (const e of result.errors) {
    if (e.code !== 'UndetectableDelimiter') errors.push({ line: (e.row ?? 0) + 2, message: `CSV 格式有誤：${e.message}` });
  }
  return { drafts, errors, unknownColumns, missingImages: [...missingImages] };
}
