/**
 * Money is stored everywhere as integer cents to avoid floating point drift.
 * Positive amounts are money coming in to the beneficiary, negative amounts
 * are money going out.
 */
export type Cents = number;

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(
  cents: Cents,
  opts: { sign?: boolean; absolute?: boolean } = {},
): string {
  const value = opts.absolute ? Math.abs(cents) : cents;
  const text = usd.format(value / 100);
  if (opts.sign && value > 0) return `+${text}`;
  return text;
}

/** Format without a currency symbol, e.g. for PDF columns: "1,234.56" / "(12.00)". */
export function formatAmountPlain(cents: Cents, parensForNegative = true): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  const body = `${whole}.${frac}`;
  if (cents < 0) return parensForNegative ? `(${body})` : `-${body}`;
  return body;
}

/**
 * Parse a human or bank formatted amount into cents.
 * Handles "$1,234.56", "(12.30)", "-12.30", "12.30-", "12.30 CR", "12.30 DR",
 * "1.234,56" (European) and plain integers. Returns null when nothing numeric
 * is present.
 */
export function parseMoney(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const upper = s.toUpperCase();
  if (/\b(DR|DEBIT)\.?$/.test(upper)) {
    negative = true;
    s = s.replace(/\s*(DR|DEBIT)\.?$/i, '');
  } else if (/\b(CR|CREDIT)\.?$/.test(upper)) {
    s = s.replace(/\s*(CR|CREDIT)\.?$/i, '');
  }
  s = s.trim();
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/[$\s\u00a0]|USD/gi, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/[0-9]/.test(s)) return null;

  // Decide which separator is the decimal point.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234" is thousands; "12,34" and "12,5" are European decimals.
    const decimals = s.length - lastComma - 1;
    normalized =
      (decimals === 1 || decimals === 2) && s.indexOf(',') === lastComma
        ? s.replace(',', '.')
        : s.replace(/,/g, '');
  } else {
    normalized = s;
  }
  if (!/^\d*\.?\d*$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  const rounding = fraction.length > 2 && Number(fraction[2]) >= 5 ? 1 : 0;
  const total = cents + rounding;
  if (!Number.isFinite(total)) return null;
  return negative ? -total : total;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
