import { useEffect, useMemo, useState } from 'react';
import { Lock, Plus, Trash2, Paperclip, Split as SplitIcon, X } from 'lucide-react';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { CategorySelect } from '../components/CategorySelect';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { todayISO, formatDate } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { prepareReceiptFile, bytesToObjectUrl } from '../../ocr/image';
import type { Transaction } from '../../db/types';
import { useTagOnce } from './useTagOnce';

interface SplitDraft {
  amount: number | null;
  category: string | null;
  memo: string;
}

export function ReceiptThumb({ id, size = 64 }: { id: string; size?: number }) {
  const { store } = useBook();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const d = store.receiptData(id);
    if (!d) return;
    const bytes = d.thumb ?? (d.mime.startsWith('image/') ? d.data : null);
    if (!bytes) return;
    const u = bytesToObjectUrl(bytes, d.thumb ? 'image/jpeg' : d.mime);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [id, store]);
  return (
    <span
      className="receipt-thumb"
      style={{ width: size, height: (size * 4) / 3, borderRadius: 6, display: 'inline-grid' }}
    >
      {url ? <img src={url} alt="Receipt" /> : <Paperclip size={18} />}
    </span>
  );
}

export function TransactionDialog({
  open,
  onClose,
  tx,
}: {
  open: boolean;
  onClose: () => void;
  tx: Transaction | null;
}) {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const tagOnce = useTagOnce();
  const accounts = useMemo(() => store.listAccounts(book.id), [store, book.id]);
  const categories = useMemo(() => store.categoryIndex(book.id), [store, book.id]);
  const lockedThrough = store.lockedThrough(book.id);
  const locked = Boolean(tx && lockedThrough && tx.date <= lockedThrough);
  const disabled = readOnly || locked;

  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [payee, setPayee] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [check, setCheck] = useState('');
  const [splitting, setSplitting] = useState(false);
  const [splits, setSplits] = useState<SplitDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setAccountId(tx?.account_id ?? accounts.find((a) => !a.closed)?.id ?? '');
    setDate(tx?.date ?? todayISO());
    setPayee(tx?.payee ?? '');
    setDirection(tx && tx.amount > 0 ? 'in' : 'out');
    setAmount(tx ? Math.abs(tx.amount) : null);
    setCategory(tx?.category ?? null);
    setMemo(tx?.memo ?? '');
    setCheck(tx?.check_number ?? '');
    const existing = tx ? store.splitsFor(tx.id) : [];
    setSplitting(existing.length > 0);
    setSplits(
      existing.map((s) => ({ amount: Math.abs(s.amount), category: s.category, memo: s.memo })),
    );
  }, [open, tx, accounts, store]);

  const receipts = useQuery(
    (s) => (tx ? s.listReceipts(book.id, { txId: tx.id }) : []),
    [tx?.id, book.id],
  );
  const sign = direction === 'out' ? -1 : 1;
  const splitTotal = splits.reduce((n, s) => n + (s.amount ?? 0), 0);
  const splitRemaining = (amount ?? 0) - splitTotal;

  const save = () => {
    try {
      if (!amount) throw new Error('Enter an amount.');
      const input = {
        account_id: accountId,
        date,
        payee,
        amount: sign * amount,
        memo,
        check_number: check,
        category: splitting ? null : category,
      };
      if (splitting && splitRemaining !== 0)
        throw new Error(
          `The splits must add up to ${formatMoney(amount)}. ${formatMoney(Math.abs(splitRemaining))} is ${splitRemaining > 0 ? 'left over' : 'too much'}.`,
        );
      const saved: Transaction = store.tx(() => {
        let t: Transaction;
        if (tx) {
          if (store.splitsFor(tx.id).length && (!splitting || input.amount !== tx.amount))
            store.setSplits(tx.id, []);
          t = store.updateTransaction(tx.id, input);
        } else {
          t = store.addTransaction(book.id, input);
        }
        if (splitting) {
          store.setSplits(
            t.id,
            splits.map((s) => ({
              amount: sign * (s.amount ?? 0),
              category: s.category,
              memo: s.memo,
            })),
          );
        }
        return t;
      });
      toast.success(tx ? 'Transaction updated.' : 'Transaction added.');
      if (!splitting && category && category !== tx?.category)
        tagOnce(saved, category, { silent: true });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = () => {
    if (
      !tx ||
      !confirm(
        `Delete ${tx.payee} for ${formatMoney(tx.amount)}? This is recorded in the activity log.`,
      )
    )
      return;
    try {
      store.deleteTransaction(tx.id);
      toast.success('Transaction deleted.');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const attach = async (files: FileList | null) => {
    if (!tx || !files) return;
    for (const file of Array.from(files)) {
      try {
        const prepared = await prepareReceiptFile(file);
        store.addReceipt(book.id, {
          filename: file.name,
          mime: prepared.mime,
          data: prepared.data,
          thumb: prepared.thumb,
          tx_id: tx.id,
        });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx ? (readOnly ? 'Transaction' : 'Edit transaction') : 'Add a transaction'}
      wide
      footer={
        readOnly ? (
          <button className="btn" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            {tx && !locked && (
              <button className="btn btn-danger left" onClick={remove}>
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={disabled}>
              {tx ? 'Save changes' : 'Add transaction'}
            </button>
          </>
        )
      }
    >
      <div className="stack">
        {locked && (
          <div className="callout callout-warn">
            <Lock size={18} />
            <div>
              This transaction is part of a filed report (locked through{' '}
              {formatDate(lockedThrough!, 'long')}). Reopen the report on the Reports page to
              correct it; the change will be recorded in the activity log.
            </div>
          </div>
        )}
        <div className="form-grid">
          <label className="field">
            <span>Account</span>
            <select
              value={accountId}
              disabled={disabled}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.closed ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={date}
              disabled={disabled}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{direction === 'out' ? 'Paid to' : 'Received from'}</span>
            <input
              value={payee}
              disabled={disabled}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g. Lakeview Apartments"
            />
            {tx?.raw_payee && tx.raw_payee !== tx.payee && (
              <span className="hint">Bank description: {tx.raw_payee}</span>
            )}
          </label>
          <div className="field">
            <span>Amount</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="segmented" role="group" aria-label="Direction">
                <button
                  type="button"
                  aria-pressed={direction === 'out'}
                  disabled={disabled}
                  onClick={() => setDirection('out')}
                >
                  Money out
                </button>
                <button
                  type="button"
                  aria-pressed={direction === 'in'}
                  disabled={disabled}
                  onClick={() => setDirection('in')}
                >
                  Money in
                </button>
              </div>
              <MoneyInput value={amount} onChange={setAmount} ariaLabel="Amount" />
            </div>
          </div>
          {!splitting && (
            <label className="field">
              <span>Tag</span>
              <CategorySelect
                categories={categories}
                value={category}
                onChange={setCategory}
                amount={sign}
                disabled={disabled}
              />
            </label>
          )}
          <label className="field">
            <span>
              Check number <span className="hint">(optional)</span>
            </span>
            <input
              value={check}
              disabled={disabled}
              onChange={(e) => setCheck(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field span-2">
            <span>
              Note <span className="hint">(what it was for; printed on itemized schedules)</span>
            </span>
            <input value={memo} disabled={disabled} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>

        <div className="stack-sm">
          <div className="row-between">
            <h3>
              <SplitIcon size={16} style={{ verticalAlign: '-3px' }} /> Split across tags
            </h3>
            {!disabled && (
              <label className="check small">
                <input
                  type="checkbox"
                  checked={splitting}
                  onChange={(e) => {
                    setSplitting(e.target.checked);
                    if (e.target.checked && splits.length === 0)
                      setSplits([
                        { amount: amount, category, memo: '' },
                        { amount: null, category: null, memo: '' },
                      ]);
                  }}
                />
                One payment covered several things (for example groceries and clothing)
              </label>
            )}
          </div>
          {splitting && (
            <div className="stack-sm">
              {splits.map((s, i) => (
                <div className="split-row" key={i}>
                  <CategorySelect
                    categories={categories}
                    value={s.category}
                    amount={sign}
                    disabled={disabled}
                    onChange={(v) =>
                      setSplits(splits.map((x, j) => (j === i ? { ...x, category: v } : x)))
                    }
                  />
                  <MoneyInput
                    value={s.amount}
                    ariaLabel={`Split ${i + 1} amount`}
                    onChange={(v) =>
                      setSplits(splits.map((x, j) => (j === i ? { ...x, amount: v } : x)))
                    }
                  />
                  <input
                    value={s.memo}
                    placeholder="Note"
                    disabled={disabled}
                    onChange={(e) =>
                      setSplits(
                        splits.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    className="icon-btn"
                    aria-label="Remove split"
                    disabled={disabled || splits.length <= 2}
                    onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <div className="row-between small">
                {!disabled && (
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      setSplits([
                        ...splits,
                        {
                          amount: splitRemaining > 0 ? splitRemaining : null,
                          category: null,
                          memo: '',
                        },
                      ])
                    }
                  >
                    <Plus size={14} /> Add a part
                  </button>
                )}
                <span className={splitRemaining === 0 ? 'pos' : 'danger-text'}>
                  {splitRemaining === 0
                    ? 'Splits add up'
                    : `${formatMoney(Math.abs(splitRemaining))} ${splitRemaining > 0 ? 'left to assign' : 'over'}`}
                </span>
              </div>
            </div>
          )}
        </div>

        {tx && (
          <div className="stack-sm">
            <div className="row-between">
              <h3>
                <Paperclip size={16} style={{ verticalAlign: '-3px' }} /> Receipts
              </h3>
              {!readOnly && (
                <label className="btn btn-sm">
                  <Plus size={14} /> Attach
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    multiple
                    hidden
                    onChange={(e) => attach(e.target.files)}
                  />
                </label>
              )}
            </div>
            {receipts.length === 0 ? (
              <p className="muted small">No receipt attached.</p>
            ) : (
              <div className="row">
                {receipts.map((r) => (
                  <a
                    key={r.id}
                    href={`#/receipts?open=${r.id}`}
                    title={r.filename}
                    onClick={onClose}
                  >
                    <ReceiptThumb id={r.id} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
