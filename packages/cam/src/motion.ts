import type { Vec3 } from './geom';

export const MOTION_ROLES = ['approach', 'plunge', 'ramp', 'lead-in', 'cut', 'corner', 'finish', 'lead-out', 'link', 'tab'] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

export interface CornerFeedSettings {
  factor: number;
  minAngleDeg: number;
  /** Small-radius curves also qualify when their accumulated turn exceeds minAngleDeg. */
  maxRadius: number;
  /** Length before and after a qualifying turn to reduce, measured along the programmed path. */
  distance: number;
}

export interface MotionPath {
  pts: Vec3[];
  feeds: number[];
  /** Role of the move ending at each point; index zero describes the approach or link. */
  roles?: MotionRole[];
  link?: 'direct' | 'retract';
}

export interface FeedPolicy {
  plungeFeed: number;
  rampFeed: number;
  leadFeed: number;
  leadOutFeed?: number;
  transitionFeed?: number;
  reducedFeed?: number;
  materialSide?: 'left' | 'right';
  cornerFeed?: CornerFeedSettings | false;
}

const cutting = (role: MotionRole) => role === 'cut' || role === 'finish';
const xy = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Feed scheduling changes only segment endpoints along existing lines, never the path's geometry. */
export function applyFeedPolicy<T extends MotionPath>(
  pass: T,
  policy: FeedPolicy,
  defaultRole: MotionRole = 'cut'
): T & { roles: MotionRole[] } {
  const roles = pass.pts.map((p, i): MotionRole => {
    if (pass.roles?.[i]) return pass.roles[i];
    if (!i) return pass.link === 'direct' ? 'link' : 'approach';
    const a = pass.pts[i - 1];
    if (p[2] < a[2] - 1e-8) return xy(a, p) > 1e-8 ? 'ramp' : 'plunge';
    return defaultRole;
  });
  const feeds = pass.feeds.map((feed, i) => {
    if (roles[i] === 'ramp') return policy.rampFeed;
    if (roles[i] === 'plunge' || roles[i] === 'approach') return policy.plungeFeed;
    if (roles[i] === 'lead-in') return policy.leadFeed;
    if (roles[i] === 'lead-out') return policy.leadOutFeed ?? policy.leadFeed;
    if (roles[i] === 'link') return policy.transitionFeed ?? feed;
    return feed;
  });
  const result = { ...pass, pts: [...pass.pts], feeds, roles };
  const settings = policy.cornerFeed;
  if (!settings || !policy.materialSide || pass.pts.length < 3) return result;

  const pts = pass.pts;
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1] + xy(pts[i - 1], pts[i]));
  const total = cumulative.at(-1)!;
  if (total < 1e-8) return result;
  const closed = xy(pts[0], pts.at(-1)!) < 1e-7 && Math.abs(pts[0][2] - pts.at(-1)![2]) < 1e-7;
  const sign = policy.materialSide === 'right' ? 1 : -1;
  const turns: { at: number; angle: number; radius: number }[] = [];
  for (let i = closed ? 0 : 1; i < pts.length - 1; i++) {
    const a = pts[i ? i - 1 : pts.length - 2],
      b = pts[i],
      c = pts[i + 1];
    if (!cutting(roles[i || pts.length - 1]) || !cutting(roles[i + 1])) continue;
    if (Math.abs(a[2] - b[2]) > 1e-7 || Math.abs(c[2] - b[2]) > 1e-7) continue;
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      vx = c[0] - b[0],
      vy = c[1] - b[1];
    const l1 = Math.hypot(ux, uy),
      l2 = Math.hypot(vx, vy);
    if (l1 < 1e-8 || l2 < 1e-8) continue;
    const cross = ux * vy - uy * vx;
    const angle = sign * Math.atan2(cross, ux * vx + uy * vy);
    if (Math.abs(angle) <= 1e-7) continue;
    const radius = Math.abs(cross) > 1e-12 ? (l1 * l2 * xy(a, c)) / (2 * Math.abs(cross)) : Infinity;
    turns.push({ at: cumulative[i], angle, radius });
  }
  const threshold = (settings.minAngleDeg * Math.PI) / 180;
  const intervals: [number, number][] = [];
  for (const turn of turns) {
    if (turn.angle <= 0) continue;
    const accumulated = turns.reduce((sum, other) => {
      const d = Math.abs(turn.at - other.at);
      return sum + ((closed ? Math.min(d, total - d) : d) <= settings.distance ? other.angle : 0);
    }, 0);
    if (turn.angle < threshold && !(turn.radius <= settings.maxRadius && accumulated >= threshold)) continue;
    intervals.push([Math.max(0, turn.at - settings.distance), Math.min(total, turn.at + settings.distance)]);
    if (closed && turn.at < settings.distance) intervals.push([total + turn.at - settings.distance, total]);
    if (closed && total - turn.at < settings.distance) intervals.push([0, turn.at + settings.distance - total]);
  }
  if (!intervals.length) return result;
  const limits = [...new Set(intervals.flat())].sort((a, b) => a - b);
  const outPts: Vec3[] = [pts[0]];
  const outFeeds = [feeds[0]],
    outRoles = [roles[0]];
  for (let i = 1; i < pts.length; i++) {
    const start = cumulative[i - 1],
      end = cumulative[i],
      len = end - start;
    if (len < 1e-9) {
      outPts.push(pts[i]);
      outFeeds.push(feeds[i]);
      outRoles.push(roles[i]);
      continue;
    }
    const cuts = [...limits.filter(s => s > start + 1e-8 && s < end - 1e-8), end];
    let previous = start;
    for (const at of cuts) {
      const t = (at - start) / len;
      const p: Vec3 = at === end ? [...pts[i]] : (pts[i - 1].map((v, axis) => v + t * (pts[i][axis] - v)) as Vec3);
      const middle = (previous + at) / 2;
      const reduce = cutting(roles[i]) && intervals.some(([a, b]) => middle >= a && middle <= b);
      outPts.push(p);
      outFeeds.push(reduce ? Math.min(feeds[i], policy.reducedFeed ?? feeds[i] * settings.factor) : feeds[i]);
      outRoles.push(reduce ? 'corner' : roles[i]);
      previous = at;
    }
  }
  return { ...pass, pts: outPts, feeds: outFeeds, roles: outRoles };
}
