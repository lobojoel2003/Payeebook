import { useCallback } from 'react';
import { useBook } from '../../state/AppContext';
import { useToast, errorMessage } from '../../state/toast';
import { normalizePayee, suggestPattern } from '../../core/payee';
import type { Transaction } from '../../db/types';

/**
 * After a transaction is tagged, offer to remember the tag for that payee so
 * the same merchant is tagged automatically from now on ("tag it once").
 */
export function useTagOnce() {
  const { store, book } = useBook();
  const toast = useToast();
  return useCallback(
    (
      tx: Pick<Transaction, 'payee' | 'raw_payee' | 'amount'>,
      category: string,
      opts: { silent?: boolean } = {},
    ) => {
      const source = tx.raw_payee || tx.payee;
      const pattern = suggestPattern(source);
      if (!pattern) return;
      const direction = tx.amount < 0 ? 'out' : 'in';
      const rules = store.listRules(book.id);
      if (
        rules.some(
          (r) => normalizePayee(r.pattern) === normalizePayee(pattern) && r.category === category,
        )
      ) {
        if (!opts.silent)
          toast.success(`Tagged as ${store.categoryIndex(book.id).label(category)}.`);
        return;
      }
      const label = store.categoryIndex(book.id).label(category);
      const more = store.countMatching(book.id, pattern, direction);
      toast.show(
        <>
          Tagged as <b>{label}</b>. Always tag “{pattern}” as {label}?
        </>,
        {
          tone: 'success',
          action: {
            label: more > 0 ? `Yes, and tag ${more} more` : 'Yes, remember',
            run: () => {
              try {
                const n = store.addRule(book.id, pattern, category, direction);
                toast.success(
                  `Remembered. ${n ? `Tagged ${n} more. ` : ''}Future imports from “${pattern}” will be tagged ${label}.`,
                );
              } catch (e) {
                toast.error(errorMessage(e));
              }
            },
          },
        },
      );
    },
    [store, book.id, toast],
  );
}
