import {
  addDays,
  addMonths,
  addYears,
  startOfMonth,
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

/**
 * Reporting years run between anniversaries of an anchor date: from
 * anchor + n years to the day before anchor + (n + 1) years. Computing every
 * year from the original anchor keeps consecutive periods contiguous, even for
 * appointments on the 29th, 30th or 31st.
 */
function anniversaryYears(anchor: ISODate, today: ISODate) {
  const startOf = (n: number) => addYears(anchor, n);
  let n = Math.max(0, Number(today.slice(0, 4)) - Number(anchor.slice(0, 4)) - 1);
  while (startOf(n + 1) <= today) n++;
  while (n > 0 && startOf(n) > today) n--;
  const current = { start: startOf(n), end: addDays(startOf(n + 1), -1) };
  const completed = n > 0 ? { start: startOf(n - 1), end: addDays(startOf(n), -1) } : null;
  return { current, completed };
}

function anchorFor(book: Book): ISODate {
  if (book.report_month) return toISO(2000, book.report_month, 1);
  return book.appointment_date ?? toISO(2000, 1, 1);
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
    // The last full year since appointment, or the year in progress if none has ended.
    const { current, completed } = anniversaryYears(book.appointment_date, today);
    return completed ?? current;
  }
  if (book.report_month) {
    const { current, completed } = anniversaryYears(anchorFor(book), today);
    return completed ?? current;
  }
  // The 12 whole calendar months before this one.
  const end = addDays(startOfMonth(today), -1);
  return { start: startOfMonth(addMonths(startOfMonth(end), -11)), end };
}

/** The reporting year that contains today, for the dashboard. */
export function currentReportingYear(
  book: Book,
  today: ISODate = todayISO(),
): { start: ISODate; end: ISODate } {
  return anniversaryYears(anchorFor(book), today).current;
}
