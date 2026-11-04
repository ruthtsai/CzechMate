import { RESOURCE_TYPE_LABEL, STAGE_LABEL, type ResourceType, type Stage } from '../domain/constants';

// Resource CSV import: requirements spec 6.1.

export const CSV_COLUMNS = ['標題', '類型', '階段', '網址', '內容', '標籤', '圖片檔名', '釘選', '常用連結名稱', 'ID'] as const;

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
  /** Explicit order when 釘選 holds a number. */
  pinOrder?: number;
  pinLabel?: string;
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

/**
 * Validates one row (CSV or the 資源 sheet). `matchImage` maps a written file name to an available file,
 * or returns null when it is missing; omit it to accept every name as written (sheet rows).
 * `釘選` accepts 是, or a number giving the order on the home screen.
 */
export function rowToDraft(
  row: Record<string, unknown>,
  line: number,
  matchImage?: (name: string) => string | null
): { draft?: Omit<ImportDraft, 'duplicateOf'>; error?: string; missingImages: string[] } {
  const get = (k: string) => String(row[k] ?? '').trim();
  const missingImages: string[] = [];
  const title = get('標題');
  if (!title) return { error: '標題是空白的。', missingImages };
  const warnings: string[] = [];

  const typeRaw = get('類型');
  const type = typeRaw ? TYPE_BY_LABEL[typeRaw.toLowerCase()] : 'note';
  if (!type) return { error: `類型「${typeRaw}」不在清單中（筆記、Dcard、網站、截圖、文件）。`, missingImages };

  const stageRaw = get('階段');
  const stage = stageRaw ? STAGE_BY_LABEL[stageRaw] : 'any';
  if (!stage) return { error: `階段「${stageRaw}」不在清單中（出發前、抵達後、旅遊、不分）。`, missingImages };

  const url = get('網址');
  if (url && !isHttpUrl(url)) return { error: '網址需要以 http:// 或 https:// 開頭。', missingImages };

  const pinRaw = get('釘選');
  const pinNumber = /^\d+$/.test(pinRaw) ? Number(pinRaw) : undefined;
  let pinned = pinRaw === '是' || (pinNumber !== undefined && pinNumber > 0);
  if (pinRaw && !pinned && pinRaw !== '0') warnings.push(`釘選欄「${pinRaw}」只接受「是」或數字，已當作不釘選。`);
  if (pinned && !url) {
    pinned = false;
    warnings.push('沒有網址，無法釘選到首頁。');
  }

  const imageNames: string[] = [];
  for (const name of splitTags(get('圖片檔名'))) {
    const found = matchImage ? matchImage(name) : name;
    if (found) imageNames.push(found);
    else {
      missingImages.push(name);
      warnings.push(`找不到圖片 ${name}。`);
    }
  }
  if (imageNames.length > 5) {
    warnings.push('每筆最多 5 張圖片，只匯入前 5 張。');
    imageNames.length = 5;
  }

  return {
    draft: {
      line, title, type, stage, url, content: String(row['內容'] ?? ''), tags: splitTags(get('標籤')), imageNames, pinned,
      pinOrder: pinned ? pinNumber : undefined, pinLabel: get('常用連結名稱') || undefined, warnings
    },
    missingImages
  };
}
