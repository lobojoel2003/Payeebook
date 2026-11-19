import { CategoryIndex, reportSign } from '../categories';
import { formatDate, diffDays, type ISODate } from '../dates';
import { formatMoney } from '../money';
import { evalExpr, ExprError, type Value } from './expr';
import type {
  AccountKind,
  FormTemplate,
  LineFormat,
  SumSpec,
  TemplateLine,
  TemplateSection,
} from './types';

/** One ledger line inside the report period. Split transactions produce one line per split. */
export interface EvalLine {
  txId: string;
  lineId: string;
  date: ISODate;
  amount: number;
  category: string | null;
  payee: string;
  memo: string;
  checkNumber: string;
  accountId: string;
  accountName: string;
  accountKind: AccountKind;
  receiptIds: string[];
  /** The whole transaction's amount (differs from `amount` for split lines). */
  txAmount?: number;
}

export interface EvalAccount {
  id: string;
  name: string;
  kind: AccountKind;
  start: number;
  end: number;
}

export interface EvalContext {
  book: Record<string, string>;
  period: { start: ISODate; end: ISODate };
  lines: EvalLine[];
  accounts: EvalAccount[];
  /** Money tagged "saved" that left tracked accounts but still belongs to the beneficiary. */
  savedOffBook: { start: number; end: number };
  counts: { untagged: number; transactions: number; missing_receipts: number };
  categories: CategoryIndex;
  inputs: Record<string, Value>;
  today: ISODate;
}

export interface ResultLine {
  id: string;
  label: string;
  format: LineFormat;
  value: Value;
  display: string;
  help?: string;
  emphasis?: boolean;
  items: EvalLine[];
  inTotal: boolean;
}

export interface ItemGroup {
  lineId: string;
  label: string;
  items: EvalLine[];
  /** Items below the itemize threshold, rolled into one row. */
  rolledUp: { count: number; amount: number } | null;
  total: number;
}

export interface ResultSection {
  id: string;
  title: string;
  description?: string;
  lines: ResultLine[];
  total: { label: string; value: number; display: string } | null;
  itemized: ItemGroup[] | null;
}

export interface CheckResult {
  label: string;
  ok: boolean;
  severity: 'error' | 'warning';
  help?: string;
  error?: string;
}

export interface ReceiptExhibit {
  number: string;
  receiptId: string;
  line: EvalLine;
}

export interface ReportResult {
  template: FormTemplate;
  period: { start: ISODate; end: ISODate };
  sections: ResultSection[];
  checks: CheckResult[];
  values: Record<string, Value>;
  notes: string[];
  attestation: string;
  exhibits: ReceiptExhibit[];
  inputs: Record<string, Value>;
}

export function lineMatches(spec: SumSpec, line: EvalLine, cats: CategoryIndex): boolean {
  const cat = cats.get(line.category);
  // A tag that no longer exists counts as untagged, so it can never vanish from every total.
  if (spec.untagged) return !cat;
  if (!cat) return false;
  if (spec.exclude?.includes(cat.id)) return false;
  if (spec.accounts && !spec.accounts.includes(line.accountKind)) return false;
  if (spec.direction === 'in' && line.amount < 0) return false;
  if (spec.direction === 'out' && line.amount > 0) return false;
  const filters: boolean[] = [];
  if (spec.categories) filters.push(spec.categories.includes(cat.id));
  if (spec.kinds) filters.push(spec.kinds.includes(cat.kind));
  if (spec.ssa) filters.push(spec.ssa.includes(cat.ssa));
  if (spec.court) filters.push(spec.court.includes(cat.court));
  // A line matches if it satisfies any of the listed selectors.
  return filters.length === 0 ? true : filters.some(Boolean);
}

export function sumLines(
  spec: SumSpec,
  lines: EvalLine[],
  cats: CategoryIndex,
): { total: number; items: EvalLine[] } {
  let total = 0;
  const items: EvalLine[] = [];
  for (const l of lines) {
    if (!lineMatches(spec, l, cats)) continue;
    total += contribution(l, cats, Boolean(spec.untagged));
    items.push(l);
  }
  return { total, items };
}

/** How much one ledger line adds to a sum line, with the sum's polarity. */
export function contribution(line: EvalLine, cats: CategoryIndex, untagged = false): number {
  const cat = cats.get(line.category);
  const sign = untagged || !cat ? (line.amount < 0 ? -1 : 1) : reportSign(cat.kind);
  return line.amount * sign;
}

export function formatValue(v: Value, format: LineFormat): string {
  if (v === null || v === undefined) return '';
  switch (format) {
    case 'money':
      return formatMoney(typeof v === 'number' ? Math.round(v) : Number(v) || 0);
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('en-US') : String(v);
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? formatDate(v, 'long')
        : String(v);
    case 'yesno':
      if (v === '') return '';
      return v === true || v === 1 || v === 'yes' || v === 'true' ? 'Yes' : 'No';
    default:
      return String(v);
  }
}

function lineFormat(line: TemplateLine, template: FormTemplate): LineFormat {
  if (line.format) return line.format;
  if (line.sum || line.value) return 'money';
  if (line.input) {
    const input = template.inputs?.find((i) => i.id === line.input);
    if (input?.type === 'money') return 'money';
    if (input?.type === 'yesno') return 'yesno';
    if (input?.type === 'date') return 'date';
    if (input?.type === 'number') return 'number';
  }
  return 'text';
}

export class TemplateEvaluator {
  private values = new Map<string, Value>();
  private sumItems = new Map<string, EvalLine[]>();
  private evaluating = new Set<string>();
  private sectionsById = new Map<string, TemplateSection>();

  constructor(
    readonly template: FormTemplate,
    readonly ctx: EvalContext,
  ) {
    for (const s of template.sections) this.sectionsById.set(s.id, s);
  }

  builtin(name: string): Value | undefined {
    const { ctx } = this;
    const accountsStart = ctx.accounts.reduce((n, a) => n + a.start, 0);
    const accountsEnd = ctx.accounts.reduce((n, a) => n + a.end, 0);
    const savingsStart = ctx.accounts
      .filter((a) => a.kind === 'savings')
      .reduce((n, a) => n + a.start, 0);
    const savingsEnd = ctx.accounts
      .filter((a) => a.kind === 'savings')
      .reduce((n, a) => n + a.end, 0);
    const kindTotal = (kind: string) =>
      ctx.lines.reduce((n, l) => {
        const c = ctx.categories.get(l.category);
        return c && c.kind === kind ? n + l.amount * reportSign(c.kind) : n;
      }, 0);
    switch (name) {
      case 'balance.start':
        return accountsStart + ctx.savedOffBook.start;
      case 'balance.end':
        return accountsEnd + ctx.savedOffBook.end;
      case 'balance.accounts_start':
        return accountsStart;
      case 'balance.accounts_end':
        return accountsEnd;
      case 'balance.saved_start':
        return savingsStart + ctx.savedOffBook.start;
      case 'balance.saved_end':
        return savingsEnd + ctx.savedOffBook.end;
      case 'balance.cash_end':
        return ctx.accounts.filter((a) => a.kind !== 'savings').reduce((n, a) => n + a.end, 0);
      case 'totals.income':
        return kindTotal('income');
      case 'totals.expense':
        return kindTotal('expense');
      case 'totals.saved':
        return kindTotal('saving');
      case 'totals.transfers':
        return ctx.lines.reduce(
          (n, l) => (ctx.categories.get(l.category)?.kind === 'transfer' ? n + l.amount : n),
          0,
        );
      case 'totals.untagged':
        return ctx.lines.reduce((n, l) => (l.category ? n : n + l.amount), 0);
      case 'count.untagged':
        return ctx.counts.untagged;
      case 'count.transactions':
        return ctx.counts.transactions;
      case 'count.missing_receipts':
        return ctx.counts.missing_receipts;
      case 'period.start':
        return ctx.period.start;
      case 'period.end':
        return ctx.period.end;
      case 'period.days':
        return diffDays(ctx.period.start, ctx.period.end) + 1;
      case 'today':
        return ctx.today;
    }
    if (name.startsWith('book.')) return ctx.book[name.slice(5)] ?? '';
    if (name.startsWith('inputs.')) {
      const id = name.slice(7);
      if (id in ctx.inputs) return ctx.inputs[id];
      const def = this.template.inputs?.find((i) => i.id === id);
      return def ? this.inputDefault(def.default) : undefined;
    }
    return undefined;
  }

  inputDefault(def: string | number | boolean | undefined): Value {
    if (def === undefined) return '';
    if (typeof def === 'string') return this.interpolate(def);
    return def;
  }

  resolve = (name: string): Value => {
    const b = this.builtin(name);
    if (b !== undefined) return b;
    const dot = name.indexOf('.');
    if (dot < 0) throw new ExprError(`Unknown name "${name}"`);
    const sectionId = name.slice(0, dot);
    const lineId = name.slice(dot + 1);
    const section = this.sectionsById.get(sectionId);
    if (!section) throw new ExprError(`Unknown section "${sectionId}" in "${name}"`);
    if (lineId === 'total') return this.sectionTotal(section);
    const line = section.lines.find((l) => l.id === lineId);
    if (!line) throw new ExprError(`Unknown line "${lineId}" in section "${sectionId}"`);
    return this.lineValue(section, line);
  };

  lineValue(section: TemplateSection, line: TemplateLine): Value {
    const key = `${section.id}.${line.id}`;
    if (this.values.has(key)) return this.values.get(key)!;
    if (this.evaluating.has(key)) throw new ExprError(`Circular reference involving "${key}"`);
    this.evaluating.add(key);
    let v: Value;
    try {
      if (line.sum) {
        const { total, items } = sumLines(line.sum, this.ctx.lines, this.ctx.categories);
        this.sumItems.set(key, items);
        v = total;
      } else if (line.value !== undefined) {
        v = evalExpr(String(line.value), this.resolve);
        if (typeof v === 'number' && lineFormat(line, this.template) === 'money') v = Math.round(v);
      } else if (line.input) {
        v = this.resolve(`inputs.${line.input}`);
      } else if (line.text !== undefined) {
        v = this.interpolate(line.text);
      } else {
        v = null;
      }
    } finally {
      this.evaluating.delete(key);
    }
    this.values.set(key, v);
    return v;
  }

  sectionTotal(section: TemplateSection): number {
    const key = `${section.id}.total`;
    if (this.values.has(key)) return this.values.get(key) as number;
    let total = 0;
    for (const line of section.lines) {
      if (!this.countsInTotal(line)) continue;
      const v = this.lineValue(section, line);
      total += typeof v === 'number' ? v : 0;
    }
    this.values.set(key, total);
    return total;
  }

  countsInTotal(line: TemplateLine): boolean {
    if (line.in_total !== undefined) return line.in_total;
    return Boolean(line.sum);
  }

  /** Replace {{ expr }} and {{ expr | money }} / {{ expr | date }} in text. */
  interpolate(text: string): string {
    return text.replace(
      /\{\{\s*([^}|]+?)\s*(?:\|\s*(money|date|yesno|number)\s*)?\}\}/g,
      (_, expr: string, filter?: string) => {
        try {
          const v = evalExpr(expr, this.resolve);
          if (filter) return formatValue(v, filter as LineFormat);
          return v === null || v === undefined ? '' : String(v);
        } catch {
          return '';
        }
      },
    );
  }

  run(): ReportResult {
    const { template, ctx } = this;
    const sections: ResultSection[] = template.sections.map((section) => {
      const lines: ResultLine[] = section.lines.map((line) => {
        const format = lineFormat(line, template);
        const value = this.lineValue(section, line);
        return {
          id: line.id,
          label: this.interpolate(line.label),
          format,
          value,
          display:
            line.input && (value === '' || value === null)
              ? 'Not answered'
              : formatValue(value, format),
          help: line.help,
          emphasis: line.emphasis,
          items: this.sumItems.get(`${section.id}.${line.id}`) ?? [],
          inTotal: this.countsInTotal(line),
        };
      });
      const hasTotal = section.total !== false && section.total !== undefined;
      const totalValue = hasTotal ? this.sectionTotal(section) : 0;
      let itemized: ItemGroup[] | null = null;
      if (section.itemize) {
        const min =
          typeof section.itemize === 'object' && section.itemize.min_amount
            ? Math.round(section.itemize.min_amount * 100)
            : 0;
        itemized = lines
          .filter((l) => l.items.length > 0)
          .map((l) => {
            const big = l.items
              .filter((i) => Math.abs(i.amount) >= min)
              .sort((a, b) => a.date.localeCompare(b.date));
            const small = l.items.filter((i) => Math.abs(i.amount) < min);
            const untaggedLine = Boolean(section.lines.find((x) => x.id === l.id)?.sum?.untagged);
            return {
              lineId: l.id,
              label: l.label,
              items: big,
              rolledUp: small.length
                ? {
                    count: small.length,
                    amount: small.reduce(
                      (n, i) => n + contribution(i, ctx.categories, untaggedLine),
                      0,
                    ),
                  }
                : null,
              total: typeof l.value === 'number' ? l.value : 0,
            };
          });
      }
      return {
        id: section.id,
        title: this.interpolate(section.title),
        description: section.description ? this.interpolate(section.description) : undefined,
        lines,
        total: hasTotal
          ? {
              label: (section.total as { label: string }).label,
              value: totalValue,
              display: formatMoney(totalValue),
            }
          : null,
        itemized,
      };
    });

    const checks: CheckResult[] = (template.checks ?? []).map((check) => {
      try {
        const v = evalExpr(check.assert, this.resolve);
        return {
          label: this.interpolate(check.label),
          ok: Boolean(v),
          severity: check.severity ?? 'error',
          help: check.help,
        };
      } catch (e) {
        return { label: check.label, ok: false, severity: 'error', error: (e as Error).message };
      }
    });

    // Number receipts in date order as exhibits R-1, R-2, ...
    const receiptMin = Math.round((template.receipts?.min_amount ?? 0) * 100);
    const exhibits: ReceiptExhibit[] = [];
    if (template.receipts?.attach !== false) {
      const seen = new Set<string>();
      const withReceipts = ctx.lines
        .filter((l) => l.receiptIds.length > 0 && Math.abs(l.txAmount ?? l.amount) >= receiptMin)
        .sort((a, b) => a.date.localeCompare(b.date) || a.payee.localeCompare(b.payee));
      for (const line of withReceipts) {
        for (const rid of line.receiptIds) {
          if (seen.has(rid)) continue;
          seen.add(rid);
          exhibits.push({ number: `R-${exhibits.length + 1}`, receiptId: rid, line });
        }
      }
    }

    const values: Record<string, Value> = {};
    for (const [k, v] of this.values) values[k] = v;
    const inputs: Record<string, Value> = {};
    for (const input of template.inputs ?? [])
      inputs[input.id] = this.resolve(`inputs.${input.id}`);

    return {
      template,
      period: ctx.period,
      sections,
      checks,
      values,
      notes: (template.notes ?? []).map((n) => this.interpolate(n)),
      attestation: template.attestation ? this.interpolate(template.attestation) : '',
      exhibits,
      inputs,
    };
  }
}

export function evaluateTemplate(template: FormTemplate, ctx: EvalContext): ReportResult {
  return new TemplateEvaluator(template, ctx).run();
}

const NOT_MONEY = /^(count\.[a-z_]+|period\.days)$/;

/**
 * Resolve an acroform mapping value: an expression (optionally followed by
 * `| money`, `| number`, `| date`, `| yesno` or `| text`), or text with {{ }}.
 * Numbers are written as money (1,234.56) unless they are counts or days.
 */
export function acroValue(evaluator: TemplateEvaluator, spec: string): string {
  if (spec.includes('{{')) return evaluator.interpolate(spec);
  const m = /^(.*?)\s*\|\s*(money|number|date|yesno|text)\s*$/.exec(spec);
  const expr = (m ? m[1] : spec).trim();
  const filter = m?.[2] ?? (NOT_MONEY.test(expr) ? 'number' : 'money');
  const v = evalExpr(expr, evaluator.resolve);
  if (v === null || v === undefined) return '';
  if (filter === 'money' && typeof v === 'number') {
    const abs = Math.abs(Math.round(v));
    const s = `${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
    return v < 0 ? `-${s}` : s;
  }
  if (filter === 'number' && typeof v === 'number') return String(v);
  if (filter === 'date' || filter === 'yesno') return formatValue(v, filter);
  return String(v);
}
