import { describe, expect, it } from 'vitest';
import { cadValueHasUnit, formatCadValue, parseCadValue } from './valueExpressions';

function value(text: string, unit: 'mm' | 'deg' = 'mm') {
  const parsed = parseCadValue(text, { unit });
  if ('error' in parsed) throw new Error(`${text}: ${parsed.error}`);
  return parsed;
}

describe('CAD value expressions', () => {
  it.each(['2mm', '2 IN', '1/2in', '(20+30)mm', '45deg', '45°', '2mm+', '2in+(', '1e308mm', '3 1/0in', '@2mm'])(
    'detects an explicit unit while typing %s without evaluating its expression',
    text => {
      expect(cadValueHasUnit(text)).toBe(true);
    }
  );

  it.each(['', '2', '20+30', '1/2', '2mi', '5M', 'mmx', 'constructor', '2e3'])(
    'keeps a fixed unit hint for %s when the lexer finds no recognized unit',
    text => {
      expect(cadValueHasUnit(text)).toBe(false);
    }
  );

  it('accepts unitless conic-rho arithmetic without implying a length or angle', () => {
    expect(parseCadValue('1/2', { unit: 'scalar' })).toEqual({ value: 0.5, expression: '1/2' });
    expect(parseCadValue('(1 + 2) / 6', { unit: 'scalar' })).toEqual({ value: 0.5, expression: '(1 + 2) / 6' });
    expect(parseCadValue('0.7', { unit: 'scalar' })).toEqual({ value: 0.7 });
  });

  it('rejects every unit suffix in scalar mode instead of converting it into an accidental valid rho', () => {
    for (const text of ['0.01cm', '0.1mm', '1/2in', '1ft', '0.5deg', '0.01rad', '(1/2) mm'])
      expect(parseCadValue(text, { unit: 'scalar' }), text).toEqual({
        error: 'Use a unitless value; length and angle units are not accepted.',
      });
  });

  it('supports arithmetic precedence, signed values, fractions, parentheses and optional equals', () => {
    expect(value('20+30')).toEqual({ value: 50, expression: '20+30' });
    expect(value('=50')).toEqual({ value: 50, expression: '=50' });
    expect(value('  (20 + 30) * 2 - 10/4  ')).toEqual({ value: 97.5, expression: '(20 + 30) * 2 - 10/4' });
    expect(value('1/2').value).toBe(0.5);
    expect(value('2*-3').value).toBe(-6);
    expect(value('−2 × (3 + 4) ÷ 2').value).toBe(-7);
    expect(value('.5e2')).toEqual({ value: 50 });
    expect(value('-0')).toEqual({ value: 0 });
  });

  it('retains decimal-comma input in plain values, arithmetic and units', () => {
    expect(value('18,5')).toEqual({ value: 18.5 });
    expect(value(',5')).toEqual({ value: 0.5 });
    expect(value('1,5e2')).toEqual({ value: 150 });
    expect(value('1,5cm + 2,5mm')).toEqual({ value: 17.5, expression: '1,5cm + 2,5mm' });
    expect(parseCadValue('0,7', { unit: 'scalar' })).toEqual({ value: 0.7 });
    expect(parseCadValue('1,2,3')).toHaveProperty('error');
  });

  it('converts length units, including a whole fractional-inch literal rather than an inverse length', () => {
    expect(value('10cm').value).toBe(100);
    expect(value('0.2 m').value).toBe(200);
    expect(value('1/2in').value).toBe(12.7);
    expect(value('-1/2 inch').value).toBe(-12.7);
    expect(value('1 ft').value).toBe(304.8);
    expect(value('1in + 10mm').value).toBe(35.4);
    expect(value('2*3cm').value).toBe(60);
    expect(value('(1/2)in').value).toBe(12.7);
    expect(value('1in/2').value).toBe(12.7);
    expect(parseCadValue('1in/2in')).toHaveProperty('error');
  });

  it('uses the selected base unit for bare expressions and requires explicit units in mixed sums', () => {
    expect(value('3')).toEqual({ value: 3 });
    expect(parseCadValue('3')).toEqual({ value: 3 });
    expect(value('3', 'deg')).toEqual({ value: 3 });
    expect(parseCadValue('2 + 1in')).toHaveProperty('error');
    expect(parseCadValue('2 + 1rad', { unit: 'deg' })).toHaveProperty('error');
    expect(value('2mm + 1in').value).toBe(27.4);
    expect(value('2deg + 1rad', 'deg').value).toBeCloseTo(2 + 180 / Math.PI, 12);
  });

  it.each([
    ['2mm', 2],
    [' 2 mm ', 2],
    ['2MM', 2],
    ['2 mM', 2],
    ['.0001 mm', 0.0001],
    ['-2.5e-2 MM', -0.025],
    ['+0,25 mm', 0.25],
    ['2.e1mm', 20],
  ] as const)('stores the base-length literal %s without an expression marker', (text, expected) => {
    expect(parseCadValue(text)).toEqual({ value: expected });
  });

  it.each([
    ['45deg', 45],
    [' 45 DEG ', 45],
    ['-2.5e-2 dEg', -0.025],
    ['+.0001deg', 0.0001],
    ['90°', 90],
    ['  +.25 ° ', 0.25],
    ['-1e-2°', -0.01],
  ] as const)('stores the base-angle literal %s without an expression marker', (text, expected) => {
    expect(parseCadValue(text, { unit: 'deg' })).toEqual({ value: expected });
  });

  it('retains arithmetic and converted-unit expressions even when the result uses the base unit', () => {
    for (const text of ['20+30', '20mm+30mm', '2*3mm', '(2)mm', '=2mm', '1/2mm', '2 in', '2 cm'])
      expect(parseCadValue(text), text).toHaveProperty('expression', text);
    for (const text of ['20deg+30deg', '(45)deg', '=45deg', '1rad'])
      expect(parseCadValue(text, { unit: 'deg' }), text).toHaveProperty('expression', text);
  });

  it('converts degrees/radians and rejects incompatible length/angle units', () => {
    expect(value('180deg', 'deg').value).toBe(180);
    expect(value('90°', 'deg').value).toBe(90);
    expect(value('1rad', 'deg').value).toBeCloseTo(180 / Math.PI, 12);
    expect(value('(90 + 90) deg', 'deg').value).toBe(180);
    expect(parseCadValue('1rad', { unit: 'mm' })).toHaveProperty('error');
    expect(parseCadValue('1mm', { unit: 'deg' })).toHaveProperty('error');
    expect(parseCadValue('1mm*2mm')).toHaveProperty('error');
    expect(parseCadValue('1/(2in)')).toHaveProperty('error');
  });

  it('returns errors for invalid syntax, unknown names, zero division, overflow and underflow', () => {
    for (const text of [
      '',
      ' ',
      '=',
      '==50',
      '1+',
      '(2+3',
      '2+3)',
      '1..2',
      '2 3',
      '10cm + foo',
      'Math.max(1,2)',
      'globalThis.alert(1)',
      '2**3',
      '1/0',
      '0/0',
      '1e309',
      '1e-999',
      '1e-200*1e-200',
    ])
      expect(parseCadValue(text), text).toHaveProperty('error');
    expect(value('0e-999').value).toBe(0);
    expect(value('5e-324').value).toBe(Number.MIN_VALUE);
  });

  it('bounds expression size and recursion without evaluating arbitrary code', () => {
    expect(parseCadValue('('.repeat(40) + '1' + ')'.repeat(40))).toHaveProperty('error');
    expect(parseCadValue('1+'.repeat(300) + '1')).toHaveProperty('error');
    expect(parseCadValue('constructor.constructor("return 1")()')).toHaveProperty('error');
  });
});

describe('CAD value display', () => {
  it('rounds ordinary labels to three decimals without changing source precision', () => {
    const source = 12.3456789012345;
    expect(formatCadValue(source)).toBe('12.346');
    expect(String(source)).toBe('12.3456789012345');
    expect(formatCadValue(50)).toBe('50');
    expect(formatCadValue(1.2)).toBe('1.2');
    expect(formatCadValue(0)).toBe('0');
    expect(formatCadValue(-0)).toBe('0');
    expect(formatCadValue(-2.1238)).toBe('-2.124');
  });

  it('never rounds a representable nonzero small value to a zero label', () => {
    for (const number of [0.0009999, 0.0001, 0.000012345, 1e-7, -1e-9, 1e-30, Number.MIN_VALUE]) {
      const display = formatCadValue(number);
      expect(Number(display), display).not.toBe(0);
      expect(Number.isFinite(Number(display)), display).toBe(true);
    }
    expect(formatCadValue(0.00012345)).toBe('0.000123');
    expect(formatCadValue(1e-9)).toBe('1e-9');
  });

  it('preserves scientific exponents and gives a nonnumeric marker for nonfinite data', () => {
    expect(formatCadValue(1.234e30)).toBe('1.234e30');
    expect(formatCadValue(1e30)).toBe('1e30');
    expect(formatCadValue(Infinity)).toBe('—');
    expect(formatCadValue(NaN)).toBe('—');
  });
});
