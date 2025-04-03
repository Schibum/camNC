import { useVideoSrc, useStore } from '@/store';
import { useVideoTexture } from '@react-three/drei';
import { useEffect } from 'react';


export function useCameraTexture() {
  const videoSrc = useVideoSrc();
  const setVideoDimensions = useStore(state => state.setVideoDimensions);
  // Use drei's useVideoTexture hook to load video texture
  const videoTexture = useVideoTexture(videoSrc, {
    crossOrigin: 'anonymous',
    muted: true,
    loop: true,
    start: true,
  });
  // videoTexture.flipY = false;
  useEffect(() => {
    setVideoDimensions([videoTexture.image.videoWidth, videoTexture.image.videoHeight]);
  }, [videoTexture.image.videoWidth, videoTexture.image.videoHeight, setVideoDimensions]);
  return videoTexture;
}
