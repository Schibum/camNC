import React, { useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useUndistorter } from './useUndistorter';
import { CalibrationData } from './undistort';
import VideoPlane from './VideoPlane';
import * as THREE from 'three';

interface VideoUndistorterProps {
  videoPath: string;
  calibrationData: CalibrationData;
}
// Function to wait for OpenCV.js to load
function waitForOpenCV() {
  return new Promise((resolve, reject) => {
    // Check if OpenCV is already loaded
    if ('cv' in window) {
      resolve(window.cv);
      return;
    }

    // Poll for window.cv to become available (it should be a promise)
    const intervalId = setInterval(() => {
      if ('cv' in window) {
        clearInterval(intervalId);
        // Assume window.cv is a promise that resolves to the API
        (window.cv as unknown as Promise<any>).then((cv2: any) => {
          resolve(cv2);
        }).catch(reject);
      }
    }, 100);

    // Set a timeout to avoid waiting forever
    setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error('Timeout waiting for OpenCV.js to load'));
    }, 30000); // 30 second timeout
  });
}

async function waitForOpenCvGlobal() {
  if ((window as any).cv.Mat) {
    return;
  }
  let cv = await waitForOpenCV();
  (window as any).cv = cv;
}

const VideoUndistorter: React.FC<VideoUndistorterProps> = ({ videoPath, calibrationData }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isError, setIsError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Use our custom hook to handle the undistortion process
  const {
    undistortedTextureRef,
    initialize,
    processFrame,
  } = useUndistorter(videoRef, canvasRef, calibrationData);

  // Handle video loading
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.src = videoPath;
      // videoRef.current.load();

      const onLoadedMetadata = async () => {
        console.log('Video loaded, initializing undistorter...');
        await waitForOpenCvGlobal();
        initialize()
          .then(success => {
            if (success) {
              console.log('Starting undistorted playback...');
              setIsError(false);
              // Start processing frames when initialized
              setIsProcessing(true);
              // Ensure video starts playing
              if (videoRef.current) {
                videoRef.current.play()
                  .catch(playError => {
                    console.error('Error starting video playback:', playError);
                    setIsError(true);
                  });
              }
            } else {
              console.log('Failed to initialize undistorter');
              setIsError(true);
            }
          })
          .catch(error => {
            console.error('Initialization error:', error);
            console.log(`Error initializing: ${error.message}`);
            setIsError(true);
          });
      };

      videoRef.current.addEventListener('loadedmetadata', onLoadedMetadata);

      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadedmetadata', onLoadedMetadata);
        }
      };
    }
  }, [videoPath, initialize]);

  // Animation loop for processing frames
  useEffect(() => {
    let animationFrameId: number | undefined = undefined;
    let video = videoRef.current;

    const animate = async () => {
      if (isProcessing && video && !video.paused && video.currentTime > 0) {
        try {
          await processFrame();
          animationFrameId = video.requestVideoFrameCallback(animate);
        } catch (error) {
          console.error('Error processing frame:', error);
          setIsError(true);
          setIsProcessing(false);
        }
      } else if (isProcessing) {
        // If we're supposed to be processing but the video isn't ready/playing yet,
        // keep checking until it is
        animationFrameId = video?.requestVideoFrameCallback(animate);
      }
    };

    if (isProcessing) {
      animate();
    }

    return () => {
      if (animationFrameId !== undefined) {
        video?.cancelVideoFrameCallback(animationFrameId);
      }
    };
  }, [isProcessing, processFrame]);

  if (isError) {
    return <div>Oops, see console for details</div>;
  }

  return (
    <>

      <div className="video-container">
        {/* Hidden video element used as the source */}
        <video
          ref={videoRef}
          style={{ display: 'none' }}
          autoPlay
          loop
          muted
          playsInline
          crossOrigin="anonymous"
        />

        {/* Hidden canvas for undistortion processing */}
        <canvas
          ref={canvasRef}
          style={{ display: 'none' }}
        />

        {/* Three.js scene with React Three Fiber */}
        {undistortedTextureRef.current && <Canvas
          camera={{
            position: [0, 0, 1.5],
            near: 0.1,
            far: 1000,
            type: "OrthographicCamera"
          }}
        >
          <OrthographicCamera makeDefault position={[0, 0, 1.5]} zoom={1} near={0.1} far={100} >
            <color attach="background" args={[0x1111ff]} />

          </OrthographicCamera>

          <VideoPlane
            textureRef={undistortedTextureRef}
            videoRef={videoRef}
          />

          <gridHelper
            args={[2, 10, 0x555555, 0x333333]}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, -0.01]}
          />
          <Html transform position={[0, 0, 1.5] } distanceFactor={1000} >
            <div>
              <p>Hello</p>
            </div>
          </Html>

          <OrbitControls
            enableDamping
            enableRotate={false}
            dampingFactor={0.25}
            screenSpacePanning={true}
            minZoom={1}
            maxZoom={10}
            zoomSpeed={2.0}
            mouseButtons={{
              LEFT: THREE.MOUSE.PAN,
            }}
            makeDefault
          />
        </Canvas>
        }
      </div>

      <div className="controls">
        <p className="controls-info">
          Use mouse to interact: Left click + drag to rotate, Right click + drag to pan, Scroll to zoom
        </p>
      </div>
    </>
  );
};

export default VideoUndistorter;