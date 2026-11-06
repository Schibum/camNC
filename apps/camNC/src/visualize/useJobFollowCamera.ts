import { getCncApi } from '@/lib/fluidnc/machine';
import { isJobOfToolpath } from '@/lib/machine/jobs';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, TOUCH, Vector3 } from 'three';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { getStockFootprint } from './depthInspection';
import { useDepthView, useZeroPlacement } from './depthViewStore';
import { ParsedToolpath } from './gcodeParsing';
import { getJobParts, PartShotFollower, partAt } from './jobFollow';
import { currentPlayhead } from './stockSim/jobTimeline';
import { useJobProgressSplit } from './useJobProgressSplit';

/** Whether the camNC job of `toolpath` is running. */
export function useJobActive(toolpath: ParsedToolpath) {
  'use no memo';
  const job = getCncApi().jobProgress.value;
  return !!job && isJobOfToolpath(job.file, toolpath.gcode);
}

/** Each job starts out followed, whatever was done to the view during the last one. Once: not again after a view switch. */
export function useFollowEachJob(jobActive: boolean) {
  'use no memo';
  const startedAt = getCncApi().jobStartedAt.value;
  useEffect(() => {
    if (jobActive && startedAt !== null) useDepthView.getState().startFollowing(startedAt);
  }, [jobActive, startedAt]);
}

/**
 * While a job runs, keeps the 3D view's camera on the part being cut, or the one at the timeline's playhead when it
 * plays freely. Returns the step to call each frame, with `moved` when something else animates the camera.
 */
export function useJobFollowCamera(toolpath: ParsedToolpath, workOrigin: Vector3, enabled: boolean) {
  'use no memo';
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const get = useThree(s => s.get);
  const zScale = useDepthView(s => s.zScale);
  const { shift } = useZeroPlacement(toolpath);
  const jobActive = useJobActive(toolpath);
  useFollowEachJob(jobActive);
  const followCamera = useDepthView(s => s.followCamera);
  const split = useJobProgressSplit(toolpath);
  const parts = useMemo(() => getJobParts(toolpath, shift), [toolpath, shift]);
  const footprint = useMemo(() => getStockFootprint(toolpath), [toolpath]);
  const follower = useMemo(() => (controls ? new PartShotFollower(camera, controls) : null), [camera, controls]);
  const worldBox = useRef(new Box3());
  const { setFollowCamera, setFollowCustomView } = useDepthView.getState();

  // Fingers never hold a pinch still: its drift would count as a pan, and stop following on every zoom.
  useEffect(() => {
    if (!controls || !enabled || !jobActive || !followCamera) return;
    const { TWO } = controls.touches;
    controls.touches.TWO = TOUCH.DOLLY_ROTATE;
    return () => {
      controls.touches.TWO = TWO;
    };
  }, [controls, enabled, jobActive, followCamera]);

  return (dt: number, moved: boolean) => {
    if (!follower) return;
    const { followCamera, followCustomView, simEnabled, simFollowJob } = useDepthView.getState();
    if (moved || !enabled || !jobActive || !followCamera) return follower.skip();
    const index = simEnabled && !simFollowJob ? currentPlayhead(toolpath).index : (split?.index ?? 0);
    const part = partAt(parts, index);
    if (!part) return follower.skip();
    // Scene coordinates: Z relative to the stock top, scaled. Above the cut, the stock top stays in frame.
    worldBox.current.min.set(part.box.min.x, part.box.min.y, (part.box.min.z + shift) * zScale).add(workOrigin);
    worldBox.current.max.set(part.box.max.x, part.box.max.y, 0).add(workOrigin);
    const { width, height } = get().size;
    follower.step({
      worldBox: worldBox.current,
      partBox: part.box,
      footprint,
      width,
      height,
      dt,
      customView: followCustomView,
      onPan: () => setFollowCamera(false),
      onCustomView: () => setFollowCustomView(true),
    });
    get().invalidate();
  };
}
