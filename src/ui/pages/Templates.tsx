import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload,
  Download,
  FileSearch,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Code2,
} from 'lucide-react';
import { useBook, useQuery } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { PageHead } from '../components/Empty';
import { Modal } from '../components/Modal';
import { loadTemplates } from '../../templates';
import {
  parseTemplateYaml,
  TemplateError,
  type ValidationIssue,
} from '../../core/templates/validate';
import type { FormField } from '../../pdf/acroform';
import { saveFile, readFileBytes } from '../download';
import { REPO_URL } from '../../buildInfo';
import { StatusBadge, jurisdictionLabel } from './Reports';
import type { LoadedTemplate } from '../../core/templates/types';

const STARTER = `# yaml-language-server: $schema=https://raw.githubusercontent.com/lobojoel2003/Payeebook/main/templates/schema.json
# SPDX-License-Identifier: MIT
schema: payeebook/template@1
id: us-xx-my-county-annual-account
name: My County — Annual account of guardian (community draft)
short_name: My County account
version: 0.1.0
kind: court
status: draft
jurisdiction:
  country: US
  state: XX
  county: My County
roles: [guardian, conservator]
description: >-
  What this form is and who files it.
references:
  - title: Link to the official form or court rule
    url: https://example.org/forms/annual-account.pdf
period:
  default: appointment-year
inputs:
  - id: case_number
    label: Case number
    type: text
    default: "{{ book.case_number }}"
sections:
  - id: summary
    title: Summary
    total: false
    lines:
      - { id: opening, label: "Balance at start of period", value: balance.start }
      - { id: receipts, label: "Receipts (Schedule A)", value: receipts.total }
      - { id: disbursements, label: "Disbursements (Schedule B)", value: disbursements.total }
      - { id: closing, label: "Balance at end of period", value: balance.end, emphasis: true }
  - id: receipts
    title: Schedule A — Receipts
    itemize: true
    total: { label: Total receipts }
    lines:
      - { id: benefits, label: "Government benefits", sum: { court: [receipts.benefits] } }
      - { id: other, label: "All other receipts", sum: { kinds: [income], exclude: [benefits_ssa, benefits_ssi, benefits_va] } }
  - id: disbursements
    title: Schedule B — Disbursements
    itemize: true
    total: { label: Total disbursements }
    lines:
      - { id: residence, label: "Residence and care", sum: { court: [disbursements.residence] } }
      - { id: everything_else, label: "All other disbursements", sum: { kinds: [expense], exclude: [housing, utilities, care_facility] } }
checks:
  - label: Start + receipts - disbursements = end
    assert: summary.opening + receipts.total - disbursements.total == summary.closing
attestation: >-
  I, {{ book.fiduciary_name }}, state this account is true and complete.
signatures: [Guardian, Date]
# Optional: fill the official fillable PDF. Use "Inspect a PDF form" in Payeebook to list field names.
# acroform:
#   fields:
#     "Total Receipts": receipts.total
#     "Case Number": "{{ inputs.case_number }}"
`;

export function Templates() {
  const { store, book, readOnly } = useBook();
  const toast = useToast();
  const userTemplates = useQuery((s) => s.listUserTemplates(), []);
  const customIds = useQuery((s) => s.customCategories(book.id).map((c) => c.id), [book.id]);
  const { templates, errors } = useMemo(
    () => loadTemplates(userTemplates, customIds),
    [userTemplates, customIds],
  );
  const [viewing, setViewing] = useState<LoadedTemplate | null>(null);
  const [issues, setIssues] = useState<{
    name: string;
    message: string;
    issues: ValidationIssue[];
  } | null>(null);
  const [fields, setFields] = useState<{ name: string; fields: FormField[] } | null>(null);

  const importYaml = async (file: File) => {
    try {
      const text = await file.text();
      const { template, warnings } = parseTemplateYaml(text, customIds);
      store.saveUserTemplate(template.id, text);
      toast.success(
        `Added “${template.name}”${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}. It is now available on the Reports page.`,
      );
    } catch (e) {
      setIssues({
        name: file.name,
        message: errorMessage(e),
        issues: e instanceof TemplateError ? e.issues : [],
      });
    }
  };

  const inspect = async (file: File) => {
    try {
      const { listFormFields } = await import('../../pdf/acroform');
      setFields({ name: file.name, fields: await listFormFields(await readFileBytes(file)) });
    } catch (e) {
      toast.error(`Could not read that PDF: ${errorMessage(e)}`);
    }
  };

  return (
    <>
      <PageHead
        title="Form templates"
        sub={
          <>
            Each report is a plain YAML file. A volunteer can add their state’s court accounting
            form in an afternoon and share it with everyone.{' '}
            <a href={`${REPO_URL}/blob/main/templates/README.md`} target="_blank" rel="noreferrer">
              Read the guide <ExternalLink size={12} />
            </a>
          </>
        }
        actions={
          <>
            <button
              className="btn"
              onClick={() => saveFile('my-template.yaml', STARTER, 'text/yaml')}
            >
              <Download size={16} /> Starter file
            </button>
            {!readOnly && (
              <label className="btn btn-primary">
                <Upload size={16} /> Add a template…
                <input
                  type="file"
                  accept=".yaml,.yml,text/yaml"
                  hidden
                  onChange={(e) => e.target.files?.[0] && importYaml(e.target.files[0])}
                />
              </label>
            )}
          </>
        }
      />

      <section className="card card-tight" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Where</th>
                <th>Status</th>
                <th>Version</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.template.id}>
                  <td>
                    <b>{t.template.name}</b>
                    <div className="tiny muted">{t.template.id}</div>
                  </td>
                  <td className="small">{jurisdictionLabel(t.template)}</td>
                  <td>
                    <StatusBadge status={t.template.status} />
                  </td>
                  <td className="small">{t.template.version}</td>
                  <td className="small">{t.source === 'bundled' ? 'Built in' : 'Added by you'}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <Link className="btn btn-sm" to={`/reports?template=${t.template.id}`}>
                        Use
                      </Link>
                      <button
                        className="icon-btn"
                        aria-label="View YAML"
                        onClick={() => setViewing(t)}
                      >
                        <Code2 size={16} />
                      </button>
                      {t.source === 'user' && !readOnly && (
                        <button
                          className="icon-btn"
                          aria-label="Remove template"
                          onClick={() => {
                            if (
                              confirm(
                                `Remove “${t.template.name}”? Saved reports keep their numbers.`,
                              )
                            )
                              store.deleteUserTemplate(t.template.id);
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
      </section>

      {errors.length > 0 && (
        <div className="callout callout-danger" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            {errors.map((e) => (
              <div key={e.path}>
                <b>{e.path}</b>: {e.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2">
        <section className="card stack-sm">
          <h2>
            <FileSearch size={18} style={{ verticalAlign: '-3px' }} /> Inspect a PDF form
          </h2>
          <p className="small text-2">
            Many courts publish fillable PDFs. Choose one to list its field names, then map them in
            your template’s <code>acroform</code> section so Payeebook can fill the official form
            directly.
          </p>
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            <Upload size={16} /> Choose a PDF…
            <input
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => e.target.files?.[0] && inspect(e.target.files[0])}
            />
          </label>
        </section>
        <section className="card stack-sm">
          <h2>How templates work</h2>
          <ul className="small text-2" style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <b>sum</b> lines add up tagged transactions by category, SSA bucket or court group.
            </li>
            <li>
              <b>value</b> lines are formulas such as{' '}
              <code>receipts.total - disbursements.total</code>.
            </li>
            <li>
              <b>checks</b> catch mistakes before you file, for example a start balance that does
              not roll forward.
            </li>
            <li>
              Templates are MIT licensed. Share yours with a pull request so other families in your
              county can use it.
            </li>
          </ul>
        </section>
      </div>

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.template.name}
        wide
      >
        {viewing && (
          <div className="stack">
            <div className="row">
              <StatusBadge status={viewing.template.status} />
              <span className="small muted">{viewing.path}</span>
            </div>
            {viewing.warnings.length > 0 && (
              <div className="callout callout-warn">
                <AlertTriangle size={18} />
                <div>
                  {viewing.warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              </div>
            )}
            <pre className="code">{viewing.yaml}</pre>
            <button
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => saveFile(`${viewing.template.id}.yaml`, viewing.yaml, 'text/yaml')}
            >
              <Download size={16} /> Download YAML
            </button>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(issues)}
        onClose={() => setIssues(null)}
        title={`Problems in ${issues?.name ?? ''}`}
      >
        {issues && (
          <div className="stack-sm">
            <p>{issues.message}</p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {issues.issues.map((i, n) => (
                <li key={n} className={i.severity === 'error' ? 'danger-text' : ''}>
                  <code>{i.path || '(top)'}</code>: {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(fields)}
        onClose={() => setFields(null)}
        title={`Fields in ${fields?.name ?? ''}`}
        wide
      >
        {fields &&
          (fields.fields.length === 0 ? (
            <p>
              This PDF has no fillable fields. Use Payeebook’s own PDF report and copy the totals
              onto the paper form.
            </p>
          ) : (
            <div className="stack-sm">
              <p className="small text-2">Copy a name into your template, for example:</p>
              <pre className="code">{`acroform:\n  fields:\n    "${fields.fields.find((f) => f.type === 'text')?.name ?? fields.fields[0].name}": receipts.total`}</pre>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Field name</th>
                      <th>Type</th>
                      <th>Current value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.fields.map((f) => (
                      <tr key={f.name}>
                        <td>
                          <code>{f.name}</code>
                        </td>
                        <td className="small">{f.type}</td>
                        <td className="small muted">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
      </Modal>
    </>
  );
}
