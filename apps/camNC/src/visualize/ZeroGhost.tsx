import { getCncApi } from '@/lib/fluidnc/machine';
import { zeroGhost } from '@/lib/machine/workflow';
import { CanvasLabel } from '@/scene/CanvasLabel';
import { useMachineBusy } from '@/cam/machine/useMachineBusy';
import { useStore } from '@/store/store';
import { Line } from '@react-three/drei';

const kColor = '#f59e0b';
const kPastColor = '#ef4444';
const noRaycast = () => null;

/** Dashed outline of where the program would really run from the zero on the controller, when that isn't where it's placed. */
export function ZeroGhost() {
  'use no memo';
  const api = getCncApi();
  const toolpath = useStore(s => s.toolpath);
  const toolpathOffset = useStore(s => s.toolpathOffset);
  const busy = useMachineBusy();
  const workOffset = api.status.value?.wco;
  if (!toolpath || !workOffset || !api.isConnected.value || busy) return null;
  const ghost = zeroGhost({ toolpathBounds: toolpath.getBounds(), workOffset, toolpathOffset, travel: api.travel.value });
  if (!ghost) return null;
  const { min, max, past, label } = ghost;
  const corners: [number, number][] = [
    [min.x, min.y],
    [min.x, max.y],
    [max.x, max.y],
    [max.x, min.y],
    [min.x, min.y],
  ];
  return (
    <group>
      <Line
        raycast={noRaycast}
        depthTest={false}
        renderOrder={1001}
        points={corners}
        color={kColor}
        lineWidth={2}
        dashed
        dashSize={8}
        gapSize={6}
      />
      {past.map((p, i) => (
        <mesh key={i} raycast={noRaycast} renderOrder={1000} position={[(p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, 0]}>
          <planeGeometry args={[p.max.x - p.min.x, p.max.y - p.min.y]} />
          <meshBasicMaterial color={kPastColor} transparent opacity={0.35} depthTest={false} />
        </mesh>
      ))}
      <CanvasLabel position={[max.x, max.y, 0]} offset={[8, 8]} zIndexRange={[20, 0]}>
        <div className="rounded bg-background/90 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">{label}</div>
      </CanvasLabel>
    </group>
  );
}
