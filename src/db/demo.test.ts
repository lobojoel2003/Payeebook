import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { Store } from './store';
import { createDemoBook } from './demo';

describe('demo book', () => {
  it('builds a balanced, reconciled demo book', async () => {
    const SQL = await initSqlJs();
    const store = Store.open(SQL);
    const { book, receipts } = createDemoBook(store, '2026-11-19');
    const counts = store.counts(book.id);
    expect(counts.transactions).toBeGreaterThan(200);
    expect(counts.untagged).toBe(3);
    expect(receipts.length).toBeGreaterThan(10);
    const recon = store.listReconciliations(book.id);
    expect(recon.length).toBeGreaterThan(20);
    expect(recon.every((r) => r.difference === 0)).toBe(true);
    // Transfers net to zero across accounts.
    const ctx = store.buildEvalContext(book.id, { start: '2025-10-01', end: '2026-09-30' });
    const transfers = ctx.lines
      .filter((l) => l.category === 'transfer')
      .reduce((n, l) => n + l.amount, 0);
    expect(transfers).toBe(0);
    expect(store.verifyAudit(book.id).ok).toBe(true);
  });
});
