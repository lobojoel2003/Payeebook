import Papa from 'papaparse';
import { parseMoney } from './money';
import { parseDate, type DateOrder, type ISODate } from './dates';

export interface CsvMapping {
  /** Number of rows to skip before the header (or data, if hasHeader is false). */
  skipRows: number;
  hasHeader: boolean;
  date: number;
  description: number;
  /** Single signed amount column. */
  amount?: number;
  /** Or separate debit / credit columns. */
  debit?: number;
  credit?: number;
  memo?: number;
  checkNumber?: number;
  balance?: number;
  dateOrder: DateOrder;
  /** Flip signs, for card exports that show purchases as positive numbers. */
  invert: boolean;
}

export interface ParsedRow {
  line: number;
  date: ISODate | null;
  description: string;
  amount: number | null;
  memo: string;
  checkNumber: string;
  balance: number | null;
  errors: string[];
}

export interface CsvParseResult {
  rows: string[][];
  mapping: CsvMapping;
  headers: string[];
  confidence: 'high' | 'medium' | 'low';
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  date: /^(transaction |posted |posting |trans\.? |effective )?date$|^date posted$|^posted on$/i,
  description:
    /^(description|payee|merchant|name|details|transaction description|narrative|original description)$/i,
  amount: /^(amount|transaction amount|amt|net amount|amount \(usd\))$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|debit amount|charges?)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in|credit amount|payments?)$/i,
  memo: /^(memo|notes?|reference|ref|extended description)$/i,
  memoAlt: /^(category|type|transaction type)$/i,
  checkNumber: /^(check|check ?(number|no\.?|#)|chk|cheque|serial)$/i,
  balance: /^(balance|running balance|available balance|ledger balance)$/i,
};

export function readCsv(text: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  });
  return res.data.map((r) => r.map((c) => (c ?? '').trim()));
}

function scoreHeader(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    for (const re of Object.values(HEADER_PATTERNS)) if (re.test(cell.trim())) score++;
  }
  return score;
}

/** Guess whether dates are written month-first or day-first. */
export function guessDateOrder(values: string[]): DateOrder {
  let mdy = 0;
  let dmy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(v.trim());
    if (!m) {
      if (/^\d{4}[-/.]/.test(v.trim())) return 'YMD';
      continue;
    }
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  return dmy > mdy ? 'DMY' : 'MDY';
}

function isDateLike(v: string): boolean {
  return parseDate(v) !== null;
}

function isAmountLike(v: string): boolean {
  return (
    v.trim() !== '' &&
    /\d/.test(v) &&
    parseMoney(v) !== null &&
    !/[a-z]{3,}/i.test(v.replace(/\b(CR|DR|USD)\b/gi, ''))
  );
}

/**
 * Inspect a CSV and propose a column mapping. Works on files with a header row
 * (most banks), files with preamble lines before the header, and headerless
 * exports (for example Wells Fargo) by looking at the cell contents.
 */
export function detectMapping(text: string): CsvParseResult {
  const rows = readCsv(text);
  if (rows.length === 0) throw new Error('The file is empty.');

  // Find a header in the first 15 rows.
  let headerIndex = -1;
  let best = 1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const s = scoreHeader(rows[i]);
    if (s > best) {
      best = s;
      headerIndex = i;
    }
  }

  const mapping: CsvMapping = {
    skipRows: headerIndex >= 0 ? headerIndex : 0,
    hasHeader: headerIndex >= 0,
    date: -1,
    description: -1,
    dateOrder: 'MDY',
    invert: false,
  };

  let headers: string[];
  const dataStart = headerIndex >= 0 ? headerIndex + 1 : 0;
  const sample = rows.slice(dataStart, dataStart + 50);
  const width = Math.max(...rows.slice(dataStart, dataStart + 50).map((r) => r.length), 0);

  if (headerIndex >= 0) {
    headers = rows[headerIndex];
    const found: Record<string, number> = {};
    headers.forEach((h, i) => {
      const cell = h.trim();
      for (const [key, re] of Object.entries(HEADER_PATTERNS)) {
        if (re.test(cell)) {
          if (found[key] === undefined) found[key] = i;
          break;
        }
      }
    });
    if (found.date !== undefined) mapping.date = found.date;
    if (found.description !== undefined) mapping.description = found.description;
    if (found.amount !== undefined) mapping.amount = found.amount;
    else {
      if (found.debit !== undefined) mapping.debit = found.debit;
      if (found.credit !== undefined) mapping.credit = found.credit;
    }
    const memo = found.memo ?? found.memoAlt;
    if (memo !== undefined) mapping.memo = memo;
    if (found.checkNumber !== undefined) mapping.checkNumber = found.checkNumber;
    if (found.balance !== undefined) mapping.balance = found.balance;
  } else {
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  }

  // Fill gaps from the cell contents.
  const colStats = Array.from({ length: width }, (_, i) => {
    const vals = sample.map((r) => r[i] ?? '').filter((v) => v !== '');
    return {
      i,
      dates: vals.filter(isDateLike).length / Math.max(vals.length, 1),
      amounts: vals.filter(isAmountLike).length / Math.max(vals.length, 1),
      textLen:
        vals.reduce((n, v) => n + (/[a-z]/i.test(v) ? v.length : 0), 0) / Math.max(vals.length, 1),
      filled: vals.length,
    };
  });
  const used = () =>
    new Set(
      [
        mapping.date,
        mapping.description,
        mapping.amount,
        mapping.debit,
        mapping.credit,
        mapping.memo,
        mapping.checkNumber,
        mapping.balance,
      ].filter((v): v is number => v !== undefined && v >= 0),
    );
  if (mapping.date < 0) {
    const c = colStats.filter((s) => !used().has(s.i)).sort((a, b) => b.dates - a.dates)[0];
    if (c && c.dates > 0.6) mapping.date = c.i;
  }
  if (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined) {
    const c = colStats
      .filter((s) => !used().has(s.i) && s.dates < 0.5)
      .sort((a, b) => b.amounts - a.amounts)[0];
    if (c && c.amounts > 0.6) mapping.amount = c.i;
  }
  if (mapping.description < 0) {
    const c = colStats.filter((s) => !used().has(s.i)).sort((a, b) => b.textLen - a.textLen)[0];
    if (c) mapping.description = c.i;
  }

  if (mapping.date >= 0)
    mapping.dateOrder = guessDateOrder(sample.map((r) => r[mapping.date] ?? ''));

  const hasAmount =
    mapping.amount !== undefined || mapping.debit !== undefined || mapping.credit !== undefined;
  const confidence: CsvParseResult['confidence'] =
    mapping.date >= 0 && mapping.description >= 0 && hasAmount
      ? mapping.hasHeader
        ? 'high'
        : 'medium'
      : 'low';

  return { rows, mapping, headers, confidence };
}

/** Header signature used to remember a mapping for the next file from the same bank. */
export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join('|');
}

export function applyMapping(rows: string[][], mapping: CsvMapping): ParsedRow[] {
  const start = mapping.skipRows + (mapping.hasHeader ? 1 : 0);
  const out: ParsedRow[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => c === '')) continue;
    const errors: string[] = [];
    const rawDate = r[mapping.date] ?? '';
    const date = parseDate(rawDate, mapping.dateOrder);
    if (!date) errors.push(`Unreadable date "${rawDate}"`);

    let amount: number | null = null;
    if (mapping.amount !== undefined && mapping.amount >= 0) {
      amount = parseMoney(r[mapping.amount] ?? '');
    } else {
      const debit =
        mapping.debit !== undefined && mapping.debit >= 0
          ? parseMoney(r[mapping.debit] ?? '')
          : null;
      const credit =
        mapping.credit !== undefined && mapping.credit >= 0
          ? parseMoney(r[mapping.credit] ?? '')
          : null;
      if (debit !== null || credit !== null)
        amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
    }
    if (amount === null) errors.push('No amount');
    else if (mapping.invert) amount = -amount;

    const description = (r[mapping.description] ?? '').replace(/\s+/g, ' ').trim();
    if (!description) errors.push('No description');

    out.push({
      line: i + 1,
      date,
      description,
      amount,
      memo: mapping.memo !== undefined && mapping.memo >= 0 ? (r[mapping.memo] ?? '') : '',
      checkNumber:
        mapping.checkNumber !== undefined && mapping.checkNumber >= 0
          ? (r[mapping.checkNumber] ?? '').replace(/\D/g, '')
          : '',
      balance:
        mapping.balance !== undefined && mapping.balance >= 0
          ? parseMoney(r[mapping.balance] ?? '')
          : null,
      errors,
    });
  }
  return out;
}

/** Export transactions back to CSV (for attorneys and spreadsheets). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return Papa.unparse(
    rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    {
      newline: '\r\n',
    },
  );
}
