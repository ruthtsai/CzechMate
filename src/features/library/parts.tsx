import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { db } from '../../db';
import type { Resource } from '../../db/schema';
import { RESOURCE_TYPE_LABEL, STAGE_LABEL, type ResourceType } from '../../domain/constants';
import { slashDate } from '../../domain/dates';
import { highlight, snippet } from '../../domain/search';
import { IconChat, IconFile, IconGlobe, IconImage, IconLink, IconNote, IconPin } from '../../components/Icons';

export const TYPE_ICON: Record<ResourceType, (p: { width?: number }) => ReactNode> = {
  note: IconNote,
  dcard: IconChat,
  web: IconGlobe,
  screenshot: IconImage,
  doc: IconFile
};

export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return <>{highlight(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

/** Object URL for a stored image blob, revoked on unmount. */
export function useImageUrl(id: string | undefined) {
  const image = useLiveQuery(() => (id ? db.images.get(id) : undefined), [id]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!image) return setUrl(undefined);
    const u = URL.createObjectURL(image.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);
  return url;
}

export function StoredImage({ id, className, alt = '' }: { id: string; className?: string; alt?: string }) {
  const url = useImageUrl(id);
  return url ? <img src={url} className={className} alt={alt} /> : <span className={className} aria-hidden="true" />;
}

export const stageChip = (r: Pick<Resource, 'stage'>) => (
  <span className={`chip ${r.stage === 'travel' ? 'travel' : 'green'}`}>{STAGE_LABEL[r.stage]}</span>
);

export function ResourceCard({ r, terms = [], onClick }: { r: Resource; terms?: string[]; onClick: () => void }) {
  const Icon = TYPE_ICON[r.type];
  const preview = terms.length ? snippet(r.content, terms) : r.content.replace(/\s+/g, ' ').trim();
  return (
    <button type="button" className="res" onClick={onClick}>
      <span className="ticon" title={RESOURCE_TYPE_LABEL[r.type]}><Icon /></span>
      <span className="body">
        <span className="t">
          <span><Highlighted text={r.title} terms={terms} /></span>
          {r.url && <IconLink />}
          {r.pinned && <IconPin />}
        </span>
        {preview && <span className="p"><Highlighted text={preview} terms={terms} /></span>}
        <span className="chips">
          {stageChip(r)}
          {r.tags.map(t => <span className="chip" key={t}>#<Highlighted text={t} terms={terms} /></span>)}
          <span className="date num">{slashDate(r.updatedAt.slice(0, 10))}</span>
        </span>
      </span>
      {r.imageIds[0] && <StoredImage id={r.imageIds[0]} className="thumb" />}
    </button>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"'）)】]+)/g;

/** Plain text with URLs turned into links (UI spec 5.7). */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <span key={i}>{p}</span>))}
    </>
  );
}

export function ImageViewer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const url = useImageUrl(id ?? undefined);
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, onClose]);
  if (!id) return null;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="圖片" onClick={onClose}>
      {url && <img src={url} alt="" />}
      <button type="button" aria-label="關閉" onClick={onClose}>✕</button>
    </div>
  );
}
