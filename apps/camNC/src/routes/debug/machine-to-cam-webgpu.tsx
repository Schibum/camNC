import { useCameraExtrinsics, useNewCameraMatrix, useStore, useVideoUrl } from '@/store/store';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import {
  createVideoStreamProcessor,
  generateCamToMachineMatrix,
  generateMachineToCamMatrix,
  type StepConfig,
  type VideoPipelineWorkerAPI,
} from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { useEffect, useRef } from 'react';

export const Route = createFileRoute('/debug/machine-to-cam-webgpu')({
  component: MachineToCamRoute,
});

function MachineToCamRoute() {
  const videoUrl = useVideoUrl();
  const K = useNewCameraMatrix();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('bitmaprenderer');
    if (!ctx) return;

    const params = { K, R, t };
    const camToMachMat = Float32Array.from(generateCamToMachineMatrix(params));
    const machToCamMat = Float32Array.from(generateMachineToCamMatrix(params));

    const machineWidth = bounds.max.x - bounds.min.x;
    const machineHeight = bounds.max.y - bounds.min.y;
    const outWidth = 512;
    const outHeight = Math.round((outWidth * machineHeight) / machineWidth);

    const margin = 10;

    const steps: StepConfig[] = [
      {
        type: 'camToMachine',
        params: {
          outputSize: [outWidth, outHeight],
          machineBounds: [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y],
          matrix: camToMachMat,
        },
      },
      {
        type: 'machineToCam',
        params: {
          outputSize: [videoRef.current!.videoWidth || 640, videoRef.current!.videoHeight || 480],
          machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
          matrix: machToCamMat,
        },
      },
    ];

    const workerUrl = new URL('../../../../../packages/video-worker-utils/src/videoPipeline.worker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    const proxy = Comlink.wrap<VideoPipelineWorkerAPI>(worker);

    let stream: ReadableStream<VideoFrame> | MediaStreamTrack;
    let running = true;

    const setup = async () => {
      stream = await createVideoStreamProcessor(videoUrl);
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
  }, [videoUrl, bounds, K, R, t]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Machine→Cam Debug" className="absolute" />
      <video ref={videoRef} src={videoUrl} autoPlay playsInline muted className="hidden" />
      <div className="flex gap-4 pt-16">
        <canvas ref={canvasRef} width={512} height={512} className="border" />
      </div>
    </div>
  );
}

export default MachineToCamRoute;
