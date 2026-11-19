import type { DemoReceiptSpec } from '../db/demo';
import type { Store } from '../db/store';
import { formatDate } from '../core/dates';

/** Draw a plausible till receipt for the demo book so the receipt features have something to show. */
async function drawReceipt(
  spec: DemoReceiptSpec,
): Promise<{ data: Uint8Array; thumb: Uint8Array }> {
  const width = 420;
  const lines = spec.lines.length;
  const height = 300 + lines * 30;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(spec.merchant.toUpperCase(), width / 2, 24);
  ctx.font = '15px "Courier New", monospace';
  ctx.fillText('Saint Paul, MN', width / 2, 58);
  ctx.fillText(formatDate(spec.date, 'us'), width / 2, 80);
  ctx.textAlign = 'left';
  let y = 124;
  const itemsTotal = spec.lines.reduce((n, [, c]) => n + c, 0);
  const scale = itemsTotal ? spec.amount / itemsTotal : 1;
  let running = 0;
  spec.lines.forEach(([label, cents], i) => {
    const value = i === spec.lines.length - 1 ? spec.amount - running : Math.round(cents * scale);
    running += value;
    ctx.fillText(label.toUpperCase(), 30, y);
    ctx.textAlign = 'right';
    ctx.fillText((value / 100).toFixed(2), width - 30, y);
    ctx.textAlign = 'left';
    y += 30;
  });
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(30, y + 4);
  ctx.lineTo(width - 30, y + 4);
  ctx.stroke();
  ctx.font = 'bold 19px "Courier New", monospace';
  ctx.fillText('TOTAL', 30, y + 18);
  ctx.textAlign = 'right';
  ctx.fillText(`$${(spec.amount / 100).toFixed(2)}`, width - 30, y + 18);
  ctx.textAlign = 'center';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText('DEBIT CARD ****4417', width / 2, y + 62);
  ctx.fillText('THANK YOU', width / 2, y + 86);

  const toBytes = (c: HTMLCanvasElement, q: number) =>
    new Promise<Uint8Array>((resolve, reject) =>
      c.toBlob(
        async (b) =>
          b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('encode failed')),
        'image/jpeg',
        q,
      ),
    );
  const thumb = document.createElement('canvas');
  thumb.width = 180;
  thumb.height = Math.round((height / width) * 180);
  thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return { data: await toBytes(canvas, 0.85), thumb: await toBytes(thumb, 0.7) };
}

export async function addDemoReceipts(store: Store, bookId: string, specs: DemoReceiptSpec[]) {
  for (const spec of specs) {
    const { data, thumb } = await drawReceipt(spec);
    store.addReceipt(bookId, {
      filename: `${spec.merchant.replace(/[^A-Za-z]+/g, '-').toLowerCase()}-${spec.date}.jpg`,
      mime: 'image/jpeg',
      data,
      thumb,
      tx_id: spec.txId,
      ocr_total: spec.amount,
      ocr_date: spec.date,
      ocr_merchant: spec.merchant,
    });
  }
}
