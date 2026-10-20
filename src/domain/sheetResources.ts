import type { Resource } from '../db/schema';
import { RESOURCE_TYPE_LABEL, STAGE_LABEL } from './constants';
import { rowToDraft } from '../io/csvImport';

// Pure mapping between 資源 sheet rows and app resources (requirements spec 6.7).

export interface SheetRowIn { row: number; values: Record<string, string> }

export interface PullPlan {
  put: Resource[];
  remove: string[];
  errors: { line: number; message: string }[];
  unchanged: number;
}

const SAME_KEYS = ['title', 'type', 'stage', 'url', 'content', 'tags', 'imageNames', 'pinned', 'pinOrder', 'pinLabel', 'sheetRow'] as const;
const same = (a: Resource, b: Resource) => SAME_KEYS.every(k => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

/**
 * Turns sheet rows into resource records. Rows with errors are skipped and reported; sheet resources whose
 * row is gone are removed; pending app additions are left alone until their row shows up.
 */
export function planPull(rows: SheetRowIn[], existing: Resource[], now = new Date().toISOString()): PullPlan {
  const byId = new Map(existing.map(r => [r.id, r]));
  const seen = new Set<string>();
  const plan: PullPlan = { put: [], remove: [], errors: [], unchanged: 0 };
  for (const { row, values } of rows) {
    const id = (values.ID ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) {
      plan.errors.push({ line: row, message: 'ID 與上面的列重複，請刪除這格讓腳本重新產生。' });
      continue;
    }
    const r = rowToDraft(values, row);
    if (!r.draft) {
      plan.errors.push({ line: row, message: r.error! });
      continue;
    }
    seen.add(id);
    const d = r.draft;
    const old = byId.get(id);
    const next: Resource = {
      id,
      title: d.title,
      type: d.type,
      stage: d.stage,
      url: d.url,
      content: d.content,
      tags: d.tags,
      imageNames: d.imageNames,
      imageIds: old?.imageIds ?? [],
      pinned: d.pinned,
      // Numbered pins keep their number; 是 pins follow the row order after them.
      pinOrder: d.pinned ? d.pinOrder ?? 1000 + row : undefined,
      pinLabel: d.pinLabel,
      source: 'sheet',
      sheetRow: row,
      createdAt: old?.createdAt ?? now,
      updatedAt: old?.updatedAt ?? now
    };
    if (old && old.source === 'sheet' && same(old, next)) plan.unchanged++;
    else plan.put.push({ ...next, updatedAt: now });
  }
  for (const r of existing) if (r.source === 'sheet' && !seen.has(r.id)) plan.remove.push(r.id);
  return plan;
}

/** Sheet row values for a resource added in the app (appendResource). */
export function toSheetValues(r: Resource, imageNames: string[]): Record<string, string> {
  return {
    ID: r.id,
    標題: r.title,
    類型: RESOURCE_TYPE_LABEL[r.type],
    階段: STAGE_LABEL[r.stage],
    網址: r.url,
    內容: r.content,
    標籤: r.tags.join(';'),
    圖片檔名: imageNames.join(';'),
    釘選: r.pinned ? '是' : '',
    常用連結名稱: r.pinLabel ?? ''
  };
}
