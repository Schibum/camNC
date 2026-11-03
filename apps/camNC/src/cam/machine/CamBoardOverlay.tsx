import { getCncApi } from '@/lib/fluidnc/machine';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { useStore } from '@/store/store';
import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import { currentTab, takeOutAt, useCamMachine } from './camMachine';

const kOutline = '#a78bfa';
const kTab = '#f59e0b';
const kHold = '#22c55e';

/** A label beside a marker: readable over the camera image at any zoom, never in the way of the pointer. */
function Label({ at, text, tone }: { at: { x: number; y: number }; text: string; tone: 'tab' | 'hold' }) {
  return (
    <Html position={[at.x, at.y, 0.4]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
      <span
        className={`ml-3 -mt-2.5 block w-max max-w-48 rounded px-1.5 py-0.5 text-xs font-medium text-black shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${tone === 'tab' ? 'bg-amber-400' : 'bg-green-400'}`}>
        {text}
      </span>
    </Html>
  );
}

/**
 * In the top view, with the toolpath: the board's outline (dashed, turned like the program) to drag onto the board
 * in the camera image, and during guided tab removal the tabs, the next one highlighted with where to hold the part
 * (or, pausing once per part, the part's tabs being cut); while freeing skin parts the part being freed. Labelled.
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
  // Programs that pause per part (freeing skins, tabs per part): the part being cut, or paused to be taken out.
  const perPart = running ? takeOutAt(gcode!, job!.percent) : { part: 0, paused: false };
  const tabParts = [...new Set(overlay.tabs?.map(t => t.part))];
  const cutting = overlay.tabsPerPart ? tabParts[perPart.part] : undefined;
  const at = overlay.tabs && !overlay.tabsPerPart ? Math.max(1, running ? currentTab(gcode!, job!.percent) : 1) : 0;
  const next = overlay.tabs?.find(t => t.index === at);
  const current = (t: { index: number; part: string }) => (overlay.tabsPerPart ? t.part === cutting : t.index === at);
  const past = (t: { index: number; part: string }) => (overlay.tabsPerPart ? tabParts.indexOf(t.part) < perPart.part : t.index < at);
  const freeing = overlay.freeParts?.[perPart.part];
  const firstOfPart = overlay.tabs?.find(t => t.part === cutting);
  return (
    <group position={[offset.x, offset.y, 0]}>
      <Line points={outline} color={kOutline} lineWidth={2} dashed dashSize={6} gapSize={4} />
      {overlay.tabs?.map(t => (
        <mesh key={t.index} position={[t.at.x, t.at.y, 0.3]}>
          <boxGeometry args={current(t) ? [9, 9, 0.1] : [5, 5, 0.1]} />
          <meshBasicMaterial color={kTab} transparent opacity={past(t) ? 0.35 : 1} />
        </mesh>
      ))}
      {next && <Label at={next.at} text={`Next: tab ${next.index} of ${overlay.tabs!.length}`} tone="tab" />}
      {firstOfPart && (
        <Label
          at={firstOfPart.at}
          text={perPart.paused ? `Take out ${cutting}` : `Cutting ${cutting}’s tabs, then take it out`}
          tone="tab"
        />
      )}
      {freeing && (
        <>
          <mesh position={[freeing.at.x, freeing.at.y, 0.3]}>
            <ringGeometry args={[14, 20, 48]} />
            <meshBasicMaterial color={kHold} transparent opacity={0.85} />
          </mesh>
          <Label
            at={{ x: freeing.at.x + 18, y: freeing.at.y }}
            text={perPart.paused ? `Take out ${freeing.name}` : `Freeing ${freeing.name}`}
            tone="hold"
          />
        </>
      )}
      {next && (
        <>
          <mesh position={[next.hold.x, next.hold.y, 0.3]}>
            <ringGeometry args={[14, 20, 48]} />
            <meshBasicMaterial color={kHold} transparent opacity={0.85} />
          </mesh>
          <Label at={{ x: next.hold.x + 18, y: next.hold.y }} text="Hold here" tone="hold" />
        </>
      )}
    </group>
  );
}
