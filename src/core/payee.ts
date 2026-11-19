/**
 * Bank descriptions are noisy: "POS PURCHASE PUBLIX #1432 TAMPA FL 03/14".
 * normalizePayee() reduces them to a stable key ("PUBLIX TAMPA FL") so a tag
 * applied once can be remembered and reused on every future import.
 */
const NOISE_WORDS = new Set([
  'POS',
  'PURCHASE',
  'DEBIT',
  'CARD',
  'CHECKCARD',
  'CHECK',
  'CRD',
  'VISA',
  'MC',
  'MASTERCARD',
  'RECURRING',
  'PAYMENT',
  'PMT',
  'ACH',
  'WEB',
  'ONLINE',
  'PPD',
  'CCD',
  'ID',
  'TRANSACTION',
  'PREAUTHORIZED',
  'AUTHORIZED',
  'ON',
  'WITHDRAWAL',
  'DEPOSIT',
  'ELECTRONIC',
  'EFT',
  'XFER',
  'SQ',
  'TST',
  'PAYPAL',
  'INST',
  'DES',
  'INDN',
  'CO',
  'ENTRY',
]);

export function normalizePayee(raw: string): string {
  const upper = raw
    .toUpperCase()
    .replace(/[*#]/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // dates
    .replace(/\bX{2,}\d*\b/g, ' ') // masked card numbers
    .replace(/\bX{2,}(?=[A-Z])/g, '') // "XXSOC SEC" masking prefixes
    .replace(/\b[A-Z]*\d[A-Z0-9-]*\b/g, ' ') // store numbers, references, ids
    .replace(/[^A-Z&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = upper.split(' ').filter((w) => w.length > 1 && !NOISE_WORDS.has(w));
  return words.join(' ').trim() || upper || raw.trim().toUpperCase();
}

const ACRONYMS = new Set([
  'SSA',
  'SSI',
  'IRS',
  'CVS',
  'ATM',
  'USPS',
  'LLC',
  'HOA',
  'DMV',
  'UPS',
  'AT&T',
  'IGA',
  'BP',
  'VA',
  'US',
  'USA',
  'TJ',
  'HEB',
  'QT',
]);

/** Turn a bank description into a readable display name: "Publix Tampa FL". */
export function prettyPayee(raw: string): string {
  const key = normalizePayee(raw);
  return key
    .split(' ')
    .map((w) => (w.length <= 2 || ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

export type RuleDirection = 'any' | 'in' | 'out';

export interface PayeeRule {
  id: string;
  pattern: string; // already normalized
  category: string;
  direction: RuleDirection;
  hits?: number;
}

/** Longest matching pattern wins, so "PUBLIX PHARMACY" can override "PUBLIX". */
export function matchRule<R extends PayeeRule>(
  rules: R[],
  payee: string,
  amount: number,
): R | undefined {
  const key = normalizePayee(payee);
  const padded = ` ${key} `;
  let best: R | undefined;
  for (const rule of rules) {
    if (rule.direction === 'in' && amount < 0) continue;
    if (rule.direction === 'out' && amount > 0) continue;
    const pattern = normalizePayee(rule.pattern);
    if (!pattern) continue;
    if (padded.includes(` ${pattern} `) || key === pattern) {
      if (!best || pattern.length > normalizePayee(best.pattern).length) best = rule;
    }
  }
  return best;
}

/**
 * Suggest a short pattern for a new rule: the first two meaningful words are
 * usually the merchant ("PUBLIX", "DUKE ENERGY"), while trailing city/state
 * words vary between branches.
 */
export function suggestPattern(payee: string): string {
  const words = normalizePayee(payee).split(' ');
  const US_STATES =
    /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/;
  const trimmed = [...words];
  while (trimmed.length > 1 && US_STATES.test(trimmed[trimmed.length - 1])) trimmed.pop();
  return trimmed.slice(0, Math.min(2, trimmed.length)).join(' ');
}

/** Rules seeded into every new book. They are ordinary rules the user can delete. */
export const DEFAULT_RULES: Omit<PayeeRule, 'id'>[] = [
  { pattern: 'SOC SEC', category: 'benefits_ssa', direction: 'in' },
  { pattern: 'SSA TREAS', category: 'benefits_ssa', direction: 'in' },
  { pattern: 'SUPP SEC', category: 'benefits_ssi', direction: 'in' },
  { pattern: 'SSI TREAS', category: 'benefits_ssi', direction: 'in' },
  { pattern: 'VA BENEFIT', category: 'benefits_va', direction: 'in' },
  { pattern: 'INTEREST PAID', category: 'interest', direction: 'in' },
  { pattern: 'INTEREST EARNED', category: 'interest', direction: 'in' },
  { pattern: 'PHARMACY', category: 'medical', direction: 'out' },
  { pattern: 'RENT', category: 'housing', direction: 'out' },
  { pattern: 'SERVICE FEE', category: 'fees', direction: 'out' },
  { pattern: 'GROCERY', category: 'food', direction: 'out' },
  { pattern: 'SUPERMARKET', category: 'food', direction: 'out' },
];
