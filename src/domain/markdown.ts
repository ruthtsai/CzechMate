import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

// Markdown display for resource content and HackMD notes (requirements MD-01).
// HackMD notes may contain raw HTML. It is rendered, then cleaned with DOMPurify: no scripts, styles,
// frames, forms or inline styles survive, and source classes are dropped so they cannot pick up app styles.
// Without a DOM (tests in Node), raw HTML is shown escaped instead.

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
const md = new MarkdownIt({ html: hasDom, linkify: true, breaks: true, typographer: false });

md.renderer.rules.image = (tokens, idx) => {
  const t = tokens[idx];
  const src = md.utils.escapeHtml(t.attrGet('src') ?? '');
  const alt = md.utils.escapeHtml(t.content);
  return `<img src="${src}" alt="${alt}">`;
};

const purifier = hasDom ? DOMPurify(window) : null;
let currentBase: string | undefined;
purifier?.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') {
    let href = node.getAttribute('href') ?? '';
    // Site-relative links (HackMD's `/@user/note`) point at the note's own site, not at this app.
    if (currentBase && href.startsWith('/') && !href.startsWith('//')) {
      href = new URL(href, currentBase).toString();
      node.setAttribute('href', href);
    }
    // In-page anchors stay; everything else opens outside the app.
    if (href && !href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

const PURIFY = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'title', 'base'],
  FORBID_ATTR: ['style', 'class', 'id'],
  ADD_ATTR: ['target']
};

function clean(html: string, base?: string): string {
  if (!purifier) return html;
  currentBase = base;
  try {
    return purifier.sanitize(html, PURIFY) as string;
  } finally {
    currentBase = undefined;
  }
}

const CALLOUT = /^\s*:::\s*(\w+)?/;
const CALLOUT_KINDS = ['info', 'success', 'warning', 'danger', 'spoiler'];
const CALLOUT_END = /^\s*:::\s*$/;

/** HackMD-only syntax that has no meaning here. */
function cleanHackmd(src: string): string {
  return src
    .replace(/\[color=[^\]]*\]/gi, '')
    .replace(/\{%\s*(youtube|vimeo|gist|slideshare|speakerdeck|pdf|hackmd)[^%]*%\}/gi, '')
    .replace(/^\s*\[TOC\]\s*$/gim, '')
    .replace(/^.*<!DOCTYPE[^>]*>.*$/gim, '') // pasted whole HTML pages: the doctype line is noise
    .replace(/(!\[[^\]]*\]\(\S+?)\s+=[\d.%]*x?[\d.%]*\)/g, '$1)') // HackMD image size: ![](url =50%x)
    .replace(/^---\s*\n(?:[\w-]+:.*\n)+---\s*\n/, ''); // front matter
}

/** `base` resolves site-relative links, e.g. `https://hackmd.io` for HackMD notes. */
export function renderMarkdown(src: string, base?: string): string {
  const lines = cleanHackmd(src).split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let kind: string | null = null;
  const flush = () => {
    // Clean each piece before adding our own callout wrapper, whose class must survive.
    const html = clean(md.render(buf.join('\n')), base);
    out.push(kind ? `<div class="callout callout-${kind}">${html}</div>` : html);
    buf = [];
  };
  for (const line of lines) {
    const open: RegExpMatchArray | null = kind === null ? line.match(CALLOUT) : null;
    if (open) {
      flush();
      const k: string = (open[1] ?? '').toLowerCase();
      kind = CALLOUT_KINDS.includes(k) ? k : 'info';
    } else if (kind !== null && CALLOUT_END.test(line)) {
      flush();
      kind = null;
    } else buf.push(line);
  }
  flush();
  return out.join('');
}

/** Inline markup only (links, emphasis, code); for single-line text such as headings, where "2. …" is not a list. */
export function stripInline(src: string): string {
  return src
    .replace(/\[color=[^\]]*\]/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text for previews and search: drops Markdown and HackMD markup, keeps words and link text. */
export function stripMarkdown(src: string): string {
  return cleanHackmd(src)
    // HTML pasted into notes: drop non-text blocks, then the tags themselves
    .replace(/<(style|script|title|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, ''))
    .replace(/^\s*:::.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
