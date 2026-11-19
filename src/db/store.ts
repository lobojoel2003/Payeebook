import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { CategoryIndex, type Category, type CategoryKind } from '../core/categories';
import { addDays, todayISO, type ISODate } from '../core/dates';
import { importKeys } from '../core/dedupe';
import {
  DEFAULT_RULES,
  matchRule,
  normalizePayee,
  prettyPayee,
  type RuleDirection,
} from '../core/payee';
import { sha256Hex } from '../core/sha256';
import { newId } from '../core/ids';
import type { EvalContext, EvalLine } from '../core/templates/evaluate';
import type { Value } from '../core/templates/expr';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import {
  ROLE_LABELS,
  type Account,
  type AccountInput,
  type AuditEntry,
  type Book,
  type BookInput,
  type ImportPreviewRow,
  type ImportResult,
  type ImportRow,
  type ReceiptInput,
  type ReceiptMeta,
  type Reconciliation,
  type Report,
  type ReportStatus,
  type Rule,
  type Split,
  type Transaction,
  type TxInput,
  type TxRow,
  type TxSource,
} from './types';

type Params = SqlValue[] | Record<string, SqlValue>;

export class ReadOnlyError extends Error {
  constructor() {
    super('This book is open read-only. Changes are not allowed.');
  }
}

export class LockedPeriodError extends Error {
  constructor(readonly lockedThrough: ISODate) {
    super(
      `Transactions through ${lockedThrough} are part of a filed report. Reopen that report to change them.`,
    );
  }
}

export class ValidationError extends Error {}

export interface StoreOptions {
  readOnly?: boolean;
  onChange?: () => void;
  now?: () => Date;
}

export interface TxFilter {
  accountId?: string;
  category?: string | 'untagged';
  from?: ISODate;
  to?: ISODate;
  search?: string;
  hasReceipt?: boolean;
  needsReceipt?: boolean;
}

const GENESIS = '0'.repeat(64);

export class Store {
  readonly readOnly: boolean;
  private onChange?: () => void;
  private now: () => Date;
  private depth = 0;

  constructor(
    readonly db: Database,
    opts: StoreOptions = {},
  ) {
    this.readOnly = Boolean(opts.readOnly);
    this.onChange = opts.onChange;
    this.now = opts.now ?? (() => new Date());
    db.run('PRAGMA foreign_keys = ON;');
    // Read-only snapshots are in-memory copies, so upgrading their schema is safe.
    this.migrate();
  }

  static open(SQL: SqlJsStatic, bytes?: Uint8Array | null, opts: StoreOptions = {}): Store {
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    return new Store(db, opts);
  }

  // ---------------------------------------------------------------- helpers

  all<T>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  scalar<T extends SqlValue>(sql: string, params: Params = []): T | undefined {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? (stmt.get()[0] as T) : undefined;
    } finally {
      stmt.free();
    }
  }

  run(sql: string, params: Params = []): void {
    this.db.run(sql, params);
  }

  private ts(): string {
    return this.now().toISOString();
  }

  private assertWritable() {
    if (this.readOnly) throw new ReadOnlyError();
  }

  /** Run fn in a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    this.assertWritable();
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    this.db.run('BEGIN');
    try {
      const result = fn();
      this.db.run('COMMIT');
      this.depth = 0;
      this.onChange?.();
      return result;
    } catch (e) {
      this.db.run('ROLLBACK');
      this.depth = 0;
      throw e;
    }
  }

  migrate() {
    this.db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    const current = Number(this.getMeta('schema_version') ?? '0');
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `This book was created by a newer version of Payeebook (schema ${current}). Please update the app.`,
      );
    }
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.run('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]);
        this.db.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', [
          'schema_version',
          String(v + 1),
        ]);
        this.db.run('COMMIT');
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
    }
    if (!this.getMeta('created_at')) this.setMeta('created_at', this.ts());
  }

  getMeta(key: string): string | undefined {
    return this.scalar<string>('SELECT value FROM meta WHERE key = ?', [key]);
  }

  setMeta(key: string, value: string) {
    if (this.readOnly) return;
    this.db.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', [key, value]);
    this.onChange?.();
  }

  export(): Uint8Array {
    return this.db.export();
  }

  close() {
    this.db.close();
  }

  // ------------------------------------------------------------------ audit

  private actorFor(bookId: string): string {
    return (
      this.scalar<string>('SELECT fiduciary_name FROM books WHERE id = ?', [bookId]) ?? 'Unknown'
    );
  }

  log(
    bookId: string,
    action: string,
    entity: string,
    entityId: string | null,
    summary: string,
    details: object = {},
  ) {
    const prev =
      this.scalar<string>(
        'SELECT hash FROM audit_log WHERE book_id = ? ORDER BY seq DESC LIMIT 1',
        [bookId],
      ) ?? GENESIS;
    const ts = this.ts();
    const actor = this.actorFor(bookId);
    const detailJson = JSON.stringify(details);
    const hash = sha256Hex(
      `${prev}\n${JSON.stringify([bookId, ts, actor, action, entity, entityId, summary, detailJson])}`,
    );
    this.run(
      'INSERT INTO audit_log(book_id, ts, actor, action, entity, entity_id, summary, details, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [bookId, ts, actor, action, entity, entityId, summary, detailJson, prev, hash],
    );
    // Anchor the head of the chain, so removing the newest entries is detected too.
    const count =
      this.scalar<number>('SELECT COUNT(*) FROM audit_log WHERE book_id = ?', [bookId]) ?? 0;
    this.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', [
      `audit_head:${bookId}`,
      `${count}:${hash}`,
    ]);
  }

  listAudit(bookId: string, limit = 500): AuditEntry[] {
    return this.all<AuditEntry>(
      'SELECT * FROM audit_log WHERE book_id = ? ORDER BY seq DESC LIMIT ?',
      [bookId, limit],
    );
  }

  /** Recompute the hash chain. Any edit to a past entry breaks every later hash. */
  verifyAudit(bookId: string): { ok: boolean; count: number; brokenAt?: number; head: string } {
    const rows = this.all<AuditEntry>(
      'SELECT * FROM audit_log WHERE book_id = ? ORDER BY seq ASC',
      [bookId],
    );
    let prev = GENESIS;
    for (const r of rows) {
      const expected = sha256Hex(
        `${prev}\n${JSON.stringify([r.book_id, r.ts, r.actor, r.action, r.entity, r.entity_id, r.summary, r.details])}`,
      );
      if (r.prev_hash !== prev || r.hash !== expected)
        return { ok: false, count: rows.length, brokenAt: r.seq, head: prev };
      prev = r.hash;
    }
    const anchor = this.getMeta(`audit_head:${bookId}`);
    if (anchor && anchor !== `${rows.length}:${prev}`) {
      // The chain itself is intact but entries after the last one were removed.
      return {
        ok: false,
        count: rows.length,
        brokenAt: (rows[rows.length - 1]?.seq ?? 0) + 1,
        head: prev,
      };
    }
    return { ok: true, count: rows.length, head: prev };
  }

  // ------------------------------------------------------------------ books

  listBooks(): Book[] {
    return this.all<Book>('SELECT * FROM books ORDER BY beneficiary_name COLLATE NOCASE');
  }

  getBook(id: string): Book | undefined {
    return this.get<Book>('SELECT * FROM books WHERE id = ?', [id]);
  }

  createBook(
    input: BookInput,
    accounts: AccountInput[] = [],
    opts: { seedRules?: boolean; id?: string } = {},
  ): Book {
    if (!input.beneficiary_name.trim()) throw new ValidationError('Enter the beneficiary’s name.');
    if (!input.fiduciary_name.trim()) throw new ValidationError('Enter your name.');
    return this.tx(() => {
      const id = opts.id ?? newId('bk');
      const ts = this.ts();
      this.run(
        `INSERT INTO books(id, beneficiary_name, beneficiary_dob, fiduciary_name, fiduciary_phone, fiduciary_address, role, state, county, court,
           case_number, claim_number, appointment_date, report_month, receipt_threshold, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          input.beneficiary_name.trim(),
          input.beneficiary_dob || null,
          input.fiduciary_name.trim(),
          input.fiduciary_phone || null,
          input.fiduciary_address || null,
          input.role,
          input.state || null,
          input.county || null,
          input.court || null,
          input.case_number || null,
          input.claim_number || null,
          input.appointment_date || null,
          input.report_month ?? null,
          input.receipt_threshold ?? 5000,
          input.notes || null,
          ts,
          ts,
        ],
      );
      this.log(id, 'create', 'book', id, `Opened the book for ${input.beneficiary_name.trim()}`, {
        role: input.role,
      });
      for (const a of accounts) this.createAccount(id, a);
      if (opts.seedRules !== false) {
        for (const r of DEFAULT_RULES) {
          this.run(
            'INSERT INTO rules(id, book_id, pattern, category, direction, hits, created_at) VALUES (?,?,?,?,?,0,?)',
            [newId('rl'), id, r.pattern, r.category, r.direction, ts],
          );
        }
      }
      if (!this.getMeta('active_book'))
        this.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['active_book', id]);
      return this.getBook(id)!;
    });
  }

  updateBook(id: string, patch: Partial<BookInput>): Book {
    return this.tx(() => {
      const before = this.getBook(id);
      if (!before) throw new ValidationError('Book not found.');
      const fields = Object.keys(patch).filter((k) => k in before) as (keyof BookInput)[];
      if (fields.length === 0) return before;
      const sets = fields.map((f) => `${f} = ?`).join(', ');
      const values = fields.map((f) => {
        const v = patch[f];
        return v === undefined || v === '' ? null : (v as SqlValue);
      });
      this.run(`UPDATE books SET ${sets}, updated_at = ? WHERE id = ?`, [...values, this.ts(), id]);
      const changed = fields.filter(
        (f) =>
          (before as unknown as Record<string, unknown>)[f] !== (patch[f] === '' ? null : patch[f]),
      );
      if (changed.length)
        this.log(id, 'update', 'book', id, `Updated book details (${changed.join(', ')})`, {
          fields: changed,
        });
      return this.getBook(id)!;
    });
  }

  deleteBook(id: string) {
    this.tx(() => {
      this.run('DELETE FROM books WHERE id = ?', [id]);
      this.run('DELETE FROM audit_log WHERE book_id = ?', [id]);
      if (this.getMeta('active_book') === id) {
        const next = this.scalar<string>('SELECT id FROM books LIMIT 1');
        if (next)
          this.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['active_book', next]);
        else this.run("DELETE FROM meta WHERE key = 'active_book'");
      }
    });
  }

  // --------------------------------------------------------------- accounts

  listAccounts(bookId: string, includeClosed = true): Account[] {
    return this.all<Account>(
      `SELECT * FROM accounts WHERE book_id = ? ${includeClosed ? '' : 'AND closed = 0'} ORDER BY closed, created_at`,
      [bookId],
    );
  }

  getAccount(id: string): Account | undefined {
    return this.get<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
  }

  createAccount(bookId: string, input: AccountInput): Account {
    if (!input.name.trim()) throw new ValidationError('Give the account a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.opening_date))
      throw new ValidationError('Enter the date the opening balance applies to.');
    return this.tx(() => {
      // An opening balance inside a filed period would change what was filed.
      this.assertUnlocked(bookId, input.opening_date);
      const id = newId('ac');
      this.run(
        'INSERT INTO accounts(id, book_id, name, kind, institution, last4, opening_balance, opening_date, closed, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)',
        [
          id,
          bookId,
          input.name.trim(),
          input.kind,
          input.institution || null,
          input.last4 || null,
          input.opening_balance,
          input.opening_date,
          this.ts(),
        ],
      );
      this.log(
        bookId,
        'create',
        'account',
        id,
        `Added account "${input.name.trim()}" with opening balance ${input.opening_balance / 100}`,
        {
          opening_balance: input.opening_balance,
          opening_date: input.opening_date,
        },
      );
      return this.getAccount(id)!;
    });
  }

  updateAccount(id: string, patch: Partial<AccountInput> & { closed?: number }): Account {
    return this.tx(() => {
      const before = this.getAccount(id);
      if (!before) throw new ValidationError('Account not found.');
      const fields = (
        [
          'name',
          'kind',
          'institution',
          'last4',
          'opening_balance',
          'opening_date',
          'closed',
        ] as const
      ).filter(
        (k) =>
          k in patch &&
          (patch as Record<string, unknown>)[k] !==
            (before as unknown as Record<string, unknown>)[k],
      );
      if (!fields.length) return before;
      if (fields.some((f) => f === 'opening_balance' || f === 'opening_date' || f === 'kind'))
        this.assertUnlocked(
          before.book_id,
          before.opening_date,
          patch.opening_date ?? before.opening_date,
        );
      this.run(`UPDATE accounts SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [
        ...fields.map((f) => ((patch as Record<string, unknown>)[f] ?? null) as SqlValue),
        id,
      ]);
      this.log(
        before.book_id,
        'update',
        'account',
        id,
        `Updated account "${patch.name ?? before.name}"`,
        patch,
      );
      return this.getAccount(id)!;
    });
  }

  deleteAccount(id: string) {
    this.tx(() => {
      const acct = this.getAccount(id);
      if (!acct) return;
      const n =
        this.scalar<number>('SELECT COUNT(*) FROM transactions WHERE account_id = ?', [id]) ?? 0;
      if (n > 0)
        throw new ValidationError(
          'This account has transactions. Close it instead of deleting it, so the history is kept.',
        );
      this.run('DELETE FROM accounts WHERE id = ?', [id]);
      this.log(acct.book_id, 'delete', 'account', id, `Deleted empty account "${acct.name}"`);
    });
  }

  // ------------------------------------------------------------- categories

  customCategories(bookId: string): Category[] {
    return this.all<Omit<Category, 'builtin'>>(
      'SELECT id, label, kind, ssa, court, color, hint FROM categories WHERE book_id = ?',
      [bookId],
    ).map((c) => ({ ...c, hint: c.hint ?? undefined, builtin: false }));
  }

  categoryIndex(bookId: string): CategoryIndex {
    return new CategoryIndex(this.customCategories(bookId));
  }

  addCategory(bookId: string, c: Omit<Category, 'builtin'>): Category {
    return this.tx(() => {
      if (this.categoryIndex(bookId).get(c.id))
        throw new ValidationError(`A category with id "${c.id}" already exists.`);
      this.run(
        'INSERT INTO categories(id, book_id, label, kind, ssa, court, color, hint) VALUES (?,?,?,?,?,?,?,?)',
        [c.id, bookId, c.label, c.kind, c.ssa, c.court, c.color, c.hint ?? null],
      );
      this.log(bookId, 'create', 'category', c.id, `Added category "${c.label}"`, c);
      return { ...c, builtin: false };
    });
  }

  deleteCategory(bookId: string, id: string) {
    this.tx(() => {
      const used =
        (this.scalar<number>(
          'SELECT COUNT(*) FROM transactions WHERE book_id = ? AND category = ?',
          [bookId, id],
        ) ?? 0) +
        (this.scalar<number>(
          'SELECT COUNT(*) FROM splits s JOIN transactions t ON t.id = s.tx_id WHERE t.book_id = ? AND s.category = ?',
          [bookId, id],
        ) ?? 0);
      if (used)
        throw new ValidationError(`${used} transactions use this category. Re-tag them first.`);
      const rules =
        this.scalar<number>('SELECT COUNT(*) FROM rules WHERE book_id = ? AND category = ?', [
          bookId,
          id,
        ]) ?? 0;
      this.run('DELETE FROM rules WHERE book_id = ? AND category = ?', [bookId, id]);
      this.run('DELETE FROM categories WHERE book_id = ? AND id = ?', [bookId, id]);
      this.log(
        bookId,
        'delete',
        'category',
        id,
        `Deleted category "${id}"${rules ? ` and ${rules} remembered payee${rules === 1 ? '' : 's'} that used it` : ''}`,
      );
    });
  }

  // ----------------------------------------------------------------- locking

  lockedThrough(bookId: string): ISODate | null {
    return (
      this.scalar<string>(
        "SELECT MAX(period_end) FROM reports WHERE book_id = ? AND status = 'filed'",
        [bookId],
      ) ?? null
    );
  }

  private assertUnlocked(bookId: string, ...dates: ISODate[]) {
    const through = this.lockedThrough(bookId);
    if (through && dates.some((d) => d <= through)) throw new LockedPeriodError(through);
  }

  private assertTxUnlocked(txId: string) {
    const t = this.getTransaction(txId);
    if (t) this.assertUnlocked(t.book_id, t.date);
  }

  // ------------------------------------------------------------ transactions

  getTransaction(id: string): Transaction | undefined {
    return this.get<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  }

  /**
   * Transactions newest first, each with the running balance of the selected
   * account (or of all accounts) after it posted.
   */
  listTransactions(bookId: string, f: TxFilter = {}): TxRow[] {
    const params: SqlValue[] = [bookId];
    let where = 't.book_id = ?';
    if (f.accountId) {
      where += ' AND t.account_id = ?';
      params.push(f.accountId);
    }
    const rows = this.all<Omit<TxRow, 'balance' | 'locked'>>(
      `SELECT t.*, a.name AS account_name,
              (SELECT COUNT(*) FROM receipts r WHERE r.tx_id = t.id) AS receipt_count,
              (SELECT COUNT(*) FROM splits s WHERE s.tx_id = t.id) AS split_count
         FROM transactions t JOIN accounts a ON a.id = t.account_id
        WHERE ${where}
        ORDER BY t.date ASC, t.created_at ASC, t.id ASC`,
      params,
    );
    // Each account's opening balance counts from its opening date onwards.
    const openings = (
      f.accountId ? [this.getAccount(f.accountId)!].filter(Boolean) : this.listAccounts(bookId)
    )
      .map((a) => ({ date: a.opening_date, amount: a.opening_balance }))
      .sort((a, b) => a.date.localeCompare(b.date));
    let nextOpening = 0;
    const through = this.lockedThrough(bookId);
    let balance = 0;
    let splitCats: Map<string, string[]> | null = null;
    if (f.category) {
      splitCats = new Map();
      for (const s of this.all<{ tx_id: string; category: string | null }>(
        'SELECT s.tx_id, s.category FROM splits s JOIN transactions t ON t.id = s.tx_id WHERE t.book_id = ?',
        [bookId],
      )) {
        const list = splitCats.get(s.tx_id) ?? [];
        list.push(s.category ?? 'untagged');
        splitCats.set(s.tx_id, list);
      }
    }
    const q = f.search?.trim().toLowerCase();
    const out: TxRow[] = [];
    const needs = f.needsReceipt ? this.needsReceiptIds(bookId) : null;
    for (const r of rows) {
      while (nextOpening < openings.length && openings[nextOpening].date <= r.date)
        balance += openings[nextOpening++].amount;
      balance += r.amount;
      if (f.from && r.date < f.from) continue;
      if (f.to && r.date > f.to) continue;
      if (f.category) {
        const cats = r.split_count > 0 ? (splitCats!.get(r.id) ?? []) : [r.category ?? 'untagged'];
        if (!cats.includes(f.category)) continue;
      }
      if (f.hasReceipt !== undefined && r.receipt_count > 0 !== f.hasReceipt) continue;
      if (needs && !needs.has(r.id)) continue;
      if (q) {
        const hay =
          `${r.payee} ${r.raw_payee ?? ''} ${r.memo} ${r.check_number} ${(r.amount / 100).toFixed(2)}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ ...r, balance, locked: Boolean(through && r.date <= through) });
    }
    return out.reverse();
  }

  addTransaction(bookId: string, input: TxInput, source: TxSource = 'manual'): Transaction {
    this.validateTx(input);
    return this.tx(() => {
      this.assertUnlocked(bookId, input.date);
      const id = newId('tx');
      const ts = this.ts();
      this.run(
        `INSERT INTO transactions(id, book_id, account_id, date, amount, payee, raw_payee, memo, category, check_number, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          bookId,
          input.account_id,
          input.date,
          input.amount,
          input.payee.trim(),
          null,
          input.memo ?? '',
          input.category ?? null,
          input.check_number ?? '',
          source,
          ts,
          ts,
        ],
      );
      this.log(
        bookId,
        'create',
        'transaction',
        id,
        `Added ${input.amount < 0 ? 'payment to' : 'deposit from'} ${input.payee.trim()} on ${input.date}`,
        {
          amount: input.amount,
          date: input.date,
          category: input.category ?? null,
        },
      );
      return this.getTransaction(id)!;
    });
  }

  private validateTx(input: Partial<TxInput>) {
    if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date))
      throw new ValidationError('Enter a valid date.');
    if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount === 0))
      throw new ValidationError('Enter an amount other than zero.');
    if (input.payee !== undefined && !input.payee.trim())
      throw new ValidationError('Enter who was paid or who paid.');
  }

  updateTransaction(id: string, patch: Partial<TxInput>): Transaction {
    this.validateTx(patch);
    return this.tx(() => {
      const before = this.getTransaction(id);
      if (!before) throw new ValidationError('Transaction not found.');
      this.assertUnlocked(before.book_id, before.date, ...(patch.date ? [patch.date] : []));
      const allowed: (keyof TxInput)[] = [
        'account_id',
        'date',
        'amount',
        'payee',
        'memo',
        'category',
        'check_number',
      ];
      const fields = allowed.filter(
        (k) =>
          patch[k] !== undefined && patch[k] !== (before as unknown as Record<string, unknown>)[k],
      );
      if (!fields.length) return before;
      if (fields.includes('amount')) {
        const splits = this.splitsFor(id);
        if (splits.length)
          throw new ValidationError(
            'This transaction is split. Edit the splits so they match the new amount, or remove them first.',
          );
      }
      this.run(
        `UPDATE transactions SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...fields.map((f) => (patch[f] ?? null) as SqlValue), this.ts(), id],
      );
      const changes = Object.fromEntries(
        fields.map((f) => [
          f,
          { from: (before as unknown as Record<string, unknown>)[f], to: patch[f] },
        ]),
      );
      this.log(
        before.book_id,
        'update',
        'transaction',
        id,
        `Edited ${before.payee} (${fields.join(', ')})`,
        changes,
      );
      return this.getTransaction(id)!;
    });
  }

  deleteTransaction(id: string) {
    this.tx(() => {
      const before = this.getTransaction(id);
      if (!before) return;
      this.assertUnlocked(before.book_id, before.date);
      this.run('DELETE FROM transactions WHERE id = ?', [id]);
      this.log(
        before.book_id,
        'delete',
        'transaction',
        id,
        `Deleted ${before.payee} ${before.amount / 100} on ${before.date}`,
        before,
      );
    });
  }

  setCategory(bookId: string, txIds: string[], category: string | null): number {
    if (category && !this.categoryIndex(bookId).get(category))
      throw new ValidationError(`Unknown category "${category}".`);
    return this.tx(() => {
      let n = 0;
      for (const id of txIds) {
        const t = this.getTransaction(id);
        if (!t || t.book_id !== bookId || t.category === category) continue;
        this.assertUnlocked(bookId, t.date);
        this.run('UPDATE transactions SET category = ?, updated_at = ? WHERE id = ?', [
          category,
          this.ts(),
          id,
        ]);
        n++;
      }
      if (n) {
        const label = category ? this.categoryIndex(bookId).label(category) : 'untagged';
        this.log(
          bookId,
          'tag',
          'transaction',
          txIds.length === 1 ? txIds[0] : null,
          `Tagged ${n} transaction${n === 1 ? '' : 's'} as ${label}`,
          {
            ids: txIds,
            category,
          },
        );
      }
      return n;
    });
  }

  splitsFor(txId: string): Split[] {
    return this.all<Split>('SELECT * FROM splits WHERE tx_id = ? ORDER BY rowid', [txId]);
  }

  setSplits(txId: string, splits: Omit<Split, 'id' | 'tx_id'>[]) {
    this.tx(() => {
      const t = this.getTransaction(txId);
      if (!t) throw new ValidationError('Transaction not found.');
      this.assertUnlocked(t.book_id, t.date);
      if (splits.length === 1) throw new ValidationError('A split needs at least two parts.');
      if (splits.length) {
        const total = splits.reduce((n, s) => n + s.amount, 0);
        if (total !== t.amount)
          throw new ValidationError(
            `The splits add up to ${total / 100} but the transaction is ${t.amount / 100}.`,
          );
        if (splits.some((s) => s.amount === 0))
          throw new ValidationError('Each split needs an amount.');
      }
      this.run('DELETE FROM splits WHERE tx_id = ?', [txId]);
      // When split, the parts carry the tags; the parent's own tag no longer applies.
      if (splits.length && t.category !== null)
        this.run('UPDATE transactions SET category = NULL, updated_at = ? WHERE id = ?', [
          this.ts(),
          txId,
        ]);
      for (const s of splits) {
        this.run('INSERT INTO splits(id, tx_id, amount, category, memo) VALUES (?,?,?,?,?)', [
          newId('sp'),
          txId,
          s.amount,
          s.category,
          s.memo ?? '',
        ]);
      }
      this.log(
        t.book_id,
        'split',
        'transaction',
        txId,
        splits.length
          ? `Split ${t.payee} into ${splits.length} parts`
          : `Removed splits from ${t.payee}`,
        { splits },
      );
    });
  }

  // ----------------------------------------------------------------- import

  previewImport(bookId: string, accountId: string, rows: ImportRow[]): ImportPreviewRow[] {
    const keys = importKeys(
      accountId,
      rows.map((r) => ({
        date: r.date,
        amount: r.amount,
        description: r.description,
        fitId: r.fitId,
      })),
    );
    const existing = new Set(
      this.all<{ import_key: string }>(
        'SELECT import_key FROM transactions WHERE account_id = ? AND import_key IS NOT NULL',
        [accountId],
      ).map((r) => r.import_key),
    );
    const rules = this.listRules(bookId);
    const through = this.lockedThrough(bookId);
    return rows.map((r, i) => {
      const key = keys[i];
      // A FITID repeated inside one file is the same bank transaction listed twice.
      const repeated = existing.has(key);
      existing.add(key);
      const status = repeated ? 'duplicate' : through && r.date <= through ? 'locked' : 'new';
      return {
        ...r,
        key,
        status,
        payee: prettyPayee(r.description) || r.description,
        category: matchRule(rules, r.description, r.amount)?.category ?? null,
      };
    });
  }

  importTransactions(
    bookId: string,
    accountId: string,
    rows: ImportRow[],
    source: 'csv' | 'ofx',
    overrides: Record<string, string | null> = {},
  ): ImportResult {
    return this.tx(() => {
      const preview = this.previewImport(bookId, accountId, rows);
      const rules = this.listRules(bookId);
      const result: ImportResult = { added: 0, duplicates: 0, locked: 0, autoTagged: 0 };
      const ts = this.ts();
      for (const r of preview) {
        if (r.status === 'duplicate') {
          result.duplicates++;
          continue;
        }
        if (r.status === 'locked') {
          result.locked++;
          continue;
        }
        const category = r.key in overrides ? overrides[r.key] : r.category;
        if (category && !(r.key in overrides)) {
          result.autoTagged++;
          const rule = matchRule(rules, r.description, r.amount);
          if (rule) this.run('UPDATE rules SET hits = hits + 1 WHERE id = ?', [rule.id]);
        }
        this.run(
          `INSERT INTO transactions(id, book_id, account_id, date, amount, payee, raw_payee, memo, category, check_number, source, import_key, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newId('tx'),
            bookId,
            accountId,
            r.date,
            r.amount,
            r.payee,
            r.description,
            r.memo ?? '',
            category,
            r.checkNumber ?? '',
            source,
            r.key,
            ts,
            ts,
          ],
        );
        result.added++;
      }
      const acct = this.getAccount(accountId);
      this.log(
        bookId,
        'import',
        'account',
        accountId,
        `Imported ${result.added} transactions into "${acct?.name}" from ${source.toUpperCase()} (${result.duplicates} duplicates skipped)`,
        result,
      );
      return result;
    });
  }

  getImportProfile(signature: string): string | undefined {
    return this.scalar<string>('SELECT mapping FROM import_profiles WHERE signature = ?', [
      signature,
    ]);
  }

  saveImportProfile(signature: string, mapping: object) {
    if (this.readOnly) return;
    this.run(
      'INSERT OR REPLACE INTO import_profiles(signature, mapping, updated_at) VALUES (?,?,?)',
      [signature, JSON.stringify(mapping), this.ts()],
    );
  }

  // ------------------------------------------------------------------ rules

  listRules(bookId: string): Rule[] {
    return this.all<Rule>('SELECT * FROM rules WHERE book_id = ? ORDER BY pattern', [bookId]);
  }

  /** Remember "payee -> category" and tag matching untagged transactions. Returns how many were tagged. */
  addRule(
    bookId: string,
    pattern: string,
    category: string,
    direction: RuleDirection = 'any',
    applyToExisting = true,
  ): number {
    const normalized = normalizePayee(pattern);
    if (!normalized) throw new ValidationError('Enter some words from the bank description.');
    return this.tx(() => {
      const existing = this.get<Rule>(
        'SELECT * FROM rules WHERE book_id = ? AND pattern = ? AND direction = ?',
        [bookId, normalized, direction],
      );
      if (existing) this.run('UPDATE rules SET category = ? WHERE id = ?', [category, existing.id]);
      else
        this.run(
          'INSERT INTO rules(id, book_id, pattern, category, direction, hits, created_at) VALUES (?,?,?,?,?,0,?)',
          [newId('rl'), bookId, normalized, category, direction, this.ts()],
        );
      this.log(
        bookId,
        'create',
        'rule',
        null,
        `Always tag "${normalized}" as ${this.categoryIndex(bookId).label(category)}`,
        { pattern: normalized, category, direction },
      );
      if (!applyToExisting) return 0;
      const rules = this.listRules(bookId);
      const untagged = this.untaggedCandidates(bookId);
      const ids = untagged
        .filter(
          (t) =>
            matchRule(rules, t.raw_payee || t.payee, t.amount)?.category === category &&
            matchRule(rules, t.raw_payee || t.payee, t.amount)?.pattern === normalized,
        )
        .map((t) => t.id);
      if (ids.length) this.setCategory(bookId, ids, category);
      return ids.length;
    });
  }

  deleteRule(id: string) {
    this.tx(() => {
      const r = this.get<Rule>('SELECT * FROM rules WHERE id = ?', [id]);
      if (!r) return;
      this.run('DELETE FROM rules WHERE id = ?', [id]);
      this.log(r.book_id, 'delete', 'rule', id, `Stopped auto-tagging "${r.pattern}"`);
    });
  }

  /** Untagged transactions a new rule would tag, for the "tag all like this" prompt. */
  countMatching(bookId: string, pattern: string, direction: RuleDirection): number {
    const fake: Rule = {
      id: 'x',
      book_id: bookId,
      pattern: normalizePayee(pattern),
      category: 'x',
      direction,
      hits: 0,
      created_at: '',
    };
    return this.untaggedCandidates(bookId).filter((t) =>
      matchRule([fake], t.raw_payee || t.payee, t.amount),
    ).length;
  }

  /** Untagged, unsplit transactions outside any filed period: the ones a new rule may tag. */
  private untaggedCandidates(bookId: string): Transaction[] {
    const through = this.lockedThrough(bookId);
    return this.all<Transaction>(
      `SELECT * FROM transactions t WHERE book_id = ? AND category IS NULL
         AND NOT EXISTS (SELECT 1 FROM splits s WHERE s.tx_id = t.id) ${through ? 'AND date > ?' : ''}`,
      through ? [bookId, through] : [bookId],
    );
  }

  // --------------------------------------------------------------- receipts

  addReceipt(bookId: string, input: ReceiptInput): ReceiptMeta {
    return this.tx(() => {
      if (input.tx_id) this.assertTxUnlocked(input.tx_id);
      const id = newId('rc');
      this.run(
        `INSERT INTO receipts(id, book_id, tx_id, filename, mime, data, thumb, size, ocr_text, ocr_confidence, ocr_total, ocr_date, ocr_merchant, note, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          bookId,
          input.tx_id ?? null,
          input.filename,
          input.mime,
          input.data,
          input.thumb ?? null,
          input.data.byteLength,
          input.ocr_text ?? null,
          input.ocr_confidence ?? null,
          input.ocr_total ?? null,
          input.ocr_date ?? null,
          input.ocr_merchant ?? null,
          input.note ?? '',
          this.ts(),
        ],
      );
      this.log(bookId, 'create', 'receipt', id, `Added receipt ${input.filename}`, {
        tx_id: input.tx_id ?? null,
        size: input.data.byteLength,
        sha256: sha256Hex(input.data),
      });
      return this.getReceipt(id)!;
    });
  }

  getReceipt(id: string): ReceiptMeta | undefined {
    return this.get<ReceiptMeta>(
      'SELECT id, book_id, tx_id, filename, mime, size, ocr_text, ocr_confidence, ocr_total, ocr_date, ocr_merchant, note, created_at FROM receipts WHERE id = ?',
      [id],
    );
  }

  listReceipts(bookId: string, opts: { txId?: string; unmatched?: boolean } = {}): ReceiptMeta[] {
    let where = 'book_id = ?';
    const params: SqlValue[] = [bookId];
    if (opts.txId) {
      where += ' AND tx_id = ?';
      params.push(opts.txId);
    }
    if (opts.unmatched) where += ' AND tx_id IS NULL';
    return this.all<ReceiptMeta>(
      `SELECT id, book_id, tx_id, filename, mime, size, ocr_text, ocr_confidence, ocr_total, ocr_date, ocr_merchant, note, created_at
         FROM receipts WHERE ${where} ORDER BY created_at DESC`,
      params,
    );
  }

  receiptData(
    id: string,
  ): { data: Uint8Array; mime: string; thumb: Uint8Array | null } | undefined {
    return this.get<{ data: Uint8Array; mime: string; thumb: Uint8Array | null }>(
      'SELECT data, mime, thumb FROM receipts WHERE id = ?',
      [id],
    );
  }

  updateReceipt(
    id: string,
    patch: Partial<
      Pick<
        ReceiptMeta,
        'tx_id' | 'note' | 'ocr_text' | 'ocr_total' | 'ocr_date' | 'ocr_merchant' | 'ocr_confidence'
      >
    >,
  ) {
    this.tx(() => {
      const r = this.getReceipt(id);
      if (!r) throw new ValidationError('Receipt not found.');
      const allowed = [
        'tx_id',
        'note',
        'ocr_text',
        'ocr_total',
        'ocr_date',
        'ocr_merchant',
        'ocr_confidence',
      ];
      const fields = (Object.keys(patch) as (keyof typeof patch)[]).filter((f) =>
        allowed.includes(f),
      );
      if (!fields.length) return;
      if ('tx_id' in patch && patch.tx_id !== r.tx_id) {
        if (r.tx_id) this.assertTxUnlocked(r.tx_id);
        if (patch.tx_id) this.assertTxUnlocked(patch.tx_id);
      }
      this.run(`UPDATE receipts SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, [
        ...fields.map((f) => (patch[f] ?? null) as SqlValue),
        id,
      ]);
      if ('tx_id' in patch) {
        const t = patch.tx_id ? this.getTransaction(patch.tx_id) : null;
        this.log(
          r.book_id,
          'link',
          'receipt',
          id,
          t
            ? `Attached receipt ${r.filename} to ${t.payee} on ${t.date}`
            : `Detached receipt ${r.filename}`,
          { tx_id: patch.tx_id },
        );
      }
    });
  }

  deleteReceipt(id: string) {
    this.tx(() => {
      const r = this.getReceipt(id);
      if (!r) return;
      if (r.tx_id) {
        const t = this.getTransaction(r.tx_id);
        if (t) this.assertUnlocked(r.book_id, t.date);
      }
      this.run('DELETE FROM receipts WHERE id = ?', [id]);
      this.log(r.book_id, 'delete', 'receipt', id, `Deleted receipt ${r.filename}`);
    });
  }

  // --------------------------------------------------------------- balances

  balanceAt(accountId: string, asOf: ISODate): number {
    const a = this.getAccount(accountId);
    if (!a) return 0;
    const sum =
      this.scalar<number>(
        'SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ? AND date <= ?',
        [accountId, asOf],
      ) ?? 0;
    return (asOf >= a.opening_date ? a.opening_balance : 0) + sum;
  }

  savingKinds(bookId: string): string[] {
    return this.categoryIndex(bookId)
      .all.filter((c) => c.kind === 'saving')
      .map((c) => c.id);
  }

  /** Money tagged "saved" that left tracked accounts; it still belongs to the beneficiary. */
  savedOffBook(bookId: string, asOf: ISODate): number {
    const ids = this.savingKinds(bookId);
    if (!ids.length) return 0;
    const sum =
      this.scalar<number>(
        `SELECT COALESCE(SUM(amount), 0) FROM tx_lines WHERE book_id = ? AND date <= ? AND category IN (${ids.map(() => '?').join(',')})`,
        [bookId, asOf, ...ids],
      ) ?? 0;
    return 0 - sum;
  }

  totalFunds(
    bookId: string,
    asOf: ISODate = '9999-12-31',
  ): { accounts: number; saved: number; total: number } {
    const accounts = this.listAccounts(bookId).reduce((n, a) => n + this.balanceAt(a.id, asOf), 0);
    const saved = this.savedOffBook(bookId, asOf);
    return { accounts, saved, total: accounts + saved };
  }

  // ---------------------------------------------------------------- stats

  categoryKindMap(bookId: string): Map<string, CategoryKind> {
    return new Map(this.categoryIndex(bookId).all.map((c) => [c.id, c.kind]));
  }

  monthlyFlows(
    bookId: string,
    from: ISODate,
    to: ISODate,
  ): { month: string; in: number; out: number; saved: number }[] {
    const kinds = this.categoryKindMap(bookId);
    const lines = this.all<{ date: string; amount: number; category: string | null }>(
      'SELECT date, amount, category FROM tx_lines WHERE book_id = ? AND date >= ? AND date <= ?',
      [bookId, from, to],
    );
    const map = new Map<string, { in: number; out: number; saved: number }>();
    for (const l of lines) {
      const key = l.date.slice(0, 7);
      const m = map.get(key) ?? { in: 0, out: 0, saved: 0 };
      const kind = l.category ? kinds.get(l.category) : undefined;
      if (kind === 'transfer') continue;
      if (kind === 'saving') m.saved -= l.amount;
      else if (kind === 'income' || (!kind && l.amount > 0)) m.in += l.amount;
      else m.out -= l.amount;
      map.set(key, m);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
  }

  categoryTotals(
    bookId: string,
    from: ISODate,
    to: ISODate,
  ): { category: string | null; total: number; count: number }[] {
    return this.all<{ category: string | null; total: number; count: number }>(
      `SELECT category, -SUM(amount) AS total, COUNT(*) AS count FROM tx_lines
        WHERE book_id = ? AND date >= ? AND date <= ? GROUP BY category ORDER BY total DESC`,
      [bookId, from, to],
    );
  }

  /** Ledger lines with no tag, or a tag that no longer exists. */
  untaggedLineCount(bookId: string, from: ISODate = '0000-01-01', to: ISODate = '9999-12-31') {
    const known = this.categoryIndex(bookId);
    return this.all<{ category: string | null }>(
      'SELECT category FROM tx_lines WHERE book_id = ? AND date BETWEEN ? AND ?',
      [bookId, from, to],
    ).filter((l) => !known.get(l.category)).length;
  }

  /**
   * Payments at or above the book's receipt threshold with no receipt attached,
   * ignoring money that only moved between the beneficiary's own accounts or into savings.
   */
  needsReceiptIds(
    bookId: string,
    from: ISODate = '0000-01-01',
    to: ISODate = '9999-12-31',
  ): Set<string> {
    const threshold = this.getBook(bookId)?.receipt_threshold ?? 5000;
    const cats = this.categoryIndex(bookId);
    const neutral = (c: string | null) => {
      const kind = cats.get(c)?.kind;
      return kind === 'transfer' || kind === 'saving';
    };
    const lines = this.all<{ tx_id: string; category: string | null }>(
      `SELECT l.tx_id, l.category FROM tx_lines l JOIN transactions t ON t.id = l.tx_id
        WHERE l.book_id = ? AND l.date BETWEEN ? AND ? AND t.amount <= ?
          AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.tx_id = l.tx_id)`,
      [bookId, from, to, -threshold],
    );
    const ids = new Set<string>();
    for (const l of lines) if (!neutral(l.category)) ids.add(l.tx_id);
    return ids;
  }

  counts(bookId: string, from: ISODate = '0000-01-01', to: ISODate = '9999-12-31') {
    return {
      transactions:
        this.scalar<number>(
          'SELECT COUNT(*) FROM transactions WHERE book_id = ? AND date BETWEEN ? AND ?',
          [bookId, from, to],
        ) ?? 0,
      untagged: this.untaggedLineCount(bookId, from, to),
      missing_receipts: this.needsReceiptIds(bookId, from, to).size,
      unmatched_receipts:
        this.scalar<number>('SELECT COUNT(*) FROM receipts WHERE book_id = ? AND tx_id IS NULL', [
          bookId,
        ]) ?? 0,
      receipts:
        this.scalar<number>('SELECT COUNT(*) FROM receipts WHERE book_id = ?', [bookId]) ?? 0,
    };
  }

  // --------------------------------------------------------- reconciliation

  listReconciliations(bookId: string, accountId?: string): Reconciliation[] {
    return accountId
      ? this.all<Reconciliation>(
          'SELECT * FROM reconciliations WHERE account_id = ? ORDER BY statement_date DESC',
          [accountId],
        )
      : this.all<Reconciliation>(
          'SELECT * FROM reconciliations WHERE book_id = ? ORDER BY statement_date DESC',
          [bookId],
        );
  }

  reconcile(
    accountId: string,
    statementDate: ISODate,
    statementBalance: number,
    note = '',
  ): Reconciliation {
    return this.tx(() => {
      const a = this.getAccount(accountId);
      if (!a) throw new ValidationError('Account not found.');
      const ledger = this.balanceAt(accountId, statementDate);
      const id = newId('rn');
      this.run(
        'INSERT INTO reconciliations(id, book_id, account_id, statement_date, statement_balance, ledger_balance, difference, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          id,
          a.book_id,
          accountId,
          statementDate,
          statementBalance,
          ledger,
          statementBalance - ledger,
          note,
          this.ts(),
        ],
      );
      if (statementBalance === ledger) {
        this.run(
          'UPDATE transactions SET cleared = 1, reconciliation_id = COALESCE(reconciliation_id, ?) WHERE account_id = ? AND date <= ?',
          [id, accountId, statementDate],
        );
      }
      this.log(
        a.book_id,
        'reconcile',
        'account',
        accountId,
        statementBalance === ledger
          ? `Reconciled "${a.name}" through ${statementDate}: matches the bank statement`
          : `Reconciled "${a.name}" through ${statementDate}: off by ${(statementBalance - ledger) / 100}`,
        { statementBalance, ledger },
      );
      return this.get<Reconciliation>('SELECT * FROM reconciliations WHERE id = ?', [id])!;
    });
  }

  // ---------------------------------------------------------------- reports

  listReports(bookId: string): Report[] {
    return this.all<Report>(
      'SELECT * FROM reports WHERE book_id = ? ORDER BY period_end DESC, created_at DESC',
      [bookId],
    );
  }

  saveReport(
    bookId: string,
    r: {
      id?: string;
      template_id: string;
      template_version: string;
      template_name: string;
      period_start: string;
      period_end: string;
      inputs: object;
      totals: object;
    },
  ): Report {
    return this.tx(() => {
      const ts = this.ts();
      const existing = r.id
        ? this.get<Report>('SELECT * FROM reports WHERE id = ?', [r.id])
        : undefined;
      if (existing?.status === 'filed')
        throw new ValidationError('This report was filed. Reopen it before changing it.');
      const id = existing?.id ?? newId('rp');
      if (existing) {
        this.run(
          'UPDATE reports SET period_start = ?, period_end = ?, inputs = ?, totals = ?, template_version = ?, updated_at = ? WHERE id = ?',
          [
            r.period_start,
            r.period_end,
            JSON.stringify(r.inputs),
            JSON.stringify(r.totals),
            r.template_version,
            ts,
            id,
          ],
        );
      } else {
        this.run(
          `INSERT INTO reports(id, book_id, template_id, template_version, template_name, period_start, period_end, inputs, totals, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?)`,
          [
            id,
            bookId,
            r.template_id,
            r.template_version,
            r.template_name,
            r.period_start,
            r.period_end,
            JSON.stringify(r.inputs),
            JSON.stringify(r.totals),
            ts,
            ts,
          ],
        );
        this.log(
          bookId,
          'create',
          'report',
          id,
          `Started ${r.template_name} for ${r.period_start} to ${r.period_end}`,
        );
      }
      return this.get<Report>('SELECT * FROM reports WHERE id = ?', [id])!;
    });
  }

  setReportStatus(
    id: string,
    status: ReportStatus,
    filedAt: ISODate = todayISO(this.now()),
  ): Report {
    return this.tx(() => {
      const r = this.get<Report>('SELECT * FROM reports WHERE id = ?', [id]);
      if (!r) throw new ValidationError('Report not found.');
      this.run('UPDATE reports SET status = ?, filed_at = ?, updated_at = ? WHERE id = ?', [
        status,
        status === 'filed' ? filedAt : r.filed_at,
        this.ts(),
        id,
      ]);
      const verb =
        status === 'filed'
          ? `Marked ${r.template_name} as filed on ${filedAt}; transactions through ${r.period_end} are now locked`
          : status === 'reopened'
            ? `Reopened ${r.template_name} for corrections`
            : `Set ${r.template_name} back to draft`;
      this.log(r.book_id, status === 'filed' ? 'file' : 'reopen', 'report', id, verb, {
        totals: JSON.parse(r.totals),
      });
      return this.get<Report>('SELECT * FROM reports WHERE id = ?', [id])!;
    });
  }

  deleteReport(id: string) {
    this.tx(() => {
      const r = this.get<Report>('SELECT * FROM reports WHERE id = ?', [id]);
      if (!r) return;
      if (r.status === 'filed')
        throw new ValidationError('Filed reports cannot be deleted. Reopen it first.');
      this.run('DELETE FROM reports WHERE id = ?', [id]);
      this.log(r.book_id, 'delete', 'report', id, `Deleted draft ${r.template_name}`);
    });
  }

  // ------------------------------------------------------------- templates

  listUserTemplates(): { id: string; yaml: string; updated_at: string }[] {
    return this.all('SELECT id, yaml, updated_at FROM user_templates ORDER BY id');
  }

  saveUserTemplate(id: string, yaml: string) {
    this.assertWritable();
    const ts = this.ts();
    this.run(
      'INSERT INTO user_templates(id, yaml, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET yaml = excluded.yaml, updated_at = excluded.updated_at',
      [id, yaml, ts, ts],
    );
    this.onChange?.();
  }

  deleteUserTemplate(id: string) {
    this.assertWritable();
    this.run('DELETE FROM user_templates WHERE id = ?', [id]);
    this.onChange?.();
  }

  // ------------------------------------------------------ report evaluation

  buildEvalContext(
    bookId: string,
    period: { start: ISODate; end: ISODate },
    inputs: Record<string, Value> = {},
    today: ISODate = todayISO(this.now()),
  ): EvalContext {
    const book = this.getBook(bookId);
    if (!book) throw new ValidationError('Book not found.');
    const accounts = this.listAccounts(bookId);
    const kindOf = new Map(accounts.map((a) => [a.id, a]));
    const receipts = new Map<string, string[]>();
    for (const r of this.all<{ id: string; tx_id: string }>(
      'SELECT id, tx_id FROM receipts WHERE book_id = ? AND tx_id IS NOT NULL',
      [bookId],
    )) {
      const list = receipts.get(r.tx_id) ?? [];
      list.push(r.id);
      receipts.set(r.tx_id, list);
    }
    const lines: EvalLine[] = this.all<{
      tx_id: string;
      line_id: string;
      account_id: string;
      date: string;
      amount: number;
      category: string | null;
      payee: string;
      memo: string;
      check_number: string;
      tx_amount: number;
    }>(
      `SELECT l.*, t.amount AS tx_amount FROM tx_lines l JOIN transactions t ON t.id = l.tx_id
        WHERE l.book_id = ? AND l.date >= ? AND l.date <= ? ORDER BY l.date, l.tx_id, l.line_id`,
      [bookId, period.start, period.end],
    ).map((l) => {
      const a = kindOf.get(l.account_id);
      return {
        txId: l.tx_id,
        lineId: l.line_id,
        date: l.date,
        amount: l.amount,
        category: l.category,
        payee: l.payee,
        memo: l.memo,
        checkNumber: l.check_number,
        accountId: l.account_id,
        accountName: a?.name ?? '',
        accountKind: a?.kind ?? 'other',
        receiptIds: receipts.get(l.tx_id) ?? [],
        txAmount: l.tx_amount,
      };
    });
    const dayBefore = addDays(period.start, -1);
    const bookStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(book))
      bookStrings[k] = v === null || v === undefined ? '' : String(v);
    bookStrings.role_label = ROLE_LABELS[book.role] ?? book.role;
    return {
      book: bookStrings,
      period,
      lines,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        start: this.balanceAt(a.id, dayBefore),
        end: this.balanceAt(a.id, period.end),
      })),
      savedOffBook: {
        start: this.savedOffBook(bookId, dayBefore),
        end: this.savedOffBook(bookId, period.end),
      },
      counts: this.counts(bookId, period.start, period.end),
      categories: this.categoryIndex(bookId),
      inputs,
      today,
    };
  }
}
