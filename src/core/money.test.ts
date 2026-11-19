import { describe, expect, it } from 'vitest';
import { formatAmountPlain, formatMoney, parseMoney } from './money';

describe('parseMoney', () => {
  it.each([
    ['12.34', 1234],
    ['$1,234.56', 123456],
    ['-12.30', -1230],
    ['(12.30)', -1230],
    ['($1,000.00)', -100000],
    ['12.30-', -1230],
    ['12.30 CR', 1230],
    ['12.30 DR', -1230],
    ['1.234,56', 123456],
    ['12,34', 1234],
    ['1,234', 123400],
    ['  $ 7 ', 700],
    ['+5.5', 550],
    ['0.005', 1],
    ['USD 10.00', 1000],
    ['−12.00', -1200],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('accepts numbers', () => {
    expect(parseMoney(12.345)).toBe(1235);
    expect(parseMoney(-0.1)).toBe(-10);
  });

  it.each(['', 'abc', '--', null, undefined, '1.2.3'])('rejects %s', (input) => {
    expect(parseMoney(input as string)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats currency', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-500)).toBe('-$5.00');
    expect(formatMoney(500, { sign: true })).toBe('+$5.00');
    expect(formatMoney(-500, { absolute: true })).toBe('$5.00');
  });
  it('formats plain amounts', () => {
    expect(formatAmountPlain(123456)).toBe('1,234.56');
    expect(formatAmountPlain(-5)).toBe('(0.05)');
    expect(formatAmountPlain(-5, false)).toBe('-0.05');
  });
});
