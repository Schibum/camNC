import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { cn } from '@wbcnc/ui/lib/utils';
import { useMemo, useState } from 'react';
import type { PocBoard } from './usePocBoard';
import { StockScene } from './variantCScene';
import { groupOps, viewFor } from './variantCUtil';

/** THROWAWAY concept C: before/after per op. Main 3D view plus a strip with one thumbnail per operation. */
export function VariantC({ board }: { board: PocBoard }) {
  const groups = useMemo(() => groupOps(board), [board]);
  // null: the finished part.
  const [selected, setSelected] = useState<number | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const view = useMemo(() => viewFor(board, 1.8, 35), [board]);
  const group = selected === null ? null : groups[selected];
  const totalMin = groups.reduce((s, g) => s + g.timeMin, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-[#161b24]">
        <Canvas
          key={board.plan.gcode.length}
          camera={{ position: view.position.toArray(), up: [0, 0, 1], fov: 35, near: 1, far: view.dist * 20 }}
          gl={{ antialias: true }}>
          <color attach="background" args={['#161b24']} />
          <StockScene board={board} groups={groups} selected={selected} showLines={showLines} onThumbnails={setThumbs} />
          <OrbitControls target={view.center} makeDefault />
        </Canvas>
        <div className="pointer-events-none absolute left-4 top-3 text-sm text-white/90">
          {group ? (
            <>
              <div className="font-medium">
                After step {selected! + 1}: {group.label}
                {group.count > 1 && ` (×${group.count})`}
              </div>
              <div className="text-white/60">
                <span className="mr-1 inline-block size-2.5 rounded-sm bg-orange-500 align-middle" /> material this step removes ·{' '}
                {group.timeMin.toFixed(1)} min
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">Finished part</div>
              <div className="text-white/60">
                {groups.length} steps · {totalMin.toFixed(1)} min · pick a step below to see what it cuts
              </div>
            </>
          )}
        </div>
        {group && (
          <label className="absolute right-4 top-3 flex items-center gap-1.5 rounded-md bg-black/40 px-2 py-1 text-xs text-white/80">
            <input type="checkbox" checked={showLines} onChange={e => setShowLines(e.target.checked)} /> toolpath
          </label>
        )}
      </div>
      <div className="flex shrink-0 gap-2 overflow-x-auto border-t bg-muted/40 p-2">
        <Thumb
          active={selected === null}
          onClick={() => setSelected(null)}
          title="Finished"
          subtitle={`all steps · ${totalMin.toFixed(1)} min`}
          img={thumbs[groups.length]}
        />
        {groups.map((g, i) => (
          <Thumb
            key={i}
            active={selected === i}
            onClick={() => setSelected(i)}
            title={`${i + 1}. ${g.label}${g.count > 1 ? ` ×${g.count}` : ''}`}
            subtitle={`${g.kind} · ${g.timeMin.toFixed(1)} min`}
            img={thumbs[i]}
          />
        ))}
      </div>
    </div>
  );
}

function Thumb(props: { active: boolean; onClick: () => void; title: string; subtitle: string; img?: string }) {
  return (
    <button
      type="button"
      data-testid="op-thumb"
      onClick={props.onClick}
      className={cn(
        'flex w-[200px] shrink-0 flex-col overflow-hidden rounded-md border bg-background text-left text-xs transition',
        props.active ? 'ring-2 ring-primary' : 'hover:border-foreground/40'
      )}>
      <div className="aspect-[8/5] w-full bg-[#161b24]">
        {props.img && <img src={props.img} alt="" className="size-full object-cover" />}
      </div>
      <div className="px-2 py-1">
        <div className="truncate font-medium">{props.title}</div>
        <div className="text-muted-foreground">{props.subtitle}</div>
      </div>
    </button>
  );
}
