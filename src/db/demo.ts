import {
  addDays,
  addMonths,
  startOfMonth,
  toISO,
  todayISO,
  splitISO,
  endOfMonth,
  type ISODate,
} from '../core/dates';
import type { Store } from './store';
import type { Book } from './types';

/** Deterministic pseudo-random numbers so the demo looks the same every time. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoReceiptSpec {
  txId: string;
  merchant: string;
  date: ISODate;
  amount: number;
  lines: [string, number][];
}

/**
 * A fictional book: Margaret Ellis, 81, lives in a senior apartment. Her son
 * Daniel is her Social Security representative payee and court-appointed
 * conservator. 14 months of activity ending today.
 */
export function createDemoBook(
  store: Store,
  today: ISODate = todayISO(),
): { book: Book; receipts: DemoReceiptSpec[] } {
  const rand = mulberry32(20260301);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const start = startOfMonth(addMonths(today, -13));
  const book = store.createBook(
    {
      beneficiary_name: 'Margaret Ellis',
      beneficiary_dob: '1945-04-12',
      fiduciary_name: 'Daniel Ellis',
      fiduciary_phone: '(612) 555-0142',
      fiduciary_address: '418 Maple Court, Saint Paul, MN',
      role: 'conservator',
      state: 'MN',
      county: 'Ramsey',
      court: 'Ramsey County District Court',
      case_number: 'DEMO-2025-0001',
      claim_number: null,
      appointment_date: start,
      report_month: Number(start.slice(5, 7)),
      notes:
        'Demo book with made-up people and numbers. Explore freely; delete it from Settings when you are done.',
      receipt_threshold: 7500,
    },
    [
      {
        name: 'Representative payee checking',
        kind: 'checking',
        institution: 'North Star Credit Union',
        last4: '4417',
        opening_balance: 61842,
        opening_date: start,
      },
      {
        name: 'Conserved savings',
        kind: 'savings',
        institution: 'North Star Credit Union',
        last4: '9032',
        opening_balance: 412500,
        opening_date: start,
      },
      { name: 'Cash on hand', kind: 'cash', opening_balance: 6000, opening_date: start },
    ],
  );
  const [checking, savings, cash] = store.listAccounts(book.id);
  const receipts: DemoReceiptSpec[] = [];
  const add = (
    account: string,
    date: ISODate,
    amount: number,
    payee: string,
    category: string | null,
    memo = '',
    check = '',
  ) => {
    if (date > today) return null;
    return store.addTransaction(
      book.id,
      { account_id: account, date, amount, payee, category, memo, check_number: check },
      'demo',
    );
  };

  store.tx(() => {
    let check = 2101;
    for (let m = 0; m < 14; m++) {
      const month = addMonths(start, m);
      const [y, mo] = splitISO(month);
      const d = (day: number) => toISO(y, mo, Math.min(day, Number(endOfMonth(month).slice(8))));
      add(
        checking.id,
        d(3),
        148600,
        'SSA Treas 310 Soc Sec',
        'benefits_ssa',
        'Monthly Social Security',
      );
      add(checking.id, d(1), 21240, 'MN State Retirement System', 'pension', 'Survivor pension');
      add(
        checking.id,
        d(1),
        -85000,
        'Lakeview Senior Apartments',
        'housing',
        `Rent ${month.slice(0, 7)}`,
        String(check++),
      );
      add(checking.id, d(12), -between(4800, 9600), 'Xcel Energy', 'utilities', 'Electric');
      add(checking.id, d(15), -3500, 'T-Mobile', 'utilities', 'Phone');
      add(checking.id, d(9), -2200, 'Great Clips', 'personal', 'Haircut');
      add(checking.id, d(5), -2800, 'Metro Transit', 'transportation', 'Monthly senior pass');
      add(checking.id, d(20), -between(1000, 2500), 'Walgreens', 'medical', 'Prescription copays');
      add(
        checking.id,
        d(25),
        -10000,
        'Transfer to conserved savings',
        'transfer',
        'Monthly savings',
      );
      add(savings.id, d(25), 10000, 'Transfer from checking', 'transfer', 'Monthly savings');
      add(savings.id, endOfMonth(month), between(140, 180), 'Dividend', 'interest');
      for (const day of [4, 11, 18, 26]) {
        const amt = -between(3200, 8800);
        const store_ = rand() > 0.5 ? 'Cub Foods' : 'Hy-Vee';
        const t = add(checking.id, d(day), amt, store_, 'food', 'Groceries');
        if (t && rand() > 0.55) {
          receipts.push({
            txId: t.id,
            merchant: store_,
            date: t.date,
            amount: -amt,
            lines: [
              ['Bananas', 129],
              ['Milk 2%', 349],
              ['Bread', 299],
              ['Soup (4)', 596],
              ['Chicken thighs', 912],
            ],
          });
        }
      }
      if (m % 3 === 1)
        add(cash.id, d(14), -1500, 'Senior center outing', 'recreation', 'Lunch and bingo');
      if (m % 4 === 2) {
        const t = add(
          checking.id,
          d(16),
          -between(3500, 7500),
          'Kohl’s',
          'clothing',
          'Winter clothes',
        );
        if (t)
          receipts.push({
            txId: t.id,
            merchant: "Kohl's",
            date: t.date,
            amount: -t.amount,
            lines: [
              ['Cardigan', 2999],
              ['Slippers', 1499],
            ],
          });
      }
      if (m === 2 || m === 8) {
        const t = add(
          checking.id,
          d(22),
          -between(9000, 16000),
          'HealthPartners Dental',
          'medical',
          'Dental visit',
        );
        if (t)
          receipts.push({
            txId: t.id,
            merchant: 'HealthPartners Dental',
            date: t.date,
            amount: -t.amount,
            lines: [['Exam and cleaning', -t.amount]],
          });
      }
      if (m === 1)
        add(
          checking.id,
          d(8),
          -15000,
          'Western Surety Company',
          'fees',
          'Conservator bond premium',
        );
      if (m === 5)
        add(checking.id, d(19), -40000, 'Hansen Elder Law', 'legal', 'Annual account review');
      if (m === 6)
        add(checking.id, d(2), -20000, 'Cash withdrawal', 'transfer', 'Cash for small purchases');
      if (m === 6)
        add(cash.id, d(2), 20000, 'Cash withdrawal', 'transfer', 'Cash for small purchases');
      if (m === 10)
        add(checking.id, d(21), 5800, 'Walgreens refund', 'medical', 'Overcharged copay refunded');
    }

    // The last few transactions are fresh from the bank and still untagged.
    const recent = addDays(today, -2);
    add(checking.id, recent, -4317, 'POS Purchase Target T-1832 Saint Paul MN', null);
    add(checking.id, addDays(today, -1), -1899, 'Amazon Mktpl*2K4LP0', null);
    add(cash.id, addDays(today, -3), -600, 'Coffee with friends', null);

    // Month-end reconciliations for every closed month.
    for (let m = 0; m < 13; m++) {
      const end = endOfMonth(addMonths(start, m));
      if (end >= today) break;
      store.reconcile(checking.id, end, store.balanceAt(checking.id, end));
      store.reconcile(savings.id, end, store.balanceAt(savings.id, end));
    }
  });
  store.addRule(book.id, 'CUB FOODS', 'food', 'out', false);
  store.addRule(book.id, 'HY-VEE', 'food', 'out', false);
  store.addRule(book.id, 'XCEL ENERGY', 'utilities', 'out', false);
  return { book, receipts };
}
