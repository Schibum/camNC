import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyMesh } from '../camTypes';

/** Display geometry only: preserve sharp machined edges while smoothing gently curved tessellated surfaces. */
export function modelGeometry(mesh: BodyMesh): BufferGeometry {
  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  indexed.setIndex(new BufferAttribute(mesh.indices, 1));
  const flat = new Matrix4().fromArray(mesh.flat);
  const v = new Vector3();
  const n = mesh.positions.length / 3;
  const zs = new Float32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, (zs[i] = v.fromArray(mesh.positions, i * 3).applyMatrix4(flat).z));
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.fill(0.55 + 0.45 * (top > 0 ? zs[i] / top : 1), i * 3, i * 3 + 3);
  indexed.setAttribute('color', new BufferAttribute(colors, 3));
  // STL import welds vertices for connected-body detection. Averaging every incident face normal would make its
  // square pocket walls and outer edges look rounded. Split display corners at creases (60°), leaving CAM topology intact.
  const geometry = toCreasedNormals(indexed);
  indexed.dispose();
  return geometry;
}
