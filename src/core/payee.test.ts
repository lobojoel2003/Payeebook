import { describe, expect, it } from 'vitest';
import { matchRule, normalizePayee, prettyPayee, suggestPattern, type PayeeRule } from './payee';

describe('normalizePayee', () => {
  it.each([
    ['POS PURCHASE PUBLIX #1432 TAMPA FL 03/14', 'PUBLIX TAMPA FL'],
    ['CHECKCARD 0314 KROGER 0045 COLUMBUS OH', 'KROGER COLUMBUS OH'],
    ['SSA TREAS 310 XXSOC SEC PPD ID: 9031036000', 'SSA TREAS SOC SEC'],
    ['Duke Energy Payment', 'DUKE ENERGY'],
    ['Walgreens #04512', 'WALGREENS'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizePayee(raw)).toBe(expected);
  });
  it('makes display names', () => {
    expect(prettyPayee('POS PURCHASE PUBLIX #1432 TAMPA FL')).toBe('Publix Tampa FL');
    expect(prettyPayee('SSA TREAS 310 XXSOC SEC')).toBe('SSA Treas Soc Sec');
  });
  it('suggests short patterns without trailing state', () => {
    expect(suggestPattern('POS PURCHASE PUBLIX #1432 TAMPA FL')).toBe('PUBLIX TAMPA');
    expect(suggestPattern('DUKE ENERGY PAYMENT')).toBe('DUKE ENERGY');
    expect(suggestPattern('Walgreens #04512 OH')).toBe('WALGREENS');
  });
});

describe('matchRule', () => {
  const rules: PayeeRule[] = [
    { id: '1', pattern: 'PUBLIX', category: 'food', direction: 'out' },
    { id: '2', pattern: 'PUBLIX PHARMACY', category: 'medical', direction: 'out' },
    { id: '3', pattern: 'SOC SEC', category: 'benefits_ssa', direction: 'in' },
  ];
  it('prefers the longest pattern', () => {
    expect(matchRule(rules, 'PUBLIX #12 TAMPA', -1000)?.category).toBe('food');
    expect(matchRule(rules, 'PUBLIX PHARMACY #12', -1000)?.category).toBe('medical');
  });
  it('respects direction', () => {
    expect(matchRule(rules, 'PUBLIX REFUND', 500)).toBeUndefined();
    expect(matchRule(rules, 'SSA TREAS 310 SOC SEC', 94300)?.category).toBe('benefits_ssa');
    expect(matchRule(rules, 'SSA TREAS 310 SOC SEC', -100)).toBeUndefined();
  });
  it('matches whole words only', () => {
    expect(
      matchRule(
        [{ id: 'x', pattern: 'RENT', category: 'housing', direction: 'any' }],
        'PARENTS GIFT',
        -100,
      ),
    ).toBeUndefined();
    expect(
      matchRule(
        [{ id: 'x', pattern: 'RENT', category: 'housing', direction: 'any' }],
        'MAY RENT',
        -100,
      )?.category,
    ).toBe('housing');
  });
});
