import { useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useAtomValue } from 'jotai';
import { suspend } from 'suspend-react';
import { CalibrationData, CameraUndistorter } from './undistort';
import { useFrame, useThree } from '@react-three/fiber';
import { calibrationDataAtom, videoSrcAtom } from '../atoms';
import * as THREE from 'three';
import { waitForOpenCvGlobal } from './waitForOpenCvGlobal';

function useCanvas() {
  const canvas = useMemo(() => {
    const canvas = document.createElement('canvas');
    console.log('cerating canvas', canvas);
    return canvas;
  }, []);
  return canvas;
}

const useVideoFrame = (video: HTMLVideoElement, f?: VideoFrameRequestCallback) => {
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

function useLoadedVideo() {
  const videoSrc = useAtomValue(videoSrcAtom);
  const video = suspend(
    () =>
      new Promise<HTMLVideoElement>(resolve => {
        console.log('creating video');
        const video = document.createElement('video');
        video.src = videoSrc;
        video.muted = true;
        video.crossOrigin = 'anonymous';
        video.loop = true;
        video.playsInline = true;
        video.addEventListener('loadedmetadata', () => {
          resolve(video);
        });
        video.play();
      }),
    [videoSrc]
  );
  return video;
}

export function useUndistortedCanvas() {
  const video = useLoadedVideo();
  const calibrationData = useAtomValue(calibrationDataAtom);
  // This is a global cache that is currently never disposed of.
  // We may want to move it to a state (async atom?)
  const [undistorter, canvas] = suspend(async () => {
    const canvas = document.createElement('canvas');
    canvas.id = crypto.randomUUID();
    console.log('creating undistorter with output canvas', canvas);
    await waitForOpenCvGlobal();
    const undistorter = new CameraUndistorter({
      calibrationData: calibrationData,
      videoElement: video,
      outputCanvas: canvas,
      preferWebGPU: true,
    });
    await undistorter.initialize();
    return [undistorter, canvas] as const;
  }, ['cam-undistorter']);

  // useEffect(() => {
  //   return () => {
  //     console.log('disposing undistorter');
  //     undistorter.dispose();
  //   };
  // }, [undistorter]);

  useVideoFrame(video, () => {
    undistorter.processFrame();
  });

  return canvas;
}

export function UndistortedTexture() {
  const canvas = useUndistortedCanvas();
  const textureRef = useRef<THREE.Texture>(null);

  useFrame(() => {
    if (!textureRef.current) return;
    textureRef.current.needsUpdate = true;
  });

  return (
    <canvasTexture
      ref={textureRef}
      flipY={false}
      minFilter={THREE.LinearFilter}
      magFilter={THREE.LinearFilter}
      colorSpace={THREE.SRGBColorSpace}
      attach="map"
      args={[canvas]}
    />
  );
}
