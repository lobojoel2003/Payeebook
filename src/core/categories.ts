/**
 * Categories are how each transaction is "tagged once". Every category carries
 * the mappings that reports need, so a template can ask for "everything SSA
 * counts as food and housing" without listing categories by hand.
 */
export type CategoryKind = 'income' | 'expense' | 'transfer' | 'saving';

/** Buckets used by the SSA-623 Representative Payee Report. */
export type SsaBucket =
  'benefits' | 'other_income' | 'food_housing' | 'other_needs' | 'saved' | 'none';

/** Roll-up groups used by court accounting schedules. */
export type CourtGroup =
  | 'receipts.benefits'
  | 'receipts.pension'
  | 'receipts.earned'
  | 'receipts.investment'
  | 'receipts.other'
  | 'disbursements.residence'
  | 'disbursements.food'
  | 'disbursements.medical'
  | 'disbursements.personal'
  | 'disbursements.transport'
  | 'disbursements.insurance'
  | 'disbursements.administration'
  | 'disbursements.debt'
  | 'disbursements.other'
  | 'transfers'
  | 'savings';

export interface Category {
  id: string;
  label: string;
  kind: CategoryKind;
  ssa: SsaBucket;
  court: CourtGroup;
  color: string;
  hint?: string;
  builtin: boolean;
}

const C = (
  id: string,
  label: string,
  kind: CategoryKind,
  ssa: SsaBucket,
  court: CourtGroup,
  color: string,
  hint?: string,
): Category => ({ id, label, kind, ssa, court, color, hint, builtin: true });

export const BUILTIN_CATEGORIES: readonly Category[] = [
  // Money in
  C(
    'benefits_ssa',
    'Social Security benefits',
    'income',
    'benefits',
    'receipts.benefits',
    '#2f7d62',
    'Retirement, survivor or disability (RSDI) payments from SSA',
  ),
  C(
    'benefits_ssi',
    'SSI benefits',
    'income',
    'benefits',
    'receipts.benefits',
    '#3c8f73',
    'Supplemental Security Income payments',
  ),
  C(
    'benefits_va',
    'VA benefits',
    'income',
    'other_income',
    'receipts.benefits',
    '#4a9a80',
    'Veterans Affairs compensation or pension',
  ),
  C('pension', 'Pension or annuity', 'income', 'other_income', 'receipts.pension', '#5a8f9a'),
  C(
    'wages',
    'Earned income',
    'income',
    'other_income',
    'receipts.earned',
    '#6a8fb0',
    'Wages or self-employment income',
  ),
  C(
    'interest',
    'Interest and dividends',
    'income',
    'other_income',
    'receipts.investment',
    '#7a86c0',
  ),
  C('refund', 'Refunds and reimbursements', 'income', 'other_income', 'receipts.other', '#8b7fb8'),
  C('other_income', 'Other money in', 'income', 'other_income', 'receipts.other', '#9b8aa8'),

  // Money out: food and housing (SSA treats utilities as part of housing)
  C(
    'housing',
    'Housing',
    'expense',
    'food_housing',
    'disbursements.residence',
    '#b5651d',
    'Rent, mortgage, property tax, repairs',
  ),
  C(
    'utilities',
    'Utilities',
    'expense',
    'food_housing',
    'disbursements.residence',
    '#c0782f',
    'Electric, gas, water, trash, phone, internet',
  ),
  C(
    'care_facility',
    'Care facility',
    'expense',
    'food_housing',
    'disbursements.residence',
    '#c98a45',
    'Nursing home, assisted living, group home room and board',
  ),
  C(
    'food',
    'Food',
    'expense',
    'food_housing',
    'disbursements.food',
    '#d29a55',
    'Groceries and meals',
  ),

  // Money out: other needs
  C(
    'medical',
    'Medical and dental',
    'expense',
    'other_needs',
    'disbursements.medical',
    '#b04a5a',
    'Doctor, dentist, pharmacy, copays, medical supplies',
  ),
  C('clothing', 'Clothing', 'expense', 'other_needs', 'disbursements.personal', '#a05a8a'),
  C(
    'personal',
    'Personal care and items',
    'expense',
    'other_needs',
    'disbursements.personal',
    '#9060a0',
    'Haircuts, toiletries, phone, allowance',
  ),
  C('education', 'Education', 'expense', 'other_needs', 'disbursements.personal', '#7066a8'),
  C(
    'recreation',
    'Recreation',
    'expense',
    'other_needs',
    'disbursements.personal',
    '#5f6fb0',
    'Outings, hobbies, subscriptions',
  ),
  C(
    'transportation',
    'Transportation',
    'expense',
    'other_needs',
    'disbursements.transport',
    '#4f7ab0',
    'Bus, ride share, fuel, car repair',
  ),
  C(
    'insurance',
    'Insurance',
    'expense',
    'other_needs',
    'disbursements.insurance',
    '#4686a0',
    'Health, Medicare premiums, renters, burial',
  ),
  C(
    'fees',
    'Bank, court and bond fees',
    'expense',
    'other_needs',
    'disbursements.administration',
    '#5d6b78',
    'Bank charges, filing fees, guardian bond premium',
  ),
  C(
    'legal',
    'Legal and professional',
    'expense',
    'other_needs',
    'disbursements.administration',
    '#6b7785',
    'Attorney, accountant, tax preparer',
  ),
  C('taxes', 'Taxes', 'expense', 'other_needs', 'disbursements.administration', '#788391'),
  C('debt', 'Debt payments', 'expense', 'other_needs', 'disbursements.debt', '#86909c'),
  C('other_expense', 'Other spending', 'expense', 'other_needs', 'disbursements.other', '#939ba5'),

  // Neutral moves
  C(
    'saved',
    'Saved',
    'saving',
    'saved',
    'savings',
    '#2b6cb0',
    'Moved into savings, a CD, or savings bonds kept for the beneficiary',
  ),
  C(
    'transfer',
    'Transfer between accounts',
    'transfer',
    'none',
    'transfers',
    '#8a8f98',
    'Both accounts belong to the beneficiary and are tracked here',
  ),
];

export const COURT_GROUP_LABELS: Record<CourtGroup, string> = {
  'receipts.benefits': 'Government benefits',
  'receipts.pension': 'Pensions and annuities',
  'receipts.earned': 'Earned income',
  'receipts.investment': 'Interest and dividends',
  'receipts.other': 'Other receipts',
  'disbursements.residence': 'Residence and care',
  'disbursements.food': 'Food',
  'disbursements.medical': 'Medical and dental',
  'disbursements.personal': 'Clothing and personal needs',
  'disbursements.transport': 'Transportation',
  'disbursements.insurance': 'Insurance',
  'disbursements.administration': 'Administration (fees, legal, taxes)',
  'disbursements.debt': 'Debt payments',
  'disbursements.other': 'Other disbursements',
  transfers: 'Transfers between accounts',
  savings: 'Saved',
};

export const SSA_BUCKET_LABELS: Record<SsaBucket, string> = {
  benefits: 'Benefits received',
  other_income: 'Other income',
  food_housing: 'Food and housing',
  other_needs: 'Clothing, medical, personal and other needs',
  saved: 'Saved',
  none: 'Not reported',
};

export const KIND_LABELS: Record<CategoryKind, string> = {
  income: 'Money in',
  expense: 'Money out',
  saving: 'Saved',
  transfer: 'Transfer',
};

export class CategoryIndex {
  private byId = new Map<string, Category>();
  readonly all: Category[];

  constructor(custom: Category[] = []) {
    this.all = [...BUILTIN_CATEGORIES, ...custom];
    for (const c of this.all) this.byId.set(c.id, c);
  }

  get(id: string | null | undefined): Category | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  label(id: string | null | undefined): string {
    if (!id) return 'Untagged';
    return this.byId.get(id)?.label ?? id;
  }

  byKind(kind: CategoryKind): Category[] {
    return this.all.filter((c) => c.kind === kind);
  }

  /** Categories that make sense for a transaction with this sign. */
  suggestFor(amount: number): Category[] {
    const primary =
      amount >= 0 ? ['income', 'transfer', 'saving'] : ['expense', 'saving', 'transfer'];
    return [...this.all].sort((a, b) => primary.indexOf(a.kind) - primary.indexOf(b.kind) || 0);
  }
}

/**
 * Polarity used when totalling a category: income is reported as money in,
 * expenses and savings as positive amounts going out. A refund booked to
 * "medical" therefore reduces medical spending rather than counting as income.
 */
export function reportSign(kind: CategoryKind): 1 | -1 {
  return kind === 'income' ? 1 : -1;
}
