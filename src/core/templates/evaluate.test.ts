import { describe, expect, it } from 'vitest';
import { CategoryIndex } from '../categories';
import {
  evaluateTemplate,
  TemplateEvaluator,
  acroValue,
  type EvalContext,
  type EvalLine,
} from './evaluate';
import { parseTemplateYaml, validateTemplate } from './validate';

function line(
  p: Partial<EvalLine> & { amount: number; category: string | null; date?: string },
): EvalLine {
  return {
    txId: Math.random().toString(36).slice(2),
    lineId: '',
    date: p.date ?? '2026-03-01',
    payee: 'X',
    memo: '',
    checkNumber: '',
    accountId: 'chk',
    accountName: 'Checking',
    accountKind: 'checking',
    receiptIds: [],
    ...p,
  };
}

const YAML = `
schema: payeebook/template@1
id: test-template
name: Test account
version: 1.0.0
kind: court
status: generic
jurisdiction: { country: US }
inputs:
  - id: case_number
    label: Case number
    type: text
    default: "{{ book.case_number }}"
  - id: real_property
    label: Real property value
    type: money
    default: 0
sections:
  - id: summary
    title: Summary for {{ book.beneficiary_name }}
    total: false
    lines:
      - { id: opening, label: Opening, value: balance.start }
      - { id: receipts, label: Receipts, value: receipts.total }
      - { id: spent, label: Disbursements, value: disbursements.total }
      - { id: closing, label: Closing, value: balance.end }
  - id: receipts
    title: Receipts
    itemize: true
    total: { label: Total receipts }
    lines:
      - { id: benefits, label: Benefits, sum: { ssa: [benefits] } }
      - { id: other, label: Other, sum: { kinds: [income], exclude: [benefits_ssa, benefits_ssi] } }
  - id: disbursements
    title: Disbursements
    itemize: { min_amount: 25 }
    total: { label: Total disbursements }
    lines:
      - { id: food_housing, label: Food and housing, sum: { ssa: [food_housing] } }
      - { id: other, label: Other needs, sum: { ssa: [other_needs] } }
      - { id: note, label: Note, text: "Case {{ inputs.case_number }}", }
checks:
  - label: Account balances
    assert: summary.opening + receipts.total - disbursements.total == summary.closing
  - label: Everything tagged
    assert: count.untagged == 0
    severity: warning
attestation: I, {{ book.fiduciary_name }}, swear the total of {{ receipts.total | money }} is right.
acroform:
  fields:
    TotalReceipts: receipts.total
    Case: "{{ inputs.case_number }}"
`;

function ctx(lines: EvalLine[]): EvalContext {
  return {
    book: { beneficiary_name: 'Rosa Diaz', fiduciary_name: 'Ana Diaz', case_number: '2025-P-123' },
    period: { start: '2026-01-01', end: '2026-12-31' },
    lines,
    accounts: [
      {
        id: 'chk',
        name: 'Checking',
        kind: 'checking',
        start: 50000,
        end: 50000 + lines.reduce((n, l) => n + l.amount, 0),
      },
    ],
    savedOffBook: {
      start: 0,
      end: -lines.filter((l) => l.category === 'saved').reduce((n, l) => n + l.amount, 0),
    },
    counts: {
      untagged: lines.filter((l) => !l.category).length,
      transactions: lines.length,
      missing_receipts: 0,
    },
    categories: new CategoryIndex(),
    inputs: {},
    today: '2027-01-15',
  };
}

const LINES = [
  line({ amount: 104300, category: 'benefits_ssa', date: '2026-01-03' }),
  line({ amount: 5000, category: 'pension', date: '2026-01-04' }),
  line({ amount: -85000, category: 'housing', date: '2026-01-05' }),
  line({ amount: -5420, category: 'food', date: '2026-01-06', receiptIds: ['r1'] }),
  line({ amount: -1000, category: 'personal', date: '2026-01-07' }),
  line({ amount: 300, category: 'personal', date: '2026-01-08' }), // refund reduces spending
  line({ amount: -10000, category: 'saved', date: '2026-01-09' }),
];

describe('template evaluation', () => {
  const { template, warnings } = parseTemplateYaml(YAML);

  it('validates cleanly', () => {
    expect(warnings).toEqual([]);
  });

  it('computes sections, totals and checks', () => {
    const r = evaluateTemplate(template, ctx(LINES));
    const receipts = r.sections.find((s) => s.id === 'receipts')!;
    expect(receipts.total?.value).toBe(109300);
    expect(receipts.lines.map((l) => l.value)).toEqual([104300, 5000]);
    const disb = r.sections.find((s) => s.id === 'disbursements')!;
    expect(disb.lines[0].value).toBe(90420);
    expect(disb.lines[1].value).toBe(700);
    expect(disb.total?.value).toBe(91120);
    expect(disb.lines[2].display).toBe('Case 2025-P-123');
    expect(r.checks.map((c) => c.ok)).toEqual([true, true]);
    expect(r.sections[0].title).toBe('Summary for Rosa Diaz');
    expect(r.attestation).toBe('I, Ana Diaz, swear the total of $1,093.00 is right.');
    expect(r.exhibits).toHaveLength(1);
    expect(r.exhibits[0].number).toBe('R-1');
    expect(r.inputs.case_number).toBe('2025-P-123');
  });

  it('itemizes with thresholds', () => {
    const r = evaluateTemplate(template, ctx(LINES));
    const disb = r.sections.find((s) => s.id === 'disbursements')!;
    const other = disb.itemized!.find((g) => g.lineId === 'other')!;
    expect(other.items).toHaveLength(0);
    // The refund reduces the rolled-up amount, so it agrees with the line total.
    expect(other.rolledUp).toEqual({ count: 2, amount: 700 });
    const fh = disb.itemized!.find((g) => g.lineId === 'food_housing')!;
    expect(fh.items.map((i) => i.amount)).toEqual([-85000, -5420]);
  });

  it('fails checks when the books do not balance', () => {
    const c = ctx([...LINES, line({ amount: -500, category: null })]);
    const r = evaluateTemplate(template, c);
    expect(r.checks.map((x) => x.ok)).toEqual([false, false]);
  });

  it('fills acroform values', () => {
    const ev = new TemplateEvaluator(template, ctx(LINES));
    expect(acroValue(ev, 'receipts.total')).toBe('1,093.00');
    expect(acroValue(ev, '{{ inputs.case_number }}')).toBe('2025-P-123');
  });

  it('detects circular references', () => {
    const bad = parseTemplateYaml(`
schema: payeebook/template@1
id: loop
name: Loop
version: 1.0.0
kind: other
status: draft
jurisdiction: { country: US }
references: [{ title: x, url: "https://example.org" }]
sections:
  - id: s
    title: S
    lines:
      - { id: a, label: A, value: s.b }
      - { id: b, label: B, value: s.a }
`).template;
    expect(() => evaluateTemplate(bad, ctx([]))).toThrow(/Circular/);
  });
});

describe('template validation', () => {
  it('reports structural and reference errors', () => {
    const issues = validateTemplate({
      schema: 'nope',
      id: 'Bad ID',
      name: 'x',
      version: '1',
      kind: 'court',
      status: 'draft',
      jurisdiction: { country: 'US' },
      sections: [
        {
          id: 's',
          title: 'S',
          lines: [
            { id: 'a', label: 'A', value: 'nope.total + 1' },
            { id: 'a', label: 'dup', sum: { ssa: ['bogus'] } },
            { id: 'c', label: 'C' },
            { id: 'd', label: 'D', sum: { categories: ['my_custom'] } },
            { id: 'e', label: 'E', text: '{{ s.a | shout }}' },
          ],
        },
      ],
      checks: [{ label: 'x', assert: '1 +' }],
    });
    const messages = issues.map((i) => `${i.severity}:${i.path}:${i.message}`);
    expect(messages.some((m) => m.includes('schema'))).toBe(true);
    expect(messages.some((m) => m.includes('error:id:'))).toBe(true);
    expect(messages.some((m) => m.includes('error:version'))).toBe(true);
    expect(messages.some((m) => m.includes('Unknown name "nope.total"'))).toBe(true);
    expect(messages.some((m) => m.includes('Duplicate line id'))).toBe(true);
    expect(messages.some((m) => m.includes('Unknown SSA bucket "bogus"'))).toBe(true);
    expect(messages.some((m) => m.includes('exactly one of'))).toBe(true);
    expect(messages.some((m) => m.startsWith('warning') && m.includes('my_custom'))).toBe(true);
    expect(messages.some((m) => m.includes('Unknown filter "shout"'))).toBe(true);
    expect(messages.some((m) => m.includes('checks[0].assert'))).toBe(true);
    expect(messages.some((m) => m.startsWith('warning:references'))).toBe(true);
  });

  it('rejects unknown keys such as an unquoted comma in a flow mapping', () => {
    const yamlText = `
schema: payeebook/template@1
id: comma
name: Comma
version: 1.0.0
kind: other
status: generic
jurisdiction: { country: US }
sections:
  - id: s
    title: S
    lines:
      - { id: a, label: Benefits (SSA, SSI), sum: { ssa: [benefits] } }
`;
    expect(() => parseTemplateYaml(yamlText)).toThrow(/Unknown key/);
  });

  it('throws readable YAML errors', () => {
    expect(() => parseTemplateYaml('a: [1, 2')).toThrow(/YAML syntax error/);
    expect(() => parseTemplateYaml('- 1')).toThrow(/problem/);
  });
});
