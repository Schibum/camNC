import { Matrix3 } from 'three';
import { StructuredView } from 'webgpu-utils';
import { RemapStepParams } from './remapPipeline';

// Helper to pack a mat3x3 (column-major) into vec4 columns (std140).
export function padMat3(mat: Matrix3) {
  // prettier-ignore
  return [
    mat.elements[0], mat.elements[1], mat.elements[2], 0,
    mat.elements[3], mat.elements[4], mat.elements[5], 0,
    mat.elements[6], mat.elements[7], mat.elements[8], 0,
  ];
}

/*
struct Params {
  // cam→machine part
  matrix : mat3x3<f32>,
  bounds : vec4<f32>,

  // undistort part (mirrors UndistortStep)
  cameraMatrix : mat3x3<f32>,
  newCameraMatrix : mat3x3<f32>,
  distCoeffs : vec4<f32>,
  k3 : f32,
};*/
export function createRemapUniform(params: RemapStepParams, paramsValues: StructuredView) {
  paramsValues.set({
    matrix: padMat3(params.combinedProjectionMatrix ?? generateCamToMachineMatrix(params)),
    bounds: params.machineBounds,
    cameraMatrix: padMat3(params.cameraMatrix),
    newCameraMatrix: padMat3(params.newCameraMatrix),
    distCoeffs: params.distCoeffs.slice(0, 4),
    k3: params.distCoeffs[4] !== undefined ? params.distCoeffs[4]! : 0,
  });
}

// Combined projection matrix: machine → camera.
function computeMatrix({ R, t, newCameraMatrix }: RemapStepParams): Matrix3 {
  // Start with a copy of the rotation matrix (column-major storage).
  const extr = R.clone();

  // Put the translation vector into the third column → [r₁ r₂ t].
  const e = extr.elements; // [n11,n21,n31,n12,n22,n32,n13,n23,n33]
  e[6] = t.x; // n13
  e[7] = t.y; // n23
  e[8] = t.z; // n33

  // Final 3 × 3 homography: H = K · extr
  return newCameraMatrix.clone().multiply(extr);
}

// For converting a camera frame to a machine frame. The matrix projects machine -> camera, not the inverse as the name suggests.
export function generateCamToMachineMatrix(params: RemapStepParams) {
  return computeMatrix(params);
}

// For converting a machine frame to a camera frame. The matrix projects camera -> machine, not the inverse as the name suggests.
export function generateMachineToCamMatrix(params: RemapStepParams) {
  return computeMatrix(params).invert();
}
