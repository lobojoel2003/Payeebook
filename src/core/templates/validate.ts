import yaml from 'js-yaml';
import {
  BUILTIN_CATEGORIES,
  COURT_GROUP_LABELS,
  SSA_BUCKET_LABELS,
  KIND_LABELS,
} from '../categories';
import { ExprError, identifiers, parseExpr } from './expr';
import { TEMPLATE_SCHEMA, type FormTemplate } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

const ID_RE = /^[a-z][a-z0-9_]*$/;
const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const INPUT_TYPES = ['text', 'textarea', 'money', 'number', 'date', 'yesno', 'choice'];
const ROLES = [
  'ssa_payee',
  'ssi_payee',
  'va_fiduciary',
  'guardian',
  'conservator',
  'trustee',
  'other',
];
const ACCOUNT_KINDS = ['checking', 'savings', 'cash', 'prepaid', 'investment', 'other'];
const FORMATS = ['money', 'number', 'text', 'date', 'yesno'];

export const BUILTIN_NAMES = [
  'balance.start',
  'balance.end',
  'balance.accounts_start',
  'balance.accounts_end',
  'balance.saved_start',
  'balance.saved_end',
  'balance.cash_end',
  'totals.income',
  'totals.expense',
  'totals.saved',
  'totals.transfers',
  'totals.untagged',
  'count.untagged',
  'count.transactions',
  'count.missing_receipts',
  'period.start',
  'period.end',
  'period.days',
  'today',
];

export const BOOK_FIELDS = [
  'beneficiary_name',
  'beneficiary_dob',
  'fiduciary_name',
  'fiduciary_phone',
  'fiduciary_address',
  'role',
  'role_label',
  'state',
  'county',
  'court',
  'case_number',
  'claim_number',
  'appointment_date',
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const KEYS = {
  template: [
    'schema',
    'id',
    'name',
    'short_name',
    'version',
    'kind',
    'status',
    'jurisdiction',
    'roles',
    'description',
    'references',
    'maintainers',
    'license',
    'period',
    'inputs',
    'sections',
    'checks',
    'notes',
    'attestation',
    'signatures',
    'receipts',
    'acroform',
  ],
  jurisdiction: ['country', 'state', 'county', 'agency', 'court'],
  period: ['default', 'months'],
  input: ['id', 'label', 'type', 'help', 'default', 'required', 'options'],
  section: ['id', 'title', 'description', 'lines', 'total', 'itemize'],
  line: ['id', 'label', 'sum', 'value', 'input', 'text', 'format', 'help', 'emphasis', 'in_total'],
  sum: ['categories', 'kinds', 'ssa', 'court', 'exclude', 'accounts', 'direction', 'untagged'],
  check: ['id', 'label', 'assert', 'severity', 'help'],
  receipts: ['attach', 'min_amount'],
  acroform: ['fields', 'checkboxes'],
};

function unknownKeys(
  obj: Record<string, unknown>,
  allowed: string[],
  path: string,
  err: (path: string, message: string) => void,
) {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    err(
      path ? `${path}.${key}` : key,
      `Unknown key "${key}". If it came from text containing a comma inside { ... }, put that text in quotes.`,
    );
  }
}

/**
 * Validate a parsed template. Errors make the template unusable; warnings are
 * shown to authors (for example an unknown category id that may be custom).
 */
export function validateTemplate(raw: unknown, extraCategoryIds: string[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) =>
    issues.push({ path, message, severity: 'warning' });

  if (!isObj(raw)) {
    err('', 'A template must be a YAML mapping (key: value pairs).');
    return issues;
  }
  const t = raw as Record<string, unknown>;
  unknownKeys(t, KEYS.template, '', err);
  if (isObj(t.jurisdiction)) unknownKeys(t.jurisdiction, KEYS.jurisdiction, 'jurisdiction', err);
  if (isObj(t.period)) unknownKeys(t.period, KEYS.period, 'period', err);
  if (isObj(t.receipts)) unknownKeys(t.receipts, KEYS.receipts, 'receipts', err);
  if (isObj(t.acroform)) unknownKeys(t.acroform, KEYS.acroform, 'acroform', err);
  const reqStr = (key: string) => {
    if (typeof t[key] !== 'string' || !(t[key] as string).trim())
      err(key, `"${key}" is required and must be text.`);
  };
  if (t.schema !== TEMPLATE_SCHEMA) err('schema', `"schema" must be "${TEMPLATE_SCHEMA}".`);
  reqStr('id');
  reqStr('name');
  reqStr('version');
  if (typeof t.id === 'string' && !TEMPLATE_ID_RE.test(t.id))
    err('id', 'Use lowercase letters, digits and dashes, e.g. "us-mn-conservator-annual".');
  if (typeof t.version === 'string' && !SEMVER_RE.test(t.version))
    err('version', 'Use semantic versioning, e.g. "1.0.0".');
  if (!['ssa', 'court', 'va', 'other'].includes(t.kind as string))
    err('kind', '"kind" must be one of ssa, court, va, other.');
  if (!['verified', 'draft', 'generic'].includes(t.status as string))
    err('status', '"status" must be "verified", "draft" or "generic".');
  if (!isObj(t.jurisdiction) || typeof t.jurisdiction.country !== 'string')
    err('jurisdiction', '"jurisdiction.country" is required (e.g. "US").');
  if (t.roles !== undefined) {
    if (!Array.isArray(t.roles)) err('roles', '"roles" must be a list.');
    else
      t.roles.forEach(
        (r, i) =>
          !ROLES.includes(r as string) &&
          err(`roles[${i}]`, `Unknown role "${r}". Use one of ${ROLES.join(', ')}.`),
      );
  }
  if (t.references !== undefined) {
    if (!Array.isArray(t.references)) err('references', '"references" must be a list.');
    else
      t.references.forEach((r, i) => {
        if (!isObj(r) || typeof r.title !== 'string' || typeof r.url !== 'string')
          err(`references[${i}]`, 'Each reference needs a title and url.');
        else if (!/^https:\/\//.test(r.url))
          warn(`references[${i}].url`, 'Reference links should use https://');
      });
  }

  const categoryIds = new Set([...BUILTIN_CATEGORIES.map((c) => c.id), ...extraCategoryIds]);
  const known = new Set<string>(BUILTIN_NAMES);
  BOOK_FIELDS.forEach((f) => known.add(`book.${f}`));

  // Inputs
  const inputIds = new Set<string>();
  if (t.inputs !== undefined) {
    if (!Array.isArray(t.inputs)) err('inputs', '"inputs" must be a list.');
    else
      t.inputs.forEach((inp, i) => {
        const p = `inputs[${i}]`;
        if (!isObj(inp)) return err(p, 'Each input must be a mapping.');
        unknownKeys(inp, KEYS.input, p, err);
        if (typeof inp.id !== 'string' || !ID_RE.test(inp.id))
          err(`${p}.id`, 'Input ids use lowercase letters, digits and underscores.');
        else if (inputIds.has(inp.id)) err(`${p}.id`, `Duplicate input id "${inp.id}".`);
        else {
          inputIds.add(inp.id);
          known.add(`inputs.${inp.id}`);
        }
        if (typeof inp.label !== 'string') err(`${p}.label`, 'Each input needs a label.');
        if (!INPUT_TYPES.includes(inp.type as string))
          err(`${p}.type`, `Input type must be one of ${INPUT_TYPES.join(', ')}.`);
        if (inp.type === 'choice' && (!Array.isArray(inp.options) || inp.options.length === 0))
          err(`${p}.options`, 'Choice inputs need a list of options.');
      });
  }

  // Sections and lines (register all names first so forward references work)
  const exprs: { path: string; src: string }[] = [];
  const texts: { path: string; src: string }[] = [];
  if (!Array.isArray(t.sections) || t.sections.length === 0) {
    err('sections', 'At least one section is required.');
  } else {
    const sectionIds = new Set<string>();
    t.sections.forEach((s, si) => {
      if (!isObj(s)) return;
      if (typeof s.id === 'string') {
        if (sectionIds.has(s.id)) err(`sections[${si}].id`, `Duplicate section id "${s.id}".`);
        sectionIds.add(s.id);
        known.add(`${s.id}.total`);
        if (Array.isArray(s.lines))
          s.lines.forEach(
            (l) => isObj(l) && typeof l.id === 'string' && known.add(`${s.id}.${l.id}`),
          );
      }
    });
    t.sections.forEach((s, si) => {
      const sp = `sections[${si}]`;
      if (!isObj(s)) return err(sp, 'Each section must be a mapping.');
      unknownKeys(s, KEYS.section, sp, err);
      if (typeof s.id !== 'string' || !ID_RE.test(s.id))
        err(`${sp}.id`, 'Section ids use lowercase letters, digits and underscores.');
      if (typeof s.title !== 'string') err(`${sp}.title`, 'Each section needs a title.');
      else texts.push({ path: `${sp}.title`, src: s.title });
      if (
        s.total !== undefined &&
        s.total !== false &&
        !(isObj(s.total) && typeof s.total.label === 'string')
      )
        err(`${sp}.total`, '"total" must be false or have a label.');
      if (s.itemize !== undefined && typeof s.itemize !== 'boolean' && !isObj(s.itemize))
        err(`${sp}.itemize`, '"itemize" must be true/false or a mapping.');
      if (!Array.isArray(s.lines) || s.lines.length === 0)
        return err(`${sp}.lines`, 'Each section needs at least one line.');
      const lineIds = new Set<string>();
      s.lines.forEach((l, li) => {
        const lp = `${sp}.lines[${li}]`;
        if (!isObj(l)) return err(lp, 'Each line must be a mapping.');
        unknownKeys(l, KEYS.line, lp, err);
        if (typeof l.id !== 'string' || !ID_RE.test(l.id))
          err(`${lp}.id`, 'Line ids use lowercase letters, digits and underscores.');
        else if (l.id === 'total') err(`${lp}.id`, '"total" is reserved for the section total.');
        else if (lineIds.has(l.id)) err(`${lp}.id`, `Duplicate line id "${l.id}".`);
        else lineIds.add(l.id);
        if (typeof l.label !== 'string') err(`${lp}.label`, 'Each line needs a label.');
        else texts.push({ path: `${lp}.label`, src: l.label });
        const sources = ['sum', 'value', 'input', 'text'].filter((k) => l[k] !== undefined);
        if (sources.length !== 1)
          err(lp, 'Each line needs exactly one of: sum, value, input, text.');
        if (l.format !== undefined && !FORMATS.includes(l.format as string))
          err(`${lp}.format`, `format must be one of ${FORMATS.join(', ')}.`);
        if (l.value !== undefined) exprs.push({ path: `${lp}.value`, src: String(l.value) });
        if (l.text !== undefined) texts.push({ path: `${lp}.text`, src: String(l.text) });
        if (l.input !== undefined && !inputIds.has(l.input as string))
          err(`${lp}.input`, `No input with id "${l.input}".`);
        if (l.sum !== undefined) {
          if (!isObj(l.sum)) return err(`${lp}.sum`, '"sum" must be a mapping.');
          const sum = l.sum;
          unknownKeys(sum, KEYS.sum, `${lp}.sum`, err);
          const listOf = (key: string, allowed: string[] | null, label: string) => {
            if (sum[key] === undefined) return;
            if (!Array.isArray(sum[key]))
              return err(`${lp}.sum.${key}`, `"${key}" must be a list.`);
            (sum[key] as unknown[]).forEach((v, vi) => {
              if (allowed && !allowed.includes(v as string))
                err(`${lp}.sum.${key}[${vi}]`, `Unknown ${label} "${v}".`);
              if (!allowed && !categoryIds.has(v as string))
                warn(
                  `${lp}.sum.${key}[${vi}]`,
                  `"${v}" is not a built-in category. It will only match a custom category with that id.`,
                );
            });
          };
          listOf('categories', null, 'category');
          listOf('exclude', null, 'category');
          listOf('kinds', Object.keys(KIND_LABELS), 'kind');
          listOf('ssa', Object.keys(SSA_BUCKET_LABELS), 'SSA bucket');
          listOf('court', Object.keys(COURT_GROUP_LABELS), 'court group');
          listOf('accounts', ACCOUNT_KINDS, 'account kind');
          if (sum.direction !== undefined && !['in', 'out'].includes(sum.direction as string))
            err(`${lp}.sum.direction`, 'direction must be "in" or "out".');
        }
      });
    });
  }

  if (t.checks !== undefined) {
    if (!Array.isArray(t.checks)) err('checks', '"checks" must be a list.');
    else
      t.checks.forEach((c, ci) => {
        if (!isObj(c) || typeof c.label !== 'string' || typeof c.assert !== 'string')
          return err(`checks[${ci}]`, 'Each check needs a label and an assert expression.');
        unknownKeys(c, KEYS.check, `checks[${ci}]`, err);
        if (c.severity !== undefined && !['error', 'warning'].includes(c.severity as string))
          err(`checks[${ci}].severity`, 'severity must be "error" or "warning".');
        exprs.push({ path: `checks[${ci}].assert`, src: c.assert });
      });
  }
  if (t.attestation !== undefined) {
    if (typeof t.attestation !== 'string') err('attestation', '"attestation" must be text.');
    else texts.push({ path: 'attestation', src: t.attestation });
  }
  if (t.notes !== undefined) {
    if (!Array.isArray(t.notes)) err('notes', '"notes" must be a list of text.');
    else
      t.notes.forEach((n, i) =>
        typeof n === 'string'
          ? texts.push({ path: `notes[${i}]`, src: n })
          : err(`notes[${i}]`, 'Notes must be text.'),
      );
  }
  if (t.inputs && Array.isArray(t.inputs)) {
    t.inputs.forEach((inp, i) => {
      if (isObj(inp) && typeof inp.default === 'string')
        texts.push({ path: `inputs[${i}].default`, src: inp.default });
    });
  }
  if (t.acroform !== undefined) {
    if (!isObj(t.acroform)) err('acroform', '"acroform" must be a mapping.');
    else
      for (const key of ['fields', 'checkboxes'] as const) {
        const m = t.acroform[key];
        if (m === undefined) continue;
        if (!isObj(m)) {
          err(`acroform.${key}`, `"acroform.${key}" must map PDF field names to expressions.`);
          continue;
        }
        for (const [field, spec] of Object.entries(m)) {
          if (typeof spec !== 'string')
            err(`acroform.${key}.${field}`, 'Field mappings must be text.');
          else if (spec.includes('{{')) texts.push({ path: `acroform.${key}.${field}`, src: spec });
          else
            exprs.push({
              path: `acroform.${key}.${field}`,
              src: spec.replace(/\s*\|\s*(money|number|date|yesno|text)\s*$/, ''),
            });
        }
      }
  }

  const checkExpr = (path: string, src: string) => {
    try {
      for (const name of identifiers(parseExpr(src))) {
        if (!known.has(name)) err(path, `Unknown name "${name}" in "${src}".`);
      }
    } catch (e) {
      if (e instanceof ExprError) err(path, e.message);
      else throw e;
    }
  };
  exprs.forEach(({ path, src }) => checkExpr(path, src));
  for (const { path, src } of texts) {
    for (const m of src.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|\s*([a-z]+)\s*)?\}\}/g)) {
      checkExpr(path, m[1]);
      if (m[2] && !['money', 'date', 'yesno', 'number'].includes(m[2]))
        err(path, `Unknown filter "${m[2]}". Use money, date, yesno or number.`);
    }
  }

  if (t.status === 'draft' && (!Array.isArray(t.references) || t.references.length === 0)) {
    warn(
      'references',
      'Draft templates should link to the official form or statute so reviewers can verify them.',
    );
  }
  return issues;
}

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[],
  ) {
    super(message);
  }
}

export function parseTemplateYaml(
  text: string,
  extraCategoryIds: string[] = [],
): { template: FormTemplate; warnings: ValidationIssue[] } {
  let raw: unknown;
  try {
    raw = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    throw new TemplateError(`YAML syntax error: ${(e as Error).message}`, []);
  }
  const issues = validateTemplate(raw, extraCategoryIds);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new TemplateError(
      `Template has ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors[0].path ? `${errors[0].path}: ` : ''}${errors[0].message}`,
      issues,
    );
  }
  return {
    template: raw as FormTemplate,
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}
