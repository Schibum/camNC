import { describe, expect, it } from 'vitest';
import { CylinderGeometry, Matrix4, Triangle, Vector3 } from 'three';
import { camWorker } from '../camQueries';
import type { BodyMesh } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import trayUrl from '../samples/pocket-tray.stl?url';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';

describe('model display normals', () => {
  it('keeps the STL tray pocket floors, walls and rim flat right up to their sharp edges', async () => {
    const bytes = new Uint8Array(await (await fetch(trayUrl)).arrayBuffer());
    const model = await camWorker().importModel(bytes, 'Pocket tray.stl', 'display-tray');
    const mesh = model.meshes[0];
    const originalPositions = mesh.positions.slice();
    const originalIndices = mesh.indices.slice();
    const geometry = modelGeometry(mesh);
    const p = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const triangle = new Triangle();
    const face = new Vector3();
    const vertex = new Vector3();
    for (let i = 0; i < p.count; i += 3) {
      triangle.a.fromBufferAttribute(p, i);
      triangle.b.fromBufferAttribute(p, i + 1);
      triangle.c.fromBufferAttribute(p, i + 2);
      triangle.getNormal(face);
      for (let k = 0; k < 3; k++) expect(vertex.fromBufferAttribute(normals, i + k).dot(face)).toBeCloseTo(1, 5);
    }
    expect(geometry.getAttribute('color').count).toBe(p.count);
    expect(mesh.positions).toEqual(originalPositions);
    expect(mesh.indices).toEqual(originalIndices);
    geometry.dispose();
  });

  it('still smooths curved surfaces rather than faceting every triangle', () => {
    const cylinder = new CylinderGeometry(20, 20, 12, 32);
    const mesh: BodyMesh = {
      name: 'Curved part',
      partId: 'curve',
      positions: cylinder.getAttribute('position').array as Float32Array,
      indices: Uint32Array.from(cylinder.index!.array),
      flat: new Matrix4().toArray(),
    };
    const geometry = modelGeometry(mesh);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    let curvedVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      const n = new Vector3().fromBufferAttribute(normals, i);
      expect(n.length()).toBeCloseTo(1, 5);
      if (Math.abs(n.y) < 0.01) {
        const radial = new Vector3(positions.getX(i), 0, positions.getZ(i)).normalize();
        expect(n.dot(radial)).toBeGreaterThan(0.999);
        curvedVertices++;
      }
    }
    expect(curvedVertices).toBeGreaterThan(100);
    geometry.dispose();
    cylinder.dispose();
  });

  it('preserves real STEP model bounds and produces valid normals and colors', async () => {
    const bytes = new Uint8Array(await (await fetch(stepUrl)).arrayBuffer());
    const model = await camWorker().importModel(bytes, 'kinderregal-eiche.step', 'display-step');
    for (const mesh of model.meshes) {
      const geometry = modelGeometry(mesh);
      const normals = geometry.getAttribute('normal');
      expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
      for (let i = 0; i < normals.count; i++) expect(new Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 5);
      geometry.computeBoundingBox();
      const xs = Array.from(mesh.positions).filter((_, i) => i % 3 === 0);
      expect(geometry.boundingBox!.min.x).toBe(Math.min(...xs));
      expect(geometry.boundingBox!.max.x).toBe(Math.max(...xs));
      geometry.dispose();
    }
  }, 60_000);
});
