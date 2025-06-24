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

export function createRemapUniform(params: RemapStepParams): Float32Array {
  const floats = new Float32Array(64);

  const camToMachMat = Float32Array.from(
    params.combinedProjectionMatrix
      ? params.combinedProjectionMatrix.toArray()
      : generateCamToMachineMatrix({ K: params.newCameraMatrix, R: params.R, t: params.t })
  );
  let base = 0;
  packMat3(camToMachMat, base, floats); // cam→machine matrix
  base += 12;
  // bounds vec4
  floats.set(params.machineBounds, base);
  base += 4;
  // cameraMatrix, newCameraMatrix, R
  packMat3(params.cameraMatrix.elements, base, floats);
  base += 12;
  packMat3(params.newCameraMatrix.elements, base, floats);
  base += 12;
  // distCoeffs vec4
  const getCoeff = (i: number) => (params.distCoeffs[i] !== undefined ? params.distCoeffs[i]! : 0);
  floats[base++] = getCoeff(0);
  floats[base++] = getCoeff(1);
  floats[base++] = getCoeff(2);
  floats[base++] = getCoeff(3);
  // k3
  floats[base++] = getCoeff(4);

  return floats;
}
