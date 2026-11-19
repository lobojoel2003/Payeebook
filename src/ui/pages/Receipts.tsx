import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Camera,
  ScanText,
  Trash2,
  Link2,
  Unlink,
  FileText,
  ReceiptText,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead, Empty } from '../components/Empty';
import { FileDrop } from '../components/FileDrop';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { CategorySelect } from '../components/CategorySelect';
import { prepareReceiptFile, bytesToObjectUrl, type PreparedImage } from '../../ocr/image';
import { readReceipt } from '../../ocr/ocr';
import { rankMatches, type MatchCandidate } from '../../core/receipt';
import { addDays, formatDate, todayISO } from '../../core/dates';
import { formatMoney } from '../../core/money';
import type { ReceiptMeta } from '../../db/types';
import { saveFile } from '../download';

interface Job {
  id: number;
  name: string;
  status: 'preparing' | 'reading' | 'ready' | 'error' | 'saved';
  progress: number;
  message?: string;
  prepared?: PreparedImage;
  preview?: string;
  text?: string;
  confidence?: number;
  total: number | null;
  date: string | null;
  merchant: string;
  choice: string | 'new' | 'none';
  accountId: string;
  category: string | null;
}

let jobSeq = 1;

export function Receipts() {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const filter = params.get('filter') ?? 'all';
  const openId = params.get('open');
  const accounts = useMemo(() => store.listAccounts(book.id, false), [store, book.id]);
  const categories = useQuery((s) => s.categoryIndex(book.id), [book.id]);
  const receipts = useQuery(
    (s) => s.listReceipts(book.id, { unmatched: filter === 'unmatched' }),
    [book.id, filter],
  );
  const txIndex = useQuery(
    (s) => {
      const rows = s.listTransactions(book.id, { from: addDays(todayISO(), -800) });
      return new Map(rows.map((r) => [r.id, r]));
    },
    [book.id],
  );
  const candidates: MatchCandidate[] = useMemo(
    () =>
      [...txIndex.values()]
        .filter((t) => t.amount < 0)
        .map((t) => ({
          id: t.id,
          date: t.date,
          amount: t.amount,
          payee: t.payee,
          hasReceipt: t.receipt_count > 0,
        })),
    [txIndex],
  );

  const update = (id: number, patch: Partial<Job>) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const process = async (files: File[]) => {
    for (const file of files) {
      const id = jobSeq++;
      const job: Job = {
        id,
        name: file.name || 'Photo',
        status: 'preparing',
        progress: 0,
        total: null,
        date: null,
        merchant: '',
        choice: 'none',
        accountId: accounts[0]?.id ?? '',
        category: null,
      };
      setJobs((js) => [job, ...js]);
      try {
        const prepared = await prepareReceiptFile(file);
        const preview = prepared.thumb ? bytesToObjectUrl(prepared.thumb, 'image/jpeg') : undefined;
        update(id, {
          prepared,
          preview,
          status: prepared.mime === 'application/pdf' ? 'ready' : 'reading',
        });
        if (prepared.mime === 'application/pdf') continue;
        try {
          const ocr = await readReceipt(
            new Blob([prepared.data as BlobPart], { type: prepared.mime }),
            (p, status) => update(id, { progress: status.includes('recogniz') ? p : 0 }),
          );
          const matches = rankMatches(ocr, candidates);
          update(id, {
            status: 'ready',
            text: ocr.text,
            confidence: ocr.confidence,
            total: ocr.total,
            date: ocr.date,
            merchant: ocr.merchant ?? '',
            choice: matches[0]?.id ?? (ocr.total ? 'new' : 'none'),
          });
        } catch (e) {
          update(id, {
            status: 'ready',
            message: `Could not read the text automatically (${errorMessage(e)}). Enter the details by hand.`,
          });
        }
      } catch (e) {
        update(id, { status: 'error', message: errorMessage(e) });
      }
    }
  };

  const save = (job: Job) => {
    if (!job.prepared) return;
    try {
      store.tx(() => {
        let txId: string | null = null;
        if (job.choice === 'new') {
          if (!job.total) throw new Error('Enter the receipt total to create a transaction.');
          const t = store.addTransaction(
            book.id,
            {
              account_id: job.accountId,
              date: job.date ?? todayISO(),
              amount: -job.total,
              payee: job.merchant || 'Receipt',
              category: job.category,
              memo: 'Added from a receipt',
            },
            'receipt',
          );
          txId = t.id;
        } else if (job.choice !== 'none') {
          txId = job.choice;
        }
        store.addReceipt(book.id, {
          filename: job.name,
          mime: job.prepared!.mime,
          data: job.prepared!.data,
          thumb: job.prepared!.thumb,
          tx_id: txId,
          ocr_text: job.text ?? null,
          ocr_confidence: job.confidence ?? null,
          ocr_total: job.total,
          ocr_date: job.date,
          ocr_merchant: job.merchant || null,
        });
      });
      update(job.id, { status: 'saved' });
      toast.success(
        job.choice === 'none'
          ? 'Receipt saved. Match it to a transaction later.'
          : 'Receipt saved and attached.',
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const viewing = openId ? store.getReceipt(openId) : undefined;

  return (
    <>
      <PageHead
        title="Receipts"
        sub="Snap or upload receipts. Payeebook reads the total and date on this device and finds the payment they belong to."
        actions={
          <div className="segmented" role="group" aria-label="Filter receipts">
            {[
              ['all', 'All'],
              ['unmatched', 'Not attached'],
            ].map(([k, label]) => (
              <button
                key={k}
                aria-pressed={filter === k}
                onClick={() => setParams(k === 'all' ? {} : { filter: k })}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="stack">
        {!readOnly && (
          <FileDrop
            accept="image/*,application/pdf"
            multiple
            onFiles={process}
            title="Add receipts"
            hint="Photos (JPEG, PNG) or PDFs. Images are read with on-device OCR; nothing is uploaded."
            icon={<ScanText size={22} />}
            testId="receipt-file"
          >
            <label className="btn">
              <Camera size={16} /> Take a photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => e.target.files && process(Array.from(e.target.files))}
              />
            </label>
          </FileDrop>
        )}

        {jobs
          .filter((j) => j.status !== 'saved')
          .map((job) => {
            const matches = rankMatches(
              { total: job.total, date: job.date, merchant: job.merchant },
              candidates,
            ).slice(0, 4);
            return (
              <section className="card" key={job.id} data-testid="receipt-job">
                <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
                  <div
                    className="receipt-thumb"
                    style={{ width: 120, borderRadius: 8, flex: 'none' }}
                  >
                    {job.preview ? <img src={job.preview} alt="" /> : <FileText size={28} />}
                  </div>
                  <div className="grow stack-sm">
                    <div className="row-between">
                      <h3>{job.name}</h3>
                      {job.status === 'preparing' || job.status === 'reading' ? (
                        <span className="badge">
                          <Loader2 size={12} className="spin" />{' '}
                          {job.status === 'preparing'
                            ? 'Preparing…'
                            : `Reading text ${Math.round(job.progress * 100)}%`}
                        </span>
                      ) : job.status === 'error' ? (
                        <span className="badge badge-danger">Could not open</span>
                      ) : (
                        <span className="badge badge-ok">
                          <CheckCircle2 size={12} />{' '}
                          {job.text
                            ? `Read with ${Math.round(job.confidence ?? 0)}% confidence`
                            : 'Ready'}
                        </span>
                      )}
                    </div>
                    {job.status === 'reading' && (
                      <div className="progress">
                        <div style={{ width: `${Math.max(5, job.progress * 100)}%` }} />
                      </div>
                    )}
                    {job.message && <p className="small muted">{job.message}</p>}
                    {job.status === 'ready' && (
                      <>
                        <div className="grid-3">
                          <label className="field">
                            <span>Total</span>
                            <MoneyInput
                              value={job.total}
                              onChange={(v) => update(job.id, { total: v })}
                              ariaLabel="Receipt total"
                            />
                          </label>
                          <label className="field">
                            <span>Date</span>
                            <input
                              type="date"
                              value={job.date ?? ''}
                              onChange={(e) => update(job.id, { date: e.target.value || null })}
                            />
                          </label>
                          <label className="field">
                            <span>Store or payee</span>
                            <input
                              value={job.merchant}
                              onChange={(e) => update(job.id, { merchant: e.target.value })}
                            />
                          </label>
                        </div>
                        <fieldset
                          className="stack-sm"
                          style={{ border: 'none', padding: 0, margin: 0 }}
                        >
                          <legend className="field-label" style={{ marginBottom: 6 }}>
                            Attach to
                          </legend>
                          {matches.map((m) => (
                            <label className="check" key={m.id}>
                              <input
                                type="radio"
                                name={`job-${job.id}`}
                                checked={job.choice === m.id}
                                onChange={() => update(job.id, { choice: m.id })}
                              />
                              {formatDate(m.date)} · {m.payee} · {formatMoney(m.amount)}
                              {m.hasReceipt && <span className="badge">has a receipt</span>}
                            </label>
                          ))}
                          {job.total !== null && matches.length === 0 && (
                            <p className="small muted">
                              No payment of {formatMoney(job.total)} within a week of that date.
                            </p>
                          )}
                          <label className="check">
                            <input
                              type="radio"
                              name={`job-${job.id}`}
                              checked={job.choice === 'new'}
                              onChange={() => update(job.id, { choice: 'new' })}
                            />
                            A new cash or card payment (adds a transaction)
                          </label>
                          {job.choice === 'new' && (
                            <div className="grid-2" style={{ paddingLeft: 24 }}>
                              <label className="field">
                                <span>Paid from</span>
                                <select
                                  value={job.accountId}
                                  onChange={(e) => update(job.id, { accountId: e.target.value })}
                                >
                                  {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="field">
                                <span>Tag</span>
                                <CategorySelect
                                  categories={categories}
                                  value={job.category}
                                  amount={-1}
                                  onChange={(v) => update(job.id, { category: v })}
                                />
                              </label>
                            </div>
                          )}
                          <label className="check">
                            <input
                              type="radio"
                              name={`job-${job.id}`}
                              checked={job.choice === 'none'}
                              onChange={() => update(job.id, { choice: 'none' })}
                            />
                            Keep it unattached for now
                          </label>
                        </fieldset>
                        <div className="row">
                          <button
                            className="btn btn-primary"
                            onClick={() => save(job)}
                            data-testid="receipt-save"
                          >
                            Save receipt
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => setJobs((js) => js.filter((j) => j.id !== job.id))}
                          >
                            Discard
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </section>
            );
          })}

        <section className="card">
          <div className="card-head">
            <h2>
              {filter === 'unmatched' ? 'Receipts not attached to a transaction' : 'All receipts'}
            </h2>
            <span className="sub">{receipts.length}</span>
          </div>
          {receipts.length === 0 ? (
            <Empty
              icon={<ReceiptText size={32} />}
              title={filter === 'unmatched' ? 'Every receipt is attached' : 'No receipts yet'}
            >
              {filter === 'unmatched'
                ? 'Nice work.'
                : 'Receipts you add appear here and in the report appendix.'}
            </Empty>
          ) : (
            <div className="receipt-grid">
              {receipts.map((r) => {
                const tx = r.tx_id ? txIndex.get(r.tx_id) : undefined;
                return (
                  <button
                    className="receipt-card"
                    key={r.id}
                    onClick={() =>
                      setParams({ ...(filter !== 'all' ? { filter } : {}), open: r.id })
                    }
                  >
                    <ReceiptThumbFill id={r.id} mime={r.mime} />
                    <div className="receipt-meta">
                      <b>{tx?.payee ?? r.ocr_merchant ?? r.filename}</b>
                      <span className="muted">
                        {formatDate(tx?.date ?? r.ocr_date ?? r.created_at.slice(0, 10))}
                        {(tx?.amount ?? r.ocr_total)
                          ? ` · ${formatMoney(Math.abs(tx?.amount ?? r.ocr_total ?? 0))}`
                          : ''}
                      </span>
                      {r.tx_id ? (
                        <span className="badge badge-ok">Attached</span>
                      ) : (
                        <span className="badge badge-warn">Not attached</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
      {viewing && (
        <ReceiptViewer
          receipt={viewing}
          candidates={candidates}
          onClose={() => setParams(filter !== 'all' ? { filter } : {})}
        />
      )}
    </>
  );
}

function ReceiptThumbFill({ id, mime }: { id: string; mime: string }) {
  if (mime === 'application/pdf')
    return (
      <div className="receipt-thumb">
        <FileText size={36} />
      </div>
    );
  return (
    <div className="receipt-thumb">
      <ThumbImg id={id} />
    </div>
  );
}

function ThumbImg({ id }: { id: string }) {
  const { store } = useBook();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const d = store.receiptData(id);
    if (!d) return;
    const u = bytesToObjectUrl(d.thumb ?? d.data, d.thumb ? 'image/jpeg' : d.mime);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [id, store]);
  return url ? <img src={url} alt="" loading="lazy" /> : null;
}

function ReceiptViewer({
  receipt,
  candidates,
  onClose,
}: {
  receipt: ReceiptMeta;
  candidates: MatchCandidate[];
  onClose: () => void;
}) {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const [url, setUrl] = useState<string>();
  const [showText, setShowText] = useState(false);
  const [linkTo, setLinkTo] = useState('');
  const tx = receipt.tx_id ? store.getTransaction(receipt.tx_id) : undefined;
  useEffect(() => {
    const d = store.receiptData(receipt.id);
    if (!d) return;
    const u = bytesToObjectUrl(d.data, d.mime);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [receipt.id, store]);
  const ranked = rankMatches(
    { total: receipt.ocr_total, date: receipt.ocr_date, merchant: receipt.ocr_merchant },
    candidates,
  );
  const options = ranked.length ? ranked : candidates.slice(0, 50);

  const act = (fn: () => void, msg: string) => {
    try {
      fn();
      toast.success(msg);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={receipt.ocr_merchant ?? receipt.filename}
      footer={
        <>
          {!readOnly && (
            <button
              className="btn btn-danger left"
              onClick={() => {
                if (confirm('Delete this receipt? This is recorded in the activity log.')) {
                  act(() => store.deleteReceipt(receipt.id), 'Receipt deleted.');
                  onClose();
                }
              }}
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              const d = store.receiptData(receipt.id);
              if (d) void saveFile(receipt.filename, d.data, d.mime);
            }}
          >
            Download original
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="grid-2 receipt-viewer">
        <div>
          {receipt.mime === 'application/pdf'
            ? url && (
                <iframe
                  title="Receipt PDF"
                  src={url}
                  style={{
                    width: '100%',
                    height: 520,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
              )
            : url && <img src={url} alt="Receipt" />}
        </div>
        <div className="stack">
          <dl className="kv">
            <dt>File</dt>
            <dd>{receipt.filename}</dd>
            <dt>Added</dt>
            <dd>{formatDate(receipt.created_at.slice(0, 10), 'long')}</dd>
            {receipt.ocr_total !== null && (
              <>
                <dt>Total read</dt>
                <dd>{formatMoney(receipt.ocr_total)}</dd>
              </>
            )}
            {receipt.ocr_date && (
              <>
                <dt>Date read</dt>
                <dd>{formatDate(receipt.ocr_date, 'long')}</dd>
              </>
            )}
          </dl>
          {tx ? (
            <div className="callout callout-ok">
              <Link2 size={18} />
              <div className="grow">
                Attached to <b>{tx.payee}</b> on {formatDate(tx.date)} for {formatMoney(tx.amount)}.
              </div>
              {!readOnly && (
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    act(() => store.updateReceipt(receipt.id, { tx_id: null }), 'Receipt detached.')
                  }
                >
                  <Unlink size={14} /> Detach
                </button>
              )}
            </div>
          ) : (
            !readOnly && (
              <div className="stack-sm">
                <label className="field">
                  <span>Attach to a payment</span>
                  <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                    <option value="">Choose…</option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatDate(c.date)} · {c.payee} · {formatMoney(c.amount)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-primary"
                  disabled={!linkTo}
                  onClick={() =>
                    act(
                      () => store.updateReceipt(receipt.id, { tx_id: linkTo }),
                      'Receipt attached.',
                    )
                  }
                >
                  Attach
                </button>
              </div>
            )
          )}
          {receipt.ocr_text && (
            <div>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowText(!showText)}>
                {showText ? 'Hide' : 'Show'} text read from the image
              </button>
              {showText && <pre className="code">{receipt.ocr_text}</pre>}
            </div>
          )}
          <p className="muted tiny">Book: {book.beneficiary_name}</p>
        </div>
      </div>
    </Modal>
  );
}
