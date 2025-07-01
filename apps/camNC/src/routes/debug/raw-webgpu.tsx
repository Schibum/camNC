import { RemapStepParams } from '@/depth/remapPipeline';
import { Config, VideoPipelineWorkerAPI } from '@/depth/videoPipeline.worker';
import { useAutoScanMarkers } from '@/hooks/useAutoScanMarkers';
import { useCalibrationData, useCameraExtrinsics, useCamResolution, useStore, useVideoUrl } from '@/store/store';
import { createFileRoute } from '@tanstack/react-router';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { createVideoStreamProcessor, registerThreeJsTransferHandlers } from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/debug/raw-webgpu')({
  component: RawWebGPURoute,
});

registerThreeJsTransferHandlers();

function RawWebGPURoute() {
  useAutoScanMarkers({ intervalMs: 5000 });
  const { src: vidSource } = useVideoSource(useVideoUrl());
  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [displaySize, setDisplaySize] = useState<[number, number]>([1024, 1024]);

  // Derived output size for cam→machine step (shared in effect + JSX)
  const machineWidth = bounds.max.x - bounds.min.x;
  const machineHeight = bounds.max.y - bounds.min.y ? bounds.max.y - bounds.min.y : 1;
  const outWidth = 1024;
  const outHeight = Math.round((outWidth * machineHeight) / machineWidth);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('bitmaprenderer');
    if (!ctx) return;

    const workerUrl = new URL('../../depth/videoPipeline.worker.ts', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });
    const proxy = Comlink.wrap<VideoPipelineWorkerAPI>(worker);

    let stream: ReadableStream<VideoFrame> | MediaStreamTrack;
    let running = true;

    const setup = async () => {
      stream = await createVideoStreamProcessor(vidSource);

      const margin = 20;
      const params: RemapStepParams = {
        outputSize: [outWidth, outHeight],
        machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
        cameraMatrix: calibration.calibration_matrix,
        newCameraMatrix: calibration.new_camera_matrix,
        distCoeffs: calibration.distortion_coefficients,
        R: R,
        t: t,
      };

      params.outputSize = camRes;
      const cfg: Config = { mode: 'depth', params };

      setDisplaySize(camRes);

      await proxy.init(Comlink.transfer(stream as any, [stream as any]), cfg);

      await proxy.start(
        Comlink.proxy((result: { bg: ImageBitmap }) => {
          if (!running) return;
          ctx.transferFromImageBitmap(result.bg);
          result.bg.close();
        })
      );
    };

    setup();

    return () => {
      running = false;
      proxy.stop?.().catch(() => undefined);
      worker.terminate();
      if (stream instanceof ReadableStream) stream.cancel().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vidSource, calibration, camRes, bounds]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Raw Video Debug" className="absolute" />
      <div className="flex items-center gap-4 pt-15 text-sm">Mode: depth (streaming)</div>
      <div className="flex gap-4 pt-4">
        <canvas ref={canvasRef} width={displaySize[0] * 0.5} height={displaySize[1] * 0.5} className="border" />
      </div>
    </div>
  );
}

export default RawWebGPURoute;
