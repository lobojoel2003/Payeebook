import { PDFDocument, rgb } from 'pdf-lib';
import type { CategoryIndex } from '../core/categories';
import { formatDate } from '../core/dates';
import { formatAmountPlain, formatMoney } from '../core/money';
import type { ReportResult } from '../core/templates/evaluate';
import { BRAND, FAIL, INK, MUTED, PAGE, PASS, RULE, TINT, WARN, Writer } from './writer';
import { winAnsi } from './text';

export interface BuildInfo {
  version: string;
  build: string;
  commit: string;
}

export interface ReceiptFile {
  data: Uint8Array;
  mime: string;
  filename: string;
}

export interface ReportPdfOptions {
  result: ReportResult;
  book: {
    beneficiary_name: string;
    fiduciary_name: string;
    role_label: string;
    case_number?: string | null;
    court?: string | null;
    claim_number?: string | null;
  };
  categories: CategoryIndex;
  receipt: (id: string) => ReceiptFile | undefined;
  includeReceipts: boolean;
  generatedOn: string;
  build: BuildInfo;
}

const STATUS_TEXT: Record<string, string> = {
  verified: 'Template checked against the official form.',
  draft: 'Community draft template. Compare each line with the official form before filing.',
  generic:
    'Standard schedules, not tied to one official form. Use as your court allows, or as the worksheet for its form.',
};

export async function renderReportPdf(opts: ReportPdfOptions): Promise<Uint8Array> {
  const { result, book } = opts;
  const t = result.template;
  const shortTitle = `${t.short_name ?? t.name} - ${book.beneficiary_name}`;
  const w = await Writer.create(`${t.name} - ${book.beneficiary_name}`, (wr) => {
    wr.text(shortTitle, PAGE.margin, PAGE.height - PAGE.margin + 18, { size: 8, color: MUTED });
    wr.textRight(
      `${formatDate(result.period.start)} - ${formatDate(result.period.end)}`,
      PAGE.width - PAGE.margin,
      PAGE.height - PAGE.margin + 18,
      { size: 8, color: MUTED },
    );
  });
  w.doc.setSubject(
    `${t.name} for ${formatDate(result.period.start, 'long')} to ${formatDate(result.period.end, 'long')}`,
  );
  w.doc.setKeywords(['payeebook', t.id, t.version]);

  // ---- Title block
  w.page.drawRectangle({
    x: 0,
    y: PAGE.height - 128,
    width: PAGE.width,
    height: 128,
    color: BRAND,
  });
  w.text('PAYEEBOOK', PAGE.margin, PAGE.height - 44, {
    size: 8,
    font: w.fonts.bold,
    color: rgb(0.78, 0.9, 0.85),
  });
  const titleLines = w.wrap(t.name, 18, w.contentWidth, w.fonts.bold);
  titleLines.slice(0, 2).forEach((line, i) =>
    w.text(line, PAGE.margin, PAGE.height - 70 - i * 22, {
      size: 18,
      font: w.fonts.bold,
      color: rgb(1, 1, 1),
    }),
  );
  w.text(
    `${formatDate(result.period.start, 'long')} through ${formatDate(result.period.end, 'long')}`,
    PAGE.margin,
    PAGE.height - 70 - titleLines.slice(0, 2).length * 22 - 2,
    {
      size: 10.5,
      color: rgb(0.88, 0.95, 0.92),
    },
  );
  w.y = PAGE.height - 148;

  const info: [string, string][] = [
    ['Beneficiary', book.beneficiary_name],
    [book.role_label, book.fiduciary_name],
  ];
  if (book.case_number) info.push(['Case number', book.case_number]);
  if (book.court) info.push(['Court', book.court]);
  if (book.claim_number) info.push(['Claim number', book.claim_number]);
  info.push(['Prepared', formatDate(opts.generatedOn, 'long')]);
  const colW = w.contentWidth / 2;
  info.forEach(([k, v], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = PAGE.margin + col * colW;
    const y = w.y - row * 30;
    w.text(k.toUpperCase(), x, y - 8, { size: 7, font: w.fonts.bold, color: MUTED });
    w.text(w.wrap(v, 10.5, colW - 12)[0] ?? '', x, y - 21, { size: 10.5 });
  });
  w.y -= Math.ceil(info.length / 2) * 30 + 6;

  // Template status
  const statusColor = t.status === 'draft' ? WARN : t.status === 'verified' ? PASS : MUTED;
  w.ensure(30);
  const statusLines = w.wrap(STATUS_TEXT[t.status] ?? '', 8.5, w.contentWidth - 24);
  const boxH = statusLines.length * 12 + 12;
  w.page.drawRectangle({
    x: PAGE.margin,
    y: w.y - boxH,
    width: w.contentWidth,
    height: boxH,
    color: TINT,
    borderColor: statusColor,
    borderWidth: 0.75,
  });
  statusLines.forEach((l, i) =>
    w.text(l, PAGE.margin + 12, w.y - 16 - i * 12, { size: 8.5, color: INK }),
  );
  w.y -= boxH + 14;

  // ---- Checks
  if (result.checks.length) {
    w.heading('Checks', 11);
    for (const c of result.checks) {
      w.ensure(16);
      const label = c.ok ? 'PASS' : c.severity === 'warning' ? 'CHECK' : 'FAIL';
      const color = c.ok ? PASS : c.severity === 'warning' ? WARN : FAIL;
      w.page.drawRectangle({ x: PAGE.margin, y: w.y - 12, width: 38, height: 13, color });
      w.text(label, PAGE.margin + 19 - w.width(label, 7, w.fonts.bold) / 2, w.y - 8.5, {
        size: 7,
        font: w.fonts.bold,
        color: rgb(1, 1, 1),
      });
      const lines = w.wrap(
        c.label + (c.ok || !c.help ? '' : ` - ${c.help}`),
        9.5,
        w.contentWidth - 50,
      );
      lines.forEach((l, i) => w.text(l, PAGE.margin + 48, w.y - 9.5 - i * 13, { size: 9.5 }));
      w.y -= Math.max(18, lines.length * 13 + 5);
    }
    w.space(6);
  }

  // ---- Sections
  const amountCol = 110;
  for (const s of result.sections) {
    w.heading(s.title, 12);
    if (s.description) w.paragraph(s.description, { size: 9, color: MUTED, gap: 6 });
    for (const line of s.lines) {
      const isMoney = line.format === 'money';
      const valueText = line.display || (isMoney ? formatMoney(0) : '');
      const labelWidth =
        isMoney || valueText.length < 18 ? w.contentWidth - amountCol - 8 : w.contentWidth;
      const font = line.emphasis ? w.fonts.bold : w.fonts.regular;
      const labelLines = w.wrap(line.label, 10, labelWidth, font);
      const valueLines =
        isMoney || valueText.length < 18 ? [valueText] : w.wrap(valueText, 10, w.contentWidth - 16);
      const h =
        isMoney || valueText.length < 18
          ? labelLines.length * 14 + 6
          : (labelLines.length + valueLines.length) * 14 + 6;
      w.ensure(h);
      if (line.emphasis)
        w.page.drawRectangle({
          x: PAGE.margin - 4,
          y: w.y - h + 3,
          width: w.contentWidth + 8,
          height: h,
          color: TINT,
        });
      labelLines.forEach((l, i) => w.text(l, PAGE.margin, w.y - 11 - i * 14, { size: 10, font }));
      if (isMoney || valueText.length < 18) {
        w.textRight(valueText, PAGE.width - PAGE.margin, w.y - 11, {
          size: 10,
          font: line.emphasis ? w.fonts.bold : w.fonts.regular,
        });
      } else {
        valueLines.forEach((l, i) =>
          w.text(l, PAGE.margin + 16, w.y - 11 - (labelLines.length + i) * 14, {
            size: 10,
            color: INK,
          }),
        );
      }
      w.y -= h;
      w.page.drawLine({
        start: { x: PAGE.margin, y: w.y + 2 },
        end: { x: PAGE.width - PAGE.margin, y: w.y + 2 },
        thickness: 0.4,
        color: RULE,
      });
    }
    if (s.total) {
      w.ensure(24);
      w.y -= 4;
      w.page.drawLine({
        start: { x: PAGE.width - PAGE.margin - amountCol, y: w.y },
        end: { x: PAGE.width - PAGE.margin, y: w.y },
        thickness: 1,
        color: INK,
      });
      w.text(s.total.label, PAGE.margin, w.y - 13, { size: 10.5, font: w.fonts.bold });
      w.textRight(s.total.display, PAGE.width - PAGE.margin, w.y - 13, {
        size: 10.5,
        font: w.fonts.bold,
      });
      w.y -= 22;
    }
    w.space(8);
  }

  // ---- Notes, attestation, signatures
  if (result.notes.length) {
    w.heading('Notes', 11);
    for (const n of result.notes) w.paragraph(`•  ${n}`, { size: 9, indent: 4, gap: 3 });
  }
  if (result.attestation || t.signatures?.length) {
    w.heading('Statement', 11);
    if (result.attestation) w.paragraph(result.attestation, { size: 10, gap: 18 });
    for (const sig of t.signatures ?? []) {
      w.ensure(46);
      w.y -= 26;
      w.page.drawLine({
        start: { x: PAGE.margin, y: w.y },
        end: { x: PAGE.margin + 280, y: w.y },
        thickness: 0.75,
        color: INK,
      });
      w.text(sig, PAGE.margin, w.y - 11, { size: 8.5, color: MUTED });
      w.y -= 18;
    }
  }

  // ---- Itemized schedules
  const exhibitByTx = new Map<string, string[]>();
  for (const e of result.exhibits) {
    const list = exhibitByTx.get(e.line.txId) ?? [];
    if (!list.includes(e.number)) list.push(e.number);
    exhibitByTx.set(e.line.txId, list);
  }
  const itemizedSections = result.sections.filter(
    (s) => s.itemized && s.itemized.some((g) => g.items.length || g.rolledUp),
  );
  if (itemizedSections.length) {
    w.newPage();
    w.heading('Itemized schedules', 14);
    w.paragraph(
      'Every transaction behind the totals above, in date order. Receipt numbers refer to the receipts attached at the end.',
      { size: 9, color: MUTED, gap: 8 },
    );
    const cols = {
      date: PAGE.margin,
      payee: PAGE.margin + 62,
      cat: PAGE.margin + 262,
      receipt: PAGE.margin + 392,
      amount: PAGE.width - PAGE.margin,
    };
    const tableHeader = () => {
      w.ensure(30);
      w.page.drawRectangle({
        x: PAGE.margin - 4,
        y: w.y - 15,
        width: w.contentWidth + 8,
        height: 16,
        color: TINT,
      });
      for (const [label, x] of [
        ['DATE', cols.date],
        ['PAID TO / RECEIVED FROM', cols.payee],
        ['CATEGORY / ACCOUNT', cols.cat],
        ['RECEIPT', cols.receipt],
      ] as const)
        w.text(label, x, w.y - 10.5, { size: 6.8, font: w.fonts.bold, color: MUTED });
      w.textRight('AMOUNT', cols.amount, w.y - 10.5, {
        size: 6.8,
        font: w.fonts.bold,
        color: MUTED,
      });
      w.y -= 20;
    };
    for (const s of itemizedSections) {
      w.heading(s.title, 11);
      for (const g of s.itemized!) {
        if (!g.items.length && !g.rolledUp) continue;
        w.ensure(40);
        w.text(g.label, PAGE.margin, w.y - 11, { size: 9.5, font: w.fonts.bold });
        w.y -= 16;
        tableHeader();
        for (const item of g.items) {
          if (w.y < PAGE.margin + 50) {
            w.newPage();
            tableHeader();
          }
          const payee =
            w.wrap(
              item.payee + (item.checkNumber ? ` (check ${item.checkNumber})` : ''),
              8.5,
              192,
            )[0] ?? '';
          const memo = item.memo ? (w.wrap(item.memo, 7.5, 192)[0] ?? '') : '';
          w.text(formatDate(item.date, 'us'), cols.date, w.y - 9, { size: 8.5 });
          w.text(payee, cols.payee, w.y - 9, { size: 8.5 });
          w.text(
            w.wrap(opts.categories.label(item.category), 8.5, 124)[0] ?? '',
            cols.cat,
            w.y - 9,
            { size: 8.5 },
          );
          w.text(w.wrap(item.accountName, 7.5, 124)[0] ?? '', cols.cat, w.y - 19, {
            size: 7.5,
            color: MUTED,
          });
          if (memo) w.text(memo, cols.payee, w.y - 19, { size: 7.5, color: MUTED });
          const ex = exhibitByTx.get(item.txId);
          if (ex)
            w.text(ex.join(', '), cols.receipt, w.y - 9, {
              size: 8.5,
              font: w.fonts.bold,
              color: BRAND,
            });
          w.textRight(formatAmountPlain(item.amount), cols.amount, w.y - 9, { size: 8.5 });
          w.y -= 24;
          w.page.drawLine({
            start: { x: PAGE.margin, y: w.y + 3 },
            end: { x: PAGE.width - PAGE.margin, y: w.y + 3 },
            thickness: 0.3,
            color: RULE,
          });
        }
        if (g.rolledUp) {
          w.ensure(18);
          w.text(`${g.rolledUp.count} smaller transactions, combined`, cols.payee, w.y - 9, {
            size: 8.5,
            font: w.fonts.italic,
            color: MUTED,
          });
          w.textRight(formatAmountPlain(g.rolledUp.amount), cols.amount, w.y - 9, {
            size: 8.5,
            font: w.fonts.italic,
            color: MUTED,
          });
          w.y -= 18;
        }
        w.ensure(18);
        w.text(`Total ${g.label.toLowerCase().slice(0, 70)}`, cols.payee, w.y - 10, {
          size: 8.5,
          font: w.fonts.bold,
        });
        w.textRight(formatMoney(g.total), cols.amount, w.y - 10, { size: 8.5, font: w.fonts.bold });
        w.y -= 24;
      }
    }
  }

  // ---- Receipts
  if (opts.includeReceipts && result.exhibits.length) {
    w.newPage();
    w.heading('Receipts', 14);
    w.paragraph(
      `${result.exhibits.length} receipt${result.exhibits.length === 1 ? '' : 's'} supporting this report, numbered in date order.`,
      { size: 9, color: MUTED, gap: 8 },
    );
    let first = true;
    for (const ex of result.exhibits) {
      const file = opts.receipt(ex.receiptId);
      const caption = `${ex.number}   ${formatDate(ex.line.date, 'long')}   ${ex.line.payee}   ${formatMoney(Math.abs(ex.line.amount))}   ${opts.categories.label(ex.line.category)}`;
      if (!first) w.newPage();
      first = false;
      w.text(caption, PAGE.margin, w.y - 12, { size: 10, font: w.fonts.bold });
      w.text(
        winAnsi(`${ex.line.accountName}${file ? `  -  ${file.filename}` : ''}`),
        PAGE.margin,
        w.y - 26,
        { size: 8, color: MUTED },
      );
      w.y -= 36;
      if (!file) {
        w.paragraph('Receipt file is missing from this book.', { size: 9, color: FAIL });
        continue;
      }
      try {
        if (file.mime === 'application/pdf') {
          const src = await PDFDocument.load(file.data, { ignoreEncryption: true });
          const pages = await w.doc.copyPages(src, src.getPageIndices());
          for (const p of pages) {
            const added = w.doc.addPage(p);
            w.pages.push(added);
            added.drawRectangle({
              x: 0,
              y: added.getHeight() - 22,
              width: added.getWidth(),
              height: 22,
              color: BRAND,
              opacity: 0.9,
            });
            added.drawText(winAnsi(caption), {
              x: 12,
              y: added.getHeight() - 15,
              size: 9,
              font: w.fonts.bold,
              color: rgb(1, 1, 1),
            });
          }
          w.paragraph(
            `Attached as the following ${pages.length} page${pages.length === 1 ? '' : 's'}.`,
            { size: 9, color: MUTED },
          );
          continue;
        }
        const img =
          file.mime === 'image/png'
            ? await w.doc.embedPng(file.data)
            : await w.doc.embedJpg(file.data);
        const maxW = w.contentWidth;
        const maxH = w.y - PAGE.margin - 30;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
        const dw = img.width * scale;
        const dh = img.height * scale;
        w.page.drawRectangle({
          x: PAGE.margin + (maxW - dw) / 2 - 1,
          y: w.y - dh - 1,
          width: dw + 2,
          height: dh + 2,
          borderColor: RULE,
          borderWidth: 1,
        });
        w.page.drawImage(img, {
          x: PAGE.margin + (maxW - dw) / 2,
          y: w.y - dh,
          width: dw,
          height: dh,
        });
        w.y -= dh + 10;
      } catch {
        w.paragraph(`This receipt (${file.mime}) could not be embedded. Print it separately.`, {
          size: 9,
          color: FAIL,
        });
      }
    }
  }

  w.footer(
    `Payeebook ${opts.build.version} (build ${opts.build.build}, ${opts.build.commit})  ·  ${t.id}@${t.version}  ·  generated ${opts.generatedOn}`,
  );
  return w.doc.save();
}
