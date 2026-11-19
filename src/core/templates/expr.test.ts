import { describe, expect, it } from 'vitest';
import { evalExpr, identifiers, parseExpr } from './expr';

const vars: Record<string, number | string> = { a: 10, b: 3, 'x.y': 5, name: 'Rosa', yes: 'yes' };
const resolve = (n: string) => {
  if (!(n in vars)) throw new Error(`unknown ${n}`);
  return vars[n];
};

describe('expressions', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['a - b - 1', 6],
    ['-a + x.y', -5],
    ['a / 4', 2.5],
    ['a / 0', 0],
    ['a % b', 1],
    ['max(a, b, 42)', 42],
    ['min(a, b)', 3],
    ['abs(b - a)', 7],
    ['round(2.5)', 3],
    ['floor(2.7) + ceil(2.1)', 5],
    ['dollars(25)', 2500],
    ['a > b ? 1 : 2', 1],
    ['if(a < b, 1, 2)', 2],
    ['a == 10 && b != 4', true],
    ['!(a == 10) || b >= 3', true],
    ['name == "Rosa"', true],
    ["yes == 'yes'", true],
    ['true + true', 2],
  ])('%s', (src, expected) => {
    expect(evalExpr(src, resolve)).toBe(expected);
  });

  it('collects identifiers', () => {
    expect([...identifiers(parseExpr('max(a.b, c) + -d ? e : f'))].sort()).toEqual([
      'a.b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it.each(['1 +', '(1', 'foo(1)', '1 $ 2', '"abc', '1 2'])('rejects %s', (src) => {
    expect(() => parseExpr(src)).toThrow();
  });
});
