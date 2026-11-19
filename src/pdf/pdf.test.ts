import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../db/store';
import { createDemoBook } from '../db/demo';
import { parseTemplateYaml } from '../core/templates/validate';
import { evaluateTemplate, TemplateEvaluator } from '../core/templates/evaluate';
import { renderReportPdf } from './report';
import { renderLedgerPdf } from './ledger';
import { fillAcroForm, listFormFields } from './acroform';
import { winAnsi } from './text';

// 2x2 red PNG
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const build = { version: '1.0.0', build: '7', commit: 'abc1234' };

async function demo() {
  const SQL = await initSqlJs();
  const store = Store.open(SQL);
  const { book, receipts } = createDemoBook(store, '2026-11-19');
  for (const r of receipts.slice(0, 3))
    store.addReceipt(book.id, {
      filename: `${r.merchant}.png`,
      mime: 'image/png',
      data: PNG,
      tx_id: r.txId,
    });
  return { store, book };
}

function load(rel: string) {
  return parseTemplateYaml(readFileSync(join(__dirname, '../../templates', rel), 'utf8')).template;
}

describe('winAnsi', () => {
  it('keeps Latin-1 and maps typography', () => {
    expect(winAnsi('Zoë – “quoted” − 5 ≥ 3 ✓')).toBe('Zoë – “quoted” - 5 >= 3 v');
    expect(winAnsi('emoji 😀 and ő')).toBe('emoji ? and o');
  });
});

describe('report PDF', () => {
  it.each([
    'ssa/ssa-623-payee-report.yaml',
    'us/generic/annual-account.yaml',
    'us/mn/conservator-annual-account.yaml',
    'other/family-summary.yaml',
  ])(
    'renders %s with receipts',
    async (rel) => {
      const { store, book } = await demo();
      const template = load(rel);
      const ctx = store.buildEvalContext(book.id, { start: '2025-11-01', end: '2026-10-31' });
      const result = evaluateTemplate(template, ctx);
      const bytes = await renderReportPdf({
        result,
        book: { ...book, role_label: 'Conservator' },
        categories: ctx.categories,
        receipt: (id) => {
          const d = store.receiptData(id);
          return d
            ? { data: d.data, mime: d.mime, filename: store.getReceipt(id)!.filename }
            : undefined;
        },
        includeReceipts: true,
        generatedOn: '2026-11-19',
        build,
      });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThan(1);
      expect(doc.getTitle()).toContain('Margaret Ellis');
    },
    20_000,
  );

  it('renders a ledger', async () => {
    const { store, book } = await demo();
    const rows = store.listTransactions(book.id, { from: '2026-01-01', to: '2026-03-31' });
    const bytes = await renderLedgerPdf({
      title: 'Ledger',
      subtitle: 'Q1',
      rows,
      categories: store.categoryIndex(book.id),
      generatedOn: '2026-11-19',
      build,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});

describe('AcroForm filling', () => {
  it('fills mapped fields of an official PDF', async () => {
    const blank = await PDFDocument.create();
    const page = blank.addPage();
    const form = blank.getForm();
    form.createTextField('TotalReceipts').addToPage(page, { x: 50, y: 700 });
    form.createTextField('CaseNo').addToPage(page, { x: 50, y: 650 });
    form.createCheckBox('AllTagged').addToPage(page, { x: 50, y: 600 });
    const bytes = await blank.save();

    expect((await listFormFields(bytes)).map((f) => f.name)).toEqual([
      'TotalReceipts',
      'CaseNo',
      'AllTagged',
    ]);

    const { store, book } = await demo();
    const template = load('us/generic/annual-account.yaml');
    template.acroform = {
      fields: { TotalReceipts: 'receipts.total', CaseNo: '{{ inputs.case_number }}', Nope: '1' },
      checkboxes: { AllTagged: 'count.untagged == 0' },
    };
    const ev = new TemplateEvaluator(
      template,
      store.buildEvalContext(book.id, { start: '2025-11-01', end: '2026-10-31' }),
    );
    const out = await fillAcroForm(bytes, ev);
    expect(out.filled.sort()).toEqual(['AllTagged', 'CaseNo', 'TotalReceipts']);
    expect(out.missing).toEqual(['Nope']);
    const fields = await listFormFields(out.bytes);
    expect(fields.find((f) => f.name === 'CaseNo')!.value).toBe('DEMO-2025-0001');
    expect(fields.find((f) => f.name === 'TotalReceipts')!.value).toMatch(
      /^\d{1,3}(,\d{3})*\.\d{2}$/,
    );
    expect(fields.find((f) => f.name === 'AllTagged')!.value).toBe('checked');
  });
});
