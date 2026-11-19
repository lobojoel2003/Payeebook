import { parseDate, todayISO, diffDays, type ISODate } from './dates';
import { parseMoney } from './money';

export interface ReceiptFields {
  total: number | null;
  date: ISODate | null;
  merchant: string | null;
}

const AMOUNT_RE = /(?:\$\s?)?(-?\d{1,3}(?:[,]\d{3})+|-?\d+)\s?[.,]\s?(\d{2})(?!\d)/g;

const TOTAL_KEYWORDS: [RegExp, number][] = [
  [
    /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*paid|total\s*paid|total\s*charged?)\b/i,
    5,
  ],
  [/\b(total|tota1|t0tal|totai)\b/i, 4],
  [
    /\b(visa|mastercard|debit|credit|amex|discover|ebt|card)\s*(tend|tendered|sale|purchase|charge)?\b/i,
    2,
  ],
  [/\b(amount|amt|paid)\b/i, 1],
];
const NOT_TOTAL =
  /\b(sub\s*-?\s*total|subtotal|savings|saved|you\s*saved|discount|tax|items?\s*sold|total\s*items|change|cash\s*back|tip\s*suggest|points|rewards)\b/i;

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const v = parseMoney(`${m[1]}.${m[2]}`);
    if (v !== null && Math.abs(v) < 10_000_000) out.push(Math.abs(v));
  }
  return out;
}

export function findTotal(text: string): number | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let best: { score: number; value: number } | null = null;
  lines.forEach((line, i) => {
    if (NOT_TOTAL.test(line)) return;
    for (const [re, score] of TOTAL_KEYWORDS) {
      if (!re.test(line)) continue;
      let values = amountsIn(line);
      if (values.length === 0 && i + 1 < lines.length && !NOT_TOTAL.test(lines[i + 1])) {
        values = amountsIn(lines[i + 1]);
      }
      if (values.length === 0) continue;
      const value = values[values.length - 1];
      if (!best || score > best.score || (score === best.score && value > best.value)) {
        best = { score, value };
      }
      break;
    }
  });
  if (best) return (best as { value: number }).value;

  // Fallback: the largest amount that is not cash tendered or change.
  let max: number | null = null;
  for (const line of lines) {
    if (/\b(cash|change|tendered)\b/i.test(line)) continue;
    for (const v of amountsIn(line)) if (max === null || v > max) max = v;
  }
  return max;
}

const DATE_CANDIDATES = [
  /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/g,
  /\b(\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/g,
  /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4})\b/gi,
  /\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4})\b/gi,
];

export function findDate(text: string, today: ISODate = todayISO()): ISODate | null {
  const found: ISODate[] = [];
  for (const re of DATE_CANDIDATES) {
    for (const m of text.matchAll(re)) {
      const d = parseDate(m[1]);
      if (d) found.push(d);
    }
  }
  // Prefer plausible receipt dates: not in the future, not older than 5 years.
  const plausible = found.filter((d) => {
    const age = diffDays(d, today);
    return age >= -1 && age <= 5 * 366;
  });
  return plausible[0] ?? found[0] ?? null;
}

const MERCHANT_SKIP =
  /\b(receipt|welcome|thank|store\s*#|cashier|register|terminal|tel|phone|www\.|http|\.com|invoice|order|copy|customer|transaction|date|time)\b/i;
const ADDRESS =
  /\d+\s+\w+\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|hwy|highway|pkwy|way|ct|suite|ste)\b/i;

export function findMerchant(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const line of lines) {
    const letters = (line.match(/[a-z]/gi) ?? []).length;
    if (letters < 3) continue;
    if (letters / line.length < 0.5) continue;
    if (MERCHANT_SKIP.test(line) || ADDRESS.test(line)) continue;
    const cleaned = line
      .replace(/[^A-Za-z0-9&'.\- ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3) continue;
    return cleaned
      .toLowerCase()
      .split(' ')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ')
      .slice(0, 60);
  }
  return null;
}

export function parseReceiptText(text: string, today?: ISODate): ReceiptFields {
  return { total: findTotal(text), date: findDate(text, today), merchant: findMerchant(text) };
}

export interface MatchCandidate {
  id: string;
  date: ISODate;
  amount: number;
  payee: string;
  hasReceipt: boolean;
}

/**
 * Rank transactions that a receipt could belong to: same amount (money out)
 * within a week of the receipt date, with an exact day and a name match
 * scoring higher.
 */
export function rankMatches(fields: ReceiptFields, txs: MatchCandidate[]): MatchCandidate[] {
  if (fields.total === null) return [];
  const scored: { tx: MatchCandidate; score: number }[] = [];
  for (const tx of txs) {
    if (Math.abs(tx.amount) !== fields.total) continue;
    let score = 10;
    if (fields.date) {
      const gap = Math.abs(diffDays(fields.date, tx.date));
      if (gap > 7) continue;
      score += 7 - gap;
    }
    if (fields.merchant) {
      const word = fields.merchant.split(' ')[0]?.toUpperCase();
      if (word && word.length > 2 && tx.payee.toUpperCase().includes(word)) score += 5;
    }
    if (!tx.hasReceipt) score += 2;
    scored.push({ tx, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.tx);
}
