import { useVideoUrl } from '@/store/store';
import { useVideoTexture } from '@react-three/drei';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';

export function useCameraTexture() {
  const videoUrl = useVideoUrl();
  const { src } = useVideoSource(videoUrl);
  // Use drei's useVideoTexture hook to load video texture
  const videoTexture = useVideoTexture(src, {
    crossOrigin: 'anonymous',
    muted: true,
    loop: true,
    start: true,
  });
  // videoTexture.flipY = false;
  return videoTexture;
}
