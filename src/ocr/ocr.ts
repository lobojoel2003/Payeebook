import type { Worker } from 'tesseract.js';
import { parseReceiptText, type ReceiptFields } from '../core/receipt';

/**
 * On-device receipt OCR with Tesseract (WebAssembly in a Web Worker). The
 * engine and English model are served from this app (public/vendor), so the
 * receipt image never leaves the device.
 */
let workerPromise: Promise<Worker> | null = null;
let progressListener: ((progress: number, status: string) => void) | null = null;

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

async function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: assetUrl('vendor/tesseract/worker.min.js'),
      corePath: assetUrl('vendor/tesseract/core'),
      langPath: assetUrl('vendor/tesseract/lang'),
      gzip: true,
      logger: (m: { status: string; progress: number }) => progressListener?.(m.progress, m.status),
    });
  })().catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

export interface OcrResult extends ReceiptFields {
  text: string;
  confidence: number;
}

export async function readReceipt(
  image: Blob,
  onProgress?: (progress: number, status: string) => void,
): Promise<OcrResult> {
  progressListener = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    const fields = parseReceiptText(data.text);
    return { ...fields, text: data.text, confidence: data.confidence };
  } finally {
    progressListener = null;
  }
}

export async function stopOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
