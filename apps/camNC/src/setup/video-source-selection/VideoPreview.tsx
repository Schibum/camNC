import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { Suspense, useImperativeHandle, useLayoutEffect, useRef } from 'react';

export interface VideoPreviewRef {
  getMaxResolution: () => VideoDimensions;
}

export type VideoPreviewProps = {
  connectionUrl: string;
  ref?: React.Ref<VideoPreviewRef>;
} & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>;

export const VideoPreview = ({ connectionUrl, ref, ...props }: VideoPreviewProps) => {
  return (
    <Suspense fallback={<LoadingSpinner className="size-20" />}>
      <VideoPreviewInner ref={ref} connectionUrl={connectionUrl} {...props} />
    </Suspense>
  );
};

interface VideoPreviewInnerProps extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  connectionUrl: string;
  ref?: React.Ref<VideoPreviewRef>;
}

const VideoPreviewInner = ({ connectionUrl, ref, ...props }: VideoPreviewInnerProps) => {
  const { src, maxResolution } = useVideoSource(connectionUrl);
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    // Max resolution for dynamic-resolution sources or actual resolution else.
    getMaxResolution: () => {
      if (maxResolution) {
        return maxResolution;
      } else if (videoRef.current) {
        return {
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight,
        };
      }
      throw new Error('could not get max resolution');
    },
  }));

  return <MediaSourceVideo src={src} {...props} ref={videoRef} />;
};

const MediaSourceVideo = function MediaSourceVideo({
  src,
  ref,
  ...props
}: { src: string | MediaStream; ref?: React.Ref<HTMLVideoElement> } & Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);
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
};
