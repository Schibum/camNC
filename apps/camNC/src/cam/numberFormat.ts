/**
 * A number as typed in a CAM field: dot or comma decimals ("0.3", "0,3"), nothing else. NaN for anything that isn't
 * a plain number, so "3 mm" or "1e3" are errors instead of being read as 3 or 1000.
 */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/** A number for a CAM field: always a dot, at most `digits` decimals, no trailing zeros ("1.59", "0.3", "15000"). */
export const fmtDecimal = (v: number, digits = 2) => `${+v.toFixed(digits)}`;

export interface NumberRange {
  min?: number;
  max?: number;
  /** `min` itself is not allowed (e.g. a feed must be > 0). */
  minExclusive?: boolean;
  integer?: boolean;
  /** Unit after the range in the error: "mm". */
  unit?: string;
}

/** Why `text` is no valid value, in words for the field's inline error; null when it is fine. */
export function numberProblem(text: string, { min, max, minExclusive, integer, unit }: NumberRange): string | null {
  const v = parseDecimal(text);
  const u = unit ? ` ${unit}` : '';
  const range =
    min !== undefined && max !== undefined
      ? `${fmtDecimal(min, 3)}–${fmtDecimal(max, 3)}${u}`
      : min !== undefined
        ? `${minExclusive ? 'more than' : 'at least'} ${fmtDecimal(min, 3)}${u}`
        : max !== undefined
          ? `at most ${fmtDecimal(max, 3)}${u}`
          : '';
  if (!Number.isFinite(v)) return `Enter a number${range ? `, ${range}` : ''}, with a dot for decimals.`;
  if (integer && !Number.isInteger(v)) return `Enter a whole number${range ? `, ${range}` : ''}.`;
  const low = min !== undefined && (minExclusive ? v <= min : v < min);
  const high = max !== undefined && v > max;
  if (low || high) return `${v} is out of range: ${range}.`;
  return null;
}
