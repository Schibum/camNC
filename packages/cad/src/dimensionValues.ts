import type { CadDimension } from './types';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';

/** Shared numeric-domain validation for source parsing and dimension input. */
export function dimensionValueError(
  dimension: Pick<CadDimension, 'type'> & { driven?: boolean; sourceEntityId?: string },
  value: number
): string | null {
  if (!Number.isFinite(value)) return 'Dimensions must be finite numbers.';
  if (dimension.type === 'offset' && !dimension.driven && Math.abs(value) <= CAD_GEOMETRY_TOLERANCE)
    return 'An offset distance must not be zero.';
  if (
    (['radius', 'diameter'].includes(dimension.type) || (dimension.type === 'distance' && !dimension.driven)) &&
    value <= CAD_GEOMETRY_TOLERANCE
  )
    return 'This dimension must be greater than zero.';
  if (
    !dimension.driven &&
    dimension.sourceEntityId !== undefined &&
    (dimension.type === 'distanceX' || dimension.type === 'distanceY') &&
    Math.abs(value) <= CAD_GEOMETRY_TOLERANCE
  )
    return 'A line dimension must not be zero.';
  if (dimension.type === 'distance' && dimension.driven && value < 0) return 'A reference length must not be negative.';
  if (
    ['pointLineDistance', 'lineLineDistance', 'pointArcDistance', 'lineCircleDistance', 'circleCircleDistance'].includes(dimension.type) &&
    value < 0
  )
    return 'A normal distance must not be negative.';
  return null;
}
