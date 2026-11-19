import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft, Wand2 } from 'lucide-react';
import { useBook } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead } from '../components/Empty';
import { FileDrop } from '../components/FileDrop';
import { CategorySelect } from '../components/CategorySelect';
import { applyMapping, detectMapping, headerSignature, type CsvMapping } from '../../core/csv';
import { looksLikeOfx, parseOfx, type OfxStatement } from '../../core/ofx';
import { formatDate } from '../../core/dates';
import { formatMoney } from '../../core/money';
import type { ImportResult, ImportRow } from '../../db/types';
import { sampleCsv } from '../sampleData';

type Stage =
  | { kind: 'pick' }
  | {
      kind: 'csv';
      name: string;
      rows: string[][];
      headers: string[];
      mapping: CsvMapping;
      confidence: string;
      remembered: boolean;
    }
  | { kind: 'ofx'; name: string; statements: OfxStatement[]; index: number }
  | { kind: 'done'; result: ImportResult; name: string };

const FIELDS: { key: keyof CsvMapping; label: string; optional?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description / payee' },
  { key: 'amount', label: 'Amount (signed)', optional: true },
  { key: 'debit', label: 'Money out (debit)', optional: true },
  { key: 'credit', label: 'Money in (credit)', optional: true },
  { key: 'memo', label: 'Memo', optional: true },
  { key: 'checkNumber', label: 'Check number', optional: true },
];

export function Import() {
  const { store, book } = useBook();
  const toast = useToast();
  const accounts = useMemo(() => store.listAccounts(book.id, false), [store, book.id]);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const categories = useMemo(() => store.categoryIndex(book.id), [store, book.id]);

  const load = (name: string, text: string) => {
    setOverrides({});
    try {
      if (looksLikeOfx(text)) {
        const statements = parseOfx(text);
        setStage({ kind: 'ofx', name, statements, index: 0 });
        return;
      }
      const det = detectMapping(text);
      const saved = store.getImportProfile(headerSignature(det.headers));
      const mapping = saved
        ? { ...det.mapping, ...(JSON.parse(saved) as CsvMapping) }
        : det.mapping;
      setStage({
        kind: 'csv',
        name,
        rows: det.rows,
        headers: det.headers,
        mapping,
        confidence: det.confidence,
        remembered: Boolean(saved),
      });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const importRows: { rows: ImportRow[]; errors: number } = useMemo(() => {
    if (stage.kind === 'csv') {
      const parsed = applyMapping(stage.rows, stage.mapping);
      const ok = parsed.filter((p) => p.errors.length === 0);
      return {
        rows: ok.map((p) => ({
          date: p.date!,
          amount: p.amount!,
          description: p.description,
          memo: p.memo,
          checkNumber: p.checkNumber,
        })),
        errors: parsed.length - ok.length,
      };
    }
    if (stage.kind === 'ofx') {
      const st = stage.statements[stage.index];
      return {
        rows: st.transactions.map((t) => ({
          date: t.date,
          amount: t.amount,
          description: t.name || t.memo,
          memo: t.name && t.memo ? t.memo : '',
          checkNumber: t.checkNumber,
          fitId: t.fitId || undefined,
        })),
        errors: 0,
      };
    }
    return { rows: [], errors: 0 };
  }, [stage]);

  const preview = useMemo(
    () =>
      accountId && importRows.rows.length
        ? store.previewImport(book.id, accountId, importRows.rows)
        : [],
    [store, book.id, accountId, importRows],
  );
  const counts = useMemo(
    () => ({
      new: preview.filter((p) => p.status === 'new').length,
      duplicate: preview.filter((p) => p.status === 'duplicate').length,
      locked: preview.filter((p) => p.status === 'locked').length,
      tagged: preview.filter(
        (p) => p.status === 'new' && (p.key in overrides ? overrides[p.key] : p.category),
      ).length,
    }),
    [preview, overrides],
  );

  const run = () => {
    if (stage.kind !== 'csv' && stage.kind !== 'ofx') return;
    try {
      if (stage.kind === 'csv')
        store.saveImportProfile(headerSignature(stage.headers), stage.mapping);
      const result = store.importTransactions(
        book.id,
        accountId,
        importRows.rows,
        stage.kind,
        overrides,
      );
      setStage({ kind: 'done', result, name: stage.name });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setMap = (patch: Partial<CsvMapping>) =>
    stage.kind === 'csv' && setStage({ ...stage, mapping: { ...stage.mapping, ...patch } });

  if (!accounts.length) {
    return (
      <>
        <PageHead title="Import a bank file" />
        <div className="card">
          Add an account first in <Link to="/settings#accounts">Settings</Link>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Import a bank file"
        sub="Download transactions from your bank’s website as CSV, OFX or QFX (Quicken). Payeebook skips anything already imported and tags what it recognises."
        actions={
          stage.kind !== 'pick' && (
            <button className="btn" onClick={() => setStage({ kind: 'pick' })}>
              <ArrowLeft size={16} /> Start over
            </button>
          )
        }
      />

      {stage.kind === 'done' ? (
        <div className="card stack" data-testid="import-done">
          <div className="callout callout-ok">
            <CheckCircle2 size={20} />
            <div>
              <b>
                Imported {stage.result.added} transaction{stage.result.added === 1 ? '' : 's'}
              </b>{' '}
              from {stage.name}. {stage.result.autoTagged} were tagged automatically
              {stage.result.duplicates
                ? `, ${stage.result.duplicates} already-imported rows were skipped`
                : ''}
              {stage.result.locked
                ? `, and ${stage.result.locked} fall in a filed period and were skipped`
                : ''}
              .
            </div>
          </div>
          <div className="row">
            <Link className="btn btn-primary" to="/transactions?category=untagged">
              Tag the rest
            </Link>
            <Link className="btn" to="/transactions">
              View transactions
            </Link>
            <button className="btn btn-ghost" onClick={() => setStage({ kind: 'pick' })}>
              Import another file
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="card">
            <label className="field" style={{ maxWidth: 420 }}>
              <span>Import into account</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {stage.kind === 'pick' && (
            <FileDrop
              accept=".csv,.txt,.ofx,.qfx,text/csv,application/x-ofx"
              onFiles={async ([f]) => load(f.name, await f.text())}
              title="Drop a CSV, OFX or QFX file here"
              hint="Nothing is uploaded. The file is read on this device."
              icon={<FileSpreadsheet size={22} />}
              testId="import-file"
            >
              <button
                className="btn"
                type="button"
                onClick={() => load('sample-bank-export.csv', sampleCsv())}
              >
                <Wand2 size={16} /> Try a sample file
              </button>
            </FileDrop>
          )}

          {stage.kind === 'csv' && (
            <section className="card">
              <div className="card-head">
                <h2>Columns in {stage.name}</h2>
                <span
                  className={`badge ${stage.confidence === 'high' ? 'badge-ok' : 'badge-warn'}`}
                >
                  {stage.remembered
                    ? 'Remembered from last time'
                    : stage.confidence === 'high'
                      ? 'Detected automatically'
                      : 'Please check the columns'}
                </span>
              </div>
              <div className="grid-4">
                {FIELDS.map((f) => (
                  <label className="field" key={f.key}>
                    <span>{f.label}</span>
                    <select
                      value={(stage.mapping[f.key] as number | undefined) ?? -1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        const patch: Partial<CsvMapping> = { [f.key]: v < 0 ? undefined : v };
                        if (f.key === 'amount' && v >= 0)
                          Object.assign(patch, { debit: undefined, credit: undefined });
                        if ((f.key === 'debit' || f.key === 'credit') && v >= 0)
                          Object.assign(patch, { amount: undefined });
                        setMap(patch);
                      }}
                    >
                      <option value={-1}>{f.optional ? '(none)' : 'Choose…'}</option>
                      {stage.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="field">
                  <span>Date format</span>
                  <select
                    value={stage.mapping.dateOrder}
                    onChange={(e) =>
                      setMap({ dateOrder: e.target.value as CsvMapping['dateOrder'] })
                    }
                  >
                    <option value="MDY">Month/Day/Year (US)</option>
                    <option value="DMY">Day/Month/Year</option>
                    <option value="YMD">Year-Month-Day</option>
                  </select>
                </label>
              </div>
              <label className="check" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={stage.mapping.invert}
                  onChange={(e) => setMap({ invert: e.target.checked })}
                />
                Flip signs (use when purchases show as positive numbers, as on some card statements)
              </label>
              {importRows.errors > 0 && (
                <div className="callout callout-warn" style={{ marginTop: 12 }}>
                  <AlertTriangle size={18} />
                  <div>
                    {importRows.errors} rows could not be read with these columns and will be
                    skipped.
                  </div>
                </div>
              )}
            </section>
          )}

          {stage.kind === 'ofx' && stage.statements.length > 1 && (
            <div className="card">
              <label className="field" style={{ maxWidth: 420 }}>
                <span>This file has several accounts. Which one?</span>
                <select
                  value={stage.index}
                  onChange={(e) => setStage({ ...stage, index: Number(e.target.value) })}
                >
                  {stage.statements.map((s, i) => (
                    <option key={i} value={i}>
                      {s.accountType || 'Account'} ending {s.accountId.slice(-4)} (
                      {s.transactions.length} transactions)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(stage.kind === 'csv' || stage.kind === 'ofx') && (
            <section className="card card-tight">
              <div className="card-head" style={{ padding: '16px 20px 0' }}>
                <div className="row">
                  <span className="badge badge-brand">{counts.new} new</span>
                  <span className="badge badge-ok">{counts.tagged} will be tagged</span>
                  {counts.duplicate > 0 && (
                    <span className="badge">{counts.duplicate} already imported</span>
                  )}
                  {counts.locked > 0 && (
                    <span className="badge badge-warn">{counts.locked} in a filed period</span>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!counts.new}
                  onClick={run}
                  data-testid="import-run"
                >
                  Import {counts.new} transaction{counts.new === 1 ? '' : 's'}
                </button>
              </div>
              <div className="table-wrap" style={{ maxHeight: 520 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payee</th>
                      <th>Tag</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p) => (
                      <tr key={p.key} style={{ opacity: p.status === 'new' ? 1 : 0.55 }}>
                        <td className="nowrap">{formatDate(p.date)}</td>
                        <td className="payee">
                          <div className="payee-name">{p.payee}</div>
                          <div className="payee-memo">{p.description}</div>
                        </td>
                        <td>
                          {p.status === 'new' ? (
                            <CategorySelect
                              className="cat-select"
                              categories={categories}
                              amount={p.amount}
                              value={p.key in overrides ? overrides[p.key] : p.category}
                              onChange={(v) => setOverrides({ ...overrides, [p.key]: v })}
                            />
                          ) : (
                            <span className="muted small">—</span>
                          )}
                        </td>
                        <td className={`num ${p.amount > 0 ? 'pos' : ''}`}>
                          {formatMoney(p.amount, { sign: true })}
                        </td>
                        <td>
                          {p.status === 'new' ? (
                            <span className="badge badge-brand">New</span>
                          ) : p.status === 'duplicate' ? (
                            <span className="badge">Already imported</span>
                          ) : (
                            <span className="badge badge-warn">Filed period</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
