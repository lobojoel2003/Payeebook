import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookPlus, Sparkles, Eye, ArchiveRestore, Lock, ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { createDemoBook } from '../../db/demo';
import { addDemoReceipts } from '../demoReceipts';
import { todayISO } from '../../core/dates';
import type { AccountKind, BookInput } from '../../db/types';
import { ACCOUNT_KIND_LABELS } from '../../db/types';
import { EMPTY_BOOK, PeopleFields, ReportingFields } from './BookFields';
import { MoneyInput } from '../components/MoneyInput';
import { OpenSharedDialog, RestoreBackupDialog } from './ShareDialogs';
import { requestPersistentStorage } from '../../db/persist';
import { BUILD } from '../../buildInfo';

export function NewBookWizard({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { local } = useApp();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [book, setBook] = useState<BookInput>(EMPTY_BOOK);
  const [account, setAccount] = useState<{
    name: string;
    kind: AccountKind;
    opening_balance: number | null;
    opening_date: string;
    institution: string;
  }>({
    name: 'Representative payee checking',
    kind: 'checking',
    opening_balance: 0,
    opening_date: todayISO(),
    institution: '',
  });
  const set = (patch: Partial<BookInput>) => setBook((b) => ({ ...b, ...patch }));
  const canNext = step === 0 ? book.beneficiary_name.trim() && book.fiduciary_name.trim() : true;

  const create = () => {
    try {
      const created = local.createBook(book, [
        {
          name: account.name || 'Checking',
          kind: account.kind,
          opening_balance: account.opening_balance ?? 0,
          opening_date: account.opening_date,
          institution: account.institution || null,
        },
      ]);
      local.setMeta('active_book', created.id);
      void requestPersistentStorage();
      toast.success(`Book created for ${created.beneficiary_name}.`);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 2) setStep(step + 1);
        else create();
      }}
    >
      <div className="steps" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>
      {step === 0 && (
        <>
          <div>
            <h2>Who is this book for?</h2>
            <p className="muted small">
              One book per person whose money you manage. You can add more books later.
            </p>
          </div>
          <PeopleFields value={book} set={set} />
        </>
      )}
      {step === 1 && (
        <>
          <div>
            <h2>Where do you report?</h2>
            <p className="muted small">
              Used to pick the right form and the reporting year. Skip anything that does not apply;
              you can change it in Settings.
            </p>
          </div>
          <ReportingFields value={book} set={set} />
        </>
      )}
      {step === 2 && (
        <>
          <div>
            <h2>The account the benefits are paid into</h2>
            <p className="muted small">
              Use the balance on the day your records start. Add savings or cash accounts later in
              Settings.
            </p>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Account name</span>
              <input
                value={account.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={account.kind}
                onChange={(e) => setAccount({ ...account, kind: e.target.value as AccountKind })}
              >
                {Object.entries(ACCOUNT_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Balance at the start</span>
              <MoneyInput
                value={account.opening_balance}
                onChange={(v) => setAccount({ ...account, opening_balance: v })}
              />
            </label>
            <label className="field">
              <span>Records start on</span>
              <input
                type="date"
                required
                value={account.opening_date}
                onChange={(e) => setAccount({ ...account, opening_date: e.target.value })}
              />
            </label>
            <label className="field span-2">
              <span>
                Bank or credit union <span className="hint">(optional)</span>
              </span>
              <input
                value={account.institution}
                onChange={(e) => setAccount({ ...account, institution: e.target.value })}
              />
            </label>
          </div>
        </>
      )}
      <div className="row-between">
        {step > 0 ? (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={16} /> Back
          </button>
        ) : onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="btn btn-primary" disabled={!canNext}>
          {step < 2 ? (
            <>
              Next <ArrowRight size={16} />
            </>
          ) : (
            'Create the book'
          )}
        </button>
      </div>
    </form>
  );
}

export function Welcome() {
  const { local, books, readOnly } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'choose' | 'new'>('choose');
  const [sharedOpen, setSharedOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const demo = async () => {
    setBusy(true);
    try {
      const { book, receipts } = createDemoBook(local);
      await addDemoReceipts(local, book.id, receipts);
      local.setMeta('active_book', book.id);
      toast.success('Demo book ready. Everything in it is made up.');
      navigate('/');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <img src="./favicon.svg" alt="" />
          <h1>Payeebook</h1>
          <p>
            Keep the books for someone whose money you manage, as a Social Security representative
            payee, guardian or conservator. Tag each transaction once, keep receipts with it, and
            print the SSA or court report when it is due.
          </p>
        </div>
        {mode === 'new' ? (
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <NewBookWizard onDone={() => navigate('/')} onCancel={() => setMode('choose')} />
          </div>
        ) : (
          <div className="grid-4">
            <button className="choice" onClick={() => setMode('new')} disabled={readOnly}>
              <span className="choice-icon">
                <BookPlus size={20} />
              </span>
              <h3>Start a book</h3>
              <p>
                Set up the beneficiary, your role and the account benefits are paid into. Takes two
                minutes.
              </p>
            </button>
            <button className="choice" onClick={demo} disabled={busy || readOnly}>
              <span className="choice-icon">
                <Sparkles size={20} />
              </span>
              <h3>{busy ? 'Building demo…' : 'Explore a demo'}</h3>
              <p>
                A made-up book with 14 months of transactions, receipts and reports to try things
                out.
              </p>
            </button>
            <button className="choice" onClick={() => setSharedOpen(true)}>
              <span className="choice-icon">
                <Eye size={20} />
              </span>
              <h3>Open a shared book</h3>
              <p>
                A sibling or attorney sent you a .payeebook file. Open it read-only to check the
                books.
              </p>
            </button>
            <button className="choice" onClick={() => setRestoreOpen(true)}>
              <span className="choice-icon">
                <ArchiveRestore size={20} />
              </span>
              <h3>Restore a backup</h3>
              <p>
                Bring back books from a Payeebook backup file (.sqlite) made on this or another
                device.
              </p>
            </button>
          </div>
        )}
        <p className="privacy-note">
          <Lock size={16} aria-hidden />
          Everything stays on this device. No account, no server, no tracking. Free and open source
          (GPL-3.0).
        </p>
        <p className="privacy-note tiny" style={{ marginTop: 6 }}>
          v{BUILD.version} · build {BUILD.build}
          {books.length > 0 && (
            <>
              {' · '}
              <a href="#/">Back to your books</a>
            </>
          )}
        </p>
      </div>
      <OpenSharedDialog
        open={sharedOpen}
        onClose={() => setSharedOpen(false)}
        onOpened={() => navigate('/')}
      />
      <RestoreBackupDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onRestored={() => navigate('/')}
      />
    </div>
  );
}
