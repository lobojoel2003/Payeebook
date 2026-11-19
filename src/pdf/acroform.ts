import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { acroValue, TemplateEvaluator } from '../core/templates/evaluate';
import { evalExpr, truthy } from '../core/templates/expr';
import { winAnsi } from './text';

export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'other';
  value: string;
}

/** List the fillable fields of an official PDF form, to help volunteers write mappings. */
export async function listFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc
    .getForm()
    .getFields()
    .map((f) => {
      if (f instanceof PDFTextField)
        return { name: f.getName(), type: 'text' as const, value: f.getText() ?? '' };
      if (f instanceof PDFCheckBox)
        return {
          name: f.getName(),
          type: 'checkbox' as const,
          value: f.isChecked() ? 'checked' : '',
        };
      if (f instanceof PDFDropdown)
        return { name: f.getName(), type: 'dropdown' as const, value: f.getSelected().join(', ') };
      if (f instanceof PDFRadioGroup)
        return { name: f.getName(), type: 'radio' as const, value: f.getSelected() ?? '' };
      return { name: f.getName(), type: 'other' as const, value: '' };
    });
}

export interface FillResult {
  bytes: Uint8Array;
  filled: string[];
  missing: string[];
  errors: { field: string; message: string }[];
}

/**
 * Fill a user-supplied official PDF with values from a template's acroform
 * mapping. Payeebook never ships official forms; the user downloads the blank
 * form from the court or agency and Payeebook writes the numbers into it.
 */
export async function fillAcroForm(
  pdf: Uint8Array,
  evaluator: TemplateEvaluator,
  opts: { flatten?: boolean } = {},
): Promise<FillResult> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const form = doc.getForm();
  const mapping = evaluator.template.acroform ?? {};
  const filled: string[] = [];
  const missing: string[] = [];
  const errors: FillResult['errors'] = [];
  const names = new Set(form.getFields().map((f) => f.getName()));

  for (const [field, spec] of Object.entries(mapping.fields ?? {})) {
    if (!names.has(field)) {
      missing.push(field);
      continue;
    }
    try {
      const value = winAnsi(acroValue(evaluator, spec));
      const f = form.getField(field);
      if (f instanceof PDFTextField) f.setText(value);
      else if (f instanceof PDFDropdown) f.select(value);
      else if (f instanceof PDFRadioGroup) f.select(value);
      else throw new Error('Field is not a text, dropdown or radio field.');
      filled.push(field);
    } catch (e) {
      errors.push({ field, message: (e as Error).message });
    }
  }
  for (const [field, spec] of Object.entries(mapping.checkboxes ?? {})) {
    if (!names.has(field)) {
      missing.push(field);
      continue;
    }
    try {
      const on = truthy(evalExpr(spec, evaluator.resolve));
      const box = form.getCheckBox(field);
      if (on) box.check();
      else box.uncheck();
      filled.push(field);
    } catch (e) {
      errors.push({ field, message: (e as Error).message });
    }
  }
  if (opts.flatten) form.flatten();
  return { bytes: await doc.save(), filled, missing, errors };
}
