import { describe, expect, it } from 'vitest';
import { findDate, findMerchant, findTotal, parseReceiptText, rankMatches } from './receipt';

const GROCERY = `PUBLIX
Super Markets
1200 Bay St Tampa FL
Store #1432  Tel (813) 555-0100
BANANAS            1.29
MILK 2%            3.49
BREAD              2.99
SUBTOTAL          49.77
TAX                4.43
TOTAL             54.20
VISA TEND         54.20
CHANGE             0.00
YOU SAVED          6.10
03/05/2026 10:42 AM
Thank you for shopping`;

const PHARMACY = `Welcome to
CVS pharmacy
RX COPAY          10.00
Amount Due       $23.99
Mar 10, 2026`;

describe('receipt parsing', () => {
  it('finds the total, not subtotal, tax or savings', () => {
    expect(findTotal(GROCERY)).toBe(5420);
    expect(findTotal(PHARMACY)).toBe(2399);
  });
  it('falls back to the largest non-cash amount', () => {
    expect(findTotal('Item 3.00\nItem 12.50\nCASH 20.00\nCHANGE 4.50')).toBe(1250);
    expect(findTotal('no numbers here')).toBeNull();
  });
  it('reads totals on the following line', () => {
    expect(findTotal('TOTAL\n$ 18.75')).toBe(1875);
  });
  it('finds dates', () => {
    expect(findDate(GROCERY, '2026-04-01')).toBe('2026-03-05');
    expect(findDate(PHARMACY, '2026-04-01')).toBe('2026-03-10');
    expect(findDate('nothing', '2026-04-01')).toBeNull();
  });
  it('finds merchants', () => {
    expect(findMerchant(GROCERY)).toBe('Publix');
    expect(findMerchant(PHARMACY)).toBe('Cvs Pharmacy');
  });
  it('parses all fields', () => {
    expect(parseReceiptText(GROCERY, '2026-04-01')).toEqual({
      total: 5420,
      date: '2026-03-05',
      merchant: 'Publix',
    });
  });
});

describe('rankMatches', () => {
  const txs = [
    { id: 'a', date: '2026-03-05', amount: -5420, payee: 'PUBLIX #1432', hasReceipt: false },
    { id: 'b', date: '2026-03-09', amount: -5420, payee: 'OTHER', hasReceipt: false },
    { id: 'c', date: '2026-03-25', amount: -5420, payee: 'PUBLIX', hasReceipt: false },
    { id: 'd', date: '2026-03-05', amount: -999, payee: 'PUBLIX', hasReceipt: false },
  ];
  it('ranks by amount, date proximity and name', () => {
    const ranked = rankMatches({ total: 5420, date: '2026-03-05', merchant: 'Publix' }, txs);
    expect(ranked.map((t) => t.id)).toEqual(['a', 'b']);
  });
  it('returns nothing without a total', () => {
    expect(rankMatches({ total: null, date: null, merchant: null }, txs)).toEqual([]);
  });
});
