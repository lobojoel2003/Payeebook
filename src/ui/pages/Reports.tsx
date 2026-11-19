import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  FileDown,
  FileCheck2,
  Lock,
  LockOpen,
  Save,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FilePen,
  Trash2,
} from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead } from '../components/Empty';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { loadTemplates, suggestedFor, defaultPeriod } from '../../templates';
import { TemplateEvaluator, type ReportResult } from '../../core/templates/evaluate';
import type { Value } from '../../core/templates/expr';
import type { FormTemplate, TemplateInput } from '../../core/templates/types';
import { addYears, formatDate, periodEndFor, todayISO } from '../../core/dates';
import { formatMoney } from '../../core/money';
import { saveFile, slug, readFileBytes } from '../download';
import { BUILD } from '../../buildInfo';
import { ROLE_LABELS, type Report } from '../../db/types';

export function StatusBadge({ status }: { status: FormTemplate['status'] }) {
  if (status === 'verified')
    return <span className="badge badge-ok">Checked against official form</span>;
  if (status === 'draft') return <span className="badge badge-warn">Community draft</span>;
  return <span className="badge">Standard schedules</span>;
}

export function jurisdictionLabel(t: FormTemplate): string {
  const j = t.jurisdiction;
  return [
    j.agency,
    j.county ? `${j.county} County` : null,
    j.state ?? (j.agency ? null : 'Any US state'),
  ]
    .filter(Boolean)
    .join(', ');
}

function InputField({
  input,
  value,
  onChange,
  disabled,
}: {
  input: TemplateInput;
  value: Value;
  onChange: (v: Value) => void;
  disabled?: boolean;
}) {
  const label = (
    <span>
      {input.label}
      {input.help && <span className="hint"> {input.help}</span>}
    </span>
  );
  switch (input.type) {
    case 'money':
      return (
        <label className="field">
          {label}
          <MoneyInput
            value={typeof value === 'number' ? value : value ? Number(value) : null}
            onChange={(v) => onChange(v ?? 0)}
          />
        </label>
      );
    case 'yesno':
      return (
        <div className="field">
          {label}
          <div className="segmented" role="group" aria-label={input.label}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={value === true}
              onClick={() => onChange(true)}
            >
              Yes
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={value === false}
              onClick={() => onChange(false)}
            >
              No
            </button>
          </div>
        </div>
      );
    case 'choice':
      return (
        <label className="field">
          {label}
          <select
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Choose…</option>
            {input.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      );
    case 'textarea':
      return (
        <label className="field span-2">
          {label}
          <textarea
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case 'date':
      return (
        <label className="field">
          {label}
          <input
            type="date"
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case 'number':
      return (
        <label className="field">
          {label}
          <input
            type="number"
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
      );
    default:
      return (
        <label className="field">
          {label}
          <input
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}

function Preview({ result }: { result: ReportResult }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="stack" data-testid="report-preview">
      {result.sections.map((s) => (
        <div key={s.id} className="report-section">
          <h3>{s.title}</h3>
          {s.description && <p className="small muted">{s.description}</p>}
          <div style={{ marginTop: 6 }}>
            {s.lines.map((l) => (
              <div key={l.id} className={`report-line ${l.emphasis ? 'emphasis' : ''}`}>
                <span>{l.label}</span>
                <span className={l.format === 'money' ? 'money' : ''} data-line={`${s.id}.${l.id}`}>
                  {l.display}
                </span>
              </div>
            ))}
            {s.total && (
              <div className="report-total">
                <span>{s.total.label}</span>
                <span className="money" data-line={`${s.id}.total`}>
                  {s.total.display}
                </span>
              </div>
            )}
          </div>
          {s.itemized && s.itemized.some((g) => g.items.length) && (
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setOpen({ ...open, [s.id]: !open[s.id] })}
              >
                {open[s.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{' '}
                {open[s.id] ? 'Hide' : 'Show'} the{' '}
                {s.itemized.reduce((n, g) => n + g.items.length, 0)} transactions behind these
                totals
              </button>
              {open[s.id] && (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {s.itemized.flatMap((g) =>
                        g.items.map((i) => (
                          <tr key={`${g.lineId}-${i.txId}-${i.lineId}`}>
                            <td className="nowrap small">{formatDate(i.date)}</td>
                            <td className="small">{i.payee}</td>
                            <td className="small muted">{g.label}</td>
                            <td className="num small">{formatMoney(i.amount)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {result.attestation && (
        <div className="report-section">
          <h3>Statement</h3>
          <p className="small text-2" style={{ marginTop: 6 }}>
            {result.attestation}
          </p>
        </div>
      )}
    </div>
  );
}

export function Reports() {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const userTemplates = useQuery((s) => s.listUserTemplates(), []);
  const customIds = useQuery((s) => s.customCategories(book.id).map((c) => c.id), [book.id]);
  const { templates, errors } = useMemo(
    () => loadTemplates(userTemplates, customIds),
    [userTemplates, customIds],
  );
  const ranked = useMemo(
    () =>
      [...templates].sort(
        (a, b) =>
          suggestedFor(b.template, book) - suggestedFor(a.template, book) ||
          a.template.name.localeCompare(b.template.name),
      ),
    [templates, book],
  );
  const reports = useQuery((s) => s.listReports(book.id), [book.id]);

  const templateId = params.get('template') ?? ranked[0]?.template.id;
  const loaded = templates.find((t) => t.template.id === templateId) ?? ranked[0];
  const template = loaded?.template;
  const [period, setPeriod] = useState(() =>
    template ? defaultPeriod(template, book) : { start: todayISO(), end: todayISO() },
  );
  const [inputs, setInputs] = useState<Record<string, Value>>({});
  const [reportId, setReportId] = useState<string | null>(null);
  const [includeReceipts, setIncludeReceipts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmFile, setConfirmFile] = useState(false);

  // Reset period and inputs when the template changes (unless a saved report is being opened).
  useEffect(() => {
    if (!template) return;
    const fromReport = params.get('report');
    const saved = fromReport ? reports.find((r) => r.id === fromReport) : undefined;
    if (saved && saved.template_id === template.id) {
      setPeriod({ start: saved.period_start, end: saved.period_end });
      setInputs(JSON.parse(saved.inputs) as Record<string, Value>);
      setReportId(saved.id);
    } else {
      setPeriod(defaultPeriod(template, book));
      setInputs({});
      setReportId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, params.get('report')]);

  const evaluation = useQuery(
    (s) => {
      if (!template) return null;
      try {
        const ctx = s.buildEvalContext(book.id, period, inputs);
        const ev = new TemplateEvaluator(template, ctx);
        return { result: ev.run(), ctx, error: null as string | null };
      } catch (e) {
        return { result: null, ctx: null, error: errorMessage(e) };
      }
    },
    [template, period.start, period.end, JSON.stringify(inputs), book.id],
  );
  const current = reportId ? reports.find((r) => r.id === reportId) : undefined;
  const filed = current?.status === 'filed';

  const pick = (id: string) => setParams({ template: id });

  const resolvedInputs = evaluation?.result?.inputs ?? {};

  const persist = (): Report | null => {
    if (!template || !evaluation?.result) return null;
    const totals = Object.fromEntries(
      Object.entries(evaluation.result.values).filter(([, v]) => typeof v === 'number'),
    );
    const r = store.saveReport(book.id, {
      id: reportId ?? undefined,
      template_id: template.id,
      template_version: template.version,
      template_name: template.short_name ?? template.name,
      period_start: period.start,
      period_end: period.end,
      inputs: resolvedInputs,
      totals,
    });
    setReportId(r.id);
    return r;
  };

  const downloadPdf = async () => {
    if (!template || !evaluation?.result || !evaluation.ctx) return;
    setBusy(true);
    try {
      const { renderReportPdf } = await import('../../pdf/report');
      const bytes = await renderReportPdf({
        result: evaluation.result,
        book: { ...book, role_label: ROLE_LABELS[book.role] },
        categories: evaluation.ctx.categories,
        receipt: (id) => {
          const d = store.receiptData(id);
          const meta = store.getReceipt(id);
          return d && meta ? { data: d.data, mime: d.mime, filename: meta.filename } : undefined;
        },
        includeReceipts,
        generatedOn: todayISO(),
        build: BUILD,
      });
      await saveFile(
        `${slug(template.short_name ?? template.id)}-${slug(book.beneficiary_name)}-${period.end}.pdf`,
        bytes,
        'application/pdf',
      );
      if (!readOnly && !filed) persist();
    } catch (e) {
      toast.error(`Could not make the PDF: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const fillOfficial = async (file: File) => {
    if (!template || !evaluation?.ctx) return;
    try {
      const { fillAcroForm } = await import('../../pdf/acroform');
      const out = await fillAcroForm(
        await readFileBytes(file),
        new TemplateEvaluator(template, evaluation.ctx),
      );
      await saveFile(
        file.name.replace(/\.pdf$/i, '') + '-filled.pdf',
        out.bytes,
        'application/pdf',
      );
      toast.success(
        `Filled ${out.filled.length} field${out.filled.length === 1 ? '' : 's'}.${out.missing.length ? ` ${out.missing.length} mapped field(s) were not in this PDF: ${out.missing.slice(0, 3).join(', ')}.` : ''}`,
      );
    } catch (e) {
      toast.error(`Could not fill that PDF: ${errorMessage(e)}`);
    }
  };

  const markFiled = () => {
    try {
      const r = persist();
      if (!r) return;
      store.setReportStatus(r.id, 'filed');
      toast.success(`Marked as filed. Transactions through ${formatDate(period.end)} are locked.`);
      setConfirmFile(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!template) {
    return (
      <>
        <PageHead title="Reports" />
        <div className="card">No templates could be loaded.</div>
      </>
    );
  }

  const blockers = evaluation?.result?.checks.filter((c) => !c.ok && c.severity === 'error') ?? [];

  return (
    <>
      <PageHead
        title="Reports"
        sub="Pick a form. Payeebook fills in the totals from your ledger, lists the transactions behind them and attaches the receipts."
      />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="template-list" role="list">
          {ranked.map(({ template: t, source }) => (
            <button
              key={t.id}
              className="template-card"
              aria-pressed={t.id === template.id}
              onClick={() => pick(t.id)}
              role="listitem"
            >
              <div className="row-between">
                <b>{t.short_name ?? t.name}</b>
                {suggestedFor(t, book) >= 4 && <span className="badge badge-brand">Suggested</span>}
              </div>
              <span className="small text-2">{t.name}</span>
              <div className="row">
                <StatusBadge status={t.status} />
                <span className="tiny muted">{jurisdictionLabel(t)}</span>
                {source === 'user' && <span className="badge">Imported</span>}
              </div>
            </button>
          ))}
        </div>
        {errors.length > 0 && (
          <p className="small danger-text" style={{ marginTop: 10 }}>
            {errors.length} template{errors.length === 1 ? '' : 's'} could not be loaded. See{' '}
            <Link to="/templates">Form templates</Link>.
          </p>
        )}
      </section>

      <div className="grid-split-even">
        <div className="stack">
          <section className="card stack">
            <div>
              <div className="row" style={{ marginBottom: 6 }}>
                <StatusBadge status={template.status} />
                <span className="tiny muted">
                  {template.id} v{template.version}
                </span>
              </div>
              <h2>{template.name}</h2>
              {template.description && (
                <p className="small text-2" style={{ marginTop: 6 }}>
                  {template.description}
                </p>
              )}
              {template.references?.length ? (
                <ul className="list-plain small" style={{ marginTop: 8 }}>
                  {template.references.map((r) => (
                    <li key={r.url}>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title} <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {filed && (
              <div className="callout callout-ok">
                <Lock size={18} />
                <div className="grow">
                  Filed {formatDate(current?.filed_at)}. Transactions in this period are locked.
                </div>
                {!readOnly && (
                  <button
                    className="btn btn-sm"
                    onClick={() => store.setReportStatus(current!.id, 'reopened')}
                  >
                    <LockOpen size={14} /> Reopen
                  </button>
                )}
              </div>
            )}
            <div className="form-grid">
              <label className="field">
                <span>Period from</span>
                <input
                  type="date"
                  value={period.start}
                  disabled={filed}
                  onChange={(e) => setPeriod({ ...period, start: e.target.value })}
                />
              </label>
              <label className="field">
                <span>to</span>
                <input
                  type="date"
                  value={period.end}
                  disabled={filed}
                  onChange={(e) => setPeriod({ ...period, end: e.target.value })}
                />
              </label>
            </div>
            {!filed && (
              <div className="row small">
                <span className="muted">Quick:</span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setPeriod(defaultPeriod(template, book))}
                >
                  Suggested
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setPeriod({
                      start: addYears(period.start, -1),
                      end: periodEndFor(addYears(period.start, -1)),
                    })
                  }
                >
                  Year before
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setPeriod({
                      start: `${Number(todayISO().slice(0, 4)) - 1}-01-01`,
                      end: `${Number(todayISO().slice(0, 4)) - 1}-12-31`,
                    })
                  }
                >
                  Last calendar year
                </button>
              </div>
            )}
            {template.inputs?.length ? (
              <>
                <div className="divider" />
                <h3>Questions on the form</h3>
                <div className="form-grid">
                  {template.inputs.map((input) => (
                    <InputField
                      key={input.id}
                      input={input}
                      value={
                        input.id in inputs ? inputs[input.id] : (resolvedInputs[input.id] ?? '')
                      }
                      disabled={filed || readOnly}
                      onChange={(v) => setInputs({ ...inputs, [input.id]: v })}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>

          <section className="card stack-sm">
            <h3>Checks</h3>
            {evaluation?.error && (
              <div className="callout callout-danger">
                <XCircle size={18} />
                <div>This template could not be calculated: {evaluation.error}</div>
              </div>
            )}
            {evaluation?.result?.checks.map((c) => (
              <div className="check-row" key={c.label}>
                {c.ok ? (
                  <CheckCircle2 size={18} color="var(--ok)" />
                ) : c.severity === 'warning' ? (
                  <AlertTriangle size={18} color="var(--warn)" />
                ) : (
                  <XCircle size={18} color="var(--danger)" />
                )}
                <div>
                  <div>{c.label}</div>
                  {!c.ok && (c.help || c.error) && (
                    <div className="small muted">{c.error ?? c.help}</div>
                  )}
                </div>
              </div>
            ))}
            {evaluation?.result && evaluation.ctx && evaluation.ctx.counts.untagged > 0 && (
              <Link
                className="small"
                to={`/transactions?category=untagged&from=${period.start}&to=${period.end}`}
              >
                Tag the {evaluation.ctx.counts.untagged} untagged transaction
                {evaluation.ctx.counts.untagged === 1 ? '' : 's'} in this period →
              </Link>
            )}
          </section>

          <section className="card stack">
            <h3>Produce</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={includeReceipts}
                onChange={(e) => setIncludeReceipts(e.target.checked)}
              />
              Attach {evaluation?.result?.exhibits.length ?? 0} receipt
              {evaluation?.result?.exhibits.length === 1 ? '' : 's'} to the PDF
            </label>
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={downloadPdf}
                disabled={busy || !evaluation?.result}
                data-testid="download-pdf"
              >
                <FileDown size={16} /> {busy ? 'Building PDF…' : 'Download PDF'}
              </button>
              {template.acroform && (
                <label className="btn">
                  <FilePen size={16} /> Fill the official PDF…
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => e.target.files?.[0] && fillOfficial(e.target.files[0])}
                  />
                </label>
              )}
            </div>
            {template.acroform && (
              <p className="small muted">
                Download the blank fillable form from the court or agency, then choose it here.
                Payeebook writes the totals into its fields.
              </p>
            )}
            {!readOnly && !filed && (
              <div className="row">
                <button
                  className="btn"
                  onClick={() => {
                    try {
                      persist();
                      toast.success('Draft saved.');
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  <Save size={16} /> Save draft
                </button>
                <button
                  className="btn"
                  onClick={() => setConfirmFile(true)}
                  disabled={!evaluation?.result || blockers.length > 0}
                  title={blockers.length ? 'Fix the failed checks first' : undefined}
                >
                  <FileCheck2 size={16} /> Mark as filed…
                </button>
              </div>
            )}
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>Preview</h2>
            <span className="sub">
              {formatDate(period.start, 'long')} – {formatDate(period.end, 'long')}
            </span>
          </div>
          {evaluation?.result ? (
            <Preview result={evaluation.result} />
          ) : (
            <p className="muted">Nothing to show.</p>
          )}
        </section>
      </div>

      <section className="card card-tight" style={{ marginTop: 16 }}>
        <div className="card-head" style={{ padding: '16px 20px 0' }}>
          <h2>Saved reports</h2>
        </div>
        {reports.length === 0 ? (
          <p className="muted" style={{ padding: '0 20px 20px' }}>
            Reports you save or download appear here. Marking one as filed locks its period so the
            books cannot drift from what you submitted.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.template_name}</b>
                      <div className="tiny muted">
                        {r.template_id} v{r.template_version}
                      </div>
                    </td>
                    <td className="small">
                      {formatDate(r.period_start)} – {formatDate(r.period_end)}
                    </td>
                    <td>
                      {r.status === 'filed' ? (
                        <span className="badge badge-ok">
                          <Lock size={12} /> Filed {formatDate(r.filed_at)}
                        </span>
                      ) : r.status === 'reopened' ? (
                        <span className="badge badge-warn">Reopened</span>
                      ) : (
                        <span className="badge">Draft</span>
                      )}
                    </td>
                    <td className="small muted">{formatDate(r.updated_at.slice(0, 10))}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm"
                          onClick={() => setParams({ template: r.template_id, report: r.id })}
                        >
                          Open
                        </button>
                        {!readOnly && r.status !== 'filed' && (
                          <button
                            className="icon-btn"
                            aria-label="Delete draft"
                            onClick={() => {
                              try {
                                store.deleteReport(r.id);
                                if (reportId === r.id) setReportId(null);
                              } catch (e) {
                                toast.error(errorMessage(e));
                              }
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={confirmFile}
        onClose={() => setConfirmFile(false)}
        title="Mark this report as filed?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmFile(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={markFiled}>
              <Lock size={16} /> Mark as filed
            </button>
          </>
        }
      >
        <div className="stack">
          <p>
            Do this after you have sent the report to{' '}
            {template.kind === 'ssa' ? 'SSA' : 'the court'}. Payeebook will lock every transaction
            dated on or before <b>{formatDate(period.end, 'long')}</b>, so the books keep matching
            what you filed.
          </p>
          <p className="text-2 small">
            If you need to correct something later, reopen the report. The reopening and every
            change are recorded in the activity log.
          </p>
          <p className="text-2 small">
            Keep the receipts and statements for this period until at least{' '}
            {formatDate(addYears(todayISO(), 2), 'long')}.
          </p>
        </div>
      </Modal>
    </>
  );
}
