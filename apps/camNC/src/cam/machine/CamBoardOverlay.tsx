import { getCncApi } from '@/lib/fluidnc/machine';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { useStore } from '@/store/store';
import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import { CamBedLayer, CamGhostBoards } from './CamBedLayer';
import { CamHolds } from './CamHolds';
import { currentTab, takeOutAt, useCamMachine } from './camMachine';

const kOutline = '#a78bfa';
const kTab = '#f59e0b';
const kHold = '#22c55e';

/** A label beside a marker: readable over the camera image at any zoom, never in the way of the pointer. */
function Label({ at, text, tone, big }: { at: { x: number; y: number }; text: string; tone: 'tab' | 'hold'; big?: boolean }) {
  return (
    <Html position={[at.x, at.y, 0.4]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
      <span
        className={`ml-3 block w-max max-w-56 rounded font-medium text-black shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${big ? '-mt-3.5 px-2 py-1 text-sm font-semibold' : '-mt-2.5 px-1.5 py-0.5 text-xs'} ${tone === 'tab' ? 'bg-amber-400' : 'bg-green-400'}`}>
        {text}
      </span>
    </Html>
  );
}

/** A ring round a spot on a part: green, the part to hold down; amber, the one to take out. */
function Ring({ at, tone }: { at: { x: number; y: number }; tone: 'tab' | 'hold' }) {
  return (
    <mesh position={[at.x, at.y, 0.3]}>
      <ringGeometry args={[14, 20, 48]} />
      <meshBasicMaterial color={tone === 'tab' ? kTab : kHold} transparent opacity={0.85} />
    </mesh>
  );
}

/**
 * In the top view, with the toolpath: the board's outline (dashed, turned like the program) to drag onto the board
 * in the camera image, and during guided tab removal the tabs, the next one highlighted with where to hold the part
 * (or, pausing once per part, the part's tabs being cut); while freeing skin parts the part being freed. Labelled.
 * Side A's screws and clamps too, to move, add or remove right there (`CamHolds`).
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
  // At a take-out pause: the part cut loose right after Resume, to hold down before pressing it.
  const nextFree = perPart.paused ? overlay.freeParts?.[perPart.part + 1] : undefined;
  const nextTabPart = perPart.paused && overlay.tabsPerPart ? tabParts[perPart.part + 1] : undefined;
  const firstOfNext = nextTabPart ? overlay.tabs?.find(t => t.part === nextTabPart) : undefined;
  return (
    <>
      <CamGhostBoards running={running} />
      <group position={[offset.x, offset.y, 0]}>
        <Line points={outline} color={kOutline} lineWidth={2} dashed dashSize={6} gapSize={4} />
        <CamBedLayer overlay={overlay} offset={offset} running={running} />
        <CamHolds overlay={overlay} offset={offset} running={running} />
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
            text={perPart.paused ? `① Take out ${cutting}` : `Cutting ${cutting}’s tabs, then take it out`}
            tone="tab"
            big={perPart.paused}
          />
        )}
        {firstOfNext && <Label at={firstOfNext.at} text={`② Next: ${nextTabPart}`} tone="hold" big />}
        {freeing && (
          <>
            <Ring at={freeing.at} tone={perPart.paused ? 'tab' : 'hold'} />
            <Label
              at={{ x: freeing.at.x + 18, y: freeing.at.y }}
              text={perPart.paused ? `① Take out ${freeing.name}` : `Freeing ${freeing.name}: hold it down`}
              tone={perPart.paused ? 'tab' : 'hold'}
              big={perPart.paused}
            />
          </>
        )}
        {nextFree && (
          <>
            <Ring at={nextFree.at} tone="hold" />
            <Label at={{ x: nextFree.at.x + 18, y: nextFree.at.y }} text={`② Hold ${nextFree.name} next`} tone="hold" big />
          </>
        )}
        {next && (
          <>
            <Ring at={next.hold} tone="hold" />
            <Label at={{ x: next.hold.x + 18, y: next.hold.y }} text="Hold here" tone="hold" />
          </>
        )}
      </group>
    </>
  );
}
