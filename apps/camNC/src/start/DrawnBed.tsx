import type { MachineBoundsValues } from '@/setup/MachineBoundsForm';
import { gridLines, kBedColors } from '@/visualize/machineBedGrid';

function gridPath({ xmin, xmax, ymin, ymax }: MachineBoundsValues, step: number) {
  // Screen coordinates of the top view: +X up, +Y left (see kTopViewCameraRotation).
  const toScreen = (x: number, y: number) => `${ymax - y} ${xmax - x}`;
  const across = gridLines(xmin, xmax, step).map(x => `M${toScreen(x, ymin)}L${toScreen(x, ymax)}`);
  const along = gridLines(ymin, ymax, step).map(y => `M${toScreen(xmin, y)}L${toScreen(xmax, y)}`);
  return across.concat(along).join('');
}

/** The bed as the top view will draw it, same grid and orientation, for choosing its size before it is saved. */
export function DrawnBed({ bounds, className }: { bounds: MachineBoundsValues; className?: string }) {
  const width = bounds.ymax - bounds.ymin;
  const height = bounds.xmax - bounds.xmin;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
      data-testid="drawn-bed"
      style={{ pointerEvents: 'none' }}>
      <rect width={width} height={height} fill={kBedColors.fill} />
      <path d={gridPath(bounds, 10)} stroke={kBedColors.minor} strokeWidth={0.5} vectorEffect="non-scaling-stroke" fill="none" />
      <path d={gridPath(bounds, 100)} stroke={kBedColors.major} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
    </svg>
  );
}
