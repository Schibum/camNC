import { detectMarkersInStillFrame, getValidMarkers, kExpectedMarkerCount, setMarkersAndRecompute } from '@/store/store-p3p';

/** Below this, a setup matches the live picture well enough to use it as it is. */
export const kGoodReprojectionErrorPx = 3;

export type SetupCheck =
  | { state: 'good'; error: number }
  /** All markers found, but the setup doesn't fit the picture well. */
  | { state: 'off'; error: number }
  | { state: 'missing'; found: number }
  | { state: 'failed'; message: string };

/**
 * Checks the active camera's setup against its live picture: finds the markers and, when all are visible, stores
 * their positions in the picture and recomputes the camera pose from them.
 */
export async function checkSetupAgainstPicture(): Promise<SetupCheck> {
  try {
    const markers = getValidMarkers(await detectMarkersInStillFrame());
    if (markers.length < kExpectedMarkerCount) return { state: 'missing', found: markers.length };
    const error = setMarkersAndRecompute(markers);
    return { state: error > kGoodReprojectionErrorPx ? 'off' : 'good', error };
  } catch (e) {
    return { state: 'failed', message: (e as Error).message };
  }
}
