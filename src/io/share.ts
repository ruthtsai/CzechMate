// Hand a generated file to the user: the iOS share sheet when available (save to Files, AirDrop…),
// otherwise a normal download.
//
// Safari only opens the share sheet shortly after a tap. When building the file took too long, the share is
// refused ('needs-tap'); the caller then shows a button so one more tap can share the ready file.
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled' | 'needs-tap'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-tap';
      // anything else: fall through to a download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export const fileSize = (f: Blob) => (f.size < 1024 * 1024 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`);
