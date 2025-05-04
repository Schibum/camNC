import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { Suspense, forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

export interface VideoPreviewRef {
  maxResolution?: VideoDimensions;
}

export type VideoPreviewProps = {
  connectionUrl: string;
} & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>;

export const VideoPreview = forwardRef<VideoPreviewRef, VideoPreviewProps>(function VideoPreview({ connectionUrl, ...props }, ref) {
  return (
    <Suspense fallback={<LoadingSpinner className="size-20" />}>
      <VideoPreviewInner ref={ref} connectionUrl={connectionUrl} {...props} />
    </Suspense>
  );
});

interface VideoPreviewInnerProps extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  connectionUrl: string;
}

const VideoPreviewInner = forwardRef<VideoPreviewRef, VideoPreviewInnerProps>(function VideoPreviewInner({ connectionUrl, ...props }, ref) {
  const { src, maxResolution } = useVideoSource(connectionUrl);

  useImperativeHandle(ref, () => ({
    maxResolution,
  }));

  return <MediaSourceVideo src={src} {...props} />;
});

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
