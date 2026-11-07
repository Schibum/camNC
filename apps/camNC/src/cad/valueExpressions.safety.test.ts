import { describe, expect, it } from 'vitest';
import { parseCadValue } from './valueExpressions';

describe('dimension input ambiguity and numeric bounds', () => {
  it.each([
    ['3 1/2 in', 88.9],
    ['10 CM', 100],
    ['10MM', 10],
    ['1 IN', 25.4],
    ['2 inches', 50.8],
    ['5"', 127],
    ['5″', 127],
  ] as const)('accepts the unambiguous length form %s', (text, expected) => {
    const result = parseCadValue(text);
    expect('value' in result ? result.value : result.error).toBeCloseTo(expected, 10);
  });

  it('accepts uppercase angle units', () => {
    expect(parseCadValue('45 DEG', { unit: 'deg' })).toMatchObject({ value: 45 });
  });

  it('keeps a mixed fraction atomic under a sign and preserves its entered expression', () => {
    const negative = parseCadValue('-3 1/2 IN');
    expect(negative).toMatchObject({ expression: '-3 1/2 IN' });
    expect('value' in negative ? negative.value : NaN).toBeCloseTo(-88.9, 10);
    expect(parseCadValue('(3 1/2 + 1/2)in')).toMatchObject({ value: 101.6 });
    expect(parseCadValue('2 INCHES')).toMatchObject({ value: 50.8 });
  });

  it('retains mixed-fraction limits and dimensional safety', () => {
    for (const text of ['3 1/0 in', '100001 1/2mm', '99999 1/2in', '3 1/2M', '3 1/2in+1', '2"*3"'])
      expect(parseCadValue(text), text).toHaveProperty('error');
    expect(parseCadValue('99999 1/2mm')).toMatchObject({ value: 99999.5 });
    expect(parseCadValue('1in+1mm')).toMatchObject({ value: 26.4 });
    expect(parseCadValue('(1+1)in')).toMatchObject({ value: 50.8 });
  });

  it.each([',125', '0,125', '12,375', '1in+1', '1+1in', '1rad+1'])('rejects the ambiguous input %s consistently', text => {
    expect(parseCadValue(text, { unit: text.includes('rad') ? 'deg' : 'mm' })).toHaveProperty('error');
  });

  it.each(['1,000', '12,345', '0,125', '10mm/2in', '1in/1mm', '1/2+1/4in', '5M'])(
    'rejects %s instead of silently assigning a different real dimension',
    text => {
      expect(parseCadValue(text)).toHaveProperty('error');
    }
  );

  it.each(['1e150', '1e308', '100001mm', '101m', '-100001', '1000000in'])(
    'rejects unsupported physical size %s before it can reach the solver',
    text => {
      expect(parseCadValue(text)).toHaveProperty('error');
    }
  );

  it('bounds angle and scalar inputs as well as length inputs', () => {
    expect(parseCadValue('1e150deg', { unit: 'deg' })).toHaveProperty('error');
    expect(parseCadValue('1e150', { unit: 'scalar' })).toHaveProperty('error');
  });

  it.each(['1e150 - 1e150 + 50', '1e150 / 1e150'])(
    'rejects extreme intermediate numbers in %s rather than relying on rounded cancellation',
    text => {
      expect(parseCadValue(text)).toHaveProperty('error');
    }
  );

  it('accepts explicit fractions and normal values at the supported physical boundary', () => {
    for (const text of ['1/2in + 1/4in', '(1/2 + 1/4)in']) {
      const parsed = parseCadValue(text);
      expect('value' in parsed ? parsed.value : NaN).toBeCloseTo(19.05, 10);
    }
    expect(parseCadValue('100m')).toMatchObject({ value: 100_000 });
    expect(parseCadValue('-100000mm')).toMatchObject({ value: -100_000 });
    expect(parseCadValue('18,5')).toMatchObject({ value: 18.5 });
  });
});
