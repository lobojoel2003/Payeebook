import { useState } from 'react';
import { Users, Eye, HardDriveDownload, ArchiveRestore, Printer, ShieldCheck } from 'lucide-react';
import { useApp, useBook } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead } from '../components/Empty';
import { CreateSnapshotDialog, OpenSharedDialog, RestoreBackupDialog } from './ShareDialogs';
import { addMonths, startOfMonth, todayISO, formatDate } from '../../core/dates';
import { saveFile, slug } from '../download';
import { BUILD } from '../../buildInfo';

export function Share() {
  const { local } = useApp();
  const { store, book } = useBook();
  const toast = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [from, setFrom] = useState(startOfMonth(addMonths(todayISO(), -11)));
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const ledgerPdf = async () => {
    setBusy(true);
    try {
      const rows = store.listTransactions(book.id, { from, to });
      const { renderLedgerPdf } = await import('../../pdf/ledger');
      const bytes = await renderLedgerPdf({
        title: `Ledger for ${book.beneficiary_name}`,
        subtitle: `${formatDate(from, 'long')} to ${formatDate(to, 'long')} · kept by ${book.fiduciary_name}`,
        rows,
        categories: store.categoryIndex(book.id),
        generatedOn: todayISO(),
        build: BUILD,
      });
      await saveFile(
        `${slug(book.beneficiary_name)}-ledger-${from}-to-${to}.pdf`,
        bytes,
        'application/pdf',
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    try {
      const saved = await saveFile(
        `payeebook-backup-${todayISO()}.sqlite`,
        local.export(),
        'application/vnd.sqlite3',
      );
      if (saved) {
        local.setMeta('last_backup', new Date().toISOString());
        toast.success('Backup saved. Keep it somewhere safe, such as an encrypted drive.');
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const lastBackup = local.getMeta('last_backup');

  return (
    <>
      <PageHead
        title="Share & backup"
        sub="Let family or an attorney check the books, print the ledger, and keep a backup somewhere other than this device."
      />
      <div className="grid-2">
        <section className="card stack-sm">
          <h2>
            <Users size={18} style={{ verticalAlign: '-3px' }} /> Share read-only
          </h2>
          <p className="small text-2">
            Open books head off family conflict. Send a sibling, the beneficiary or an attorney a
            copy they can open in Payeebook to look at every transaction, receipt, report and the
            activity log, without being able to change anything.
          </p>
          <ul className="small text-2" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Encrypted with a passphrase you choose (AES-256).</li>
            <li>A fingerprint lets you both confirm the copy was not altered.</li>
            <li>No server: you send the file however you like.</li>
          </ul>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn btn-primary"
              onClick={() => setShareOpen(true)}
              data-testid="share-readonly"
            >
              <ShieldCheck size={16} /> Create a read-only copy
            </button>
            <button className="btn" onClick={() => setOpenOpen(true)}>
              <Eye size={16} /> Open one
            </button>
          </div>
        </section>

        <section className="card stack-sm">
          <h2>
            <Printer size={18} style={{ verticalAlign: '-3px' }} /> Print the ledger
          </h2>
          <p className="small text-2">
            A register of every transaction with tags and running balances, for a family meeting or
            an attorney’s file.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={ledgerPdf}
            disabled={busy}
          >
            <Printer size={16} /> {busy ? 'Building…' : 'Download ledger PDF'}
          </button>
        </section>

        <section className="card stack-sm">
          <h2>
            <HardDriveDownload size={18} style={{ verticalAlign: '-3px' }} /> Back up
          </h2>
          <p className="small text-2">
            Your books live only in this browser or app. Download a full backup (all books, receipts
            and history) every month and after filing a report. Clearing browser data deletes the
            books on this device.
          </p>
          <p className="small">
            {lastBackup ? (
              `Last backup: ${formatDate(lastBackup.slice(0, 10), 'long')}.`
            ) : (
              <b className="danger-text">No backup yet.</b>
            )}
          </p>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-start' }}
            onClick={backup}
            data-testid="backup"
          >
            <HardDriveDownload size={16} /> Download backup
          </button>
        </section>

        <section className="card stack-sm">
          <h2>
            <ArchiveRestore size={18} style={{ verticalAlign: '-3px' }} /> Restore or move to
            another device
          </h2>
          <p className="small text-2">
            Open a backup on a new computer or phone to carry on there. Restoring replaces the books
            on this device.
          </p>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setRestoreOpen(true)}
          >
            <ArchiveRestore size={16} /> Restore a backup…
          </button>
        </section>
      </div>
      <CreateSnapshotDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      <OpenSharedDialog open={openOpen} onClose={() => setOpenOpen(false)} />
      <RestoreBackupDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />
    </>
  );
}
