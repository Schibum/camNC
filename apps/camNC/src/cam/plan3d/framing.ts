import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export type ViewKind = 'top' | '3d';
export type Projection = 'perspective' | 'orthographic';

/** Vertical field of view of the perspective camera, degrees. */
export const kFov = 30;

/**
 * Where the camera looks, independent of the projection: so switching between perspective and orthographic keeps
 * the framing. `height` is how much of the world (mm) the view shows vertically at the target.
 */
export interface ViewState {
  target: Vector3;
  /** Unit vector from the target to the camera. */
  dir: Vector3;
  up: Vector3;
  height: number;
}

const kDirs: Record<ViewKind, { dir: Vector3; up: Vector3 }> = {
  top: { dir: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
  '3d': { dir: new Vector3(0.18, -0.85, 1).normalize(), up: new Vector3(0, 0, 1) },
};

/** Screen axes (right, up) of a camera looking along -dir. */
function screenAxes(dir: Vector3, up: Vector3) {
  const u = up.clone().addScaledVector(dir, -up.dot(dir));
  if (u.lengthSq() < 1e-9) u.set(0, 1, 0);
  u.normalize();
  return { right: new Vector3().crossVectors(u, dir).normalize(), up: u };
}

/**
 * The view that shows `box` from the top or at an angle, `margin` times its projected size (a bit more at an angle),
 * and never less than
 * `minSpan` mm on the shorter side of the screen (so zooming to a small hole still shows some board around it).
 */
export function fitView(
  box: Box3,
  { view, aspect, margin = 1.2, minSpan = 0 }: { view: ViewKind; aspect: number; margin?: number; minSpan?: number }
): ViewState {
  const { dir, up } = kDirs[view];
  const target = box.getCenter(new Vector3());
  const axes = screenAxes(dir, up);
  let w = 0;
  let h = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const c = new Vector3(x, y, z).sub(target);
        w = Math.max(w, Math.abs(c.dot(axes.right)) * 2);
        h = Math.max(h, Math.abs(c.dot(axes.up)) * 2);
      }
  const a = Math.max(aspect, 1e-3);
  // At an angle the near edge comes out larger in perspective: leave it room.
  const angled = view === '3d' ? 1.25 : 1;
  const height = Math.max(Math.max(h, w / a) * margin * angled, minSpan / Math.min(1, a), 1e-3);
  return { target, dir: dir.clone(), up: up.clone(), height };
}

/** Distance at which a perspective camera shows `height` mm at its target. */
export const perspectiveDistance = (height: number, fovDeg = kFov) => height / 2 / Math.tan((fovDeg * Math.PI) / 360);

/** Zoom at which an orthographic camera with a frustum in pixels (three/R3F's default) shows `height` mm. */
export const orthographicZoom = (height: number, heightPx: number) => heightPx / height;

/** Points `camera` as in `state`. Orthographic cameras get a pixel frustum of `widthPx` × `heightPx`. */
export function applyView(camera: PerspectiveCamera | OrthographicCamera, state: ViewState, widthPx: number, heightPx: number) {
  const distance = perspectiveDistance(state.height, kFov);
  camera.up.copy(state.up);
  camera.position.copy(state.target).addScaledVector(state.dir, distance);
  if ('isPerspectiveCamera' in camera) {
    camera.fov = kFov;
    camera.aspect = widthPx / Math.max(heightPx, 1);
    camera.near = Math.max(0.05, distance / 500);
    camera.far = distance * 50 + 5000;
  } else {
    Object.assign(camera, { left: -widthPx / 2, right: widthPx / 2, top: heightPx / 2, bottom: -heightPx / 2 });
    camera.zoom = orthographicZoom(state.height, heightPx);
    // The frustum reaches behind the camera too: nothing gets clipped wherever the orbit puts it.
    camera.near = -(distance * 50 + 5000);
    camera.far = distance * 50 + 5000;
  }
  camera.lookAt(state.target);
  camera.updateProjectionMatrix();
}

/** The view a camera shows now (looking at `target`), to carry over to the other projection. */
export function readView(camera: PerspectiveCamera | OrthographicCamera, target: Vector3, heightPx: number): ViewState {
  const offset = camera.position.clone().sub(target);
  const distance = Math.max(offset.length(), 1e-6);
  const height =
    'isPerspectiveCamera' in camera ? 2 * distance * Math.tan((camera.fov * Math.PI) / 360) : heightPx / Math.max(camera.zoom, 1e-9);
  return { target: target.clone(), dir: offset.divideScalar(distance), up: camera.up.clone(), height };
}

/** Share of the screen (the larger of width and height share) a box takes up in a view. */
export function screenShare(box: Box3, state: ViewState, aspect: number) {
  const axes = screenAxes(state.dir, state.up);
  const size = box.getSize(new Vector3());
  const corners = [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => new Vector3(i * size.x, j * size.y, k * size.z))));
  const extent = (axis: Vector3) => {
    const d = corners.map(c => c.dot(axis));
    return Math.max(...d) - Math.min(...d);
  };
  return Math.max(extent(axes.up) / state.height, extent(axes.right) / (state.height * aspect));
}
