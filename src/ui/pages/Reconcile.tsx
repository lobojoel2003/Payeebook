import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead, Empty } from '../components/Empty';
import { MoneyInput } from '../components/MoneyInput';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
  startOfMonth,
  todayISO,
} from '../../core/dates';
import { formatMoney } from '../../core/money';

export function Reconcile() {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const accounts = useQuery(
    (s) => s.listAccounts(book.id, false).filter((a) => a.kind !== 'cash'),
    [book.id],
  );
  const history = useQuery((s) => s.listReconciliations(book.id), [book.id]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(endOfMonth(addMonths(startOfMonth(todayISO()), -1)));
  const [statement, setStatement] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const ledger = useQuery((s) => (accountId ? s.balanceAt(accountId, date) : 0), [accountId, date]);
  const lastGood = history.find(
    (h) => h.account_id === accountId && h.difference === 0 && h.statement_date < date,
  );
  const since = useQuery(
    (s) =>
      accountId
        ? s.listTransactions(book.id, {
            accountId,
            from: lastGood ? addDays(lastGood.statement_date, 1) : undefined,
            to: date,
          })
        : [],
    [accountId, date, lastGood?.statement_date],
  );
  const diff = statement === null ? null : statement - ledger;
  const nameOf = useMemo(
    () => new Map(store.listAccounts(book.id).map((a) => [a.id, a.name])),
    [store, book.id],
  );

  const save = () => {
    if (statement === null) return;
    try {
      const r = store.reconcile(accountId, date, statement, note);
      if (r.difference === 0)
        toast.success(`Reconciled through ${formatDate(date)}. The ledger matches the bank.`);
      else
        toast.show(
          `Saved, with a difference of ${formatMoney(r.difference)}. Find the missing or extra transaction and reconcile again.`,
          { tone: 'info' },
        );
      setStatement(null);
      setNote('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!accounts.length) {
    return (
      <>
        <PageHead title="Reconcile" />
        <Empty icon={<Scale size={32} />} title="No bank accounts to reconcile">
          Cash on hand does not need reconciling. Add a checking or savings account in Settings.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Reconcile with the bank"
        sub="Once a month, check that the ledger agrees with the bank statement. It catches missing or duplicate transactions while they are easy to find."
      />
      <div className="grid-split-even">
        {!readOnly && (
          <section className="card stack">
            <h2>Statement</h2>
            <label className="field">
              <span>Account</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Statement ending date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Ending balance on the statement</span>
              <MoneyInput
                value={statement}
                onChange={setStatement}
                ariaLabel="Statement ending balance"
              />
            </label>
            <dl className="kv">
              <dt>Payeebook balance on {formatDate(date)}</dt>
              <dd className="money">
                <b>{formatMoney(ledger)}</b>
              </dd>
              {diff !== null && (
                <>
                  <dt>Difference</dt>
                  <dd className={`money ${diff === 0 ? 'pos' : 'danger-text'}`}>
                    <b>{formatMoney(diff)}</b>
                  </dd>
                </>
              )}
            </dl>
            {diff !== null &&
              (diff === 0 ? (
                <div className="callout callout-ok">
                  <CheckCircle2 size={18} />
                  <div>It matches. Save to mark these transactions as cleared.</div>
                </div>
              ) : (
                <div className="callout callout-warn">
                  <AlertTriangle size={18} />
                  <div>
                    The bank shows {formatMoney(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than
                    Payeebook. Look for a{' '}
                    {diff > 0
                      ? 'deposit that is missing, or a payment entered twice'
                      : 'payment that is missing, or a deposit entered twice'}
                    . A difference of exactly {formatMoney(Math.abs(diff))} on one line is the usual
                    culprit.
                  </div>
                </div>
              ))}
            <label className="field">
              <span>
                Note <span className="hint">(optional)</span>
              </span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn btn-primary" disabled={statement === null} onClick={save}>
              Save reconciliation
            </button>
          </section>
        )}
        <section className="card card-tight">
          <div className="card-head" style={{ padding: '16px 20px 0' }}>
            <h2>Transactions to tick off</h2>
            <span className="sub">
              {lastGood ? `Since ${formatDate(lastGood.statement_date)}` : 'All'} · {since.length}
            </span>
          </div>
          <div className="table-wrap" style={{ maxHeight: 480 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th className="num">Amount</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {since.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{formatDate(t.date)}</td>
                    <td>
                      {t.payee}
                      {t.check_number && <span className="muted small"> · #{t.check_number}</span>}
                    </td>
                    <td className={`num ${t.amount > 0 ? 'pos' : ''}`}>
                      {formatMoney(t.amount, { sign: true })}
                    </td>
                    <td className="num muted">{formatMoney(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card card-tight" style={{ marginTop: 16 }}>
        <div className="card-head" style={{ padding: '16px 20px 0' }}>
          <h2>History</h2>
          <Link to="/activity" className="btn btn-sm btn-ghost">
            Activity log
          </Link>
        </div>
        {history.length === 0 ? (
          <p className="muted" style={{ padding: '0 20px 20px' }}>
            No reconciliations yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Statement date</th>
                  <th>Account</th>
                  <th className="num">Statement</th>
                  <th className="num">Payeebook</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 36).map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.statement_date)}</td>
                    <td>{nameOf.get(h.account_id)}</td>
                    <td className="num">{formatMoney(h.statement_balance)}</td>
                    <td className="num">{formatMoney(h.ledger_balance)}</td>
                    <td>
                      {h.difference === 0 ? (
                        <span className="badge badge-ok">Matched</span>
                      ) : (
                        <span className="badge badge-warn">Off by {formatMoney(h.difference)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
