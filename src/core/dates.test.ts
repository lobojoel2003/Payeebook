import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  formatDate,
  parseDate,
  periodEndFor,
} from './dates';

describe('parseDate', () => {
  it.each([
    ['2026-01-31', '2026-01-31'],
    ['2026/1/5', '2026-01-05'],
    ['01/31/2026', '2026-01-31'],
    ['1/5/26', '2026-01-05'],
    ['20260131', '2026-01-31'],
    ['20260131120000.000[-5:EST]', '2026-01-31'],
    ['Jan 31, 2026', '2026-01-31'],
    ['September 3 2025', '2025-09-03'],
    ['Sept 3, 2025', '2025-09-03'],
    ['31 Jan 2026', '2026-01-31'],
    ['31-Jan-26', '2026-01-31'],
    ['2026-01-31T10:00:00Z', '2026-01-31'],
    ['01/31/2026 09:15', '2026-01-31'],
  ])('parses %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('respects day-first order and swaps impossible dates', () => {
    expect(parseDate('05/01/2026', 'DMY')).toBe('2026-01-05');
    expect(parseDate('31/01/2026', 'MDY')).toBe('2026-01-31');
  });

  it.each(['', 'yesterday', '2026-02-30', '13/13/2026', '2026-13-01'])('rejects %s', (input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('adds days across months and leap years', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('adds months clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
  it('computes differences and period ends', () => {
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(periodEndFor('2025-07-01')).toBe('2026-06-30');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
  it('formats', () => {
    expect(formatDate('2026-03-04', 'long')).toBe('March 4, 2026');
    expect(formatDate('2026-03-04', 'us')).toBe('03/04/2026');
    expect(formatDate(null)).toBe('');
  });
});
