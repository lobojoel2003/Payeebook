import type { SqlJsStatic } from 'sql.js';
import { fingerprint, sha256Hex } from '../core/sha256';
import { Store } from './store';

/**
 * Read-only sharing. A snapshot is one book copied into a fresh SQLite file,
 * wrapped in a small JSON envelope with a SHA-256 fingerprint and optional
 * passphrase encryption (AES-256-GCM, key from PBKDF2-SHA256). The recipient
 * opens it in Payeebook in read-only mode; nothing they do changes the file.
 */
export const SNAPSHOT_FORMAT = 'payeebook-snapshot';
export const SNAPSHOT_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export interface SnapshotEnvelope {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  app_version: string;
  created_at: string;
  sha256: string;
  /** Present only when unencrypted, so names never leak from an encrypted file. */
  summary?: {
    beneficiary: string;
    fiduciary: string;
    transactions: number;
    receipts: number;
    prepared_by_note?: string;
  };
  encryption: null | {
    alg: 'AES-GCM';
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    iv: string;
  };
  data: string;
}

export interface OpenedSnapshot {
  bytes: Uint8Array;
  sha256: string;
  fingerprint: string;
  envelope: SnapshotEnvelope;
  integrity: 'verified' | 'mismatch';
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Copy one book (and only that book) into a new database file. */
export function extractBook(SQL: SqlJsStatic, source: Store, bookId: string): Uint8Array {
  const copy = new SQL.Database(source.export());
  try {
    copy.run('PRAGMA foreign_keys = ON;');
    copy.run('DELETE FROM books WHERE id <> ?', [bookId]);
    copy.run('DELETE FROM audit_log WHERE book_id <> ?', [bookId]);
    copy.run('DELETE FROM import_profiles');
    // Custom templates are shared by every book on the device: keep only the ones this book used.
    copy.run(
      'DELETE FROM user_templates WHERE id NOT IN (SELECT template_id FROM reports WHERE book_id = ?)',
      [bookId],
    );
    copy.run("DELETE FROM meta WHERE key NOT IN ('schema_version', 'created_at', ?)", [
      `audit_head:${bookId}`,
    ]);
    copy.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['active_book', bookId]);
    copy.run('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)', ['snapshot_of', bookId]);
    copy.exec('VACUUM');
    return copy.export();
  } finally {
    copy.close();
  }
}

export async function createSnapshot(
  SQL: SqlJsStatic,
  store: Store,
  bookId: string,
  opts: { passphrase?: string; appVersion: string; note?: string },
): Promise<{ envelope: SnapshotEnvelope; json: string; fingerprint: string }> {
  const bytes = extractBook(SQL, store, bookId);
  const hash = sha256Hex(bytes);
  const book = store.getBook(bookId)!;
  const counts = store.counts(bookId);
  let data: Uint8Array = bytes;
  let encryption: SnapshotEnvelope['encryption'] = null;
  if (opts.passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(opts.passphrase, salt, PBKDF2_ITERATIONS);
    data = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        bytes as BufferSource,
      ),
    );
    encryption = {
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
    };
  }
  const envelope: SnapshotEnvelope = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    app_version: opts.appVersion,
    created_at: new Date().toISOString(),
    sha256: hash,
    summary: opts.passphrase
      ? undefined
      : {
          beneficiary: book.beneficiary_name,
          fiduciary: book.fiduciary_name,
          transactions: counts.transactions,
          receipts: counts.receipts,
          prepared_by_note: opts.note || undefined,
        },
    encryption,
    data: toBase64(data),
  };
  return { envelope, json: JSON.stringify(envelope), fingerprint: fingerprint(hash) };
}

export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly code: 'format' | 'passphrase' | 'version',
  ) {
    super(message);
  }
}

export function parseEnvelope(text: string): SnapshotEnvelope {
  let env: SnapshotEnvelope;
  try {
    env = JSON.parse(text) as SnapshotEnvelope;
  } catch {
    throw new SnapshotError('This file is not a Payeebook shared book.', 'format');
  }
  if (env?.format !== SNAPSHOT_FORMAT || typeof env.data !== 'string')
    throw new SnapshotError('This file is not a Payeebook shared book.', 'format');
  if (env.version > SNAPSHOT_VERSION)
    throw new SnapshotError(
      'This shared book was made by a newer Payeebook. Update the app to open it.',
      'version',
    );
  return env;
}

export async function openSnapshot(text: string, passphrase?: string): Promise<OpenedSnapshot> {
  const envelope = parseEnvelope(text);
  let bytes = fromBase64(envelope.data);
  if (envelope.encryption) {
    if (!passphrase)
      throw new SnapshotError(
        'This shared book is protected. Enter the passphrase you were given.',
        'passphrase',
      );
    try {
      const key = await deriveKey(
        passphrase,
        fromBase64(envelope.encryption.salt),
        envelope.encryption.iterations,
      );
      bytes = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(envelope.encryption.iv) as BufferSource },
          key,
          bytes as BufferSource,
        ),
      );
    } catch {
      throw new SnapshotError('That passphrase did not unlock the file.', 'passphrase');
    }
  }
  const hash = sha256Hex(bytes);
  return {
    bytes,
    sha256: hash,
    fingerprint: fingerprint(hash),
    envelope,
    integrity: hash === envelope.sha256 ? 'verified' : 'mismatch',
  };
}

/** A full backup is the raw SQLite file. Validate it before replacing the local book. */
export function validateBackup(
  SQL: SqlJsStatic,
  bytes: Uint8Array,
): { books: number; schema: number } {
  const header = new TextDecoder().decode(bytes.subarray(0, 15));
  if (header !== 'SQLite format 3')
    throw new Error('This is not a Payeebook backup (.sqlite) file.');
  const db = new SQL.Database(bytes);
  try {
    const schema = Number(
      db.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0]?.values[0]?.[0] ?? 0,
    );
    const books = Number(db.exec('SELECT COUNT(*) FROM books')[0]?.values[0]?.[0] ?? 0);
    if (!schema) throw new Error('This SQLite file was not made by Payeebook.');
    return { books, schema };
  } catch (e) {
    throw new Error(
      (e as Error).message.includes('no such table')
        ? 'This SQLite file was not made by Payeebook.'
        : (e as Error).message,
    );
  } finally {
    db.close();
  }
}
