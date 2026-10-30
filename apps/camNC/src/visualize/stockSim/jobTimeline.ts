import { ParsedToolpath } from '../gcodeParsing';
import { isRapidSegment } from '../depthInspection';
import { useDepthView } from '../depthViewStore';

/** Rapid rate (mm/min) used for G0 moves when the machine's is unknown. */
export const kDefaultRapidRate = 5000;
// Feed used for cutting moves before the first F word, so they still take time.
const kFallbackFeed = 1000;

/**
 * Estimated time (seconds) at which the tool reaches each path point, from the programmed feed rates and
 * `rapidRate` for G0 moves. Acceleration is ignored, so real jobs take somewhat longer.
 */
export function computeJobTimes(toolpath: ParsedToolpath, rapidRate = kDefaultRapidRate): Float64Array {
  const points = toolpath.pathPoints;
  const times = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const rapid = isRapidSegment(toolpath, i);
    const feed = rapid ? rapidRate : toolpath.feeds[i] || kFallbackFeed;
    times[i] = times[i - 1] + (points[i].distanceTo(points[i - 1]) / feed) * 60;
  }
  return times;
}

export interface Playhead {
  /** The segment ending at path point `index` is being cut; all segments before it are done. */
  index: number;
  /** Share of that segment done, 0 to 1. */
  fraction: number;
}

/** Where the tool is at time `t` (seconds). Past the end, the last segment is complete. */
export function playheadAt(times: Float64Array, t: number): Playhead {
  const n = times.length;
  if (n < 2) return { index: Math.max(n - 1, 0), fraction: 1 };
  if (t >= times[n - 1]) return { index: n - 1, fraction: 1 };
  // First point reached after t.
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  const span = times[lo] - times[lo - 1];
  return { index: lo, fraction: span > 0 ? Math.min(Math.max((t - times[lo - 1]) / span, 0), 1) : 1 };
}

export type TimelineMarkKind = 'tool' | 'depth';

export interface TimelineMark {
  time: number;
  kind: TimelineMarkKind;
  label: string;
}

/** Tool changes and the starts of new cut depths, to show as ticks on the timeline. */
export function getTimelineMarks(toolpath: ParsedToolpath, times: Float64Array, { minDepthStep = 0.05 } = {}): TimelineMark[] {
  const marks: TimelineMark[] = [];
  const points = toolpath.pathPoints;
  let tool = toolpath.modals[0]?.tool;
  let depth: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const nextTool = toolpath.modals[i]?.tool;
    if (nextTool !== tool) {
      tool = nextTool;
      marks.push({ time: times[i - 1], kind: 'tool', label: `Tool T${nextTool ?? '?'}` });
      depth = null;
    }
    if (isRapidSegment(toolpath, i)) continue;
    const p0 = points[i - 1];
    const p1 = points[i];
    // Horizontal cutting moves define the current depth.
    if (Math.abs(p1.z - p0.z) > 1e-6 || p0.equals(p1)) continue;
    if (depth === null || Math.abs(p1.z - depth) > minDepthStep) {
      depth = p1.z;
      marks.push({ time: times[i - 1], kind: 'depth', label: `Z ${p1.z.toFixed(2)}` });
    }
  }
  return marks;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export interface JobTimeline {
  times: Float64Array;
  total: number;
  marks: TimelineMark[];
}

const kMaxDepthMarks = 300;
const timelines = new WeakMap<ParsedToolpath, JobTimeline>();

/** Times and marks of a toolpath, computed once per toolpath. */
export function getJobTimeline(toolpath: ParsedToolpath): JobTimeline {
  let timeline = timelines.get(toolpath);
  if (!timeline) {
    const times = computeJobTimes(toolpath);
    let marks = getTimelineMarks(toolpath, times);
    // 3D finishing passes change depth all the time, ticks would only be noise.
    if (marks.filter(m => m.kind === 'depth').length > kMaxDepthMarks) marks = marks.filter(m => m.kind !== 'depth');
    timeline = { times, total: times[times.length - 1] ?? 0, marks };
    timelines.set(toolpath, timeline);
  }
  return timeline;
}

/** Playhead from the timeline state, at the end of the job when no time is set. Reads the store without subscribing. */
export function currentPlayhead(toolpath: ParsedToolpath): Playhead {
  const { times, total } = getJobTimeline(toolpath);
  const simTime = useDepthView.getState().simTime;
  return playheadAt(times, simTime ?? total);
}
