/**
 * Regression tests for issues found in the pre-release review. Each test names
 * the problem it guards against.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LockedPeriodError, Store, ValidationError } from './store';
import { extractBook } from './snapshot';
import { parseOfx } from '../core/ofx';
import { applyMapping, detectMapping } from '../core/csv';
import { parseMoney } from '../core/money';
import { evalExpr } from '../core/templates/expr';
import { acroValue, evaluateTemplate, TemplateEvaluator } from '../core/templates/evaluate';
import { parseTemplateYaml } from '../core/templates/validate';
import { defaultPeriod, currentReportingYear } from '../templates';

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
      role: 'guardian',
      beneficiary_dob: null,
      fiduciary_phone: null,
      fiduciary_address: null,
      state: null,
      county: null,
      court: null,
      case_number: null,
      claim_number: null,
      appointment_date: '2025-01-01',
      report_month: null,
      notes: null,
    },
    [{ name: 'Checking', kind: 'checking', opening_balance: 100000, opening_date: '2025-01-01' }],
  );
  const [checking] = store.listAccounts(book.id);
  return { store, book, checking };
}

const generic = () =>
  parseTemplateYaml(
    readFileSync(join(__dirname, '../../templates/us/generic/annual-account.yaml'), 'utf8'),
  ).template;

function file(store: Store, bookId: string, end = '2025-12-31') {
  const r = store.saveReport(bookId, {
    template_id: 'x',
    template_version: '1',
    template_name: 'Account',
    period_start: '2025-01-01',
    period_end: end,
    inputs: {},
    totals: {},
  });
  store.setReportStatus(r.id, 'filed', '2026-01-15');
}

describe('filed periods cannot change retroactively', () => {
  it('opening balances only count from their opening date, and accounts respect the lock', () => {
    const { store, book, checking } = setup();
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: 70000,
      payee: 'SSA',
      category: 'benefits_ssa',
    });
    const before = evaluateTemplate(
      generic(),
      store.buildEvalContext(book.id, { start: '2025-01-01', end: '2025-12-31' }),
    );
    file(store, book.id);

    // A new account opened after the filed period does not change it.
    const savings = store.createAccount(book.id, {
      name: 'Savings',
      kind: 'savings',
      opening_balance: 500000,
      opening_date: '2026-03-01',
    });
    expect(store.balanceAt(savings.id, '2025-12-31')).toBe(0);
    const after = evaluateTemplate(
      generic(),
      store.buildEvalContext(book.id, { start: '2025-01-01', end: '2025-12-31' }),
    );
    expect(after.values['summary.opening']).toBe(before.values['summary.opening']);
    expect(after.values['summary.closing']).toBe(before.values['summary.closing']);

    // Opening balances inside the filed period are locked.
    expect(() =>
      store.createAccount(book.id, {
        name: 'Old',
        kind: 'cash',
        opening_balance: 1,
        opening_date: '2025-05-01',
      }),
    ).toThrow(LockedPeriodError);
    expect(() => store.updateAccount(checking.id, { opening_balance: 1 })).toThrow(
      LockedPeriodError,
    );
    store.updateAccount(checking.id, { name: 'Renamed' });
    expect(store.getAccount(checking.id)!.name).toBe('Renamed');

    // The running balance picks up the new account only from its opening date.
    const rows = store.listTransactions(book.id);
    expect(rows[rows.length - 1].balance).toBe(170000);
  });

  it('receipts of filed transactions cannot be detached, swapped or added', () => {
    const { store, book, checking } = setup();
    const t = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -5000,
      payee: 'Store',
      category: 'food',
    });
    const r = store.addReceipt(book.id, {
      filename: 'a.jpg',
      mime: 'image/jpeg',
      data: new Uint8Array([1]),
      tx_id: t.id,
    });
    file(store, book.id);
    expect(() => store.updateReceipt(r.id, { tx_id: null })).toThrow(LockedPeriodError);
    expect(() =>
      store.addReceipt(book.id, {
        filename: 'b.jpg',
        mime: 'image/jpeg',
        data: new Uint8Array([2]),
        tx_id: t.id,
      }),
    ).toThrow(LockedPeriodError);
    expect(() => store.deleteReceipt(r.id)).toThrow(LockedPeriodError);
    store.updateReceipt(r.id, { note: 'notes are fine' });
  });
});

describe('the audit log', () => {
  it('detects removal of the newest entries', () => {
    const { store, book, checking } = setup();
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -100,
      payee: 'Fee',
    });
    expect(store.verifyAudit(book.id).ok).toBe(true);
    store.run('DELETE FROM audit_log WHERE seq = (SELECT MAX(seq) FROM audit_log)');
    expect(store.verifyAudit(book.id).ok).toBe(false);
  });

  it('keeps the anchor in snapshots so they still verify', () => {
    const { store, book } = setup();
    const copy = Store.open(SQL, extractBook(SQL, store, book.id), { readOnly: true });
    expect(copy.verifyAudit(book.id).ok).toBe(true);
  });
});

describe('categories', () => {
  it('deleting a tag removes its rules and never hides money from the totals', () => {
    const { store, book, checking } = setup();
    store.addCategory(book.id, {
      id: 'custom_pets',
      label: 'Pets',
      kind: 'expense',
      ssa: 'other_needs',
      court: 'disbursements.other',
      color: '#888',
    });
    store.addRule(book.id, 'PETCO', 'custom_pets', 'out');
    store.deleteCategory(book.id, 'custom_pets');
    expect(store.listRules(book.id).some((r) => r.category === 'custom_pets')).toBe(false);
    const res = store.importTransactions(
      book.id,
      checking.id,
      [{ date: '2025-06-01', amount: -2500, description: 'PETCO 123' }],
      'csv',
    );
    expect(res.autoTagged).toBe(0);

    // Even a stale tag left in the data is reported as untagged rather than vanishing.
    store.run("UPDATE transactions SET category = 'gone' WHERE payee LIKE 'Petco%'");
    const ctx = store.buildEvalContext(book.id, { start: '2025-01-01', end: '2025-12-31' });
    expect(ctx.counts.untagged).toBe(1);
    const r = evaluateTemplate(generic(), ctx);
    expect(r.checks.find((c) => c.label.includes('tagged'))!.ok).toBe(false);
  });

  it('splitting clears the parent tag', () => {
    const { store, book, checking } = setup();
    const t = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -20000,
      payee: 'Shop',
      category: 'transfer',
    });
    store.setSplits(t.id, [
      { amount: -10000, category: 'food', memo: '' },
      { amount: -10000, category: 'medical', memo: '' },
    ]);
    expect(store.getTransaction(t.id)!.category).toBeNull();
    // The missing-receipt count and list agree.
    expect(store.counts(book.id).missing_receipts).toBe(
      store.listTransactions(book.id, { needsReceipt: true }).length,
    );
    expect(store.counts(book.id).missing_receipts).toBe(1);
  });

  it('counts the same transactions a new rule will tag', () => {
    const { store, book, checking } = setup();
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -100,
      payee: 'KWIK TRIP',
    });
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2026-02-01',
      amount: -100,
      payee: 'KWIK TRIP',
    });
    file(store, book.id);
    expect(store.countMatching(book.id, 'KWIK TRIP', 'out')).toBe(1);
    expect(store.addRule(book.id, 'KWIK TRIP', 'transportation', 'out')).toBe(1);
  });
});

describe('importing', () => {
  it('treats a FITID repeated in one file as a duplicate instead of failing', () => {
    const { store, book, checking } = setup();
    const rows = [
      { date: '2025-06-01', amount: -100, description: 'A', fitId: 'F1' },
      { date: '2025-06-01', amount: -100, description: 'A', fitId: 'F1' },
    ];
    expect(store.previewImport(book.id, checking.id, rows).map((r) => r.status)).toEqual([
      'new',
      'duplicate',
    ]);
    expect(store.importTransactions(book.id, checking.id, rows, 'ofx')).toMatchObject({
      added: 1,
      duplicates: 1,
    });
  });

  it('keeps transactions whose OFX fields are empty', () => {
    const xml = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>1</ACCTID></BANKACCTFROM><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260301</DTPOSTED><NAME/><TRNAMT>-50.00</TRNAMT><FITID>a</FITID><MEMO>Cash</MEMO></STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(parseOfx(xml)[0].transactions).toMatchObject([
      { amount: -5000, memo: 'Cash', fitId: 'a' },
    ]);
    const sgml = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>1</BANKACCTFROM><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260301<NAME><TRNAMT>-50.00<FITID>b<MEMO>Cash</STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260302<NAME>Shop<TRNAMT>-1.00<FITID>c</STMTTRN>
      </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const st = parseOfx(sgml)[0];
    expect(st.accountId).toBe('1');
    expect(st.transactions.map((t) => [t.fitId, t.amount, t.name])).toEqual([
      ['b', -5000, ''],
      ['c', -100, 'Shop'],
    ]);
  });

  it('reads reversals in the credit column and skips zero rows', () => {
    const { rows, mapping } = detectMapping(
      'Date,Description,Debit,Credit\n03/01/2026,Reversal,,-12.00\n03/02/2026,Info,0.00,\n03/03/2026,Pay,5.00,\n',
    );
    const parsed = applyMapping(rows, mapping);
    expect(parsed[0].amount).toBe(-1200);
    expect(parsed[1].errors).toContain('Amount is zero');
    expect(parsed[2].amount).toBe(-500);
  });

  it('reads European decimals with one digit', () => {
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('1,5')).toBe(150);
    expect(parseMoney('1,234')).toBe(123400);
  });
});

describe('templates', () => {
  it('compares dates as text and fills counts as numbers', () => {
    const resolve = (n: string) => ({ a: '2026-03-01', b: '2026-12-31' })[n] ?? null;
    expect(evalExpr('a < b', resolve)).toBe(true);
    expect(evalExpr('a >= b', resolve)).toBe(false);

    const { store, book, checking } = setup();
    store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -100,
      payee: 'X',
      category: 'fees',
    });
    const t = generic();
    t.inputs = [...(t.inputs ?? []), { id: 'answer', label: 'A', type: 'text', default: 'No' }];
    const ev = new TemplateEvaluator(
      t,
      store.buildEvalContext(book.id, { start: '2025-01-01', end: '2025-12-31' }),
    );
    expect(acroValue(ev, 'count.transactions')).toBe('1');
    expect(acroValue(ev, 'period.days')).toBe('365');
    expect(acroValue(ev, 'disbursements.total')).toBe('1.00');
    expect(acroValue(ev, 'period.end | date')).toBe('December 31, 2025');
    expect(acroValue(ev, 'disbursements.total | number')).toBe('100');
  });

  it('attaches the receipt of a split transaction above the threshold', () => {
    const { store, book, checking } = setup();
    const tx = store.addTransaction(book.id, {
      account_id: checking.id,
      date: '2025-06-01',
      amount: -6000,
      payee: 'Shop',
    });
    store.setSplits(tx.id, [
      { amount: -3000, category: 'food', memo: '' },
      { amount: -3000, category: 'clothing', memo: '' },
    ]);
    store.addReceipt(book.id, {
      filename: 'r.jpg',
      mime: 'image/jpeg',
      data: new Uint8Array([1]),
      tx_id: tx.id,
    });
    const t = generic();
    t.receipts = { attach: true, min_amount: 50 };
    const r = evaluateTemplate(
      t,
      store.buildEvalContext(book.id, { start: '2025-01-01', end: '2025-12-31' }),
    );
    expect(r.exhibits).toHaveLength(1);
  });
});

describe('default report periods', () => {
  const t = (d: 'appointment-year' | 'last-12-months') => ({
    ...generic(),
    period: { default: d },
  });
  const book = (p: Partial<{ appointment_date: string; report_month: number | null }>) =>
    ({ appointment_date: null, report_month: null, ...p }) as never;

  it('uses whole calendar months for the last 12 months', () => {
    expect(defaultPeriod(t('last-12-months'), book({}), '2025-03-10')).toEqual({
      start: '2024-03-01',
      end: '2025-02-28',
    });
  });

  it('keeps consecutive appointment years contiguous', () => {
    const b = book({ appointment_date: '2025-07-31' });
    expect(defaultPeriod(t('appointment-year'), b, '2026-08-15')).toEqual({
      start: '2025-07-31',
      end: '2026-07-30',
    });
    expect(defaultPeriod(t('appointment-year'), b, '2027-08-15')).toEqual({
      start: '2026-07-31',
      end: '2027-07-30',
    });
    expect(currentReportingYear(b, '2027-08-15')).toEqual({
      start: '2027-07-31',
      end: '2028-07-30',
    });
    const leap = book({ appointment_date: '2024-02-29' });
    expect(defaultPeriod(t('appointment-year'), leap, '2026-03-10')).toEqual({
      start: '2025-02-28',
      end: '2026-02-27',
    });
  });

  it('uses the year in progress before the first anniversary', () => {
    expect(
      defaultPeriod(t('appointment-year'), book({ appointment_date: '2026-05-01' }), '2026-11-19'),
    ).toEqual({ start: '2026-05-01', end: '2027-04-30' });
  });

  it('follows the SSA reporting month', () => {
    expect(defaultPeriod(t('last-12-months'), book({ report_month: 7 }), '2026-11-19')).toEqual({
      start: '2025-07-01',
      end: '2026-06-30',
    });
  });
});

describe('snapshots', () => {
  it('only include custom templates the shared book used', () => {
    const { store, book } = setup();
    store.saveUserTemplate('used-template', 'x');
    store.saveUserTemplate('other-books-template', 'y');
    store.saveReport(book.id, {
      template_id: 'used-template',
      template_version: '1',
      template_name: 'U',
      period_start: '2025-01-01',
      period_end: '2025-12-31',
      inputs: {},
      totals: {},
    });
    const copy = Store.open(SQL, extractBook(SQL, store, book.id), { readOnly: true });
    expect(copy.listUserTemplates().map((u) => u.id)).toEqual(['used-template']);
  });
});

it('rejects invalid account dates', () => {
  const { store, book } = setup();
  expect(() =>
    store.createAccount(book.id, { name: 'X', kind: 'cash', opening_balance: 0, opening_date: '' }),
  ).toThrow(ValidationError);
});
