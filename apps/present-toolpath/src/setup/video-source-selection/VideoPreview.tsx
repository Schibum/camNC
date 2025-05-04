import { useVideoSource } from '@wbcnc/go2webrtc/video-source';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { useLayoutEffect, useRef } from 'react';

export function VideoPreview({
  connectionUrl,
  ...props
}: { connectionUrl: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const { src } = useVideoSource(connectionUrl);

  if (!src) return <LoadingSpinner className="size-20" />;
  return <MediaSourceVideo src={src} {...props} />;
}
function MediaSourceVideo({ src, ...props }: { src: string | MediaStream } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    if (!src || !videoRef.current) return;
    if (src instanceof MediaStream) {
      videoRef.current.srcObject = src;
    } else {
      videoRef.current.src = src;
    }
  }, [src]);
  return (
    <video
      crossOrigin="anonymous"
      autoPlay
      playsInline
      muted
      className="h-auto w-fit-content object-contain rounded-md"
      {...props}
      ref={videoRef}
    />
  );
}
