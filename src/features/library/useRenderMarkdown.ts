import { useEffect, useState } from 'react';
import type { renderMarkdown } from '../../domain/markdownRender';

// markdown-it and DOMPurify are fetched the first time content is shown, not at launch.
// The service worker precaches the chunk, so this works offline too.

type Render = typeof renderMarkdown;

let loaded: Render | undefined;
let loading: Promise<Render> | undefined;

function load(): Promise<Render> {
  loading ??= import('../../domain/markdownRender').then(
    m => (loaded = m.renderMarkdown),
    e => {
      loading = undefined; // let the next mount try again
      throw e;
    }
  );
  return loading;
}

/** The Markdown renderer, or undefined while it loads. */
export function useRenderMarkdown(): Render | undefined {
  const [render, setRender] = useState<Render | undefined>(() => loaded);
  useEffect(() => {
    if (render) return;
    let live = true;
    load().then(f => live && setRender(() => f), () => {});
    return () => {
      live = false;
    };
  }, [render]);
  return render;
}
