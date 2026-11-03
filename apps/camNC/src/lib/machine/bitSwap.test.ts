import { describe, expect, it } from 'vitest';
import { bitLongName, bitSwapAt, bitSwapTitle, zZeroIsStockBottom } from './bitSwap';
import { pauseHint } from './pauseHints';

/** Shape of a camNC board program with two bits. */
const camnc = [
  '(camNC CAM POC)',
  '(Z0 = stock bottom, X0 Y0 = lower left corner of the part)',
  '( Tools Table:)',
  '(  T1 D=3.175 CR=0 - ZMIN=-0.3 - flat end mill )',
  '(  T2 D=6 CR=0 - ZMIN=-0.3 - flat end mill )',
  '( )',
  'G21 G90 G94 G17',
  'G0 Z23',
  'M0 (MSG Insert T1 D=3.175, turn ON spindle 15000RPM)',
  '(OP 1/2 Slot - T1 D=3.175)',
  '(PASS 1/1 Z2)',
  'G0 X20 Y20',
  'G1 Z2 F300',
  'G1 X100 F1200',
  'G0 Z23',
  'M0 (MSG Spindle OFF. Change to T2 D=6, re-zero Z, spindle ON 15000RPM)',
  '(OP 2/2 Outline - T2 D=6)',
  'G0 X0 Y0',
  'G1 Z-0.3 F300',
].join('\n');

const lineOf = (gcode: string, text: string) => gcode.split('\n').findIndex(l => l.includes(text)) + 1;

describe('bitSwapAt', () => {
  it('reads the bits and speed of a camNC bit change', () => {
    expect(bitSwapAt(camnc, lineOf(camnc, 'Change to T2'))).toEqual({
      from: { tool: 1, diameter: 3.175, description: 'flat end mill' },
      to: { tool: 2, diameter: 6, description: 'flat end mill' },
      rpm: 15000,
    });
  });

  it('is null for a plain pause and for the first bit', () => {
    const plain = ['(T1 D=6 CR=0 - ZMIN=-1 - flat end mill)', 'G21', 'M0 (MSG Turn ON spindle 15000RPM)', 'G1 X1'].join('\n');
    expect(bitSwapAt(plain, 3)).toBeNull();
    expect(bitSwapAt(camnc, lineOf(camnc, 'Insert T1'))).toBeNull();
    // Not a pause at all.
    expect(bitSwapAt(camnc, lineOf(camnc, 'OP 2/2'))).toBeNull();
    expect(bitSwapAt(camnc, 999)).toBeNull();
  });

  it('reads a Fusion-style tools table and falls back to its order without operation markers', () => {
    const fusion = [
      '%',
      '(Tools Table:)',
      '(  T7 D=6 CR=0 TAPER=30deg - ZMIN=-1.796 - chamfer mill )',
      '(T3 D=3.175 CR=0. - ZMIN=-4. - flat end mill)',
      'G21',
      'G1 X1',
      'M0 (MSG,Change to T3)',
      'G1 X2',
    ].join('\n');
    const swap = bitSwapAt(fusion, 7);
    expect(swap).toEqual({
      from: { tool: 7, diameter: 6, description: 'chamfer mill' },
      to: { tool: 3, diameter: 3.175, description: 'flat end mill' },
    });
    expect(bitSwapTitle(swap!)).toBe('Swap bit: 6 mm chamfer → 3.175 mm flat');
  });

  it('takes the tool from a T word and reads semicolon tables', () => {
    const gcode = [';  T3 D=6 CR=0 - ZMIN=-19.5 - flat end mill', 'T5 M6', 'G1 X1', 'M0 (MSG swap to T3, then resume)'].join('\n');
    expect(bitSwapAt(gcode, 4)).toEqual({ from: { tool: 5 }, to: { tool: 3, diameter: 6, description: 'flat end mill' } });
  });

  it('names the bits for the dialog', () => {
    const swap = bitSwapAt(camnc, lineOf(camnc, 'Change to T2'))!;
    expect(bitSwapTitle(swap)).toBe('Swap bit: 3.175 mm → 6 mm flat');
    expect(bitLongName(swap.to)).toBe('6 mm flat end mill');
    expect(bitSwapTitle({ to: { tool: 4 } })).toBe('Swap bit: put in the T4');
    expect(bitLongName({ tool: 4, diameter: 2 })).toBe('2 mm bit');
  });

  it('tells camNC programs with Z0 at the stock bottom', () => {
    expect(zZeroIsStockBottom(camnc)).toBe(true);
    expect(zZeroIsStockBottom('(T1 D=6 - flat end mill)\nG21')).toBe(false);
  });

  it('finds the bit change from the SD progress even right after the first pause', () => {
    const percentAfter = (text: string) => {
      const end = camnc.indexOf('\n', camnc.indexOf(text)) + 1;
      return (100 * new TextEncoder().encode(camnc.slice(0, end)).length) / new TextEncoder().encode(camnc).length;
    };
    // Both pauses are within a few hundred bytes: each must still be told apart.
    expect(pauseHint(camnc, percentAfter('Insert T1'))?.line).toBe(lineOf(camnc, 'Insert T1'));
    const hint = pauseHint(camnc, percentAfter('Change to T2'));
    expect(hint?.line).toBe(lineOf(camnc, 'Change to T2'));
    expect(bitSwapAt(camnc, hint!.line)?.to.tool).toBe(2);
  });
});
