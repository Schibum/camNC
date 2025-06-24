import { Matrix3 } from 'three';
import { StructuredView } from 'webgpu-utils';
import { generateCamToMachineMatrix, RemapStepParams } from './remapPipeline';

// Helper to pack a mat3x3 (column-major) into vec4 columns (std140).
export function packMat3(e: Readonly<Float32Array | number[]>, offset: number, outBuffer: Float32Array) {
  for (let c = 0; c < 3; c++) {
    outBuffer[offset + c * 4 + 0] = e[c * 3 + 0];
    outBuffer[offset + c * 4 + 1] = e[c * 3 + 1];
    outBuffer[offset + c * 4 + 2] = e[c * 3 + 2];
    // padding slot at +3 remains 0
  }
}

function padMat3(mat: Matrix3) {
  return [
    mat.elements[0],
    mat.elements[1],
    mat.elements[2],
    0,
    mat.elements[3],
    mat.elements[4],
    mat.elements[5],
    0,
    mat.elements[6],
    mat.elements[7],
    mat.elements[8],
    0,
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
    matrix: padMat3(
      params.combinedProjectionMatrix
        ? params.combinedProjectionMatrix
        : generateCamToMachineMatrix({ K: params.newCameraMatrix, R: params.R, t: params.t })
    ),
    bounds: params.machineBounds,
    cameraMatrix: padMat3(params.cameraMatrix),
    newCameraMatrix: padMat3(params.newCameraMatrix),
    distCoeffs: params.distCoeffs.slice(0, 4),
    k3: params.distCoeffs[4] !== undefined ? params.distCoeffs[4]! : 0,
  });
}
