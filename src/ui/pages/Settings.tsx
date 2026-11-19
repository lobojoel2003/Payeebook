import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  Sun,
  Moon,
  Monitor,
  HardDrive,
  ExternalLink,
} from 'lucide-react';
import { useApp, useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead } from '../components/Empty';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { CategorySelect } from '../components/CategorySelect';
import { PeopleFields, ReportingFields } from './BookFields';
import { NewBookWizard } from './Welcome';
import { ACCOUNT_KIND_LABELS, type AccountKind, type Book, type BookInput } from '../../db/types';
import {
  COURT_GROUP_LABELS,
  SSA_BUCKET_LABELS,
  KIND_LABELS,
  type CategoryKind,
  type CourtGroup,
  type SsaBucket,
} from '../../core/categories';
import { formatDate, todayISO } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { BUILD, REPO_URL, isDesktopApp } from '../../buildInfo';
import { storageInfo, requestPersistentStorage } from '../../db/persist';
import { getTheme, setTheme, type Theme } from '../theme';

function toInput(b: Book): BookInput {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = b;
  return rest;
}

function BookSection() {
  const { store, book } = useBook();
  const toast = useToast();
  const [value, setValue] = useState<BookInput>(toInput(book));
  useEffect(() => setValue(toInput(book)), [book]);
  const set = (patch: Partial<BookInput>) => setValue((v) => ({ ...v, ...patch }));
  const save = () => {
    try {
      store.updateBook(book.id, value);
      toast.success('Book details saved.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section className="card stack" id="book">
      <h2>Book details</h2>
      <PeopleFields value={value} set={set} />
      <ReportingFields value={value} set={set} />
      <div className="form-grid">
        <label className="field">
          <span>
            Ask for receipts on payments of <span className="hint">(and more)</span>
          </span>
          <MoneyInput
            value={value.receipt_threshold ?? 5000}
            onChange={(v) => set({ receipt_threshold: v ?? 0 })}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <input
            value={value.notes ?? ''}
            onChange={(e) => set({ notes: e.target.value || null })}
          />
        </label>
      </div>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>
        Save details
      </button>
    </section>
  );
}

function AccountsSection() {
  const { store, book } = useBook();
  const toast = useToast();
  const accounts = useQuery(
    (s) => s.listAccounts(book.id).map((a) => ({ ...a, balance: s.balanceAt(a.id, '9999-12-31') })),
    [book.id],
  );
  const [form, setForm] = useState<{
    name: string;
    kind: AccountKind;
    institution: string;
    last4: string;
    opening_balance: number | null;
    opening_date: string;
  } | null>(null);
  const add = () => {
    if (!form) return;
    try {
      store.createAccount(book.id, { ...form, opening_balance: form.opening_balance ?? 0 });
      toast.success(`Added ${form.name}.`);
      setForm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section className="card stack" id="accounts">
      <div className="row-between">
        <h2>Accounts</h2>
        <button
          className="btn btn-sm"
          onClick={() =>
            setForm({
              name: '',
              kind: 'savings',
              institution: '',
              last4: '',
              opening_balance: 0,
              opening_date: todayISO(),
            })
          }
        >
          <Plus size={14} /> Add account
        </button>
      </div>
      <p className="small text-2">
        Track every place the beneficiary’s money is kept: the benefits account, savings, cash on
        hand, a prepaid card.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th className="num">Opening</th>
              <th className="num">Balance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ opacity: a.closed ? 0.55 : 1 }}>
                <td>
                  <b>{a.name}</b>
                  <div className="tiny muted">
                    {[
                      a.institution,
                      a.last4 ? `…${a.last4}` : null,
                      `since ${formatDate(a.opening_date)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td className="small">{ACCOUNT_KIND_LABELS[a.kind]}</td>
                <td className="num small">{formatMoney(a.opening_balance)}</td>
                <td className="num">{formatMoney(a.balance)}</td>
                <td className="num">
                  <button
                    className="icon-btn"
                    aria-label={a.closed ? 'Reopen account' : 'Close account'}
                    title={a.closed ? 'Reopen' : 'Close (keeps history)'}
                    onClick={() => {
                      try {
                        store.updateAccount(a.id, { closed: a.closed ? 0 : 1 });
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    {a.closed ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title="Add an account"
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={add} disabled={!form?.name}>
              Add account
            </button>
          </>
        }
      >
        {form && (
          <div className="form-grid">
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Conserved savings"
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}
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
                value={form.opening_balance}
                onChange={(v) => setForm({ ...form, opening_balance: v })}
              />
            </label>
            <label className="field">
              <span>On</span>
              <input
                type="date"
                value={form.opening_date}
                onChange={(e) => setForm({ ...form, opening_date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Bank</span>
              <input
                value={form.institution}
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Last 4 digits</span>
              <input
                value={form.last4}
                maxLength={4}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })}
              />
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
}

function CategoriesSection() {
  const { store, book } = useBook();
  const toast = useToast();
  const categories = useQuery((s) => s.categoryIndex(book.id), [book.id]);
  const [form, setForm] = useState<{
    label: string;
    kind: CategoryKind;
    ssa: SsaBucket;
    court: CourtGroup;
  } | null>(null);
  const add = () => {
    if (!form) return;
    try {
      const id = `custom_${form.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')}`;
      store.addCategory(book.id, {
        id,
        label: form.label,
        kind: form.kind,
        ssa: form.ssa,
        court: form.court,
        color: '#7a7f87',
      });
      toast.success(`Added tag “${form.label}”.`);
      setForm(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section className="card stack" id="categories">
      <div className="row-between">
        <h2>Tags</h2>
        <button
          className="btn btn-sm"
          onClick={() =>
            setForm({
              label: '',
              kind: 'expense',
              ssa: 'other_needs',
              court: 'disbursements.other',
            })
          }
        >
          <Plus size={14} /> Add a tag
        </button>
      </div>
      <p className="small text-2">
        Each tag knows where it belongs on the SSA report and on court schedules, so you only tag a
        transaction once.
      </p>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Kind</th>
              <th>SSA-623</th>
              <th>Court schedule</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.all.map((c) => (
              <tr key={c.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <i className="swatch" style={{ background: c.color }} />
                    {c.label}
                  </span>
                </td>
                <td className="small">{KIND_LABELS[c.kind]}</td>
                <td className="small">{SSA_BUCKET_LABELS[c.ssa]}</td>
                <td className="small">{COURT_GROUP_LABELS[c.court]}</td>
                <td className="num">
                  {!c.builtin && (
                    <button
                      className="icon-btn"
                      aria-label="Delete tag"
                      onClick={() => {
                        try {
                          store.deleteCategory(book.id, c.id);
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title="Add a tag"
        footer={
          <>
            <button className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={add} disabled={!form?.label.trim()}>
              Add tag
            </button>
          </>
        }
      >
        {form && (
          <div className="form-grid">
            <label className="field span-2">
              <span>Name</span>
              <input
                autoFocus
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Day program"
              />
            </label>
            <label className="field">
              <span>Kind</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind })}
              >
                {Object.entries(KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>On the SSA report</span>
              <select
                value={form.ssa}
                onChange={(e) => setForm({ ...form, ssa: e.target.value as SsaBucket })}
              >
                {Object.entries(SSA_BUCKET_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field span-2">
              <span>On court schedules</span>
              <select
                value={form.court}
                onChange={(e) => setForm({ ...form, court: e.target.value as CourtGroup })}
              >
                {Object.entries(COURT_GROUP_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
}

function RulesSection() {
  const { store, book } = useBook();
  const toast = useToast();
  const rules = useQuery((s) => s.listRules(book.id), [book.id]);
  const categories = useQuery((s) => s.categoryIndex(book.id), [book.id]);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const add = () => {
    if (!category) return;
    try {
      const n = store.addRule(book.id, pattern, category, 'any');
      toast.success(`Rule added${n ? ` and ${n} transactions tagged` : ''}.`);
      setPattern('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <section className="card stack" id="rules">
      <h2>Remembered payees</h2>
      <p className="small text-2">
        When a bank description contains these words, the transaction is tagged automatically on
        import.
      </p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow">
          <span>Words in the bank description</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g. LAKEVIEW APTS"
          />
        </label>
        <label className="field">
          <span>Tag as</span>
          <CategorySelect categories={categories} value={category} onChange={setCategory} />
        </label>
        <button className="btn" onClick={add} disabled={!pattern.trim() || !category}>
          Add
        </button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 320 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Description contains</th>
              <th>Tag</th>
              <th>Applies to</th>
              <th className="num">Used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.pattern}</code>
                </td>
                <td className="small">{categories.label(r.category)}</td>
                <td className="small">
                  {r.direction === 'in' ? 'Money in' : r.direction === 'out' ? 'Money out' : 'Both'}
                </td>
                <td className="num small">{r.hits}</td>
                <td className="num">
                  <button
                    className="icon-btn"
                    aria-label="Delete rule"
                    onClick={() => store.deleteRule(r.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeviceSection() {
  const { books, local } = useApp();
  const { book } = useBook();
  const toast = useToast();
  const navigate = useNavigate();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [storage, setStorage] = useState<{
    persisted: boolean;
    usage: number;
    quota: number;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEffect(() => {
    void storageInfo().then(setStorage);
  }, []);
  const pickTheme = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };
  return (
    <>
      <section className="card stack" id="device">
        <h2>This device</h2>
        <div className="field">
          <span>Appearance</span>
          <div className="segmented" role="group" aria-label="Theme">
            <button aria-pressed={theme === 'system'} onClick={() => pickTheme('system')}>
              <Monitor size={14} /> System
            </button>
            <button aria-pressed={theme === 'light'} onClick={() => pickTheme('light')}>
              <Sun size={14} /> Light
            </button>
            <button aria-pressed={theme === 'dark'} onClick={() => pickTheme('dark')}>
              <Moon size={14} /> Dark
            </button>
          </div>
        </div>
        {storage && (
          <div className="callout">
            <HardDrive size={18} />
            <div className="grow small">
              Using {(storage.usage / 1024 / 1024).toFixed(1)} MB
              {storage.quota
                ? ` of ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB available`
                : ''}
              .{' '}
              {isDesktopApp
                ? 'Stored in the desktop app’s data folder.'
                : storage.persisted
                  ? 'The browser will keep this data even when space runs low.'
                  : 'The browser may clear this data if space runs low.'}
            </div>
            {!storage.persisted && !isDesktopApp && (
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const ok = await requestPersistentStorage();
                  toast.show(
                    ok
                      ? 'Storage is now persistent.'
                      : 'The browser declined. Install Payeebook as an app or keep regular backups.',
                    { tone: ok ? 'success' : 'info' },
                  );
                  setStorage(await storageInfo());
                }}
              >
                Keep my data
              </button>
            )}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={16} /> Start another book
          </button>
          <button className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={16} /> Delete this book…
          </button>
        </div>
        <p className="small muted">
          {books.length} book{books.length === 1 ? '' : 's'} on this device.
        </p>
      </section>
      <Modal open={adding} onClose={() => setAdding(false)} title="Start another book" wide>
        <NewBookWizard
          onDone={() => {
            setAdding(false);
            navigate('/');
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${book.beneficiary_name}’s book?`}
        footer={
          <>
            <button className="btn" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              disabled={confirmDelete.trim() !== book.beneficiary_name}
              onClick={() => {
                local.deleteBook(book.id);
                setDeleteOpen(false);
                toast.success('Book deleted.');
                navigate(local.listBooks().length ? '/' : '/welcome');
              }}
            >
              Delete forever
            </button>
          </>
        }
      >
        <div className="stack">
          <p>
            This deletes every transaction, receipt, report and the activity log for this book from
            this device. It cannot be undone. Download a backup first if you might need it:{' '}
            <Link to="/share">Share &amp; backup</Link>.
          </p>
          <label className="field">
            <span>Type “{book.beneficiary_name}” to confirm</span>
            <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} />
          </label>
        </div>
      </Modal>
    </>
  );
}

function About() {
  return (
    <section className="card stack-sm" id="about">
      <h2>About Payeebook</h2>
      <dl className="kv">
        <dt>Version</dt>
        <dd data-testid="app-version">
          {BUILD.version} (build {BUILD.build})
        </dd>
        <dt>Commit</dt>
        <dd>
          <a href={`${REPO_URL}/commit/${BUILD.commit}`} target="_blank" rel="noreferrer">
            {BUILD.commit}
          </a>
        </dd>
        <dt>Built</dt>
        <dd>
          {formatDate(BUILD.date.slice(0, 10), 'long')} · {BUILD.channel}
        </dd>
        <dt>Licence</dt>
        <dd>App: GPL-3.0-or-later. Form templates: MIT.</dd>
      </dl>
      <p className="small text-2">
        Payeebook is not legal or financial advice and is not affiliated with SSA, the VA or any
        court. Check each report against the official form and your court’s rules before filing.
      </p>
      <div className="row">
        <a className="btn btn-sm" href={REPO_URL} target="_blank" rel="noreferrer">
          Source code <ExternalLink size={12} />
        </a>
        <a
          className="btn btn-sm"
          href={`${REPO_URL}/issues/new/choose`}
          target="_blank"
          rel="noreferrer"
        >
          Report a problem <ExternalLink size={12} />
        </a>
        <a className="btn btn-sm" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
          Releases <ExternalLink size={12} />
        </a>
      </div>
    </section>
  );
}

export function Settings() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash)
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);
  return (
    <>
      <PageHead title="Settings" />
      <div className="stack">
        <BookSection />
        <AccountsSection />
        <CategoriesSection />
        <RulesSection />
        <DeviceSection />
        <About />
      </div>
    </>
  );
}
