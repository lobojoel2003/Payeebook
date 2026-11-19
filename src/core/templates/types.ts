import type { CategoryKind, CourtGroup, SsaBucket } from '../categories';

export const TEMPLATE_SCHEMA = 'payeebook/template@1';

export type FiduciaryRole =
  'ssa_payee' | 'ssi_payee' | 'va_fiduciary' | 'guardian' | 'conservator' | 'trustee' | 'other';

export type AccountKind = 'checking' | 'savings' | 'cash' | 'prepaid' | 'investment' | 'other';

export type InputType = 'text' | 'textarea' | 'money' | 'number' | 'date' | 'yesno' | 'choice';

export interface TemplateInput {
  id: string;
  label: string;
  type: InputType;
  help?: string;
  default?: string | number | boolean;
  required?: boolean;
  options?: string[];
}

export interface SumSpec {
  categories?: string[];
  kinds?: CategoryKind[];
  ssa?: SsaBucket[];
  court?: CourtGroup[];
  exclude?: string[];
  accounts?: AccountKind[];
  direction?: 'in' | 'out';
  untagged?: boolean;
}

export type LineFormat = 'money' | 'number' | 'text' | 'date' | 'yesno';

export interface TemplateLine {
  id: string;
  label: string;
  sum?: SumSpec;
  value?: string;
  input?: string;
  text?: string;
  format?: LineFormat;
  help?: string;
  emphasis?: boolean;
  /** Whether a money line counts toward its section total. Defaults to true for sum lines. */
  in_total?: boolean;
}

export interface ItemizeSpec {
  /** Only list transactions at or above this many dollars; smaller ones are summarised. */
  min_amount?: number;
}

export interface TemplateSection {
  id: string;
  title: string;
  description?: string;
  lines: TemplateLine[];
  total?: { label: string } | false;
  itemize?: boolean | ItemizeSpec;
}

export interface TemplateCheck {
  id?: string;
  label: string;
  assert: string;
  severity?: 'error' | 'warning';
  help?: string;
}

export interface FormTemplate {
  schema: typeof TEMPLATE_SCHEMA;
  id: string;
  name: string;
  short_name?: string;
  version: string;
  kind: 'ssa' | 'court' | 'va' | 'other';
  /** verified: checked against the official form. draft: community draft awaiting review. generic: not tied to one official form. */
  status: 'verified' | 'draft' | 'generic';
  jurisdiction: {
    country: string;
    state?: string | null;
    county?: string | null;
    agency?: string;
    court?: string;
  };
  roles?: FiduciaryRole[];
  description?: string;
  references?: { title: string; url: string }[];
  maintainers?: string[];
  license?: string;
  period?: {
    default?: 'appointment-year' | 'calendar-year' | 'last-12-months' | 'custom';
    months?: number;
  };
  inputs?: TemplateInput[];
  sections: TemplateSection[];
  checks?: TemplateCheck[];
  notes?: string[];
  attestation?: string;
  signatures?: string[];
  receipts?: { attach?: boolean; min_amount?: number };
  acroform?: {
    /** Official form field name -> expression or "{{ text }}" to write into it. */
    fields?: Record<string, string>;
    /** Official checkbox field name -> boolean expression. */
    checkboxes?: Record<string, string>;
  };
}

export interface LoadedTemplate {
  template: FormTemplate;
  source: 'bundled' | 'user';
  path: string;
  yaml: string;
  warnings: string[];
}
