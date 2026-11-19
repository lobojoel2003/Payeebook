import type { AccountKind, FiduciaryRole } from '../core/templates/types';
import type { RuleDirection } from '../core/payee';

export type { AccountKind, FiduciaryRole };

export interface Book {
  id: string;
  beneficiary_name: string;
  beneficiary_dob: string | null;
  fiduciary_name: string;
  fiduciary_phone: string | null;
  fiduciary_address: string | null;
  role: FiduciaryRole;
  state: string | null;
  county: string | null;
  court: string | null;
  case_number: string | null;
  claim_number: string | null;
  appointment_date: string | null;
  /** Month (1-12) the annual report period starts. */
  report_month: number | null;
  /** Expenses at or above this many cents should have a receipt. */
  receipt_threshold: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type BookInput = Omit<Book, 'id' | 'created_at' | 'updated_at' | 'receipt_threshold'> & {
  receipt_threshold?: number;
};

export interface Account {
  id: string;
  book_id: string;
  name: string;
  kind: AccountKind;
  institution: string | null;
  last4: string | null;
  opening_balance: number;
  opening_date: string;
  closed: number;
  created_at: string;
}

export type AccountInput = Pick<Account, 'name' | 'kind' | 'opening_balance' | 'opening_date'> &
  Partial<Pick<Account, 'institution' | 'last4'>>;

export type TxSource = 'manual' | 'csv' | 'ofx' | 'receipt' | 'demo';

export interface Transaction {
  id: string;
  book_id: string;
  account_id: string;
  date: string;
  amount: number;
  payee: string;
  raw_payee: string | null;
  memo: string;
  category: string | null;
  check_number: string;
  source: TxSource;
  import_key: string | null;
  cleared: number;
  reconciliation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TxRow extends Transaction {
  account_name: string;
  receipt_count: number;
  split_count: number;
  balance: number;
  locked: boolean;
}

export interface TxInput {
  account_id: string;
  date: string;
  amount: number;
  payee: string;
  memo?: string;
  category?: string | null;
  check_number?: string;
}

export interface Split {
  id: string;
  tx_id: string;
  amount: number;
  category: string | null;
  memo: string;
}

export interface ReceiptMeta {
  id: string;
  book_id: string;
  tx_id: string | null;
  filename: string;
  mime: string;
  size: number;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ocr_total: number | null;
  ocr_date: string | null;
  ocr_merchant: string | null;
  note: string;
  created_at: string;
}

export interface ReceiptInput {
  filename: string;
  mime: string;
  data: Uint8Array;
  thumb?: Uint8Array | null;
  tx_id?: string | null;
  ocr_text?: string | null;
  ocr_confidence?: number | null;
  ocr_total?: number | null;
  ocr_date?: string | null;
  ocr_merchant?: string | null;
  note?: string;
}

export interface Rule {
  id: string;
  book_id: string;
  pattern: string;
  category: string;
  direction: RuleDirection;
  hits: number;
  created_at: string;
}

export interface Reconciliation {
  id: string;
  book_id: string;
  account_id: string;
  statement_date: string;
  statement_balance: number;
  ledger_balance: number;
  difference: number;
  note: string;
  created_at: string;
}

export type ReportStatus = 'draft' | 'filed' | 'reopened';

export interface Report {
  id: string;
  book_id: string;
  template_id: string;
  template_version: string;
  template_name: string;
  period_start: string;
  period_end: string;
  inputs: string;
  totals: string;
  status: ReportStatus;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  seq: number;
  book_id: string;
  ts: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  details: string;
  prev_hash: string;
  hash: string;
}

export interface ImportRow {
  date: string;
  amount: number;
  description: string;
  memo?: string;
  checkNumber?: string;
  fitId?: string;
}

export type ImportStatus = 'new' | 'duplicate' | 'locked';

export interface ImportPreviewRow extends ImportRow {
  key: string;
  status: ImportStatus;
  payee: string;
  category: string | null;
}

export interface ImportResult {
  added: number;
  duplicates: number;
  locked: number;
  autoTagged: number;
}

export const ROLE_LABELS: Record<FiduciaryRole, string> = {
  ssa_payee: 'Social Security representative payee',
  ssi_payee: 'SSI representative payee',
  va_fiduciary: 'VA fiduciary',
  guardian: 'Guardian of the estate',
  conservator: 'Conservator',
  trustee: 'Trustee',
  other: 'Fiduciary',
};

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash on hand',
  prepaid: 'Prepaid card',
  investment: 'Investment',
  other: 'Other',
};
