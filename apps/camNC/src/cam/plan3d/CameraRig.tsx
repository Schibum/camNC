import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { applyView, fitView, kFov, readView, type Projection, type ViewKind } from './framing';

/**
 * The 3D view's cameras and orbit controls. Frames `box` whenever `frameKey` or the view changes; switching the
 * projection keeps what is on screen (same target, direction and visible height).
 */
export function CameraRig({
  box,
  frameKey,
  view,
  projection,
  margin,
  minSpan,
}: {
  box: Box3;
  frameKey: string;
  view: ViewKind;
  projection: Projection;
  margin: number;
  minSpan: number;
}) {
  const set = useThree(s => s.set);
  const invalidate = useThree(s => s.invalidate);
  const size = useThree(s => s.size);
  const cameras = useMemo(
    () => ({ perspective: new PerspectiveCamera(kFov, 1, 0.1, 1e5), orthographic: new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5) }),
    []
  );
  const camera = cameras[projection];
  const controls = useRef<OrbitControlsImpl>(null);
  // The orbit target, kept here: a new projection gets new controls, which start out at the origin.
  const target = useRef(new Vector3());
  const shown = useRef(camera);
  const framed = useRef('');

  const syncControls = () => {
    controls.current?.target.copy(target.current);
    controls.current?.update();
  };

  // Projection change: carry the view over from the camera that was showing.
  useLayoutEffect(() => {
    if (shown.current !== camera && framed.current) {
      applyView(camera, readView(shown.current, target.current, size.height), size.width, size.height);
    }
    shown.current = camera;
    set({ camera });
    syncControls();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the camera changes
  }, [camera, set]);

  // Frame the board or the selected op.
  useLayoutEffect(() => {
    const key = `${frameKey}|${view}`;
    if (key === framed.current) return;
    framed.current = key;
    const state = fitView(box, { view, aspect: size.width / Math.max(size.height, 1), margin, minSpan });
    applyView(camera, state, size.width, size.height);
    target.current.copy(state.target);
    syncControls();
    invalidate();
  }, [box, frameKey, view, margin, minSpan, camera, size, invalidate]);

  // Resize: same zoom, frustum fitted to the canvas.
  useEffect(() => {
    if (framed.current) applyView(camera, readView(camera, target.current, size.height), size.width, size.height);
    invalidate();
  }, [camera, size, invalidate]);

  return (
    <OrbitControls
      ref={controls}
      camera={camera}
      makeDefault
      enableRotate={view === '3d'}
      screenSpacePanning
      onChange={() => controls.current && target.current.copy(controls.current.target)}
    />
  );
}
