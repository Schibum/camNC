import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { kJobDoneColor, motionLineEnds, progressPointIndex } from './jobProgress';

/** Draws the part of the loaded toolpath that the running camNC job has already done. */
export function JobProgressPath() {
  'use no memo';
  const job = getCncApi().jobProgress.value;
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const lineEnds = useMemo(() => (toolpath ? motionLineEnds(toolpath.gcode) : []), [toolpath]);

  // Only the file camNC uploaded corresponds to the loaded toolpath.
  if (!toolpath || !job || !isCamncJobFile(job.file)) return null;
  const end = progressPointIndex(toolpath, lineEnds, job.percent);
  if (end < 2) return null;
  const points = toolpath.pathPoints.slice(0, end).map(p => [p.x + offset.x, p.y + offset.y, 25] as [number, number, number]);
  return <Line points={points} color={kJobDoneColor} linewidth={3} transparent opacity={0.8} depthTest={false} renderOrder={900} />;
}
