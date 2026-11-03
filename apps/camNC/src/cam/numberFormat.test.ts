import { describe, expect, it } from 'vitest';
import { fmtDecimal, numberProblem, parseDecimal } from './numberFormat';

describe('CAM number fields', () => {
  it('read dot and comma decimals, and nothing else', () => {
    expect(parseDecimal('0.3')).toBe(0.3);
    expect(parseDecimal(' 0,3 ')).toBe(0.3);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('12')).toBe(12);
    expect(parseDecimal('-1')).toBe(-1);
    for (const bad of ['', '3 mm', '1e3', '1.2.3', 'abc', '1,2,3']) expect(parseDecimal(bad)).toBeNaN();
  });

  it('always show a dot, whatever the locale', () => {
    expect(fmtDecimal(1.5875)).toBe('1.59');
    expect(fmtDecimal(0.3)).toBe('0.3');
    expect(fmtDecimal(15000)).toBe('15000');
  });

  it('say what is wrong with a value, with its range', () => {
    const cut = { min: 0, max: 2, unit: 'mm' };
    expect(numberProblem('0,5', cut)).toBeNull();
    expect(numberProblem('5', cut)).toBe('5 is out of range: 0–2 mm.');
    expect(numberProblem('-1', cut)).toBe('-1 is out of range: 0–2 mm.');
    expect(numberProblem('x', cut)).toBe('Enter a number, 0–2 mm, with a dot for decimals.');
    expect(numberProblem('0', { min: 0, minExclusive: true, unit: 'mm/min' })).toBe('0 is out of range: more than 0 mm/min.');
    expect(numberProblem('2.5', { min: 1, integer: true })).toBe('Enter a whole number, at least 1.');
  });
});
