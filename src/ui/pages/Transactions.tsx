import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Plus, Paperclip, Lock, Download, Split, ListOrdered, CheckCheck } from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead, Empty } from '../components/Empty';
import { CategorySelect, CategoryOptions } from '../components/CategorySelect';
import { TransactionDialog } from './TransactionDialog';
import { formatDate, todayISO } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { toCsv } from '../../core/csv';
import { saveFile, slug } from '../download';
import type { Transaction, TxRow } from '../../db/types';
import { useTagOnce } from './useTagOnce';

const PAGE = 150;

export function Transactions() {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const tagOnce = useTagOnce();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filter = {
    accountId: params.get('account') ?? undefined,
    category: params.get('category') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    search: params.get('q') ?? undefined,
    needsReceipt: params.get('needsReceipt') === '1' || undefined,
  };
  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE);
    setSelected(new Set());
  };

  const accounts = useQuery((s) => s.listAccounts(book.id), [book.id]);
  const categories = useQuery((s) => s.categoryIndex(book.id), [book.id]);
  const rows = useQuery(
    (s) => s.listTransactions(book.id, filter),
    [book.id, JSON.stringify(filter)],
  );
  const visible = rows.slice(0, limit);
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({ in: t.in + Math.max(r.amount, 0), out: t.out + Math.min(r.amount, 0) }),
        { in: 0, out: 0 },
      ),
    [rows],
  );
  const anyFilter = Object.values(filter).some(Boolean);

  const tag = (row: TxRow, category: string | null) => {
    try {
      store.setCategory(book.id, [row.id], category);
      if (category) tagOnce(row, category);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const bulkTag = (category: string) => {
    try {
      const n = store.setCategory(book.id, [...selected], category);
      toast.success(
        `Tagged ${n} transaction${n === 1 ? '' : 's'} as ${categories.label(category)}.`,
      );
      setSelected(new Set());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const exportCsv = async () => {
    const header = [
      'Date',
      'Account',
      'Payee',
      'Bank description',
      'Memo',
      'Check',
      'Category',
      'Amount',
      'Balance',
      'Receipts',
      'Cleared',
    ];
    const body = [...rows]
      .reverse()
      .map((r) => [
        r.date,
        r.account_name,
        r.payee,
        r.raw_payee ?? '',
        r.memo,
        r.check_number,
        r.split_count ? 'Split' : categories.label(r.category),
        (r.amount / 100).toFixed(2),
        (r.balance / 100).toFixed(2),
        r.receipt_count,
        r.cleared ? 'yes' : '',
      ]);
    await saveFile(
      `${slug(book.beneficiary_name)}-transactions-${todayISO()}.csv`,
      toCsv([header, ...body]),
      'text/csv',
    );
  };

  const open = (row: TxRow | null) => {
    setEditing(row ? (store.getTransaction(row.id) ?? null) : null);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHead
        title="Transactions"
        sub="Every dollar in and out of the beneficiary’s accounts, newest first, with the running balance."
        actions={
          <>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>
              <Download size={16} /> CSV
            </button>
            {!readOnly && (
              <button
                className="btn btn-primary"
                onClick={() => open(null)}
                disabled={!accounts.length}
              >
                <Plus size={16} /> Add
              </button>
            )}
          </>
        }
      />

      <div className="filters">
        <label className="field search">
          <span>Search</span>
          <input
            type="search"
            placeholder="Payee, note, amount…"
            defaultValue={filter.search}
            onChange={(e) => setFilter('q', e.target.value || null)}
          />
        </label>
        <label className="field">
          <span>Account</span>
          <select
            value={filter.accountId ?? ''}
            onChange={(e) => setFilter('account', e.target.value || null)}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tag</span>
          <select
            value={filter.category ?? ''}
            onChange={(e) => setFilter('category', e.target.value || null)}
          >
            <option value="">All tags</option>
            <option value="untagged">Untagged</option>
            <CategoryOptions categories={categories} />
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input
            type="date"
            value={filter.from ?? ''}
            onChange={(e) => setFilter('from', e.target.value || null)}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="date"
            value={filter.to ?? ''}
            onChange={(e) => setFilter('to', e.target.value || null)}
          />
        </label>
        <label className="check" style={{ paddingBottom: 8 }}>
          <input
            type="checkbox"
            checked={Boolean(filter.needsReceipt)}
            onChange={(e) => setFilter('needsReceipt', e.target.checked ? '1' : null)}
          />
          Needs a receipt
        </label>
        {anyFilter && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 4 }}
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Clear filters
          </button>
        )}
      </div>

      {selected.size > 0 && !readOnly && (
        <div className="card row" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <CheckCheck size={18} />
          <b>{selected.size} selected</b>
          <select
            aria-label="Tag selected"
            defaultValue=""
            onChange={(e) => e.target.value && bulkTag(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="" disabled>
              Tag selected as…
            </option>
            <CategoryOptions categories={categories} />
          </select>
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="card card-tight">
        {rows.length === 0 ? (
          <Empty
            icon={<ListOrdered size={32} />}
            title={anyFilter ? 'Nothing matches these filters' : 'No transactions yet'}
          >
            {anyFilter ? (
              'Try clearing a filter.'
            ) : readOnly ? null : (
              <>
                <Link to="/import">Import a bank file</Link> or add one by hand.
              </>
            )}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="tx-table">
              <thead>
                <tr>
                  {!readOnly && (
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={
                          selected.size > 0 &&
                          selected.size === visible.filter((r) => !r.locked).length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? new Set(visible.filter((r) => !r.locked).map((r) => r.id))
                              : new Set(),
                          )
                        }
                      />
                    </th>
                  )}
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Tag</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    className={`clickable ${selected.has(r.id) ? 'selected' : ''}`}
                    onClick={() => open(r)}
                  >
                    {!readOnly && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.payee}`}
                          disabled={r.locked}
                          checked={selected.has(r.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(r.id);
                            else next.delete(r.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    )}
                    <td className="nowrap">{formatDate(r.date)}</td>
                    <td className="payee">
                      <div className="payee-name">
                        {r.locked && (
                          <Lock
                            size={12}
                            aria-label="Locked by a filed report"
                            style={{ marginRight: 4, verticalAlign: '-1px' }}
                          />
                        )}
                        {r.payee}
                        {r.check_number && (
                          <span className="muted small"> · #{r.check_number}</span>
                        )}
                        {r.receipt_count > 0 && (
                          <Paperclip
                            size={13}
                            aria-label={`${r.receipt_count} receipt`}
                            style={{
                              marginLeft: 6,
                              verticalAlign: '-2px',
                              color: 'var(--brand-text)',
                            }}
                          />
                        )}
                      </div>
                      {r.memo && <div className="payee-memo">{r.memo}</div>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.split_count > 0 ? (
                        <button
                          className="badge badge-brand"
                          style={{ border: 'none', cursor: 'pointer' }}
                          onClick={() => open(r)}
                        >
                          <Split size={12} /> Split ({r.split_count})
                        </button>
                      ) : readOnly ? (
                        <span className={`badge ${r.category ? '' : 'badge-warn'}`}>
                          {categories.label(r.category)}
                        </span>
                      ) : (
                        <CategorySelect
                          className="cat-select"
                          categories={categories}
                          value={r.category}
                          amount={r.amount}
                          disabled={r.locked}
                          onChange={(v) => tag(r, v)}
                          label={`Tag for ${r.payee}`}
                        />
                      )}
                    </td>
                    <td className="small text-2">{r.account_name}</td>
                    <td className={`num ${r.amount > 0 ? 'pos' : ''}`}>
                      {formatMoney(r.amount, { sign: true })}
                    </td>
                    <td className="num muted">{formatMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="row-between small muted" style={{ marginTop: 10 }}>
        <span>
          {rows.length} transaction{rows.length === 1 ? '' : 's'} · in {formatMoney(totals.in)} ·
          out {formatMoney(-totals.out)}
        </span>
        {rows.length > limit && (
          <button className="btn btn-sm" onClick={() => setLimit(limit + PAGE * 2)}>
            Show more ({rows.length - limit} hidden)
          </button>
        )}
      </div>
      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} tx={editing} />
    </>
  );
}
