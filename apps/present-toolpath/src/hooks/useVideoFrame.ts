import { useEffect } from 'react';

// From https://github.com/pmndrs/drei/blob/master/src/core/VideoTexture.tsx
export const useVideoFrame = (video: HTMLVideoElement, f?: VideoFrameRequestCallback) => {
  useEffect(() => {
    if (!f) return;
    if (!video.requestVideoFrameCallback) return;

    let handle: ReturnType<(typeof video)['requestVideoFrameCallback']>;
    const callback: VideoFrameRequestCallback = (...args) => {
      f(...args);
      handle = video.requestVideoFrameCallback(callback);
    };
    video.requestVideoFrameCallback(callback);

    return () => video.cancelVideoFrameCallback(handle);
  }, [video, f]);
};
