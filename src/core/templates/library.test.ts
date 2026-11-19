/**
 * Validates every template in /templates. Runs in CI as `npm run templates:validate`
 * so a volunteer's pull request gets a clear message if their YAML is wrong.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CategoryIndex } from '../categories';
import { evaluateTemplate, type EvalLine } from './evaluate';
import { parseTemplateYaml } from './validate';

const ROOT = join(__dirname, '../../../templates');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.ya?ml$/.test(name) ? [p] : [];
  });
}

const files = walk(ROOT);

const sample: EvalLine[] = [
  ['2025-07-03', 104300, 'benefits_ssa'],
  ['2025-07-03', 23400, 'benefits_ssi'],
  ['2025-07-05', 12000, 'pension'],
  ['2025-07-06', -85000, 'housing'],
  ['2025-07-07', -9500, 'utilities'],
  ['2025-07-08', -21000, 'food'],
  ['2025-07-09', -3500, 'medical'],
  ['2025-07-10', -4000, 'clothing'],
  ['2025-07-11', -10000, 'saved'],
  ['2025-07-12', 25, 'interest'],
].map(([date, amount, category], i) => ({
  txId: `t${i}`,
  lineId: '',
  date: date as string,
  amount: amount as number,
  category: category as string,
  payee: 'Sample',
  memo: '',
  checkNumber: '',
  accountId: 'a',
  accountName: 'Checking',
  accountKind: 'checking',
  receiptIds: i === 5 ? ['r1'] : [],
}));

describe('template library', () => {
  it('contains templates', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('has a valid JSON schema for editors', () => {
    expect(() => JSON.parse(readFileSync(join(ROOT, 'schema.json'), 'utf8'))).not.toThrow();
  });

  const ids = new Set<string>();
  for (const file of files) {
    const rel = relative(ROOT, file);
    describe(rel, () => {
      const text = readFileSync(file, 'utf8');
      const { template, warnings } = parseTemplateYaml(text);

      it('is valid and has no warnings', () => {
        expect(warnings.map((w) => `${w.path}: ${w.message}`)).toEqual([]);
      });

      it('has a unique id and SPDX header', () => {
        expect(ids.has(template.id)).toBe(false);
        ids.add(template.id);
        expect(text).toMatch(/SPDX-License-Identifier: MIT/);
      });

      it('evaluates on sample data and passes its error checks', () => {
        const end = 500000 + sample.reduce((n, l) => n + l.amount, 0);
        const result = evaluateTemplate(template, {
          book: {
            beneficiary_name: 'Sample Beneficiary',
            fiduciary_name: 'Sample Fiduciary',
            case_number: '2025-P-1',
            court: 'Circuit Court',
            county: 'Sample',
          },
          period: { start: '2025-07-01', end: '2026-06-30' },
          lines: sample,
          accounts: [{ id: 'a', name: 'Checking', kind: 'checking', start: 500000, end }],
          savedOffBook: { start: 0, end: 10000 },
          counts: { untagged: 0, transactions: sample.length, missing_receipts: 0 },
          categories: new CategoryIndex(),
          inputs: {},
          today: '2026-07-15',
        });
        const failed = result.checks.filter((c) => !c.ok && c.severity === 'error');
        expect(failed.map((c) => c.error ?? c.label)).toEqual([]);
        for (const s of result.sections)
          for (const l of s.lines) expect(l.display).not.toContain('NaN');
      });
    });
  }
});
