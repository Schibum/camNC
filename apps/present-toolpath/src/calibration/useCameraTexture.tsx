import { useVideoSrc } from '@/store';
import { useVideoTexture } from '@react-three/drei';

export function useCameraTexture() {
  const videoSrc = useVideoSrc();
  // Use drei's useVideoTexture hook to load video texture
  const videoTexture = useVideoTexture(videoSrc, {
    crossOrigin: 'anonymous',
    muted: true,
    loop: true,
    start: true,
  });
  console.log('videoTexture', videoTexture);
  // videoTexture.flipY = false;
  return videoTexture;
}
