import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { Suspense, useLayoutEffect, useRef } from 'react';

// Public component: wraps inner preview in Suspense
export function VideoPreview({
  connectionUrl,
  ...props
}: { connectionUrl: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  return (
    <Suspense fallback={<LoadingSpinner className="size-20" />}>
      <VideoPreviewInner connectionUrl={connectionUrl} {...props} />
    </Suspense>
  );
}

// Inner component that actually calls the hook (must be inside Suspense)
function VideoPreviewInner({
  connectionUrl,
  ...props
}: { connectionUrl: string } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const { src } = useVideoSource(connectionUrl);
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
