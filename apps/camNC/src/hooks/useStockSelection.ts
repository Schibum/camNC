import * as Comlink from 'comlink';
import { useRef } from 'react';
import type { DepthEstimatorWorkerAPI } from '@/workers/depthEstimator.worker';
import { getRemappedStillFrame } from '@/store/store-p3p';
import { useCameraExtrinsics, useNewCameraMatrix, useSetStockMask, useSetIsSelectingStock } from '@/store/store';
import * as THREE from 'three';

function worldToImage(p: THREE.Vector3, R: THREE.Matrix3, t: THREE.Vector3, K: THREE.Matrix3): THREE.Vector2 {
  const cam = p.clone().applyMatrix3(R).add(t);
  const img = cam.clone().applyMatrix3(K);
  return new THREE.Vector2(img.x / img.z, img.y / img.z);
}

export function useStockSelection() {
  const workerRef = useRef<Comlink.Remote<DepthEstimatorWorkerAPI> | null>(null);
  const depthRef = useRef<{ data: Float32Array; width: number; height: number } | null>(null);
  const setMask = useSetStockMask();
  const setSelecting = useSetIsSelectingStock();
  const R = useCameraExtrinsics().R;
  const t = useCameraExtrinsics().t;
  const K = useNewCameraMatrix();

  async function start() {
    setSelecting(true);
    const mat = await getRemappedStillFrame(5);
    const img = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
    mat.delete();
    const worker = new Worker(new URL('../workers/depthEstimator.worker.ts', import.meta.url), { type: 'module' });
    const proxy = Comlink.wrap<DepthEstimatorWorkerAPI>(worker);
    const res = await proxy.estimate(img);
    depthRef.current = { data: res.data, width: res.dims[0], height: res.dims[1] };
    workerRef.current = proxy;
  }

  function select(point: THREE.Vector3) {
    const depth = depthRef.current;
    if (!depth) return;
    const { data, width, height } = depth;
    const imgP = worldToImage(point, R, t, K);
    const x = Math.round(imgP.x);
    const y = Math.round(imgP.y);
    const idx = y * width + x;
    const dval = data[idx];
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++) {
      mask[i] = Math.abs(data[i] - dval) < 0.01 ? 255 : 0;
    }
    const tex = new THREE.DataTexture(mask, width, height, (THREE as any).LuminanceFormat);
    tex.needsUpdate = true;
    setMask(tex);
    depthRef.current = null;
    workerRef.current?.[Comlink.releaseProxy]();
    workerRef.current = null;
    setSelecting(false);
  }

  return { start, select };
}
