import React, { useEffect, useRef } from 'react';
import type { Mat, Size } from '@techstark/opencv-js';

declare const cv: {
  imread: (canvas: HTMLCanvasElement) => Mat;
  matFromArray: (rows: number, cols: number, type: number, array: number[]) => Mat;
  getPerspectiveTransform: (src: Mat, dst: Mat) => Mat;
  warpPerspective: (src: Mat, dst: Mat, M: Mat, dsize: Size) => void;
  imshow: (canvas: HTMLCanvasElement, mat: Mat) => void;
  CV_32FC2: number;
  Size: new (width: number, height: number) => Size;
  Mat: new () => Mat;
};
const cvGlobalVariable: string = "cv";
const checkForCVIntervalMs: number = 200;

export const waitForCv = async () => {
  let timeout;
  while (!window.hasOwnProperty(cvGlobalVariable)) {
    await new Promise(resolve => {
      clearTimeout(timeout);
      timeout = setTimeout(resolve, checkForCVIntervalMs);
    });
  }
  clearTimeout(timeout);
}

interface ImageUnskewProps {
  imageSrc: string;
}

const ImageUnskew: React.FC<ImageUnskewProps> = ({ imageSrc }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applyPerspectiveTransform = (canvas: HTMLCanvasElement) => {
    const newWidth = 625;
    const newHeight = 1235;

    const srcCorners = [
      480, 700,   // Top-left
      1655, 950,  // Top-right
      105, 3388,  // Bottom-left
      2173, 3251, // Bottom-right
    ];

    const dstCorners = [
      0, 0,           // Top-left
      newWidth, 0,    // Top-right
      0, newHeight,   // Bottom-left
      newWidth, newHeight // Bottom-right
    ];

    let src = cv.imread(canvas);
    let srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcCorners);
    let dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstCorners);
    let transformMatrix = cv.getPerspectiveTransform(srcMat, dstMat);
    console.log("transformMatrix", transformMatrix.data64F);
    const data = transformMatrix.data64F;

    console.log(`[${data[0]}, ${data[1]}, ${data[2]}]`);
    console.log(`[${data[3]}, ${data[4]}, ${data[5]}]`);
    console.log(`[${data[6]}, ${data[7]}, ${data[8]}]`);
    let dst = new cv.Mat();

    cv.warpPerspective(
      src,
      dst,
      transformMatrix,
      new cv.Size(newWidth, newHeight)
    );

    cv.imshow(canvas, dst);

    // Cleanup
    src.delete();
    dst.delete();
    srcMat.delete();
    dstMat.delete();
    transformMatrix.delete();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = async function () {
      await waitForCv();
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      applyPerspectiveTransform(canvas);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  return (
    <div>
      <canvas ref={canvasRef} />
    </div>
  );
};

export default ImageUnskew;
