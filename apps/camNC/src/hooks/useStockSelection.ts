import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { undistortedToDistortedFast } from '@/lib/image-geometry';
import { useCameraExtrinsics, useNewCameraMatrix, useSetDepthData, useSetIsSelectingStock, useSetStockMask, useStore } from '@/store/store';
import { getRemappedStillFrame } from '@/store/store-p3p';
import { depthFloodFillMask } from '@/utils/depthMask';
import type { DepthEstimatorWorkerAPI } from '@/workers/depthEstimator.worker';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import * as Comlink from 'comlink';
import { useRef } from 'react';
import * as THREE from 'three';

function worldToImage(p: THREE.Vector3, R: THREE.Matrix3, t: THREE.Vector3, K: THREE.Matrix3): THREE.Vector2 {
  const cam = p.clone().applyMatrix3(R).add(t);
  const img = cam.clone().applyMatrix3(K);
  return new THREE.Vector2(img.x / img.z, img.y / img.z);
}

export function useStockSelection() {
  const workerRef = useRef<Comlink.Remote<DepthEstimatorWorkerAPI> | null>(null);
  const setMask = useSetStockMask();
  const setSelecting = useSetIsSelectingStock();
  const R = useCameraExtrinsics().R;
  const t = useCameraExtrinsics().t;
  const K = useNewCameraMatrix();
  const setDepthData = useSetDepthData();

  async function start() {
    await ensureOpenCvIsLoaded();
    setSelecting(true);
    const mat = await getRemappedStillFrame(1);
    const img = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
    mat.delete();
    const worker = new Worker(new URL('../workers/depthEstimator.worker.ts', import.meta.url), { type: 'module' });
    const proxy = Comlink.wrap<DepthEstimatorWorkerAPI>(worker);
    const res = await proxy.estimate(img);
    console.log('res', res);
    setDepthData({ data: res.data, width: res.dims[0], height: res.dims[1] });
    workerRef.current = proxy;
  }

  function select(point: THREE.Vector3) {
    console.log('select', point);
    const depth = useStore.getState().depthData;
    if (!depth) return;
    const { data, width, height } = depth;

    // 1. Project world → UNDISTORTED pixel coordinates (using new camera matrix)
    const imgPUndist = worldToImage(point, R, t, K);

    // Fetch camera source information for image dimensions and scaling.
    const camSource = useStore.getState().camSource;
    if (!camSource) return;
    const [origW, origH] = camSource.maxResolution;

    // 2. Convert UNDISTORTED → DISTORTED pixel using cached maps
    const calib = camSource.calibration!;
    const [mapX, mapY] = calculateUndistortionMapsCached(calib, origW, origH);
    const imgPDist = undistortedToDistortedFast(imgPUndist, mapX, mapY, origW, origH);
    if (!imgPDist) {
      console.warn('undistorted pixel mapped outside distorted image', imgPUndist);
      return;
    }
    console.log('imgPDist', imgPDist);

    // Scale from full-resolution distorted pixel → depth-map resolution
    const scaleX = width / origW;
    const scaleY = height / origH;

    const xDepth = Math.round(imgPDist.x * scaleX);
    const yDepth = Math.round(imgPDist.y * scaleY);
    console.log('xDepth, yDepth', xDepth, yDepth);

    if (xDepth < 0 || xDepth >= width || yDepth < 0 || yDepth >= height) {
      console.warn('Projected point is outside depth map bounds', { xDepth, yDepth, width, height, imgPDist });
      return;
    }

    const idx = yDepth * width + xDepth;
    const dval = data[idx];
    console.log('dval', dval, idx, xDepth, yDepth, imgPDist, { scaleX, scaleY });

    const { mask: maskDepth, hits } = depthFloodFillMask(data, width, height, idx, { threshold: 0.01 });
    console.log('Total contiguous hits:', hits, 'out of', data.length, 'pixels');

    // We keep the mask in DEPTH-map resolution (already distorted).
    const tex = new THREE.DataTexture(maskDepth, width, height, THREE.RedFormat);
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    setMask(tex);
    workerRef.current?.[Comlink.releaseProxy]();
    workerRef.current = null;
  }

  return { start, select };
}
