/**
 * Dates are stored as ISO calendar dates ("YYYY-MM-DD") with no time zone.
 * Benefit deposits and receipts are calendar facts, so we never convert them
 * through Date objects in local time where a midnight shift could move a day.
 */
export type ISODate = string;

export type DateOrder = 'MDY' | 'DMY' | 'YMD';

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/** Parse many bank and receipt date spellings. Returns null if unparseable. */
export function parseDate(input: string, order: DateOrder = 'MDY'): ISODate | null {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // 20260131 or 20260131120000[.000][-5:EST] (OFX)
  let m = /^(\d{4})(\d{2})(\d{2})(?:\d{0,6})?(?:\.\d+)?(?:\[.*\])?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  // 2026-01-31, 2026/01/31, 2026.01.31 with optional time
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  // 01/31/2026, 31/01/2026, 1-31-26, 31.01.2026 with optional time
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]));
    let mo = order === 'DMY' ? b : a;
    let d = order === 'DMY' ? a : b;
    // If the preferred order is impossible but the other works, use the other.
    if (!isValidYMD(y, mo, d) && isValidYMD(y, d, mo)) [mo, d] = [d, mo];
    return isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  // Jan 31, 2026 / January 31 2026 / 31 Jan 2026 / 31-Jan-26
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3).toLowerCase()];
    const d = Number(m[2]);
    const y = expandYear(Number(m[3]));
    return mo && isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ ,-]+(\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const d = Number(m[1]);
    const y = expandYear(Number(m[3]));
    return mo && isValidYMD(y, mo, d) ? toISO(y, mo, d) : null;
  }
  return null;
}

export function splitISO(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = splitISO(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = splitISO(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(date: ISODate, years: number): ISODate {
  return addMonths(date, years * 12);
}

export function diffDays(a: ISODate, b: ISODate): number {
  const [y1, m1, d1] = splitISO(a);
  const [y2, m2, d2] = splitISO(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function startOfMonth(date: ISODate): ISODate {
  const [y, m] = splitISO(date);
  return toISO(y, m, 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const [y, m] = splitISO(date);
  return toISO(y, m, daysInMonth(y, m));
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

const LONG = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const SHORT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function asUTC(date: ISODate): Date {
  const [y, m, d] = splitISO(date);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(
  date: ISODate | null | undefined,
  style: 'long' | 'short' | 'us' = 'short',
): string {
  if (!date) return '';
  if (style === 'us') {
    const [y, m, d] = splitISO(date);
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  }
  return (style === 'long' ? LONG : SHORT).format(asUTC(date));
}

export function formatMonth(key: string): string {
  return MONTH.format(asUTC(`${key}-01`));
}

/** The last day of the 12 month period that starts on `start`. */
export function periodEndFor(start: ISODate, months = 12): ISODate {
  return addDays(addMonths(start, months), -1);
}
