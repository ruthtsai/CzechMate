import type { HandbookSection, Resource } from '../db/schema';

// Search rules: requirements spec 6.5. Plain substring matching; the data is small and Chinese needs no tokenizer.

/** Lowercase and full-width ASCII to half-width, keeping string length so offsets line up. */
const fold = (s: string) =>
  s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ').toLowerCase();

export const normalize = (s: string) => fold(s).trim();

export const toTerms = (query: string) => normalize(query).split(/\s+/).filter(Boolean);

/** Rank 0 = title hit, 1 = tag hit, 2 = content/URL only; null = not every term matches. `extra` is e.g. a downloaded note. */
export function rankResource(r: Resource, terms: string[], extra = ''): number | null {
  if (!terms.length) return 2;
  const title = normalize(r.title);
  const tags = normalize(r.tags.join(' '));
  const rest = normalize(`${r.content} ${r.url} ${extra}`);
  let best = 2;
  for (const t of terms) {
    if (title.includes(t)) best = Math.min(best, 0);
    else if (tags.includes(t)) best = Math.min(best, 1);
    else if (!rest.includes(t)) return null;
  }
  return best;
}

export function searchResources(list: Resource[], query: string, extra?: (r: Resource) => string): Resource[] {
  const terms = toTerms(query);
  return list
    .map(r => ({ r, rank: rankResource(r, terms, extra?.(r)) }))
    .filter((x): x is { r: Resource; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || (a.r.updatedAt < b.r.updatedAt ? 1 : a.r.updatedAt > b.r.updatedAt ? -1 : 0))
    .map(x => x.r);
}

/** Handbook sections where every term appears; heading hits first, then book order (requirements spec 6.5). */
export function searchSections(sections: HandbookSection[], query: string): HandbookSection[] {
  const terms = toTerms(query);
  if (!terms.length) return [];
  return sections
    .map(s => {
      const head = normalize(`${s.pageTitle} ${s.heading}`);
      const body = normalize(s.text);
      let rank = 1;
      for (const t of terms) {
        if (head.includes(t)) rank = 0;
        else if (!body.includes(t)) return null;
      }
      return { s, rank };
    })
    .filter((x): x is { s: HandbookSection; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank || a.s.sourceId.localeCompare(b.s.sourceId) || a.s.order - b.s.order)
    .map(x => x.s);
}

/** About 60 characters around the first hit, for result previews. */
export function snippet(text: string, terms: string[], radius = 30): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!terms.length) return flat;
  const low = fold(flat);
  let at = -1;
  for (const t of terms) {
    at = low.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) return flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Splits text into plain and matched parts for highlighting. */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!terms.length || !text) return [{ text, hit: false }];
  const low = fold(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    let i = low.indexOf(t);
    while (i >= 0) {
      for (let k = i; k < i + t.length; k++) marks[k] = true;
      i = low.indexOf(t, i + t.length);
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

/** Tags with how many resources use them, most used first. */
export function tagCounts(list: Resource[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of list) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
}
