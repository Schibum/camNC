import { adaptCamToResolution, isCamCalibrated } from './cam-resolution';
import { ICamSource } from './store';

/**
 * What the person says about the camera a setup is copied from:
 * - `same-spot`: the same physical camera, not moved, e.g. only the way its video reaches the app changed;
 * - `moved`: the same camera (lens) in another place;
 * - `other-camera`: another camera on the same machine, so only the markers on the machine carry over.
 */
export type ImportScope = 'same-spot' | 'moved' | 'other-camera';

/** Whether `camera` has anything worth copying into another camera. */
export function hasSetup(camera: ICamSource) {
  return !!camera.calibration || !!camera.markerPositions?.length;
}

/** A short summary of how far `camera` is set up. */
export function setupStatus(camera: ICamSource) {
  if (isCamCalibrated(camera)) return 'calibrated, markers set';
  if (camera.calibration) return 'calibrated, markers not set';
  if (camera.markerPositions?.length) return 'markers measured, not calibrated';
  return 'not calibrated';
}

/**
 * The settings to copy from `from` into `target` for `scope`. Lens calibration and marker pixels are rescaled to the
 * target's resolution, or left out when the aspect ratio differs (see `adaptCamToResolution`).
 */
export function importSetup(target: ICamSource, from: ICamSource, scope: ImportScope): Partial<ICamSource> {
  const changes: Partial<ICamSource> = {
    // Where the markers sit on the machine doesn't depend on the camera.
    markerPositions: from.markerPositions?.map(p => p.clone()),
    arucoTagSize: from.arucoTagSize,
    calibration: undefined,
    markerPosInCam: undefined,
    extrinsics: undefined,
  };
  if (scope === 'other-camera') return changes;
  const adapted = { ...from, ...adaptCamToResolution(from, target.maxResolution) };
  changes.calibration = adapted.calibration && {
    calibration_matrix: adapted.calibration.calibration_matrix.clone(),
    new_camera_matrix: adapted.calibration.new_camera_matrix.clone(),
    distortion_coefficients: [...adapted.calibration.distortion_coefficients],
  };
  if (scope === 'moved' || !changes.calibration) return changes;
  changes.markerPosInCam = adapted.markerPosInCam?.map(p => p.clone());
  changes.extrinsics = adapted.extrinsics && { R: adapted.extrinsics.R.clone(), t: adapted.extrinsics.t.clone() };
  return changes;
}

/** IPv4 addresses in a source URL, also inside an encoded go2rtc source, without loopback. */
function hostsOf(url: string): Set<string> {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Keep the URL as it is.
  }
  const hosts = decoded.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  return new Set(hosts.filter(host => !host.startsWith('127.')));
}

/**
 * The camera a new camera most likely is: one that streams from the same address, else one with the same resolution,
 * else the first. Only cameras with a setup to copy are considered.
 */
export function suggestImportSource(cameras: [string, ICamSource][], target: ICamSource): string | undefined {
  const candidates = cameras.filter(([, camera]) => camera !== target && hasSetup(camera));
  const targetHosts = hostsOf(target.url);
  const sameHost = candidates.find(([, camera]) => [...hostsOf(camera.url)].some(host => targetHosts.has(host)));
  const sameResolution = candidates.find(
    ([, camera]) => camera.maxResolution[0] === target.maxResolution[0] && camera.maxResolution[1] === target.maxResolution[1]
  );
  return (sameHost ?? sameResolution ?? candidates[0])?.[0];
}
