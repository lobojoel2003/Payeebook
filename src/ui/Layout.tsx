import type { ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  ListOrdered,
  Upload,
  Receipt,
  Scale,
  FileText,
  Shapes,
  Share2,
  History,
  Settings,
  Eye,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  MoreHorizontal,
} from 'lucide-react';
import { useApp, useQuery } from '../state/AppContext';
import { BUILD } from '../buildInfo';
import { ROLE_LABELS } from '../db/types';
import { usePwaStatus } from '../pwa';
import { formatDate } from '../core/dates';

function NavItem({
  to,
  icon,
  label,
  count,
  end,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end}>
      {icon}
      <span>{label}</span>
      {count ? (
        <span className="count" aria-label={`${count} to do`}>
          {count}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { book, books, readOnly, shared, setActiveBook, closeShared, saveState } = useApp();
  const counts = useQuery((s) => (book ? s.counts(book.id) : null), [book?.id]);
  const pwa = usePwaStatus();

  const bookSwitcher = book && (
    <div className="field" style={{ padding: '0 6px 8px' }}>
      <span
        className="tiny muted"
        style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {readOnly ? 'Shared book' : 'Book'}
      </span>
      {books.length > 1 && !readOnly ? (
        <select
          value={book.id}
          onChange={(e) => setActiveBook(e.target.value)}
          aria-label="Switch book"
        >
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.beneficiary_name}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ fontWeight: 650 }}>{book.beneficiary_name}</div>
      )}
      <span className="tiny muted">{ROLE_LABELS[book.role]}</span>
    </div>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <Link className="brand" to="/">
          <img src="./favicon.svg" alt="" />
          <span>
            <span className="brand-name">Payeebook</span>
            <span className="brand-tag">Accounts for payees &amp; guardians</span>
          </span>
        </Link>
        {bookSwitcher}
        <nav className="nav">
          <NavItem to="/" end icon={<LayoutDashboard size={18} />} label="Overview" />
          <NavItem
            to="/transactions"
            icon={<ListOrdered size={18} />}
            label="Transactions"
            count={counts?.untagged}
          />
          {!readOnly && <NavItem to="/import" icon={<Upload size={18} />} label="Import" />}
          <NavItem
            to="/receipts"
            icon={<Receipt size={18} />}
            label="Receipts"
            count={readOnly ? 0 : counts?.unmatched_receipts}
          />
          <NavItem to="/reconcile" icon={<Scale size={18} />} label="Reconcile" />
          <div className="nav-label">Reporting</div>
          <NavItem to="/reports" icon={<FileText size={18} />} label="Reports" />
          <NavItem to="/templates" icon={<Shapes size={18} />} label="Form templates" />
          <div className="nav-label">Book</div>
          {!readOnly && (
            <NavItem to="/share" icon={<Share2 size={18} />} label="Share &amp; backup" />
          )}
          <NavItem to="/activity" icon={<History size={18} />} label="Activity log" />
          {!readOnly && <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" />}
        </nav>
        <div className="sidebar-foot">
          {!readOnly && (
            <span
              className={`save-dot ${saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : ''}`}
            >
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'error'
                  ? 'Could not save'
                  : 'Saved on this device'}
            </span>
          )}
          <span>
            v{BUILD.version} · build {BUILD.build}
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="mobile-bar">
          <Link className="brand" to="/" style={{ padding: 0 }}>
            <img src="./favicon.svg" alt="" style={{ width: 26, height: 26 }} />
            <span className="brand-name">{book?.beneficiary_name ?? 'Payeebook'}</span>
          </Link>
          <div className="row">
            {!readOnly && (
              <Link className="icon-btn" to="/import" aria-label="Import">
                <Upload size={18} />
              </Link>
            )}
            <Link className="icon-btn" to="/activity" aria-label="Activity log">
              <History size={18} />
            </Link>
          </div>
        </header>

        {shared && (
          <div className="banner banner-readonly" role="status">
            <Eye size={18} aria-hidden />
            <div className="grow">
              <b>Read-only shared book</b> from{' '}
              {shared.envelope.summary?.fiduciary ?? book?.fiduciary_name}, made{' '}
              {formatDate(shared.envelope.created_at.slice(0, 10), 'long')}. Nothing you do here
              changes it.
            </div>
            <span
              className={`badge ${shared.integrity === 'verified' ? 'badge-ok' : 'badge-danger'}`}
            >
              {shared.integrity === 'verified' ? (
                <ShieldCheck size={14} />
              ) : (
                <ShieldAlert size={14} />
              )}
              {shared.integrity === 'verified'
                ? 'Fingerprint verified'
                : 'Fingerprint does not match'}
            </span>
            <code title="Ask the sender to read out the same fingerprint">
              {shared.fingerprint}
            </code>
            <button className="btn btn-sm" onClick={closeShared}>
              Close shared book
            </button>
          </div>
        )}
        {pwa.needRefresh && (
          <div className="banner banner-update" role="status">
            <RefreshCw size={18} aria-hidden />
            <div className="grow">A new version of Payeebook is ready.</div>
            <button className="btn btn-sm btn-primary" onClick={() => pwa.applyUpdate()}>
              Update now
            </button>
            <button className="btn btn-sm btn-ghost" onClick={pwa.dismiss}>
              Later
            </button>
          </div>
        )}

        <main className="content" id="main">
          {children}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          <NavLink to="/" end>
            <LayoutDashboard size={20} />
            Overview
          </NavLink>
          <NavLink to="/transactions">
            <ListOrdered size={20} />
            Ledger
          </NavLink>
          <NavLink to="/receipts">
            <Receipt size={20} />
            Receipts
          </NavLink>
          <NavLink to="/reports">
            <FileText size={20} />
            Reports
          </NavLink>
          <NavLink to={readOnly ? '/activity' : '/more'}>
            <MoreHorizontal size={20} />
            More
          </NavLink>
        </nav>
      </div>
    </div>
  );
}
