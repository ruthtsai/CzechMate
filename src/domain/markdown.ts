// Plain-text Markdown helpers for previews, search and the handbook index. Rendering to HTML lives in
// markdownRender.ts, which pulls in markdown-it and DOMPurify and is loaded only when content is shown.

/** HackMD-only syntax that has no meaning here. */
export function cleanHackmd(src: string): string {
  return src
    .replace(/\[color=[^\]]*\]/gi, '')
    .replace(/\{%\s*(youtube|vimeo|gist|slideshare|speakerdeck|pdf|hackmd)[^%]*%\}/gi, '')
    .replace(/^\s*\[TOC\]\s*$/gim, '')
    .replace(/^.*<!DOCTYPE[^>]*>.*$/gim, '') // pasted whole HTML pages: the doctype line is noise
    .replace(/(!\[[^\]]*\]\(\S+?)\s+=[\d.%]*x?[\d.%]*\)/g, '$1)') // HackMD image size: ![](url =50%x)
    .replace(/^---\s*\n(?:[\w-]+:.*\n)+---\s*\n/, ''); // front matter
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
