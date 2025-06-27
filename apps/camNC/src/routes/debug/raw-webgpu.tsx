import { RemapStepParams } from '@/depth/remapPipeline';
import { Config, VideoPipelineWorkerAPI } from '@/depth/videoPipeline.worker';
import { useAutoScanMarkers } from '@/hooks/useAutoScanMarkers';
import { useCalibrationData, useCameraExtrinsics, useCamResolution, useStore, useVideoUrl } from '@/store/store';
import { createFileRoute } from '@tanstack/react-router';
import { useVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
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

  const [mode, setMode] = useState<'none' | 'undistort' | 'camToMachine' | 'machineToCam' | 'depth'>('depth');
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

      let cfg: Config | null = null;
      switch (mode) {
        case 'camToMachine':
          cfg = { mode: 'camToMachine', params: params };
          break;
        case 'machineToCam':
          params.outputSize = camRes;
          cfg = { mode: 'machineToCam', params: params };
          break;
        case 'depth':
          params.outputSize = camRes;
          cfg = { mode: 'depth', params: params };
          break;
        case 'undistort':
          params.outputSize = camRes;
          cfg = { mode: 'undistort', params: params };
          break;
        case 'none':
          cfg = { mode: 'none' };
          break;
        default:
          throw new Error('Invalid mode');
      }

      setDisplaySize(cfg.mode === 'none' ? camRes : cfg.params.outputSize);
      await proxy.init(Comlink.transfer(stream as any, [stream as any]), cfg);

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
  }, [vidSource, calibration, camRes, bounds, mode]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Raw Video Debug" className="absolute" />
      <div className="flex items-center gap-4 pt-15">
        <span className="text-sm font-medium">Processing:</span>
        <Select value={mode} onValueChange={val => setMode(val as any)}>
          <SelectTrigger>
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="undistort">Undistort</SelectItem>
            <SelectItem value="camToMachine">Cam → Machine</SelectItem>
            <SelectItem value="machineToCam">Machine → Cam</SelectItem>
            <SelectItem value="depth">Cam → Machine → Depth</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-4 pt-4">
        <canvas ref={canvasRef} width={displaySize[0] * 0.5} height={displaySize[1] * 0.5} className="border" />
      </div>
    </div>
  );
}

export default RawWebGPURoute;
