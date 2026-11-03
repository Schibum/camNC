import { useStore } from '@/store/store';
import { Line } from '@react-three/drei';
import { kJobDoneColor } from './jobProgress';
import { useJobProgressSplit } from './useJobProgressSplit';

/** Draws the part of the loaded toolpath that the running camNC job has already done, up to the tool. */
export function JobProgressPath() {
  'use no memo';
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const progress = useJobProgressSplit(toolpath);
  if (!toolpath || !progress) return null;
  const done = [...toolpath.pathPoints.slice(0, progress.index), progress.point];
  if (done.length < 2) return null;
  const points = done.map(p => [p.x + offset.x, p.y + offset.y, 25] as [number, number, number]);
  return <Line points={points} color={kJobDoneColor} linewidth={3} transparent opacity={0.8} depthTest={false} renderOrder={900} />;
}
