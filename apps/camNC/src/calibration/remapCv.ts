import { cv2 } from '@wbcnc/load-opencv';

/**
 * Wrapper around cv2.remap with data types we use in three js shaders for remapping.
 */
export function remapCv(src: ImageData, map1: Float32Array, map2: Float32Array): cv2.Mat {
  const { width, height } = src;
  const srcMat = cv2.matFromImageData(src);
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
