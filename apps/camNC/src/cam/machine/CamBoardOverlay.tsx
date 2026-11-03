import { getCncApi } from '@/lib/fluidnc/machine';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { useStore } from '@/store/store';
import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { currentTab, partsTakenOut, useCamMachine } from './camMachine';

const kOutline = '#a78bfa';
const kTab = '#f59e0b';
const kHold = '#22c55e';

/**
 * In the top view, with the toolpath: the board's outline (dashed, turned like the program) to drag onto the board
 * in the camera image, and during guided tab removal the tabs, the next one highlighted with where to hold the part.
 */
export function CamBoardOverlay() {
  'use no memo';
  const overlay = useCamMachine(s => s.overlay);
  const offset = useStore(s => s.toolpathOffset);
  const gcode = useStore(s => s.toolpath?.gcode);
  const job = getCncApi().jobProgress.value;
  const outline = useMemo(() => {
    if (!overlay) return null;
    const a = (overlay.rotationDeg * Math.PI) / 180;
    const turn = ([x, y]: [number, number]): [number, number, number] => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
      0.2,
    ];
    return (
      [
        [0, 0],
        [overlay.w, 0],
        [overlay.w, overlay.h],
        [0, overlay.h],
        [0, 0],
      ] as [number, number][]
    ).map(turn);
  }, [overlay]);
  if (!overlay || !outline) return null;
  // The tab the program stops at next (1-based): from the job's progress, or the first before it runs.
  const running = !!gcode && !!job && isCamncJobFile(job.file);
  const at = overlay.tabs ? Math.max(1, running ? currentTab(gcode!, job!.percent) : 1) : 0;
  const next = overlay.tabs?.find(t => t.index === at);
  // Freeing skin parts: the part being cut free, then taken out (the pauses read so far).
  const freeing = overlay.freeParts?.[running ? partsTakenOut(gcode!, job!.percent) : 0];
  return (
    <group position={[offset.x, offset.y, 0]}>
      <Line points={outline} color={kOutline} lineWidth={2} dashed dashSize={6} gapSize={4} />
      {overlay.tabs?.map(t => (
        <mesh key={t.index} position={[t.at.x, t.at.y, 0.3]}>
          <boxGeometry args={t.index === at ? [9, 9, 0.1] : [5, 5, 0.1]} />
          <meshBasicMaterial color={kTab} transparent opacity={t.index < at ? 0.35 : 1} />
        </mesh>
      ))}
      {freeing && (
        <mesh position={[freeing.at.x, freeing.at.y, 0.3]}>
          <ringGeometry args={[14, 20, 48]} />
          <meshBasicMaterial color={kHold} transparent opacity={0.85} />
        </mesh>
      )}
      {next && (
        <mesh position={[next.hold.x, next.hold.y, 0.3]}>
          <ringGeometry args={[14, 20, 48]} />
          <meshBasicMaterial color={kHold} transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  );
}
