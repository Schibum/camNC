import { cv2 } from '@wbcnc/load-opencv';

/**
 * Wrapper around cv2.remap with data types we use in three js shaders for remapping.
 */
export function remapCv(src: ImageData, [width, height]: [number, number], map1: Float32Array, map2: Float32Array): cv2.Mat {
  // const { width, height } = src;
  let srcMat = cv2.matFromImageData(src);
  // Scale up srcMat in place if it doesn't match the target dimensions
  if (srcMat.cols !== width || srcMat.rows !== height) {
    console.log('current video resolution is smaller than target resolution, scaling up...');
    const tempMat = new cv2.Mat();
    cv2.resize(srcMat, tempMat, new cv2.Size(width, height), 0, 0, cv2.INTER_LINEAR);
    srcMat.delete();
    srcMat = tempMat;
  }
  const dstMat = new cv2.Mat();
  const map1Mat = cv2.matFromArray(height, width, cv2.CV_32FC1, map1);
  const map2Mat = cv2.matFromArray(height, width, cv2.CV_32FC1, map2);
  cv2.remap(srcMat, dstMat, map1Mat, map2Mat, cv2.INTER_LINEAR);
  // const dst = document.createElement('canvas');
  // dst.width = width;
  // dst.height = height;
  // cv2.imshow(dst, dstMat);
  // dstMat.delete();
  map1Mat.delete();
  map2Mat.delete();
  srcMat.delete();
  return dstMat;
}
