import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { isRapidSegment } from '@/visualize/depthInspection';
import type { ParsedToolpath } from '@/visualize/gcodeParsing';
import type { PlanModel, PlanOp } from './planModel';

type V3 = [number, number, number];

const kRapidColor = '#a1a1aa';

/** An op's moves as segment point pairs: cutting moves and rapids. */
function opSegments(toolpath: ParsedToolpath, op: PlanOp) {
  const points = toolpath.pathPoints;
  const cuts: V3[] = [];
  const rapids: V3[] = [];
  for (let i = op.from; i <= op.to; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (a.equals(b)) continue;
    (isRapidSegment(toolpath, i) ? rapids : cuts).push([a.x, a.y, a.z], [b.x, b.y, b.z]);
  }
  return { cuts, rapids };
}

/**
 * Every op's toolpath at its real depth, in its group's color. Hidden groups are left out; with one group isolated
 * the others fade to a trace. Rapids dashed, optional. `onTop` draws everything through the stock and part.
 */
export function ToolpathLayers({
  model,
  hidden,
  isolated,
  showRapids,
  onTop,
}: {
  model: PlanModel;
  hidden: ReadonlySet<number>;
  isolated: number | null;
  showRapids: boolean;
  onTop: boolean;
}) {
  const segments = useMemo(() => model.ops.map(op => opSegments(model.toolpath, op)), [model]);
  return (
    <group>
      {model.ops.map((op, i) => {
        if (hidden.has(op.group)) return null;
        const dim = isolated !== null && isolated !== op.group;
        const { cuts, rapids } = segments[i];
        const color = model.groups[op.group].color;
        return (
          <group key={op.index}>
            {cuts.length > 1 && (
              <Line
                segments
                points={cuts}
                color={color}
                lineWidth={dim ? 1 : 2}
                transparent
                opacity={dim ? 0.12 : 1}
                depthTest={!onTop}
                depthWrite={false}
                renderOrder={dim ? 2 : 3}
              />
            )}
            {showRapids && !dim && rapids.length > 1 && (
              <Line
                segments
                points={rapids}
                color={kRapidColor}
                lineWidth={1}
                dashed
                dashSize={2}
                gapSize={2}
                transparent
                opacity={0.55}
                depthTest={!onTop}
                depthWrite={false}
                renderOrder={2}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
