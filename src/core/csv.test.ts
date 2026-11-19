import { describe, expect, it } from 'vitest';
import { applyMapping, detectMapping, guessDateOrder, headerSignature, toCsv } from './csv';

describe('detectMapping', () => {
  it('maps a signed amount export with a header', () => {
    const text =
      'Date,Description,Amount,Balance\n03/03/2026,SSA TREAS 310 SOC SEC,"1,043.00","1,500.00"\n03/05/2026,PUBLIX #1432,-54.20,1445.80\n';
    const { mapping, confidence, rows } = detectMapping(text);
    expect(confidence).toBe('high');
    expect(mapping).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      balance: 3,
      hasHeader: true,
    });
    const parsed = applyMapping(rows, mapping);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      date: '2026-03-03',
      amount: 104300,
      description: 'SSA TREAS 310 SOC SEC',
      balance: 150000,
      errors: [],
    });
    expect(parsed[1].amount).toBe(-5420);
  });

  it('maps separate debit and credit columns with preamble rows', () => {
    const text = [
      'Account Name: Rep Payee Checking',
      'Account Number: XXXX1234',
      '',
      'Posting Date,Payee,Debit,Credit,Check Number,Memo',
      '2026-03-01,"RIVERSIDE APTS",850.00,,1043,March rent',
      '2026-03-03,"SOC SEC",,"1,043.00",,',
    ].join('\n');
    const { mapping, rows } = detectMapping(text);
    expect(mapping).toMatchObject({
      skipRows: 2,
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
      checkNumber: 4,
      memo: 5,
    });
    const parsed = applyMapping(rows, mapping);
    expect(parsed.map((p) => p.amount)).toEqual([-85000, 104300]);
    expect(parsed[0]).toMatchObject({ checkNumber: '1043', memo: 'March rent' });
  });

  it('infers columns for headerless exports', () => {
    const text =
      '"03/01/2026","-850.00","*","","RIVERSIDE APTS RENT"\n"03/03/2026","1043.00","*","","SSA TREAS 310 SOC SEC"\n';
    const { mapping, confidence, rows } = detectMapping(text);
    expect(confidence).toBe('medium');
    expect(mapping).toMatchObject({ hasHeader: false, date: 0, amount: 1, description: 4 });
    expect(applyMapping(rows, mapping)[1].amount).toBe(104300);
  });

  it('detects day-first dates', () => {
    expect(guessDateOrder(['01/02/2026', '25/02/2026'])).toBe('DMY');
    expect(guessDateOrder(['02/25/2026'])).toBe('MDY');
    expect(guessDateOrder(['2026-02-25'])).toBe('YMD');
  });

  it('reports row errors and supports inverting signs', () => {
    const text =
      'Date,Description,Amount\nnot a date,Thing,5.00\n03/01/2026,,abc\n03/02/2026,Coffee,4.50\n';
    const { mapping, rows } = detectMapping(text);
    const parsed = applyMapping(rows, { ...mapping, invert: true });
    expect(parsed[0].errors).toContain('Unreadable date "not a date"');
    expect(parsed[1].errors).toEqual(expect.arrayContaining(['No amount', 'No description']));
    expect(parsed[2].amount).toBe(-450);
  });

  it('builds header signatures and writes CSV', () => {
    expect(headerSignature([' Date', 'Amount '])).toBe('date|amount');
    expect(toCsv([['a,b', 1, null]])).toBe('"a,b",1,');
  });

  it('throws on empty files', () => {
    expect(() => detectMapping('')).toThrow();
  });
});
