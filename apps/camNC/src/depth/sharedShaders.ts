// Shared WGSL snippet that converts an undistorted pixel coordinate (u,v)
// to its raw camera sensor coordinate taking distortion into account.
// It uses the global `params` uniform (camera matrices + distortion).
export const UNDISTORT_WGSL = `
fn undistort_uv(u: f32, v: f32) -> vec2<f32> {
  let fx_new = params.newCameraMatrix[0][0];
  let fy_new = params.newCameraMatrix[1][1];
  let cx_new = params.newCameraMatrix[2][0];
  let cy_new = params.newCameraMatrix[2][1];
  var nx = (u - cx_new) / fx_new;
  var ny = (v - cy_new) / fy_new;
  var vec = vec3<f32>(nx, ny, 1.0);
  var x = vec.x / vec.z;
  var y = vec.y / vec.z;
  var r2 = x * x + y * y;
  var radial = 1.0 + params.distCoeffs.x * r2 + params.distCoeffs.y * r2 * r2 + params.k3 * r2 * r2 * r2;
  var deltaX = 2.0 * params.distCoeffs.z * x * y + params.distCoeffs.w * (r2 + 2.0 * x * x);
  var deltaY = params.distCoeffs.z * (r2 + 2.0 * y * y) + 2.0 * params.distCoeffs.w * x * y;
  var xd = x * radial + deltaX;
  var yd = y * radial + deltaY;
  let fx = params.cameraMatrix[0][0];
  let fy = params.cameraMatrix[1][1];
  let cx = params.cameraMatrix[2][0];
  let cy = params.cameraMatrix[2][1];
  var srcX = fx * xd + cx;
  var srcY = fy * yd + cy;
  return vec2<f32>(srcX, srcY);
}`;
