import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Tags,
  ReceiptText,
  Scale,
  FileText,
  CheckCircle2,
  Paperclip,
  CalendarClock,
  Archive,
} from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { Money } from '../components/Money';
import { MonthlyChart, BarList } from '../components/Charts';
import { PageHead } from '../components/Empty';
import {
  addDays,
  addMonths,
  addYears,
  diffDays,
  endOfMonth,
  formatDate,
  startOfMonth,
  todayISO,
} from '../../core/dates';
import { formatMoney } from '../../core/money';
import { ROLE_LABELS, ACCOUNT_KIND_LABELS } from '../../db/types';
import { currentReportingYear } from '../../templates';

export function Dashboard() {
  const { book, readOnly } = useBook();
  const today = todayISO();
  const current = currentReportingYear(book, today);
  // Early in a new reporting year, the year just closed is more useful to look at.
  const year =
    diffDays(current.start, today) < 60
      ? { start: addYears(current.start, -1), end: addDays(current.start, -1) }
      : current;
  const data = useQuery(
    (s) => {
      const monthStart = startOfMonth(today);
      const flows = s.monthlyFlows(book.id, startOfMonth(addMonths(today, -11)), today);
      const thisMonth = flows.find((f) => f.month === today.slice(0, 7)) ?? {
        in: 0,
        out: 0,
        saved: 0,
      };
      const cats = s.categoryIndex(book.id);
      const spending = s
        .categoryTotals(book.id, year.start, year.end)
        .filter((c) => c.category && cats.get(c.category)?.kind === 'expense')
        .map((c) => ({ key: c.category!, label: cats.label(c.category), value: c.total }));
      const accounts = s.listAccounts(book.id, false).map((a) => {
        const rec = s.listReconciliations(book.id, a.id)[0];
        return { ...a, balance: s.balanceAt(a.id, '9999-12-31'), lastRec: rec };
      });
      const lastMonthEnd = endOfMonth(addMonths(monthStart, -1));
      const needsRec = accounts.filter(
        (a) =>
          (a.kind === 'checking' || a.kind === 'savings') &&
          (!a.lastRec || a.lastRec.statement_date < lastMonthEnd || a.lastRec.difference !== 0),
      );
      const reports = s.listReports(book.id);
      const lastFiled = reports.find((r) => r.status === 'filed');
      return {
        funds: s.totalFunds(book.id),
        counts: {
          ...s.counts(book.id),
          missing_receipts: s.counts(book.id, current.start, today).missing_receipts,
        },
        flows,
        thisMonth,
        spending,
        accounts,
        needsRec,
        lastFiled,
        drafts: reports.filter((r) => r.status === 'draft').length,
        activity: s.listAudit(book.id, 6),
      };
    },
    [book.id, today, year.start, current.start],
  );
  const daysLeft = diffDays(today, current.end);
  const spentTotal = data.spending.reduce((n, c) => n + c.value, 0);
  const todo = [
    data.counts.untagged > 0 && {
      to: '/transactions?category=untagged',
      icon: <Tags size={18} />,
      warn: true,
      title: `${data.counts.untagged} transaction${data.counts.untagged === 1 ? '' : 's'} to tag`,
      sub: 'Untagged money is left out of report totals.',
    },
    data.counts.missing_receipts > 0 && {
      to: `/transactions?needsReceipt=1&from=${current.start}`,
      icon: <Paperclip size={18} />,
      warn: false,
      title: `${data.counts.missing_receipts} payment${data.counts.missing_receipts === 1 ? '' : 's'} of ${formatMoney(book.receipt_threshold)} or more without a receipt this year`,
      sub: 'Keep receipts for larger purchases in case SSA or the court asks.',
    },
    data.counts.unmatched_receipts > 0 && {
      to: '/receipts?filter=unmatched',
      icon: <ReceiptText size={18} />,
      warn: true,
      title: `${data.counts.unmatched_receipts} receipt${data.counts.unmatched_receipts === 1 ? '' : 's'} not attached to a transaction`,
      sub: 'Match each receipt to the payment it belongs to.',
    },
    data.needsRec.length > 0 && {
      to: '/reconcile',
      icon: <Scale size={18} />,
      warn: false,
      title: `Reconcile ${data.needsRec.map((a) => a.name).join(', ')}`,
      sub: 'Compare with last month’s bank statement. Monthly reconciliation catches mistakes early.',
    },
  ].filter(Boolean) as { to: string; icon: ReactNode; warn: boolean; title: string; sub: string }[];

  return (
    <>
      <PageHead
        title={book.beneficiary_name}
        sub={
          <>
            {ROLE_LABELS[book.role]}: {book.fiduciary_name}
            {book.case_number ? ` · Case ${book.case_number}` : ''}
          </>
        }
        actions={
          !readOnly && (
            <>
              <Link className="btn" to="/receipts">
                <ReceiptText size={16} /> Add receipt
              </Link>
              <Link className="btn btn-primary" to="/import">
                Import bank file
              </Link>
            </>
          )
        }
      />

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="card hero-card stat stat-hero span-2">
          <span className="stat-label">Beneficiary’s money</span>
          <span className="stat-value" data-testid="total-funds">
            {formatMoney(data.funds.total)}
          </span>
          <span className="stat-note">
            {formatMoney(data.funds.accounts)} in {data.accounts.length} account
            {data.accounts.length === 1 ? '' : 's'}
            {data.funds.saved !== 0 ? ` · ${formatMoney(data.funds.saved)} saved outside them` : ''}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">In this month</span>
          <span className="stat-value">
            <Money cents={data.thisMonth.in} />
          </span>
          <span className="stat-note">
            {formatDate(startOfMonth(today), 'long').replace(/ 1,/, '')}
          </span>
        </div>
        <div className="card stat">
          <span className="stat-label">Spent this month</span>
          <span className="stat-value">
            <Money cents={data.thisMonth.out} />
          </span>
          <span className="stat-note">
            {data.thisMonth.saved
              ? `${formatMoney(data.thisMonth.saved)} moved to savings`
              : 'On the beneficiary’s needs'}
          </span>
        </div>
      </div>

      <div className="grid-split" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-head">
            <h2>Money in and spent</h2>
            <span className="sub">Last 12 months</span>
          </div>
          <MonthlyChart data={data.flows} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>To do</h2>
            {todo.length === 0 && <span className="badge badge-ok">All caught up</span>}
          </div>
          <div className="todo">
            {todo.map((t) => (
              <Link key={t.title} to={t.to}>
                <span className={`todo-icon ${t.warn ? 'warn' : ''}`}>{t.icon}</span>
                <span className="grow">
                  <span className="todo-title">{t.title}</span>
                  <br />
                  <span className="todo-sub">{t.sub}</span>
                </span>
              </Link>
            ))}
            <Link to="/reports">
              <span className="todo-icon">
                <CalendarClock size={18} />
              </span>
              <span className="grow">
                <span className="todo-title">
                  Reporting year {formatDate(current.start)} – {formatDate(current.end)}
                </span>
                <br />
                <span className="todo-sub">
                  {daysLeft >= 0 ? `${daysLeft} days until it closes.` : 'Closed.'}{' '}
                  {data.drafts
                    ? `${data.drafts} draft report${data.drafts === 1 ? '' : 's'} in progress.`
                    : 'Reports fill themselves in from the ledger.'}
                </span>
              </span>
            </Link>
            {data.lastFiled && (
              <div className="todo-item">
                <span className="todo-icon ok">
                  <Archive size={18} />
                </span>
                <span className="grow">
                  <span className="todo-title">
                    Keep records through{' '}
                    {formatDate(
                      addYears(data.lastFiled.filed_at ?? data.lastFiled.period_end, 2),
                      'long',
                    )}
                  </span>
                  <br />
                  <span className="todo-sub">
                    {data.lastFiled.template_name} was filed {formatDate(data.lastFiled.filed_at)}.
                    Keep receipts and statements at least two years after filing.
                  </span>
                </span>
              </div>
            )}
            {todo.length === 0 && (
              <div className="todo-item">
                <span className="todo-icon ok">
                  <CheckCircle2 size={18} />
                </span>
                <span className="grow">
                  <span className="todo-title">Books are up to date</span>
                  <br />
                  <span className="todo-sub">
                    Everything is tagged, receipts are matched and accounts reconcile.
                  </span>
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>
              {year.start === current.start
                ? 'Spending this reporting year'
                : `Spending, ${formatDate(year.start)} – ${formatDate(year.end)}`}
            </h2>
            <span className="sub">
              <Money cents={spentTotal} /> total
            </span>
          </div>
          {data.spending.length ? (
            <BarList items={data.spending} total={spentTotal} />
          ) : (
            <p className="muted">No tagged spending yet this year.</p>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Accounts</h2>
            {!readOnly && (
              <Link to="/settings#accounts" className="btn btn-sm btn-ghost">
                Manage
              </Link>
            )}
          </div>
          <div className="todo">
            {data.accounts.map((a) => (
              <Link key={a.id} to={`/transactions?account=${a.id}`}>
                <span className="grow">
                  <span className="todo-title">{a.name}</span>
                  <br />
                  <span className="todo-sub">
                    {ACCOUNT_KIND_LABELS[a.kind]}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {a.lastRec ? ` · reconciled to ${formatDate(a.lastRec.statement_date)}` : ''}
                  </span>
                </span>
                <b className="money">{formatMoney(a.balance)}</b>
              </Link>
            ))}
          </div>
          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="card-head" style={{ marginBottom: 6 }}>
            <h3>Recent activity</h3>
            <Link to="/activity" className="btn btn-sm btn-ghost">
              Activity log
            </Link>
          </div>
          <ul className="list-plain small">
            {data.activity.map((a) => (
              <li key={a.seq} style={{ padding: '4px 0' }}>
                <span className="muted">{formatDate(a.ts.slice(0, 10))}</span> · {a.summary}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p
        className="muted small"
        style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <FileText size={14} /> Reports for this book:{' '}
        <Link to="/reports">SSA payee report, court accountings and a family summary</Link>.
      </p>
    </>
  );
}
