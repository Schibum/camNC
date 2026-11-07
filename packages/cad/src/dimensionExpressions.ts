/** Recognize an unambiguous literal in the dimension's base unit, without evaluating arithmetic. */
export function isBareBaseUnitLiteral(text: string, unit: 'mm' | 'deg', value: number): boolean {
  if (!Number.isFinite(value) || /,\d{3}(?!\d)/.test(text)) return false;
  const match = /^([+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[+-]?\d+)?)\s*(mm|deg|°)$/i.exec(text.trim().replaceAll('−', '-'));
  if (!match) return false;
  const suffix = match[2]!.toLowerCase();
  if (unit === 'mm' ? suffix !== 'mm' : suffix !== 'deg' && suffix !== '°') return false;
  const numeric = match[1]!.replace(',', '.'),
    parsed = Number(numeric);
  if (!Number.isFinite(parsed) || (parsed === 0 && /[1-9]/.test(numeric.split(/e/i)[0]!))) return false;
  return Math.abs(parsed - value) <= 1e-12 * Math.max(1, Math.abs(parsed), Math.abs(value));
}
