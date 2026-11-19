import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { LockedPeriodError, ReadOnlyError, Store, ValidationError } from './store';
import {
  createSnapshot,
  extractBook,
  openSnapshot,
  SnapshotError,
  validateBackup,
} from './snapshot';
import { evaluateTemplate } from '../core/templates/evaluate';
import { parseTemplateYaml } from '../core/templates/validate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

function setup() {
  let t = Date.parse('2026-03-01T12:00:00Z');
  const store = Store.open(SQL, null, { now: () => new Date((t += 1000)) });
  const book = store.createBook(
    {
      beneficiary_name: 'Rosa Diaz',
      fiduciary_name: 'Ana Diaz',
      role: 'ssa_payee',
      beneficiary_dob: null,
      fiduciary_phone: null,
      fiduciary_address: null,
      state: 'FL',
      county: 'Hillsborough',
      court: null,
      case_number: null,
      claim_number: null,
      appointment_date: '2025-07-01',
      report_month: 7,
      notes: null,
    },
    [
      {
        name: 'Payee checking',
        kind: 'checking',
        opening_balance: 50000,
        opening_date: '2025-07-01',
      },
      { name: 'Savings', kind: 'savings', opening_balance: 100000, opening_date: '2025-07-01' },
    ],
  );
  const [checking, savings] = store.listAccounts(book.id);
  return { store, book, checking, savings };
}

describe('Store', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creates books with accounts, default rules and an audit trail', () => {
    const { store, book } = ctx;
    expect(store.listBooks()).toHaveLength(1);
    expect(store.getMeta('active_book')).toBe(book.id);
    expect(store.listAccounts(book.id)).toHaveLength(2);
    expect(store.listRules(book.id).length).toBeGreaterThan(5);
    const audit = store.listAudit(book.id);
    expect(audit.map((a) => a.summary)).toContain('Opened the book for Rosa Diaz');
    expect(store.verifyAudit(book.id)).toMatchObject({ ok: true, count: 3 });
  });

  it('validates input', () => {
    const { store, book, checking } = ctx;
    expect(() =>
      store.addTransaction(book.id, {
        account_id: checking.id,
        date: 'bad',
        amount: 1,
        payee: 'x',
      }),
    ).toThrow(ValidationError);
    expect(() =>
      store.addTransaction(book.id, {
        account_id: checking.id,
        date: '2026-01-01',
        amount: 0,
        payee: 'x',
      }),
    ).toThrow(/zero/);
    expect(() => store.createBook({ ...book, beneficiary_name: ' ' })).toThrow(ValidationError);
  });

  it('lists transactions newest first with running balances and filters', () => {
    const { store, book, checking, savings } = ctx;
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-03',
      amount: 104300,
      payee: 'SSA',
      category: 'benefits_ssa',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-05',
      amount: -85000,
      payee: 'Riverside Apartments',
      category: 'housing',
    });
    store.addTransaction(book.id, {
      account_id: savings.id,
      date: '2025-07-06',
      amount: 12,
      payee: 'Interest',
    });
    const all = store.listTransactions(book.id);
    expect(all.map((t) => t.balance)).toEqual([169312, 169300, 254300]);
    const chk = store.listTransactions(book.id, { accountId: checking.id });
    expect(chk.map((t) => t.balance)).toEqual([69300, 154300]);
    expect(store.listTransactions(book.id, { category: 'untagged' })).toHaveLength(1);
    expect(store.listTransactions(book.id, { search: 'riverside' })).toHaveLength(1);
    expect(store.listTransactions(book.id, { from: '2025-07-04', to: '2025-07-05' })).toHaveLength(
      1,
    );
    expect(store.listTransactions(book.id, { needsReceipt: true })).toHaveLength(1);
    expect(store.totalFunds(book.id)).toEqual({ accounts: 169312, saved: 0, total: 169312 });
  });

  it('imports without duplicates and auto-tags from rules', () => {
    const { store, book, checking } = ctx;
    const rows = [
      { date: '2025-08-03', amount: 104300, description: 'SSA TREAS 310 XXSOC SEC' },
      { date: '2025-08-04', amount: -5420, description: 'POS PURCHASE PUBLIX #1432 TAMPA FL' },
      { date: '2025-08-04', amount: -5420, description: 'POS PURCHASE PUBLIX #1432 TAMPA FL' },
    ];
    const first = store.importTransactions(book.id, checking.id, rows, 'csv');
    expect(first).toEqual({ added: 3, duplicates: 0, locked: 0, autoTagged: 1 });
    const again = store.importTransactions(book.id, checking.id, rows, 'csv');
    expect(again).toMatchObject({ added: 0, duplicates: 3 });
    const tagged = store.listTransactions(book.id).find((t) => t.amount === 104300)!;
    expect(tagged.category).toBe('benefits_ssa');
    expect(tagged.payee).toBe('SSA Treas Soc Sec');

    // Tag once: a new rule tags existing and future Publix purchases.
    expect(store.countMatching(book.id, 'PUBLIX', 'out')).toBe(2);
    expect(store.addRule(book.id, 'PUBLIX', 'food', 'out')).toBe(2);
    const next = store.importTransactions(
      book.id,
      checking.id,
      [{ date: '2025-09-01', amount: -1000, description: 'PUBLIX #99 BRANDON FL' }],
      'csv',
    );
    expect(next.autoTagged).toBe(1);
    expect(store.listTransactions(book.id, { category: 'food' })).toHaveLength(3);
  });

  it('honours overrides during import', () => {
    const { store, book, checking } = ctx;
    const rows = [{ date: '2025-08-03', amount: 104300, description: 'SSA TREAS 310 XXSOC SEC' }];
    const [p] = store.previewImport(book.id, checking.id, rows);
    expect(p).toMatchObject({ status: 'new', category: 'benefits_ssa' });
    store.importTransactions(book.id, checking.id, rows, 'csv', { [p.key]: 'other_income' });
    expect(store.listTransactions(book.id)[0].category).toBe('other_income');
  });

  it('splits transactions into tagged parts', () => {
    const { store, book, checking } = ctx;
    const t = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-10',
      amount: -10000,
      payee: 'Walmart',
    });
    expect(() =>
      store.setSplits(t.id, [
        { amount: -5000, category: 'food', memo: '' },
        { amount: -4000, category: 'clothing', memo: '' },
      ]),
    ).toThrow(/add up/);
    store.setSplits(t.id, [
      { amount: -6000, category: 'food', memo: 'groceries' },
      { amount: -4000, category: 'clothing', memo: 'shoes' },
    ]);
    expect(store.listTransactions(book.id, { category: 'clothing' })).toHaveLength(1);
    const totals = store.categoryTotals(book.id, '2025-07-01', '2025-07-31');
    expect(totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'food', total: 6000 }),
        expect.objectContaining({ category: 'clothing', total: 4000 }),
      ]),
    );
    expect(() => store.updateTransaction(t.id, { amount: -1 })).toThrow(/split/);
    store.setSplits(t.id, []);
    expect(store.splitsFor(t.id)).toHaveLength(0);
  });

  it('stores and links receipts', () => {
    const { store, book, checking } = ctx;
    const t = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-10',
      amount: -5420,
      payee: 'Publix',
      category: 'food',
    });
    const r = store.addReceipt(book.id, {
      filename: 'publix.jpg',
      mime: 'image/jpeg',
      data: new Uint8Array([1, 2, 3]),
      ocr_total: 5420,
    });
    expect(store.counts(book.id).unmatched_receipts).toBe(1);
    expect(store.counts(book.id).missing_receipts).toBe(1);
    store.updateReceipt(r.id, { tx_id: t.id });
    expect(store.counts(book.id)).toMatchObject({
      unmatched_receipts: 0,
      missing_receipts: 0,
      receipts: 1,
    });
    expect(store.listTransactions(book.id)[0].receipt_count).toBe(1);
    expect(Array.from(store.receiptData(r.id)!.data)).toEqual([1, 2, 3]);
    store.deleteTransaction(t.id);
    expect(store.getReceipt(r.id)!.tx_id).toBeNull();
  });

  it('tracks saved money outside tracked accounts', () => {
    const { store, book, checking } = ctx;
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-10',
      amount: -20000,
      payee: 'Savings bond',
      category: 'saved',
    });
    expect(store.totalFunds(book.id)).toEqual({ accounts: 130000, saved: 20000, total: 150000 });
    const flows = store.monthlyFlows(book.id, '2025-07-01', '2025-07-31');
    expect(flows).toEqual([{ month: '2025-07', in: 0, out: 0, saved: 20000 }]);
  });

  it('reconciles against a statement', () => {
    const { store, book, checking } = ctx;
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-03',
      amount: 104300,
      payee: 'SSA',
      category: 'benefits_ssa',
    });
    const off = store.reconcile(checking.id, '2025-07-31', 154000);
    expect(off.difference).toBe(-300);
    const ok = store.reconcile(checking.id, '2025-07-31', 154300);
    expect(ok.difference).toBe(0);
    expect(store.listTransactions(book.id)[0].cleared).toBe(1);
    expect(store.listReconciliations(book.id)).toHaveLength(2);
  });

  it('locks filed periods until the report is reopened', () => {
    const { store, book, checking } = ctx;
    const t = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-08-01',
      amount: -100,
      payee: 'Fee',
    });
    const report = store.saveReport(book.id, {
      template_id: 'x',
      template_version: '1.0.0',
      template_name: 'Test report',
      period_start: '2025-07-01',
      period_end: '2026-06-30',
      inputs: {},
      totals: {},
    });
    store.setReportStatus(report.id, 'filed', '2026-07-15');
    expect(store.lockedThrough(book.id)).toBe('2026-06-30');
    expect(() => store.updateTransaction(t.id, { memo: 'x' })).toThrow(LockedPeriodError);
    expect(() => store.setCategory(book.id, [t.id], 'fees')).toThrow(LockedPeriodError);
    expect(() =>
      store.addTransaction(book.id, {
        account_id: checking.id,
        date: '2026-01-01',
        amount: 1,
        payee: 'x',
      }),
    ).toThrow(LockedPeriodError);
    expect(
      store.previewImport(book.id, checking.id, [
        { date: '2026-01-01', amount: 1, description: 'x' },
      ])[0].status,
    ).toBe('locked');
    expect(() => store.deleteReport(report.id)).toThrow(/Filed/);
    expect(store.listTransactions(book.id)[0].locked).toBe(true);
    store.setReportStatus(report.id, 'reopened');
    store.updateTransaction(t.id, { memo: 'corrected' });
    expect(store.getTransaction(t.id)!.memo).toBe('corrected');
  });

  it('detects tampering with the audit log', () => {
    const { store, book, checking } = ctx;
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-08-01',
      amount: -100,
      payee: 'Fee',
    });
    expect(store.verifyAudit(book.id).ok).toBe(true);
    store.run("UPDATE audit_log SET summary = 'nothing to see' WHERE seq = 2");
    const v = store.verifyAudit(book.id);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });

  it('builds an evaluation context that drives templates', () => {
    const { store, book, checking } = ctx;
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-03',
      amount: 104300,
      payee: 'SSA',
      category: 'benefits_ssa',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-05',
      amount: -85000,
      payee: 'Rent',
      category: 'housing',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-06',
      amount: -9000,
      payee: 'Doctor',
      category: 'medical',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-07',
      amount: -5000,
      payee: 'Bond',
      category: 'saved',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2026-07-07',
      amount: -1,
      payee: 'After period',
      category: 'fees',
    });
    const yaml = readFileSync(
      join(__dirname, '../../templates/ssa/ssa-623-payee-report.yaml'),
      'utf8',
    );
    const { template } = parseTemplateYaml(yaml);
    const ectx = store.buildEvalContext(book.id, { start: '2025-07-01', end: '2026-06-30' });
    expect(ectx.lines).toHaveLength(4);
    expect(ectx.book.role_label).toBe('Social Security representative payee');
    const r = evaluateTemplate(template, ectx);
    expect(r.values['received.benefits']).toBe(104300);
    expect(r.values['used.total']).toBe(94000);
    expect(r.values['saved.saved']).toBe(10300);
    expect(r.values['saved.moved_to_savings']).toBe(5000);
    expect(r.values['saved.savings_on_hand']).toBe(105000);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('refuses writes when read-only', () => {
    const { store, book } = ctx;
    const ro = Store.open(SQL, store.export(), { readOnly: true });
    expect(ro.getBook(book.id)!.beneficiary_name).toBe('Rosa Diaz');
    expect(() => ro.updateBook(book.id, { notes: 'x' })).toThrow(ReadOnlyError);
  });

  it('deletes books and moves the active pointer', () => {
    const { store, book } = ctx;
    const other = store.createBook({ ...book, beneficiary_name: 'Second' });
    store.deleteBook(book.id);
    expect(store.listBooks().map((b) => b.id)).toEqual([other.id]);
    expect(store.getMeta('active_book')).toBe(other.id);
    expect(store.listAudit(book.id)).toHaveLength(0);
  });
});

describe('snapshots and backups', () => {
  it('extracts one book and round-trips plain and encrypted snapshots', async () => {
    const { store, book, checking } = setup();
    const other = store.createBook({ ...book, beneficiary_name: 'Somebody Else' });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-07-03',
      amount: 104300,
      payee: 'SSA',
      category: 'benefits_ssa',
    });
    store.saveImportProfile('sig', { a: 1 });

    const bytes = extractBook(SQL, store, book.id);
    const copy = Store.open(SQL, bytes, { readOnly: true });
    expect(copy.listBooks().map((b) => b.id)).toEqual([book.id]);
    expect(copy.listAudit(other.id)).toHaveLength(0);
    expect(copy.getImportProfile('sig')).toBeUndefined();
    expect(copy.verifyAudit(book.id).ok).toBe(true);

    const plain = await createSnapshot(SQL, store, book.id, { appVersion: '1.0.0' });
    expect(plain.envelope.summary?.beneficiary).toBe('Rosa Diaz');
    const opened = await openSnapshot(plain.json);
    expect(opened.integrity).toBe('verified');
    expect(opened.fingerprint).toBe(plain.fingerprint);

    const secret = await createSnapshot(SQL, store, book.id, {
      appVersion: '1.0.0',
      passphrase: 'correct horse',
    });
    expect(secret.json).not.toContain('Rosa');
    expect(secret.envelope.summary).toBeUndefined();
    await expect(openSnapshot(secret.json)).rejects.toBeInstanceOf(SnapshotError);
    await expect(openSnapshot(secret.json, 'wrong')).rejects.toThrow(/passphrase/);
    const unlocked = await openSnapshot(secret.json, 'correct horse');
    expect(unlocked.integrity).toBe('verified');
    expect(
      Store.open(SQL, unlocked.bytes, { readOnly: true }).listTransactions(book.id),
    ).toHaveLength(1);

    const tampered = JSON.parse(plain.json);
    tampered.sha256 = '0'.repeat(64);
    expect((await openSnapshot(JSON.stringify(tampered))).integrity).toBe('mismatch');
    await expect(openSnapshot('{"format":"nope"}')).rejects.toThrow(/not a Payeebook/);
  }, 20_000);

  it('validates backups', () => {
    const { store } = setup();
    expect(validateBackup(SQL, store.export())).toMatchObject({ books: 1 });
    expect(() => validateBackup(SQL, new TextEncoder().encode('hello world, not sqlite'))).toThrow(
      /not a Payeebook backup/,
    );
    const foreign = new SQL.Database();
    foreign.run('CREATE TABLE x(a)');
    expect(() => validateBackup(SQL, foreign.export())).toThrow(/not made by Payeebook/);
  });
});
