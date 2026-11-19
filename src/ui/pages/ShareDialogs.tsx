import { useState } from 'react';
import { ShieldCheck, ShieldAlert, KeyRound, FileUp } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useApp } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { createSnapshot, parseEnvelope, SnapshotError, validateBackup } from '../../db/snapshot';
import { saveFile, slug, readFileBytes } from '../download';
import { BUILD } from '../../buildInfo';
import { todayISO } from '../../core/dates';

export function OpenSharedDialog({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened?: () => void;
}) {
  const { openShared } = useApp();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string; encrypted: boolean } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPassphrase('');
    setError('');
    setBusy(false);
  };

  const pick = async (f: File) => {
    setError('');
    try {
      const text = await f.text();
      const env = parseEnvelope(text);
      setFile({ name: f.name, text, encrypted: Boolean(env.encryption) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const info = await openShared(file.text, passphrase || undefined);
      toast.success(
        info.integrity === 'verified'
          ? `Opened read-only. Fingerprint ${info.fingerprint}.`
          : 'Opened, but the fingerprint does not match. Treat the numbers with caution.',
      );
      reset();
      onClose();
      onOpened?.();
    } catch (e) {
      setError(e instanceof SnapshotError ? e.message : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Open a shared book"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!file || busy || (file.encrypted && !passphrase)}
            onClick={submit}
          >
            {busy ? 'Opening…' : 'Open read-only'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="text-2">
          Choose the <b>.payeebook</b> file you were sent. It opens read-only: you can look at every
          transaction, receipt and report, but nothing can be changed.
        </p>
        <label className="field">
          <span>Shared book file</span>
          <input
            type="file"
            accept=".payeebook,application/json"
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
            data-testid="shared-file"
          />
        </label>
        {file?.encrypted && (
          <label className="field">
            <span>
              <KeyRound size={14} style={{ verticalAlign: '-2px' }} /> Passphrase
            </span>
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Ask the sender, ideally by phone"
            />
          </label>
        )}
        {error && (
          <div className="callout callout-danger">
            <ShieldAlert size={18} />
            <div>{error}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function CreateSnapshotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { SQL, local, book } = useApp();
  const toast = useToast();
  const [protect, setProtect] = useState(true);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ fingerprint: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!book) return null;
  const weak = protect && pass.length > 0 && pass.length < 10;
  const mismatch = protect && pass2.length > 0 && pass !== pass2;

  const create = async () => {
    setBusy(true);
    try {
      const snap = await createSnapshot(SQL, local, book.id, {
        passphrase: protect ? pass : undefined,
        appVersion: BUILD.version,
        note,
      });
      const name = `${slug(book.beneficiary_name)}-shared-${todayISO()}.payeebook`;
      const saved = await saveFile(name, snap.json, 'application/json');
      if (saved) {
        local.tx(() =>
          local.log(
            book.id,
            'share',
            'book',
            book.id,
            `Created a read-only copy${protect ? ' (passphrase protected)' : ''}, fingerprint ${snap.fingerprint}`,
            {
              sha256: snap.envelope.sha256,
            },
          ),
        );
        setResult({ fingerprint: snap.fingerprint, name });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResult(null);
    setPass('');
    setPass2('');
    setNote('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Share a read-only copy"
      footer={
        result ? (
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || (protect && (pass.length < 10 || pass !== pass2))}
              onClick={create}
            >
              {busy ? 'Preparing…' : 'Create file'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <div className="callout callout-ok">
            <ShieldCheck size={18} />
            <div>
              Saved <b>{result.name}</b>. Send it by email or a shared drive
              {protect ? ', and give the passphrase separately, for example by phone' : ''}.
            </div>
          </div>
          <div>
            <div className="field-label">Fingerprint</div>
            <div className="fingerprint" data-testid="fingerprint">
              {result.fingerprint}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              When they open the file, Payeebook shows the same fingerprint. If you read it to each
              other and it matches, the copy has not been altered.
            </p>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="text-2">
            Make a copy of <b>{book.beneficiary_name}</b>’s book, with receipts and the activity
            log, that a sibling, the beneficiary or an attorney can open in Payeebook read-only. It
            is a snapshot: later changes are not included.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={protect}
              onChange={(e) => setProtect(e.target.checked)}
            />
            Protect with a passphrase (recommended, encrypts the file)
          </label>
          {protect && (
            <div className="form-grid">
              <label className="field">
                <span>Passphrase</span>
                <input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="new-password"
                />
                {weak && (
                  <span className="hint">
                    Use at least 10 characters, for example three random words.
                  </span>
                )}
              </label>
              <label className="field">
                <span>Repeat passphrase</span>
                <input
                  type="password"
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  autoComplete="new-password"
                />
                {mismatch && (
                  <span className="hint danger-text">The passphrases do not match.</span>
                )}
              </label>
            </div>
          )}
          {!protect && (
            <label className="field">
              <span>
                Note for the reader{' '}
                <span className="hint">(optional, visible without a passphrase)</span>
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Books through June for the annual family call"
              />
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}

export function RestoreBackupDialog({
  open,
  onClose,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const { SQL, local, replaceLocal, readOnly } = useApp();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; books: number } | null>(null);
  const [error, setError] = useState('');
  const existing = local.listBooks().length;

  const pick = async (f: File) => {
    setError('');
    try {
      const bytes = await readFileBytes(f);
      const info = validateBackup(SQL, bytes);
      setFile({ name: f.name, bytes, books: info.books });
    } catch (e) {
      setError(errorMessage(e));
      setFile(null);
    }
  };

  const restore = async () => {
    if (!file) return;
    try {
      await replaceLocal(file.bytes);
      toast.success(`Restored ${file.books} book${file.books === 1 ? '' : 's'} from ${file.name}.`);
      setFile(null);
      onClose();
      onRestored?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restore from a backup"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${existing ? 'btn-danger' : 'btn-primary'}`}
            disabled={!file || readOnly}
            onClick={restore}
          >
            {existing ? 'Replace my books with this backup' : 'Restore'}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>
            <FileUp size={14} style={{ verticalAlign: '-2px' }} /> Backup file (.sqlite)
          </span>
          <input
            type="file"
            accept=".sqlite,.db,application/x-sqlite3,application/vnd.sqlite3"
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
          />
        </label>
        {file && (
          <div className="callout callout-info">
            <ShieldCheck size={18} />
            <div>
              {file.name} contains {file.books} book{file.books === 1 ? '' : 's'}.
            </div>
          </div>
        )}
        {existing > 0 && (
          <div className="callout callout-warn">
            <ShieldAlert size={18} />
            <div>
              This replaces the {existing} book{existing === 1 ? '' : 's'} on this device. Download
              a backup first from Share &amp; backup if you might need them.
            </div>
          </div>
        )}
        {error && (
          <div className="callout callout-danger">
            <ShieldAlert size={18} />
            <div>{error}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
