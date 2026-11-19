import { formatDate } from '../core/dates';
import { formatAmountPlain, formatMoney } from '../core/money';
import type { CategoryIndex } from '../core/categories';
import { BRAND, MUTED, PAGE, RULE, TINT, Writer } from './writer';
import type { BuildInfo } from './report';

export interface LedgerRow {
  date: string;
  payee: string;
  memo: string;
  category: string | null;
  account_name: string;
  amount: number;
  balance: number;
  receipt_count: number;
  check_number: string;
}

/** A printable register of transactions with running balance, for families and attorneys. */
export async function renderLedgerPdf(opts: {
  title: string;
  subtitle: string;
  rows: LedgerRow[];
  categories: CategoryIndex;
  generatedOn: string;
  build: BuildInfo;
}): Promise<Uint8Array> {
  const w = await Writer.create(opts.title);
  w.text(opts.title, PAGE.margin, w.y - 18, { size: 16, font: w.fonts.bold, color: BRAND });
  w.text(opts.subtitle, PAGE.margin, w.y - 34, { size: 9.5, color: MUTED });
  w.y -= 50;
  const cols = {
    date: PAGE.margin,
    payee: PAGE.margin + 58,
    cat: PAGE.margin + 250,
    amount: PAGE.width - PAGE.margin - 78,
    balance: PAGE.width - PAGE.margin,
  };
  const header = () => {
    w.page.drawRectangle({
      x: PAGE.margin - 4,
      y: w.y - 15,
      width: w.contentWidth + 8,
      height: 16,
      color: TINT,
    });
    w.text('DATE', cols.date, w.y - 10.5, { size: 6.8, font: w.fonts.bold, color: MUTED });
    w.text('PAYEE / MEMO', cols.payee, w.y - 10.5, { size: 6.8, font: w.fonts.bold, color: MUTED });
    w.text('CATEGORY / ACCOUNT', cols.cat, w.y - 10.5, {
      size: 6.8,
      font: w.fonts.bold,
      color: MUTED,
    });
    w.textRight('AMOUNT', cols.amount, w.y - 10.5, { size: 6.8, font: w.fonts.bold, color: MUTED });
    w.textRight('BALANCE', cols.balance, w.y - 10.5, {
      size: 6.8,
      font: w.fonts.bold,
      color: MUTED,
    });
    w.y -= 20;
  };
  header();
  let inflow = 0;
  let outflow = 0;
  for (const r of [...opts.rows].reverse()) {
    if (w.y < PAGE.margin + 50) {
      w.newPage();
      header();
    }
    if (r.amount > 0) inflow += r.amount;
    else outflow -= r.amount;
    w.text(formatDate(r.date, 'us'), cols.date, w.y - 9, { size: 8.5 });
    w.text(
      w.wrap(
        r.payee +
          (r.check_number ? ` #${r.check_number}` : '') +
          (r.receipt_count ? '  [receipt]' : ''),
        8.5,
        186,
      )[0] ?? '',
      cols.payee,
      w.y - 9,
      { size: 8.5 },
    );
    if (r.memo)
      w.text(w.wrap(r.memo, 7.5, 186)[0] ?? '', cols.payee, w.y - 19, { size: 7.5, color: MUTED });
    w.text(w.wrap(opts.categories.label(r.category), 8.5, 120)[0] ?? '', cols.cat, w.y - 9, {
      size: 8.5,
    });
    w.text(w.wrap(r.account_name, 7.5, 120)[0] ?? '', cols.cat, w.y - 19, {
      size: 7.5,
      color: MUTED,
    });
    w.textRight(formatAmountPlain(r.amount), cols.amount, w.y - 9, { size: 8.5 });
    w.textRight(formatAmountPlain(r.balance), cols.balance, w.y - 9, { size: 8.5, color: MUTED });
    w.y -= 24;
    w.page.drawLine({
      start: { x: PAGE.margin, y: w.y + 3 },
      end: { x: PAGE.width - PAGE.margin, y: w.y + 3 },
      thickness: 0.3,
      color: RULE,
    });
  }
  w.ensure(40);
  w.y -= 6;
  w.text(
    `${opts.rows.length} transactions   ·   money in ${formatMoney(inflow)}   ·   money out ${formatMoney(outflow)}`,
    PAGE.margin,
    w.y - 10,
    { size: 9, font: w.fonts.bold },
  );
  w.footer(
    `Payeebook ${opts.build.version} (build ${opts.build.build})  ·  generated ${opts.generatedOn}`,
  );
  return w.doc.save();
}
