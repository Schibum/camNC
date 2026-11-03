import type { PlanResult } from '../camTypes';

/** Deep = blue, shallow = yellow, like the toolpath colors in the top view. */
function depthColor(z: number, top: number, bottom: number) {
  const t = Math.max(0, Math.min(1, (z - bottom) / (top - bottom || 1)));
  return `hsl(${230 - 170 * t} 80% ${38 + 18 * t}%)`;
}

/** Top view of the generated toolpath (cutting moves only), board outline dashed. */
export function ToolpathPreview({ plan, className }: { plan: PlanResult; className?: string }) {
  const [w, h, top] = plan.size;
  const pad = Math.max(w, h) * 0.04;
  const bottom = Math.min(0, ...plan.ops.map(o => o.zBottom));
  const stroke = Math.max(w, h) / 700;
  return (
    <svg viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`} className={className} role="img" aria-label="Toolpath, top view">
      <g transform="scale(1,-1)">
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="none"
          className="stroke-muted-foreground"
          strokeDasharray={`${stroke * 4} ${stroke * 4}`}
          strokeWidth={stroke}
        />
        {plan.path.map(([a, b], i) => (
          <line
            key={i}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={depthColor(Math.min(a[2], b[2]), top, bottom)}
            strokeWidth={stroke * 1.4}
            strokeLinecap="round"
          />
        ))}
      </g>
    </svg>
  );
}
