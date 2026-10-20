import type { HandbookSection } from '../db/schema';
import { stripInline, stripMarkdown } from '../domain/markdown';

// HackMD survival handbook and personal notes: requirements spec 6.4 and 6.4.1.
// Public notes serve their Markdown at `<note url>/download` with CORS enabled, so no server is needed.

const HOST = 'hackmd.io';
const EDIT_PATHS = /\/(edit|publish|both|book|download)$/;

/** Canonical note URL: book page links like `/@u/book/%2F%40u%2Fpage` resolve to `/@u/page`; no hash or query. */
export function canonicalNoteUrl(raw: string, base = `https://${HOST}`): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.hostname !== HOST) return null;
  let path = decodeURIComponent(u.pathname);
  const inner = path.match(/\/(\/@[^/]+\/[^/]+)$/);
  if (inner) path = inner[1];
  path = path.replace(EDIT_PATHS, '').replace(/\/+$/, '');
  if (!path || path === '/') return null;
  return `https://${HOST}${encodeURI(path)}`;
}

export const isHackmdNote = (url: string) => !!url && canonicalNoteUrl(url) !== null;
export const downloadUrl = (url: string) => `${canonicalNoteUrl(url)}/download`;

export interface TocEntry { title: string; url: string }

/** Note links listed in a book's table of contents, in order, without duplicates or the book itself. */
export function parseBookToc(markdown: string, bookUrl: string): TocEntry[] {
  const book = canonicalNoteUrl(bookUrl);
  const seen = new Set<string>();
  const out: TocEntry[] = [];
  for (const m of markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const url = canonicalNoteUrl(m[2]);
    if (!url || url === book || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: m[1].replace(/\*\*/g, '').trim(), url });
  }
  return out;
}

/** HackMD anchors are the heading text with spaces turned into dashes. */
export const headingAnchor = (heading: string) => encodeURIComponent(heading.trim().replace(/\s+/g, '-'));

const ATX = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

export function splitSections(markdown: string, page: TocEntry, sourceId: string, pageIndex: number): HandbookSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const parts: { heading: string; lines: string[] }[] = [{ heading: page.title, lines: [] }];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fence = !fence;
    const next = lines[i + 1] ?? '';
    const atx = !fence && line.match(ATX);
    if (atx && atx[1].length <= 3) {
      parts.push({ heading: atx[2].trim(), lines: [] });
      continue;
    }
    if (!fence && line.trim() && /^\s*(=+|-+)\s*$/.test(next) && !/^\s*[-*+]\s/.test(line) && (next.trim()[0] === '=' || next.trim().length >= 3)) {
      parts.push({ heading: line.trim(), lines: [] });
      i++;
      continue;
    }
    parts.at(-1)!.lines.push(line);
  }
  const slug = page.url.split('/').pop() ?? 'page';
  return parts
    .map((p, i) => ({ heading: stripInline(p.heading), i, text: stripMarkdown(p.lines.join('\n')) }))
    // Tiny sections carry no content; a short preamble is usually just a "back to the book" banner.
    .filter(p => p.text.replace(/\s/g, '').length >= (p.i === 0 && parts.length > 1 ? 40 : 10))
    .map(p => ({
      id: `${sourceId}:${slug}:${p.i}`,
      sourceId,
      pageTitle: page.title,
      pageUrl: page.url,
      heading: p.heading,
      anchor: p.i === 0 ? '' : headingAnchor(p.heading),
      text: p.text,
      order: pageIndex * 1000 + p.i
    }));
}

type Fetch = typeof fetch;

export async function fetchMarkdown(url: string, fetchImpl: Fetch = fetch, timeoutMs = 15_000, retries = 1): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(downloadUrl(url), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error('下載失敗');
}

export interface BookSyncResult {
  sections: HandbookSection[];
  pages: TocEntry[];
  failed: TocEntry[];
  /** Full Markdown of each downloaded page, for reading inside the app. */
  markdown: { url: string; markdown: string }[];
}

/** Downloads a book (or a single note) and splits every page into sections. */
export async function syncBook(
  source: { id: string; url: string; title: string; kind: 'book' | 'note' },
  opts: { fetchImpl?: Fetch; delayMs?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<BookSyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pages =
    source.kind === 'book'
      ? parseBookToc(await fetchMarkdown(source.url, fetchImpl), source.url)
      : [{ title: source.title, url: canonicalNoteUrl(source.url)! }];
  const sections: HandbookSection[] = [];
  const failed: TocEntry[] = [];
  const markdown: BookSyncResult['markdown'] = [];
  for (let i = 0; i < pages.length; i++) {
    opts.onProgress?.(i, pages.length);
    try {
      const md = await fetchMarkdown(pages[i].url, fetchImpl);
      markdown.push({ url: pages[i].url, markdown: md });
      sections.push(...splitSections(md, pages[i], source.id, i));
    } catch {
      failed.push(pages[i]);
    }
    if (opts.delayMs && i < pages.length - 1) await new Promise(r => setTimeout(r, opts.delayMs));
  }
  opts.onProgress?.(pages.length, pages.length);
  return { sections, pages, failed, markdown };
}
