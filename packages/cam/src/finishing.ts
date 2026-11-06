import type { Vec3 } from './geom';
import type { MotionPath, MotionRole } from './motion';

type FinishPath = MotionPath & { phase?: 'rough' | 'finish'; materialSide?: 'left' | 'right'; circularFeedFactor?: number };
const distance = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const finishRole = (role: MotionRole | undefined) => role === 'finish' || role === 'corner';

/** Recognize a complete circular polygon only when its vertices AND chords agree with one circle. */
function circularLoop(points: Vec3[], tolerance: number): { radius: number; ccw: boolean } | undefined {
  if (points.length < 13 || distance(points[0], points.at(-1)!) > 1e-7) return undefined;
  if (points.some(p => Math.abs(p[2] - points[0][2]) > 1e-8)) return undefined;
  const ring = points.slice(0, -1).filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-8);
  if (ring.length < 12) return undefined;
  const [a, b, c] = [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor((2 * ring.length) / 3)]];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-10) return undefined;
  const aa = a[0] * a[0] + a[1] * a[1],
    bb = b[0] * b[0] + b[1] * b[1],
    cc = c[0] * c[0] + c[1] * c[1];
  const x = (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d;
  const y = (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d;
  const radius = Math.hypot(a[0] - x, a[1] - y);
  if (!Number.isFinite(radius) || radius <= tolerance) return undefined;
  let sweep = 0,
    sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    const error = Math.abs(Math.hypot(p[0] - x, p[1] - y) - radius);
    if (error > tolerance) return undefined;
    const angle = Math.atan2((p[0] - x) * (q[1] - y) - (p[1] - y) * (q[0] - x), (p[0] - x) * (q[0] - x) + (p[1] - y) * (q[1] - y));
    if (Math.abs(angle) > Math.PI / 12 || Math.abs(angle) < 1e-10 || (sign && Math.sign(angle) !== sign)) return undefined;
    if (error + radius * (1 - Math.cos(Math.abs(angle) / 2)) > tolerance) return undefined;
    sign = Math.sign(angle);
    sweep += angle;
  }
  return Math.abs(Math.abs(sweep) - 2 * Math.PI) < 1e-5 ? { radius, ccw: sweep > 0 } : undefined;
}

/** Inside-circle surface speed correction affects only positively identified finishing/corner moves. */
export function correctCircularFinish<T extends FinishPath>(pass: T, toolRadius: number, tolerance: number): T {
  if (pass.phase !== 'finish' || pass.circularFeedFactor !== undefined || !pass.materialSide || !pass.roles) return pass;
  const first = pass.roles.findIndex(finishRole);
  if (first < 1) return pass;
  let end = first;
  while (end + 1 < pass.roles.length && finishRole(pass.roles[end + 1])) end++;
  if (pass.roles.slice(end + 1).some(finishRole)) return pass;
  const circle = circularLoop(pass.pts.slice(first - 1, end + 1), tolerance);
  if (!circle || circle.ccw !== (pass.materialSide === 'right')) return pass;
  const factor = circle.radius / (circle.radius + toolRadius);
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) return pass;
  return {
    ...pass,
    circularFeedFactor: factor,
    feeds: pass.feeds.map((feed, i) => (i >= first && i <= end ? Math.min(feed, feed * factor) : feed)),
  };
}

export interface EntryBlendResult<T> {
  passes: T[];
  warning?: string;
}

/** A vertical quarter circle projects only onto the already validated first cutting/lead segment. */
export function verticalEntryBlend<T extends MotionPath & { entry?: 'plunge' | 'ramp' | 'tangent'; verticalBlendRadius?: number }>(
  pass: T,
  options: { radius: number; axialStep: number; plungeFeed: number; tolerance: number }
): EntryBlendResult<T> {
  if (pass.entry === 'ramp')
    return { passes: [pass], warning: 'Vertical entry blend is not applied to contour ramps; their programmed slope is retained' };
  if (pass.pts.length < 3 || pass.pts.some(p => Math.abs(p[2] - pass.pts[0][2]) > 1e-8))
    return {
      passes: [pass],
      warning: 'Vertical entry blend requires a flat entry pass; tabs and other height changes keep their existing entry',
    };
  const a = pass.pts[0],
    b = pass.pts[1],
    length = distance(a, b);
  const radius = Math.min(options.radius, options.axialStep, length);
  if (radius < Math.max(0.001, options.tolerance * 2) || length < 1e-8)
    return { passes: [pass], warning: 'Vertical entry blend has no representable room within the axial step and first segment' };
  const x = (b[0] - a[0]) / length,
    y = (b[1] - a[1]) / length;
  const count = Math.max(4, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(options.tolerance, radius) / radius)))));
  const arc: Vec3[] = Array.from({ length: count + 1 }, (_, i) => {
    const angle = (i * Math.PI) / (2 * count);
    return [
      a[0] + x * radius * (1 - Math.cos(angle)),
      a[1] + y * radius * (1 - Math.cos(angle)),
      i === count ? a[2] : a[2] + radius * (1 - Math.sin(angle)),
    ];
  });
  const feed = Math.min(options.plungeFeed, pass.feeds[1]);
  const entryPts = [...arc];
  const entryFeeds = arc.map(() => feed),
    entryRoles: MotionRole[] = arc.map((_, i) => (i ? 'lead-in' : 'approach'));
  const end = arc.at(-1)!;
  let contourPts: Vec3[], contourFeeds: number[], contourRoles: MotionRole[];
  let warning =
    radius < options.radius - 1e-8 ? 'Vertical entry blend radius was reduced to fit the axial step and first segment' : undefined;
  if (pass.entry === 'tangent' && pass.roles) {
    const start = pass.roles.findIndex(role => role === 'cut' || role === 'finish' || role === 'corner') - 1;
    const after = pass.roles.findIndex((role, i) => i > start && role === 'lead-out');
    const last = after < 0 ? pass.pts.length - 1 : after - 1;
    if (start < 1 || distance(pass.pts[start], pass.pts[last]) > 1e-7)
      return {
        passes: [pass],
        warning: 'Vertical entry blend could not retain a complete tangent contour lap; the original entry is retained',
      };
    entryPts.push(...pass.pts.slice(1, start + 1));
    entryFeeds.push(...pass.feeds.slice(1, start + 1));
    entryRoles.push(...pass.roles.slice(1, start + 1));
    contourPts = pass.pts.slice(start, last + 1);
    contourFeeds = pass.feeds.slice(start, last + 1);
    contourRoles = pass.roles.slice(start, last + 1);
    warning = [warning, 'Tangent exit was omitted after the vertical entry blend to retain a complete final contour lap']
      .filter(Boolean)
      .join('; ');
  } else {
    if (distance(a, pass.pts.at(-1)!) > 1e-7)
      return { passes: [pass], warning: 'Vertical entry blend requires a complete closed contour lap; the original entry is retained' };
    contourPts = [end, ...pass.pts.slice(1), end];
    contourFeeds = [pass.feeds[0], ...pass.feeds.slice(1), pass.feeds[1]];
    contourRoles = ['link', ...(pass.roles?.slice(1) ?? pass.pts.slice(1).map(() => 'cut' as const)), pass.roles?.[1] ?? 'cut'];
  }
  contourRoles[0] = 'link';
  const entry = {
    ...pass,
    pts: entryPts,
    feeds: entryFeeds,
    roles: entryRoles,
    entry: 'plunge' as const,
    link: 'retract' as const,
    verticalBlendRadius: radius,
    auxiliary: 'entry' as const,
    circularFeedFactor: undefined,
  };
  const contour = { ...pass, pts: contourPts, feeds: contourFeeds, roles: contourRoles, entry: undefined, link: 'direct' as const };
  return { passes: [entry, contour], ...(warning ? { warning } : {}) };
}

/** A complete inside contour is retained; the optional exit rises over an already cut first segment. */
export function verticalExitBlend<T extends MotionPath>(
  pass: T,
  options: { radius: number; plungeFeed: number; tolerance: number }
): EntryBlendResult<T> {
  if (pass.pts.length < 3 || distance(pass.pts[0], pass.pts.at(-1)!) > 1e-7 || pass.pts.some(p => Math.abs(p[2] - pass.pts[0][2]) > 1e-8))
    return { passes: [pass], warning: 'Vertical exit blend needs a complete flat contour lap; the existing exit is retained' };
  const a = pass.pts[0],
    b = pass.pts[1],
    length = distance(a, b);
  const radius = Math.min(options.radius, length);
  if (radius < Math.max(0.001, options.tolerance * 2) || length < 1e-8)
    return { passes: [pass], warning: 'Vertical exit blend has no representable room on the first contour segment' };
  const x = (b[0] - a[0]) / length,
    y = (b[1] - a[1]) / length;
  const count = Math.max(4, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(options.tolerance, radius) / radius)))));
  const pts: Vec3[] = Array.from({ length: count + 1 }, (_, i) => {
    const angle = (i * Math.PI) / (2 * count);
    return [a[0] + x * radius * Math.sin(angle), a[1] + y * radius * Math.sin(angle), a[2] + radius * (1 - Math.cos(angle))];
  });
  const feed = Math.min(options.plungeFeed, pass.feeds[1]);
  const exit = {
    ...pass,
    pts,
    feeds: pts.map(() => feed),
    roles: pts.map((_, i): MotionRole => (i ? 'lead-out' : 'link')),
    link: 'direct' as const,
    entry: undefined,
    auxiliary: 'exit' as const,
    spring: undefined,
    circularFeedFactor: undefined,
  };
  return {
    passes: [pass, exit],
    ...(radius < options.radius - 1e-8 ? { warning: 'Vertical exit blend radius was reduced to fit the first contour segment' } : {}),
  };
}
