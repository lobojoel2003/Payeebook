import { normalizePayee } from './payee';

export interface ImportCandidate {
  date: string;
  amount: number;
  description: string;
  fitId?: string;
}

/**
 * Stable keys for imported rows, so the same statement can be imported twice
 * (or two overlapping statements imported) without duplicating transactions.
 * OFX files carry a bank-issued FITID. CSV files do not, so we key on date,
 * amount and description plus an occurrence counter; two identical coffees on
 * the same day remain two transactions, and re-importing yields the same keys.
 */
export function importKeys(accountId: string, rows: ImportCandidate[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.fitId) return `ofx:${accountId}:${r.fitId}`;
    const base = `csv:${accountId}:${r.date}:${r.amount}:${normalizePayee(r.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}:${n}`;
  });
}
