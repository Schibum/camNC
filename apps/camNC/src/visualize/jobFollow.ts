import { Box2, Box3, Vector3 } from 'three';
import { isRapidSegment } from './depthInspection';
import { ParsedToolpath } from './gcodeParsing';

/** One place on the stock the job cuts at, in toolpath coordinates. */
export interface JobPart {
  /** First path point of the part: the rapid leading to it already belongs to it, so the camera moves ahead of the tool. */
  start: number;
  box: Box3;
}

// Cuts closer than this (mm) to the part so far belong to it: a pocket and its outline, or the passes of a profile.
const kPartGap = 2;

/**
 * Splits the job into the parts it cuts one after the other: each run of cutting moves below the stock top joins the
 * current part if it overlaps it, or starts the next one. `shift` is the offset from toolpath Z to Z relative to the
 * stock top.
 */
export function getJobParts(toolpath: ParsedToolpath, shift: number): JobPart[] {
  const points = toolpath.pathPoints;
  const parts: JobPart[] = [];
  const expanded = new Box3();
  const addRun = (run: Box3, nextStart: number) => {
    const current = parts[parts.length - 1];
    if (current) {
      expanded.copy(current.box).expandByVector(new Vector3(kPartGap, kPartGap, Infinity));
      if (expanded.intersectsBox(run)) {
        current.box.union(run);
        return;
      }
    }
    parts.push({ start: nextStart, box: run });
  };

  let run: Box3 | null = null;
  // Where the next part would start: right after the last cutting move.
  let nextStart = 0;
  let runStart = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const cutting = !isRapidSegment(toolpath, i) && Math.min(a.z, b.z) + shift < 0 && !a.equals(b);
    if (cutting) {
      if (!run) {
        run = new Box3();
        runStart = nextStart;
      }
      run.expandByPoint(a).expandByPoint(b);
      nextStart = i + 1;
    } else if (run) {
      addRun(run, runStart);
      run = null;
    }
  }
  if (run) addRun(run, runStart);
  return parts;
}

/** The part the tool is at or heading to when at path point `index`. */
export function partAt(parts: JobPart[], index: number): JobPart | null {
  let found = parts[0] ?? null;
  for (const part of parts) {
    if (part.start > index) break;
    found = part;
  }
  return found;
}

/** Stock side the camera looks from, as the azimuth of that direction (radians, 0 towards +X). */
const kSides = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];
// Turned away from straight on, so that the part's other side shows too. From -X, this is close to the 3D view's angle.
const kSideYaw = 0.33;
// A side has to be this much nearer (mm) to swing the camera around.
const kSideHysteresis = 10;
/** Low enough to read as a side view, high enough to see into pockets over the stock in front of them. */
export const kPartShotElevation = 0.42;
// Room around the part, for the panels over the view.
const kFitMargin = 1.4;
// Small parts (mm): keep some of the surroundings in view.
const kMinSpan = 40;

/** Index into the stock sides of the one nearest `box`, which keeps the camera's view over the least stock. */
export function nearestStockSide(box: Box3, footprint: Box2, current: number | null): number {
  const distances = [box.min.x - footprint.min.x, box.min.y - footprint.min.y, footprint.max.x - box.max.x, footprint.max.y - box.max.y];
  let best = 0;
  for (let i = 1; i < distances.length; i++) if (distances[i]! < distances[best]!) best = i;
  return current !== null && distances[current]! - distances[best]! <= kSideHysteresis ? current : best;
}

export function stockSideAzimuth(side: number) {
  return kSides[side]! + kSideYaw;
}

/** Direction from the look-at target towards the camera (Z up). */
export function directionFromAngles(azimuth: number, elevation: number) {
  const c = Math.cos(elevation);
  return new Vector3(Math.cos(azimuth) * c, Math.sin(azimuth) * c, Math.sin(elevation));
}

/** Orthographic zoom (pixels per mm) that fits `box` seen from the given angles into a canvas of the given size. */
export function fitZoom(box: Box3, azimuth: number, elevation: number, width: number, height: number) {
  const direction = directionFromAngles(azimuth, elevation);
  const right = new Vector3(0, 0, 1).cross(direction).normalize();
  const up = direction.clone().cross(right);
  const corner = new Vector3();
  let [spanX, spanY] = [0, 0];
  const center = box.getCenter(new Vector3());
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).sub(center);
        spanX = Math.max(spanX, Math.abs(corner.dot(right)) * 2);
        spanY = Math.max(spanY, Math.abs(corner.dot(up)) * 2);
      }
    }
  }
  return Math.min(width / (Math.max(spanX, kMinSpan) * kFitMargin), height / (Math.max(spanY, kMinSpan) * kFitMargin));
}

// Canvas (pixels) covered by the panels over the 3D view: toolbar, timeline, depth panel. The part is framed in the rest.
const kInsets = { top: 50, bottom: 150, right: 240 };

/** Canvas area left for the part: never less than half of the canvas, on small screens. */
function framedSize(width: number, height: number) {
  return { width: Math.max(width - kInsets.right, width / 2), height: Math.max(height - kInsets.top - kInsets.bottom, height / 2) };
}

/** Where to look so that `center` shows in the middle of the canvas area left for it, at the given zoom. */
export function framedTarget(center: Vector3, azimuth: number, elevation: number, zoom: number, width: number, height: number) {
  const direction = directionFromAngles(azimuth, elevation);
  const right = new Vector3(0, 0, 1).cross(direction).normalize();
  const up = direction.clone().cross(right);
  const framed = framedSize(width, height);
  // Insets shrink along with the area on small screens.
  const raise = (((kInsets.bottom - kInsets.top) / 2) * (height - framed.height)) / (kInsets.top + kInsets.bottom);
  return center
    .clone()
    .addScaledVector(right, (width - framed.width) / 2 / zoom)
    .addScaledVector(up, -raise / zoom);
}

const easeShare = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** Shortest turn from angle `from` to angle `to`, whichever way around they are written. */
const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Ease rates (1/s): slow enough to read as a glide from one part to the next.
const kTargetRate = 1.5;
const kZoomRate = 1.3;
const kAngleRate = 0.9;

// Below these, a change of the view since the last step is rounding rather than the user.
const kTargetTolerance = 1e-3;
const kAngleTolerance = 1e-4;
const kZoomTolerance = 1e-4;

interface FollowCamera {
  position: Vector3;
  zoom: number;
  updateProjectionMatrix(): void;
}

interface FollowControls {
  target: Vector3;
  update(): void;
}

export interface FollowStep {
  /** The part in world coordinates, and the same in toolpath XY for the stock side. */
  worldBox: Box3;
  partBox: Box3;
  footprint: Box2;
  width: number;
  height: number;
  dt: number;
  /** False once the user asked for the automatic angle and zoom again. */
  customView: boolean;
  /** The user moved the view: it pans (stops following) or orbits and zooms (which following keeps). */
  onPan: () => void;
  onCustomView: () => void;
}

/**
 * Glides the camera to the part being cut. The orbit controls move the same camera, so what changed since the last
 * step was the user: an orbit or zoom is kept while the view keeps following, a pan stops it.
 */
export class PartShotFollower {
  private side: number | null = null;
  private userAngle: { azimuth: number; elevation: number } | null = null;
  private zoomScale = 1;
  private last: { target: Vector3; azimuth: number; elevation: number; zoom: number } | null = null;

  constructor(
    private readonly camera: FollowCamera,
    private readonly controls: FollowControls
  ) {}

  /** Something else moves the camera, or following is off: what it does next is not the user's doing. */
  skip() {
    this.last = null;
  }

  step({ worldBox, partBox, footprint, width, height, dt, customView, onPan, onCustomView }: FollowStep) {
    const { camera, controls } = this;
    if (!customView) {
      this.userAngle = null;
      this.zoomScale = 1;
    }
    const offset = camera.position.clone().sub(controls.target);
    const length = offset.length();
    const azimuth = Math.atan2(offset.y, offset.x);
    const elevation = Math.asin(offset.z / length);
    const { last } = this;
    if (last) {
      if (last.target.distanceTo(controls.target) > kTargetTolerance) {
        this.last = null;
        onPan();
        return;
      }
      const orbited =
        Math.abs(angleBetween(last.azimuth, azimuth)) > kAngleTolerance || Math.abs(elevation - last.elevation) > kAngleTolerance;
      const zoomed = Math.abs(camera.zoom / last.zoom - 1) > kZoomTolerance;
      if (orbited) this.userAngle = { azimuth, elevation };
      if (zoomed) this.zoomScale *= camera.zoom / last.zoom;
      if (orbited || zoomed) onCustomView();
    }

    this.side = nearestStockSide(partBox, footprint, this.side);
    const wantedAzimuth = this.userAngle?.azimuth ?? stockSideAzimuth(this.side);
    const wantedElevation = this.userAngle?.elevation ?? kPartShotElevation;
    const angleShare = easeShare(kAngleRate, dt);
    const nextAzimuth = this.userAngle ? wantedAzimuth : azimuth + angleBetween(azimuth, wantedAzimuth) * angleShare;
    const nextElevation = this.userAngle ? wantedElevation : elevation + (wantedElevation - elevation) * angleShare;

    const framed = framedSize(width, height);
    const wantedZoom = fitZoom(worldBox, wantedAzimuth, wantedElevation, framed.width, framed.height) * this.zoomScale;
    camera.zoom *= (wantedZoom / camera.zoom) ** easeShare(kZoomRate, dt);
    const wantedTarget = framedTarget(worldBox.getCenter(new Vector3()), nextAzimuth, nextElevation, camera.zoom, width, height);
    controls.target.lerp(wantedTarget, easeShare(kTargetRate, dt));
    camera.position.copy(controls.target).addScaledVector(directionFromAngles(nextAzimuth, nextElevation), length);
    camera.updateProjectionMatrix();
    controls.update();
    this.last = { target: controls.target.clone(), azimuth: nextAzimuth, elevation: nextElevation, zoom: camera.zoom };
  }
}
