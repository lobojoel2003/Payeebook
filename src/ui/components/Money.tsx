import { formatMoney } from '../../core/money';

export function Money({
  cents,
  sign,
  className = '',
}: {
  cents: number;
  sign?: boolean;
  className?: string;
}) {
  const cls = cents > 0 && sign ? 'pos' : '';
  return <span className={`money ${cls} ${className}`.trim()}>{formatMoney(cents, { sign })}</span>;
}
