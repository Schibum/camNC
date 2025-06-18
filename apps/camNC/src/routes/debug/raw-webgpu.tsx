import { useCalibrationData, useCamResolution, useVideoUrl } from '@/store/store';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { createVideoStreamProcessor, type StepConfig, type VideoPipelineWorkerAPI } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { useEffect, useRef } from 'react';

export const Route = createFileRoute('/debug/raw-webgpu')({
  component: RawWebGPURoute,
});

function RawWebGPURoute() {
  const videoUrl = useVideoUrl();
  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('bitmaprenderer');
    if (!ctx) return;

    const workerUrl = new URL('../../../../../packages/video-worker-utils/src/videoPipeline.worker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    const proxy = Comlink.wrap<VideoPipelineWorkerAPI>(worker);

    let stream: ReadableStream<VideoFrame> | MediaStreamTrack;
    let running = true;

    const setup = async () => {
      stream = await createVideoStreamProcessor(videoUrl);
      const undistortParams = {
        outputSize: camRes,
        cameraMatrix: calibration.calibration_matrix,
        newCameraMatrix: calibration.new_camera_matrix,
        distCoeffs: calibration.distortion_coefficients,
      } as const;

      const steps: StepConfig[] = [{ type: 'undistort', params: undistortParams }];

      await proxy.init(Comlink.transfer(stream as any, [stream as any]), steps);

      const render = async () => {
        if (!running) return;
        const bmp = await proxy.process();
        ctx.transferFromImageBitmap(bmp);
        bmp.close();
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    };

    setup();

    return () => {
      running = false;
      worker.terminate();
      if (stream instanceof ReadableStream) stream.cancel().catch(() => undefined);
    };
  }, [videoUrl, calibration, camRes]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Raw Video Debug" className="absolute" />
      <video ref={videoRef} src={videoUrl} autoPlay playsInline muted className="hidden" />
      <div className="flex gap-4 pt-16">
        <canvas ref={canvasRef} width={camRes[0] * 0.4} height={camRes[1] * 0.4} className="border" />
      </div>
    </div>
  );
}

export default RawWebGPURoute;
