import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';

const kGap = 30;

/**
 * Where each body goes in the "laid flat" view: rows by thickness (thickest first), wrapping like a shelf so the
 * spread stays roughly square. Returns a model→world matrix per body.
 */
export function layoutFlat(meshes: BodyMesh[], parts: CamPartInfo[]): THREE.Matrix4[] {
  const partById = new Map(parts.map(p => [p.id, p]));
  const order = meshes
    .map((m, i) => ({ i, part: partById.get(m.partId)! }))
    .sort((a, b) => b.part.thickness - a.part.thickness || b.part.size[0] - a.part.size[0]);
  const totalArea = order.reduce((s, o) => s + (o.part.size[0] + kGap) * (o.part.size[1] + kGap), 0);
  const maxRow = Math.max(Math.sqrt(totalArea) * 1.3, ...order.map(o => o.part.size[0]));
  const out: THREE.Matrix4[] = [];
  let x = 0,
    y = 0,
    rowH = 0,
    maxX = 0,
    rowT: number | undefined;
  for (const { i, part } of order) {
    const [w, h] = part.size;
    if (x > 0 && (x + w > maxRow || part.thickness !== rowT)) {
      x = 0;
      y -= rowH + kGap;
      rowH = 0;
    }
    rowT = part.thickness;
    out[i] = new THREE.Matrix4().makeTranslation(x, y - h, 0).multiply(new THREE.Matrix4().fromArray(meshes[i].flat));
    x += w + kGap;
    maxX = Math.max(maxX, x - kGap);
    rowH = Math.max(rowH, h);
  }
  // Centered on the origin: <Bounds> keeps the camera's direction to the center, so an off-center layout would be
  // seen from the side.
  const center = new THREE.Matrix4().makeTranslation(-maxX / 2, -(y - rowH) / 2, 0);
  return out.map(m => center.clone().multiply(m));
}

/** The model as designed, centered on the origin (see layoutFlat). */
export function centerAssembled(meshes: BodyMesh[]): THREE.Matrix4 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) box.expandByPoint(v.fromArray(m.positions, i));
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
}
