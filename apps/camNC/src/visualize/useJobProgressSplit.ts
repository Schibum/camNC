import { getCncApi } from '@/lib/fluidnc/machine';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { useStore } from '@/store/store';
import { useMemo } from 'react';
import { Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';
import { motionLineEnds, progressPointIndex, ProgressSplit, snapProgressToTool } from './jobProgress';

/**
 * Where the running camNC job is on `toolpath`, snapped to the tool's reported position, or null when no job of
 * this toolpath runs. Positions are in toolpath (work) coordinates.
 */
export function useJobProgressSplit(toolpath: ParsedToolpath | null): ProgressSplit | null {
  'use no memo';
  const api = getCncApi();
  const job = api.jobProgress.value;
  const mpos = api.machinePos.value;
  const wcoZ = api.status.value?.wco.z ?? 0;
  const offset = useStore(s => s.toolpathOffset);
  const lineEnds = useMemo(() => (toolpath ? motionLineEnds(toolpath.gcode) : []), [toolpath]);
  // Only the file camNC uploaded corresponds to the loaded toolpath.
  if (!toolpath || !job || !isCamncJobFile(job.file)) return null;
  const readIndex = progressPointIndex(toolpath, lineEnds, job.percent);
  // Same placement as the tool marker: XY relative to where the toolpath sits on the bed, Z in work coordinates.
  const tool = mpos ? new Vector3(mpos.x - offset.x, mpos.y - offset.y, mpos.z - wcoZ) : null;
  return snapProgressToTool(toolpath.pathPoints, readIndex, tool);
}
