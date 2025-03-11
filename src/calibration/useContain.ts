import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';

function useContain(videoWidth: number, videoHeight: number) {
  const size = useThree(s => s.size);

  return useMemo(() => {
    const containerAspect = size.width / size.height;
    const videoAspect = videoWidth / videoHeight;

    let planeWidth, planeHeight;
    if (containerAspect > videoAspect) {
      // Container is wider than video - fit to height
      planeHeight = size.height;
      planeWidth = planeHeight * videoAspect;
    } else {
      // Container is taller than video - fit to width
      planeWidth = size.width;
      planeHeight = planeWidth / videoAspect;
    }

    return { planeWidth, planeHeight };
  }, [size, videoWidth, videoHeight]);
}

export default useContain;
