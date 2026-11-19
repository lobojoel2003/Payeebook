/**
 * SQLite schema, applied as ordered migrations. Never edit a shipped migration;
 * append a new one so existing books upgrade in place.
 */
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE books (
    id TEXT PRIMARY KEY,
    beneficiary_name TEXT NOT NULL,
    beneficiary_dob TEXT,
    fiduciary_name TEXT NOT NULL,
    fiduciary_phone TEXT,
    fiduciary_address TEXT,
    role TEXT NOT NULL,
    state TEXT,
    county TEXT,
    court TEXT,
    case_number TEXT,
    claim_number TEXT,
    appointment_date TEXT,
    report_month INTEGER,
    receipt_threshold INTEGER NOT NULL DEFAULT 5000,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    institution TEXT,
    last4 TEXT,
    opening_balance INTEGER NOT NULL DEFAULT 0,
    opening_date TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_accounts_book ON accounts(book_id);

  CREATE TABLE categories (
    id TEXT NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    ssa TEXT NOT NULL,
    court TEXT NOT NULL,
    color TEXT NOT NULL,
    hint TEXT,
    PRIMARY KEY (book_id, id)
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    payee TEXT NOT NULL,
    raw_payee TEXT,
    memo TEXT NOT NULL DEFAULT '',
    category TEXT,
    check_number TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    import_key TEXT,
    cleared INTEGER NOT NULL DEFAULT 0,
    reconciliation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_tx_book_date ON transactions(book_id, date);
  CREATE INDEX idx_tx_account_date ON transactions(account_id, date);
  CREATE UNIQUE INDEX idx_tx_import ON transactions(account_id, import_key) WHERE import_key IS NOT NULL;

  CREATE TABLE splits (
    id TEXT PRIMARY KEY,
    tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    category TEXT,
    memo TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_splits_tx ON splits(tx_id);

  CREATE TABLE receipts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tx_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    thumb BLOB,
    size INTEGER NOT NULL,
    ocr_text TEXT,
    ocr_confidence REAL,
    ocr_total INTEGER,
    ocr_date TEXT,
    ocr_merchant TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_receipts_book ON receipts(book_id);
  CREATE INDEX idx_receipts_tx ON receipts(tx_id);

  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'any',
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_rules_book ON rules(book_id);

  CREATE TABLE reconciliations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    statement_date TEXT NOT NULL,
    statement_balance INTEGER NOT NULL,
    ledger_balance INTEGER NOT NULL,
    difference INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_recon_account ON reconciliations(account_id, statement_date);

  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    template_version TEXT NOT NULL,
    template_name TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    inputs TEXT NOT NULL DEFAULT '{}',
    totals TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    filed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_reports_book ON reports(book_id);

  CREATE TABLE user_templates (
    id TEXT PRIMARY KEY,
    yaml TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE import_profiles (
    signature TEXT PRIMARY KEY,
    mapping TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX idx_audit_book ON audit_log(book_id, seq);

  -- One row per ledger line: split transactions contribute one row per split.
  CREATE VIEW tx_lines AS
    SELECT t.id AS tx_id, s.id AS line_id, t.book_id, t.account_id, t.date,
           s.amount AS amount, s.category AS category, t.payee, COALESCE(NULLIF(s.memo, ''), t.memo) AS memo,
           t.check_number
      FROM transactions t JOIN splits s ON s.tx_id = t.id
    UNION ALL
    SELECT t.id, '', t.book_id, t.account_id, t.date, t.amount, t.category, t.payee, t.memo, t.check_number
      FROM transactions t
     WHERE NOT EXISTS (SELECT 1 FROM splits s WHERE s.tx_id = t.id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
