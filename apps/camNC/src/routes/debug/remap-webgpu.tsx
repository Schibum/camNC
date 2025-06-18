import { useCameraExtrinsics, useCamResolution, useNewCameraMatrix, useStore, useVideoUrl } from '@/store/store';
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

export const Route = createFileRoute('/debug/remap-webgpu')({
  component: RouteComponent,
});

function RouteComponent() {
  const videoUrl = useVideoUrl();
  const camRes = useCamResolution();
  const K = useNewCameraMatrix();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);

  const videoRef = useRef<HTMLVideoElement>(null);
  const camToMachineCanvas = useRef<HTMLCanvasElement>(null);
  const backCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!videoRef.current || !camToMachineCanvas.current || !backCanvas.current) return;

    const ctx1 = camToMachineCanvas.current.getContext('bitmaprenderer');
    const ctx2 = backCanvas.current.getContext('bitmaprenderer');
    if (!ctx1 || !ctx2) return;

    const params = {
      K: K,
      R: R,
      t: t,
    };
    const camToMachMat = Float32Array.from(generateCamToMachineMatrix(params));
    const machToCamMat = Float32Array.from(generateMachineToCamMatrix(params));

    const machineWidth = bounds.max.x - bounds.min.x;
    const machineHeight = bounds.max.y - bounds.min.y;
    const outWidth = 512;
    const outHeight = Math.round((outWidth * machineHeight) / machineWidth);

    const camToMachineParams = {
      outputSize: [outWidth, outHeight],
      machineBounds: [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y],
      matrix: camToMachMat,
    } as const;

    const margin = 10;
    const machineToCamParams = {
      outputSize: camRes,
      machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
      matrix: machToCamMat,
    } as const;

    const workerUrl = new URL('../../../../../packages/video-worker-utils/src/videoPipeline.worker.ts', import.meta.url);
    const worker1 = new Worker(workerUrl, { type: 'module' });
    const worker2 = new Worker(workerUrl, { type: 'module' });
    const proxy1 = Comlink.wrap<VideoPipelineWorkerAPI>(worker1);
    const proxy2 = Comlink.wrap<VideoPipelineWorkerAPI>(worker2);

    let stream1: ReadableStream<VideoFrame> | MediaStreamTrack;
    let stream2: ReadableStream<VideoFrame> | MediaStreamTrack;

    let running = true;

    const setup = async () => {
      stream1 = await createVideoStreamProcessor(videoUrl);
      stream2 = await createVideoStreamProcessor(videoUrl);
      await proxy1.init(Comlink.transfer(stream1 as any, [stream1 as any]), [
        { type: 'camToMachine', params: camToMachineParams } as StepConfig,
      ]);
      await proxy2.init(Comlink.transfer(stream2 as any, [stream2 as any]), [
        { type: 'camToMachine', params: camToMachineParams } as StepConfig,
        { type: 'machineToCam', params: machineToCamParams } as StepConfig,
      ]);

      const render = async () => {
        if (!running) return;
        const [bmp1, bmp2] = await Promise.all([proxy1.process(), proxy2.process()]);
        ctx1.transferFromImageBitmap(bmp1);
        ctx2.transferFromImageBitmap(bmp2);
        bmp1.close();
        bmp2.close();
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    };

    setup();

    return () => {
      running = false;
      worker1.terminate();
      worker2.terminate();
      if (stream1 instanceof ReadableStream) stream1.cancel().catch(() => undefined);
      if (stream2 instanceof ReadableStream) stream2.cancel().catch(() => undefined);
    };
  }, [videoUrl, bounds, K, R, t, camRes]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Remap Debug" className="absolute" />
      <video ref={videoRef} src={videoUrl} autoPlay playsInline muted className="hidden" />
      <div className="flex gap-4 pt-16">
        <canvas ref={camToMachineCanvas} width={512} height={512} className="border" />
        <canvas ref={backCanvas} width={camRes[0]} height={camRes[1]} className="border" />
      </div>
    </div>
  );
}

export default RouteComponent;
