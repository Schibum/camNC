import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { BodyMesh, CamPartInfo } from '../camTypes';
import { modelGeometry } from './modelGeometry';
import { centerAssembled, layoutFlat } from './layoutFlat';
import { kOrbitDamping } from '@/lib/orbitDamping';

export type ModelView = 'assembled' | 'flat';

const kWood = '#c9a477';
const kSelected = '#8b5cf6';
const kOff = '#71717a';
function Body({
  mesh,
  matrix,
  color,
  opacity,
  onSelect,
}: {
  mesh: BodyMesh;
  matrix: THREE.Matrix4 | null;
  color: string;
  opacity: number;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => modelGeometry(mesh), [mesh]);
  return (
    <mesh
      geometry={geometry}
      matrixAutoUpdate={false}
      matrix={matrix ?? new THREE.Matrix4()}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect();
      }}>
      <meshStandardMaterial vertexColors color={color} roughness={0.8} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

/** Point the camera at the box from the front-right, above (Z up), and orbit around its center. */
function FitCamera({ box }: { box: THREE.Box3 }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree(s => s.size.width / s.size.height);
  useEffect(() => {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x / Math.min(aspect, 1.6), size.y, size.z) * 0.62;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.up.set(0, 0, 1);
    camera.position.copy(center).addScaledVector(new THREE.Vector3(0.2, -0.75, 1).normalize(), dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [box, camera, controls, aspect]);
  return null;
}

function boundsOf(meshes: BodyMesh[], matrices: THREE.Matrix4[]) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  meshes.forEach((m, i) => {
    for (let k = 0; k < m.positions.length; k += 3) box.expandByPoint(v.fromArray(m.positions, k).applyMatrix4(matrices[i]));
  });
  return box;
}

/** The model in 3D: as designed, or every part laid flat with its machined side up. Click a part to select it. */
export function ModelViewport({
  meshes,
  parts,
  view,
  selectedId,
  milled,
  onSelect,
}: {
  meshes: BodyMesh[];
  parts: CamPartInfo[];
  view: ModelView;
  selectedId: string | null;
  milled: (partId: string) => boolean;
  onSelect: (partId: string) => void;
}) {
  const flat = useMemo(() => layoutFlat(meshes, parts), [meshes, parts]);
  const assembled = useMemo(() => centerAssembled(meshes), [meshes]);
  const box = useMemo(() => boundsOf(meshes, view === 'flat' ? flat : meshes.map(() => assembled)), [meshes, view, flat, assembled]);
  return (
    <Canvas camera={{ fov: 30 }} dpr={[1, 2]}>
      <hemisphereLight args={['#ffffff', '#8a8178', 1.4]} position={[0, 0, 1]} />
      <directionalLight position={[300, -500, 800]} intensity={1.8} />
      <directionalLight position={[-400, 300, 200]} intensity={0.4} />
      <FitCamera box={box} />
      <group>
        {meshes.map((m, i) => (
          <Body
            key={i}
            mesh={m}
            matrix={view === 'flat' ? flat[i] : assembled}
            color={m.partId === selectedId ? kSelected : milled(m.partId) ? kWood : kOff}
            opacity={milled(m.partId) ? 1 : 0.35}
            onSelect={() => onSelect(m.partId)}
          />
        ))}
      </group>
      <OrbitControls makeDefault dampingFactor={kOrbitDamping} />
    </Canvas>
  );
}
