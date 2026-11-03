import { Box3, Vector3 } from 'three';
import { isRapidSegment } from '@/visualize/depthInspection';
import { ParsedToolpath, parseGCode } from '@/visualize/gcodeParsing';
import { getJobTimeline } from '@/visualize/stockSim/jobTimeline';
import type { PlanResult } from '../camTypes';
import { groupOps, type OpGroup } from '../plan/groupOps';
import { opColor } from './palette';

/** One operation of the program: its moves and when it runs. */
export interface PlanOp {
  /** Index into plan.ops (cut order). */
  index: number;
  /** Moves ending at path points from..to (inclusive) belong to this op. */
  from: number;
  to: number;
  /** Seconds into the board's program. */
  start: number;
  end: number;
  /** Index into PlanModel.groups. */
  group: number;
}

/** A row of the op list: identical ops shown once, in one color. */
export interface PlanOpGroup extends OpGroup {
  color: string;
}

export interface PlanModel {
  toolpath: ParsedToolpath;
  /** Seconds, whole program. */
  total: number;
  /** Time at each path point. */
  times: Float64Array;
  ops: PlanOp[];
  groups: PlanOpGroup[];
}

/** Toolpath point ranges per operation, from the `(OP i/n <name> - T<n> D=<d>)` markers the program carries. */
export function opRanges(gcode: string, toolpath: ParsedToolpath): { from: number; to: number }[] {
  const markers: number[] = [];
  gcode.split('\n').forEach((l, i) => {
    if (/^\(OP \d+\/\d+ .+ - T\d+ D=[\d.]+\)$/.test(l)) markers.push(i + 1);
  });
  return markers.map((line, k) => {
    const next = markers[k + 1] ?? Infinity;
    let from = -1;
    let to = -1;
    toolpath.lines.forEach((l, i) => {
      if (l > line && l < next) {
        if (from < 0) from = i;
        to = i;
      }
    });
    return { from: Math.max(1, from), to: Math.max(from, to, 1) };
  });
}

/** The board program's toolpath, its operations with their times, and the op list groups with their colors. */
export function buildPlanModel(plan: PlanResult): PlanModel {
  const toolpath = parseGCode(plan.gcode);
  const { times, total } = getJobTimeline(toolpath);
  const groups = groupOps(plan.ops).map((g, n) => ({ ...g, color: opColor(n) }));
  const groupOf = new Map(groups.flatMap((g, n) => g.members.map(m => [m, n] as const)));
  const ops = opRanges(plan.gcode, toolpath)
    .slice(0, plan.ops.length)
    .map((r, index) => ({
      index,
      ...r,
      start: times[r.from - 1] ?? 0,
      end: times[r.to] ?? total,
      group: groupOf.get(index) ?? 0,
    }));
  return { toolpath, total, times, ops, groups };
}

/** The ops of a group. */
export const groupOpsOf = (model: PlanModel, group: number) => model.ops.filter(o => o.group === group);

/** Path point index -> whether the move ending there is a cutting move of one of `ops`. */
export function cutsOf(toolpath: ParsedToolpath, ops: Pick<PlanOp, 'from' | 'to'>[]) {
  return (i: number) => !isRapidSegment(toolpath, i) && ops.some(o => i >= o.from && i <= o.to);
}

/**
 * What a set of ops cuts, as a box: their cutting moves widened by the bit radius (a 6 mm hole is 6 mm wide, not the
 * 2.8 mm the bit centre travels), no higher than the stock top. Null without cutting moves.
 */
export function cutBounds(toolpath: ParsedToolpath, ops: Pick<PlanOp, 'from' | 'to'>[], bitRadius: number, stockTop: number) {
  const box = new Box3();
  const points = toolpath.pathPoints;
  const cuts = cutsOf(toolpath, ops);
  for (const o of ops)
    for (let i = o.from; i <= o.to; i++) {
      if (!cuts(i)) continue;
      box.expandByPoint(points[i - 1]);
      box.expandByPoint(points[i]);
    }
  if (box.isEmpty()) return null;
  box.min.x -= bitRadius;
  box.min.y -= bitRadius;
  box.max.x += bitRadius;
  box.max.y += bitRadius;
  box.max.z = Math.min(box.max.z, stockTop);
  box.min.z = Math.min(box.min.z, box.max.z);
  return box;
}

/** A copy of the toolpath that only cuts with `ops`: every other move becomes a rapid, which the simulation skips. */
export function onlyOps(toolpath: ParsedToolpath, ops: Pick<PlanOp, 'from' | 'to'>[]) {
  const copy = new ParsedToolpath();
  const cuts = cutsOf(toolpath, ops);
  copy.pathPoints = toolpath.pathPoints;
  copy.feeds = toolpath.feeds;
  copy.lines = toolpath.lines;
  copy.modals = toolpath.modals.map((m, i) => (cuts(i) ? m : { ...m, motion: 'G0' }));
  return copy;
}

/** Board box: the stock from Z0 to its top. */
export const boardBox = (plan: PlanResult) => new Box3(new Vector3(0, 0, 0), new Vector3(...plan.size));

/**
 * Timeline layout: where each op's band sits, as fractions of the track. Bands are as wide as the time they take, but
 * at least `minWidth`, so a 6 s through hole in an hour-long program stays visible and clickable. The time between
 * ops keeps its real share. `knots` map time to position piecewise linearly, for the playhead.
 */
export function timelineLayout(ops: Pick<PlanOp, 'start' | 'end'>[], total: number, minWidth = 0.006) {
  const t = Math.max(total, 1e-6);
  const knots: { time: number; x: number }[] = [{ time: 0, x: 0 }];
  let x = 0;
  let time = 0;
  const add = (to: number, width: number) => {
    x += width;
    time = to;
    knots.push({ time, x });
  };
  const raw: { from: number; to: number }[] = [];
  for (const o of ops) {
    const start = Math.max(o.start, time);
    const end = Math.max(o.end, start);
    if (start > time) add(start, (start - time) / t);
    const from = x;
    add(end, Math.max((end - start) / t, minWidth));
    raw.push({ from, to: x });
  }
  if (t > time) add(t, (t - time) / t);
  const scale = 1 / Math.max(x, 1e-9);
  return {
    bands: raw.map(b => ({ left: b.from * scale, width: (b.to - b.from) * scale })),
    knots: knots.map(k => ({ time: k.time, x: k.x * scale })),
  };
}

export type TimelineKnots = ReturnType<typeof timelineLayout>['knots'];

/** Track position (0..1) of a time. */
export function timeToX(knots: TimelineKnots, time: number) {
  for (let i = 1; i < knots.length; i++) {
    const [a, b] = [knots[i - 1], knots[i]];
    if (time <= b.time) return b.time > a.time ? a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x) : b.x;
  }
  return knots.at(-1)?.x ?? 0;
}

/** Time at a track position (0..1). */
export function xToTime(knots: TimelineKnots, x: number) {
  for (let i = 1; i < knots.length; i++) {
    const [a, b] = [knots[i - 1], knots[i]];
    if (x <= b.x) return b.x > a.x ? a.time + ((x - a.x) / (b.x - a.x)) * (b.time - a.time) : a.time;
  }
  return knots.at(-1)?.time ?? 0;
}
