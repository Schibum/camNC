import { cn } from '@wbcnc/ui/lib/utils';
import type { CamPartSummary, GeneratedJob, Outline2D } from './camTypes';

const toD = (paths: Outline2D) => paths.map(p => `M${p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`).join('');

/** Deeper = darker wood; the top surface is the lightest. */
function depthFill(z: number, thickness: number) {
  const t = Math.max(0, Math.min(1, z / thickness));
  return `hsl(30 ${35 + 20 * (1 - t)}% ${38 + 30 * t}%)`;
}

/** Same ramp as the toolpath view: deep = blue, shallow = yellow. */
function pathStroke(z: number, thickness: number) {
  const t = Math.max(0, Math.min(1, (z + 0.5) / (thickness + 0.5)));
  return `hsl(${230 - 170 * t} 85% ${35 + 20 * t}%)`;
}

/**
 * Top view of a flat part (y up): material, pockets shaded by depth, through holes, and optionally the generated
 * toolpath. With `dims` it shows width/height labels like a drawing.
 */
export function PartPreview({
  part,
  job,
  dims,
  className,
}: {
  part: CamPartSummary;
  job?: GeneratedJob;
  dims?: boolean;
  className?: string;
}) {
  const [w, h, t] = part.size;
  const pad = dims ? Math.max(w, h) * 0.08 : Math.max(w, h) * 0.03;
  const font = Math.max(w, h) * 0.035;
  // Flip y so +Y is up like the machine.
  return (
    <svg
      viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      className={cn('block', className)}
      preserveAspectRatio="xMidYMid meet">
      <g transform="scale(1,-1)">
        <path d={toD(part.outlines)} fill={depthFill(t, t)} stroke="hsl(30 30% 30%)" strokeWidth={Math.max(w, h) * 0.002} />
        {part.pockets.map(p => (
          <path key={p.z} d={toD(p.region)} fill={depthFill(p.z, t)} fillRule="evenodd" />
        ))}
        <path d={toD(part.holes)} className="fill-background" />
        {job?.path.map(([a, b], i) => (
          <line
            key={i}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={pathStroke(Math.min(a[2], b[2]), t)}
            strokeWidth={Math.max(w, h) * 0.0025}
            strokeLinecap="round"
          />
        ))}
      </g>
      {dims && (
        <g className="fill-muted-foreground" fontSize={font} fontFamily="ui-sans-serif, system-ui">
          <text x={w / 2} y={pad * 0.55} textAnchor="middle">
            {fmtMm(w)}
          </text>
          <text x={-pad * 0.35} y={-h / 2} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.35} ${-h / 2})`}>
            {fmtMm(h)}
          </text>
        </g>
      )}
    </svg>
  );
}

export const fmtMm = (v: number) => `${+v.toFixed(1)} mm`;
