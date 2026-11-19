/**
 * Normalise a photo or scan before it is stored: downscale large phone photos,
 * convert to JPEG (so every receipt can be embedded in a PDF), and make a
 * small thumbnail for the receipt gallery.
 */
export interface PreparedImage {
  data: Uint8Array;
  mime: 'image/jpeg' | 'application/pdf' | 'image/png';
  thumb: Uint8Array | null;
  width: number;
  height: number;
}

async function canvasToBytes(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Uint8Array> {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob>((resolve, reject) =>
          (canvas as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
            type,
            quality,
          ),
        );
  return new Uint8Array(await blob.arrayBuffer());
}

function draw(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareReceiptFile(file: Blob): Promise<PreparedImage> {
  if (file.type === 'application/pdf') {
    return {
      data: new Uint8Array(await file.arrayBuffer()),
      mime: 'application/pdf',
      thumb: null,
      width: 0,
      height: 0,
    };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image format could not be read. Try a JPEG or PNG photo, or a PDF.');
  }
  try {
    const full = draw(bitmap, 2000);
    const thumb = draw(bitmap, 360);
    return {
      data: await canvasToBytes(full, 'image/jpeg', 0.85),
      mime: 'image/jpeg',
      thumb: await canvasToBytes(thumb, 'image/jpeg', 0.7),
      width: full.width,
      height: full.height,
    };
  } finally {
    bitmap.close();
  }
}

export function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
}
