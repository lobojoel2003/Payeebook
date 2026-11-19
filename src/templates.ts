import {
  addDays,
  addMonths,
  addYears,
  periodEndFor,
  toISO,
  todayISO,
  type ISODate,
} from './core/dates';
import { parseTemplateYaml, TemplateError, type ValidationIssue } from './core/templates/validate';
import type { FormTemplate, LoadedTemplate } from './core/templates/types';
import type { Book } from './db/types';

const bundled = import.meta.glob('../templates/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface TemplateLoadError {
  path: string;
  message: string;
  issues: ValidationIssue[];
}

export function loadTemplates(
  userTemplates: { id: string; yaml: string }[] = [],
  customCategoryIds: string[] = [],
) {
  const templates: LoadedTemplate[] = [];
  const errors: TemplateLoadError[] = [];
  for (const [path, yaml] of Object.entries(bundled).sort(([a], [b]) => a.localeCompare(b))) {
    const rel = path.replace('../templates/', 'templates/');
    try {
      const { template, warnings } = parseTemplateYaml(yaml, customCategoryIds);
      templates.push({
        template,
        source: 'bundled',
        path: rel,
        yaml,
        warnings: warnings.map((w) => `${w.path}: ${w.message}`),
      });
    } catch (e) {
      errors.push({
        path: rel,
        message: (e as Error).message,
        issues: e instanceof TemplateError ? e.issues : [],
      });
    }
  }
  for (const u of userTemplates) {
    try {
      const { template, warnings } = parseTemplateYaml(u.yaml, customCategoryIds);
      const idx = templates.findIndex((t) => t.template.id === template.id);
      const loaded: LoadedTemplate = {
        template,
        source: 'user',
        path: `imported/${u.id}.yaml`,
        yaml: u.yaml,
        warnings: warnings.map((w) => `${w.path}: ${w.message}`),
      };
      if (idx >= 0) templates[idx] = loaded;
      else templates.push(loaded);
    } catch (e) {
      errors.push({
        path: `imported/${u.id}.yaml`,
        message: (e as Error).message,
        issues: e instanceof TemplateError ? e.issues : [],
      });
    }
  }
  return { templates, errors };
}

export function suggestedFor(t: FormTemplate, book: Book): number {
  let score = 0;
  if (t.roles?.includes(book.role)) score += 4;
  if (t.kind === 'ssa' && (book.role === 'ssa_payee' || book.role === 'ssi_payee')) score += 4;
  if (t.jurisdiction.state && t.jurisdiction.state === book.state) score += 3;
  if (t.jurisdiction.state && book.state && t.jurisdiction.state !== book.state) score -= 5;
  if (t.status === 'generic') score += 1;
  return score;
}

/** The most recent 12-month period starting in `month` (1-12) that has ended, or the current one. */
function periodFromMonth(
  month: number,
  day: number,
  today: ISODate,
): { start: ISODate; end: ISODate } {
  const year = Number(today.slice(0, 4));
  let start = toISO(year, month, Math.min(day, 28));
  while (periodEndFor(start) >= today) start = addYears(start, -1);
  return { start, end: periodEndFor(start) };
}

export function defaultPeriod(
  t: FormTemplate,
  book: Book,
  today: ISODate = todayISO(),
): { start: ISODate; end: ISODate } {
  const kind = t.period?.default ?? 'last-12-months';
  if (kind === 'calendar-year') {
    const y = Number(today.slice(0, 4)) - 1;
    return { start: toISO(y, 1, 1), end: toISO(y, 12, 31) };
  }
  if (kind === 'appointment-year' && book.appointment_date) {
    const [, m, d] = book.appointment_date.split('-').map(Number);
    const p = periodFromMonth(m, d, today);
    // Not a full year since appointment yet: use the year in progress.
    if (p.start < book.appointment_date)
      return { start: book.appointment_date, end: periodEndFor(book.appointment_date) };
    return p;
  }
  if (book.report_month) return periodFromMonth(book.report_month, 1, today);
  const end = addDays(toISO(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1), -1);
  return { start: addDays(addMonths(end, -12), 1), end };
}

/** The reporting year that contains today, for the dashboard. */
export function currentReportingYear(
  book: Book,
  today: ISODate = todayISO(),
): { start: ISODate; end: ISODate } {
  const month =
    book.report_month ?? (book.appointment_date ? Number(book.appointment_date.slice(5, 7)) : 1);
  const day = book.report_month
    ? 1
    : book.appointment_date
      ? Number(book.appointment_date.slice(8, 10))
      : 1;
  const year = Number(today.slice(0, 4));
  let start = toISO(year, month, Math.min(day, 28));
  if (start > today) start = addYears(start, -1);
  return { start, end: periodEndFor(start) };
}
