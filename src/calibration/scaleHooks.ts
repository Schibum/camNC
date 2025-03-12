import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useVideoDimensions } from '@/store';

// Returns the scale factor from video pixels to world units.
// Used as minimum for the camera, so the video is fully contained in the viewport.
// Example: if the video is 1920x1080 and the viewport is 100x100, then the scale factor is 100 / 1920.
// Multiplied by the world / video pixel coordinates, you get the viewport coordinates.
export function useViewportToWorldScale() {
  const size = useThree(state => state.size);
  const videoDimensions = useVideoDimensions();
  const containerAspect = size.width / size.height;
  const videoAspect = videoDimensions[0] / videoDimensions[1];
  return containerAspect < videoAspect
    ? size.width / videoDimensions[0]
    : size.height / videoDimensions[1];
}

export function useContain(videoWidth: number, videoHeight: number) {
  const videoToWorldScale = useViewportToWorldScale();
  console.log(
    'videoToWorldScale',
    videoToWorldScale,
    videoWidth,
    videoHeight,
    videoToWorldScale * videoWidth,
    videoToWorldScale * videoHeight
  );
  return useMemo(
    () => ({
      planeWidth: videoWidth * videoToWorldScale,
      planeHeight: videoHeight * videoToWorldScale,
    }),
    [videoWidth, videoHeight, videoToWorldScale]
  );
}
