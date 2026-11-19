import type { CategoryIndex, CategoryKind } from '../../core/categories';
import { KIND_LABELS } from '../../core/categories';

const ORDER: CategoryKind[] = ['income', 'expense', 'saving', 'transfer'];

export function CategoryOptions({
  categories,
  amount,
}: {
  categories: CategoryIndex;
  amount?: number;
}) {
  const order =
    amount === undefined
      ? ORDER
      : amount >= 0
        ? ['income', 'transfer', 'saving', 'expense']
        : ['expense', 'saving', 'transfer', 'income'];
  return (
    <>
      {(order as CategoryKind[]).map((kind) => (
        <optgroup key={kind} label={KIND_LABELS[kind]}>
          {categories.byKind(kind).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function CategorySelect({
  categories,
  value,
  onChange,
  amount,
  disabled,
  className = '',
  allowEmpty = true,
  label,
}: {
  categories: CategoryIndex;
  value: string | null;
  onChange: (value: string | null) => void;
  amount?: number;
  disabled?: boolean;
  className?: string;
  allowEmpty?: boolean;
  label?: string;
}) {
  return (
    <select
      className={`${className} ${!value ? 'untagged' : ''}`.trim()}
      value={value ?? ''}
      disabled={disabled}
      aria-label={label ?? 'Category'}
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
    >
      {allowEmpty && <option value="">Choose a tag…</option>}
      <CategoryOptions categories={categories} amount={amount} />
    </select>
  );
}
