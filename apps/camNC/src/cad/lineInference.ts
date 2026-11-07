import type { CadPoint } from '@wbcnc/cad';

export type InferredLineAxis = 'horizontal' | 'vertical';

/** An axis can accompany tangency only when it describes the same direction before snapping. */
export function tangentLineAxis(tangent: CadPoint, start: CadPoint, rawEnd: CadPoint, pixelScale: number): InferredLineAxis | null {
  const length = Math.hypot(tangent.x, tangent.y);
  if (!Number.isFinite(length) || length < 1e-9 || !Number.isFinite(pixelScale) || pixelScale <= 0) return null;
  if (Math.abs(tangent.y) / length <= 1e-7 && Math.abs(rawEnd.y - start.y) * pixelScale <= 8) return 'horizontal';
  if (Math.abs(tangent.x) / length <= 1e-7 && Math.abs(rawEnd.x - start.x) * pixelScale <= 8) return 'vertical';
  return null;
}
