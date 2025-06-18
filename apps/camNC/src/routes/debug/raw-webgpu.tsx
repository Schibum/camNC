import { useCalibrationData, useCameraExtrinsics, useCamResolution, useStore, useVideoUrl } from '@/store/store';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import {
  createVideoStreamProcessor,
  generateCamToMachineMatrix,
  generateMachineToCamMatrix,
  type StepConfig,
  type VideoPipelineWorkerAPI,
} from '@wbcnc/video-worker-utils';
import * as Comlink from 'comlink';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/debug/raw-webgpu')({
  component: RawWebGPURoute,
});

function RawWebGPURoute() {
  const videoUrl = useVideoUrl();
  const calibration = useCalibrationData();
  const camRes = useCamResolution();
  const { R, t } = useCameraExtrinsics();
  const bounds = useStore(state => state.camSource!.machineBounds!);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<'none' | 'undistort' | 'camToMachine' | 'machineToCam'>('none');

  // Derived output size for cam→machine step (shared in effect + JSX)
  const machineWidth = bounds.max.x - bounds.min.x;
  const machineHeight = bounds.max.y - bounds.min.y ? bounds.max.y - bounds.min.y : 1;
  const outWidth = 1024;
  const outHeight = Math.round((outWidth * machineHeight) / machineWidth);

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

      const steps: StepConfig[] = [];

      if (mode === 'undistort') {
        steps.push({ type: 'undistort', params: undistortParams });
      }

      const camToMachMat = Float32Array.from(generateCamToMachineMatrix({ K: calibration.new_camera_matrix, R, t }));

      const machToCamMat = Float32Array.from(generateMachineToCamMatrix({ K: calibration.new_camera_matrix, R, t }));

      const margin = 20;
      const camToMachineParams: StepConfig['params'] = {
        outputSize: [outWidth, outHeight],
        machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
        matrix: camToMachMat,
        cameraMatrix: calibration.calibration_matrix,
        newCameraMatrix: calibration.new_camera_matrix,
        distCoeffs: calibration.distortion_coefficients,
      };

      const machineToCamParams: StepConfig['params'] = {
        outputSize: camRes,
        machineBounds: [bounds.min.x - margin, bounds.min.y - margin, bounds.max.x + margin, bounds.max.y + margin],
        matrix: machToCamMat,
      };

      if (mode === 'camToMachine') {
        steps.push({ type: 'camToMachine', params: camToMachineParams });
      }

      if (mode === 'machineToCam') {
        steps.push({ type: 'camToMachine', params: camToMachineParams });
        steps.push({ type: 'machineToCam', params: machineToCamParams });
      }

      console.log('steps', steps);
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
  }, [videoUrl, calibration, camRes, R, t, bounds, mode]);

  return (
    <div className="relative w-full h-full p-4 space-y-4">
      <PageHeader title="WebGPU Raw Video Debug" className="absolute" />
      <video ref={videoRef} src={videoUrl} autoPlay playsInline muted className="hidden" />
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
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-4 pt-4">
        <canvas ref={canvasRef} width={camRes[0] * 0.5} height={camRes[1] * 0.5} className="border" />
      </div>
    </div>
  );
}

export default RawWebGPURoute;
