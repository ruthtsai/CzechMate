// Shrinks a photo or screenshot before storing it (requirements spec 4.3): JPEG, long edge ≤ 1600 px, quality 0.8.

export const MAX_EDGE = 1600;
export const MAX_IMAGES = 5;

export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
}

export function fitWithin(width: number, height: number, max = MAX_EDGE): [number, number] {
  const scale = Math.min(1, max / Math.max(width, height));
  return [Math.round(width * scale), Math.round(height * scale)];
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img>, e.g. for formats createImageBitmap rejects */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

export async function compressImage(file: Blob): Promise<Compressed> {
  const src = await decode(file);
  try {
    const [width, height] = fitWithin(src.width, src.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // transparent PNG areas become white instead of black in JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src.source, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.8));
    return { blob, width, height };
  } finally {
    src.close();
  }
}
